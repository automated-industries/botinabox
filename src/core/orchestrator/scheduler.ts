/**
 * Scheduler — database-backed job scheduling with cron expressions.
 *
 * Supports one-time and recurring schedules. When a schedule fires,
 * it emits the schedule's `action` as a hook event with the
 * `action_config` payload. Consumers subscribe to handle the action.
 *
 * Replaces HeartbeatScheduler for recurring use cases.
 */

import cronParser from "cron-parser";
import { v4 as uuid } from "uuid";
import type { DataStore } from "../data/data-store.js";
import type { HookBus } from "../hooks/hook-bus.js";

export interface ScheduleDef {
  name: string;
  description?: string;
  /** Cron expression for recurring schedules */
  cron?: string;
  /** ISO 8601 datetime for one-time schedules */
  runAt?: string;
  /** Hook event name to emit when fired */
  action: string;
  /** JSON-serializable payload passed to the hook */
  actionConfig?: Record<string, unknown>;
  timezone?: string;
}

export interface Schedule {
  id: string;
  name: string;
  description: string | null;
  type: "one_time" | "recurring";
  cron: string | null;
  run_at: string | null;
  timezone: string;
  enabled: number;
  action: string;
  action_config: string;
  last_fired_at: string | null;
  next_fire_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function computeNextFire(
  cron: string,
  timezone: string,
  after?: Date,
): string {
  const interval = cronParser.parseExpression(cron, {
    currentDate: after ?? new Date(),
    tz: timezone,
  });
  return interval.next().toISOString();
}

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private db: DataStore,
    private hooks: HookBus,
  ) {}

  /**
   * Start the scheduler. Computes initial next_fire_at for schedules
   * that don't have one, then polls for due schedules.
   */
  async start(pollIntervalMs = 30_000): Promise<void> {
    await this.initializeNextFireTimes();
    this.timer = setInterval(() => {
      void this.tick();
    }, pollIntervalMs);
    // Fire immediately on start
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Check for and fire due schedules. */
  async tick(): Promise<void> {
    const now = new Date().toISOString();
    const schedules = (
      await this.db.query("schedules", {
        where: { enabled: 1 },
      })
    ).filter(
      (s) =>
        s["deleted_at"] == null &&
        s["next_fire_at"] != null &&
        (s["next_fire_at"] as string) <= now,
    ) as unknown as Schedule[];

    for (const schedule of schedules) {
      try {
        const config = JSON.parse(schedule.action_config || "{}");

        // Emit the action hook (e.g. 'connector.sync', 'channel.send')
        await this.hooks.emit(schedule.action, {
          schedule_id: schedule.id,
          schedule_name: schedule.name,
          ...config,
        });

        // Emit observability hook
        await this.hooks.emit("schedule.fired", {
          schedule_id: schedule.id,
          schedule_name: schedule.name,
          action: schedule.action,
          fired_at: now,
        });

        // Update last_fired_at and compute next
        if (schedule.type === "recurring" && schedule.cron) {
          const nextFire = computeNextFire(
            schedule.cron,
            schedule.timezone,
            new Date(),
          );
          await this.db.update(
            "schedules",
            { id: schedule.id },
            {
              last_fired_at: now,
              next_fire_at: nextFire,
              updated_at: now,
            },
          );
        } else {
          // One-time: disable after firing
          await this.db.update(
            "schedules",
            { id: schedule.id },
            {
              last_fired_at: now,
              next_fire_at: null,
              enabled: 0,
              updated_at: now,
            },
          );
        }
      } catch (err) {
        console.error(
          `[Scheduler] Error firing schedule "${schedule.name}":`,
          err,
        );
        await this.hooks.emit("schedule.error", {
          schedule_id: schedule.id,
          schedule_name: schedule.name,
          error: String(err),
        });
      }
    }
  }

  /** Register a new schedule. */
  async register(def: ScheduleDef): Promise<string> {
    const id = uuid();
    const type = def.cron ? "recurring" : "one_time";
    const timezone = def.timezone ?? "UTC";

    let nextFire: string | null = null;
    if (def.cron) {
      nextFire = computeNextFire(def.cron, timezone);
    } else if (def.runAt) {
      nextFire = new Date(def.runAt).toISOString();
    }

    await this.db.insert("schedules", {
      id,
      name: def.name,
      description: def.description ?? null,
      type,
      cron: def.cron ?? null,
      run_at: def.runAt ?? null,
      timezone,
      enabled: 1,
      action: def.action,
      action_config: JSON.stringify(def.actionConfig ?? {}),
      next_fire_at: nextFire,
    });

    return id;
  }

  /** Update an existing schedule. */
  async update(
    id: string,
    changes: Partial<
      Pick<ScheduleDef, "name" | "cron" | "runAt" | "action" | "actionConfig" | "timezone" | "description">
    > & { enabled?: boolean },
  ): Promise<void> {
    const row: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (changes.name !== undefined) row["name"] = changes.name;
    if (changes.description !== undefined) row["description"] = changes.description;
    if (changes.action !== undefined) row["action"] = changes.action;
    if (changes.actionConfig !== undefined)
      row["action_config"] = JSON.stringify(changes.actionConfig);
    if (changes.enabled !== undefined) row["enabled"] = changes.enabled ? 1 : 0;

    if (changes.cron !== undefined) {
      row["cron"] = changes.cron;
      row["type"] = "recurring";
      row["run_at"] = null;
      row["next_fire_at"] = computeNextFire(
        changes.cron,
        changes.timezone ?? "UTC",
      );
    } else if (changes.runAt !== undefined) {
      row["run_at"] = changes.runAt;
      row["type"] = "one_time";
      row["cron"] = null;
      row["next_fire_at"] = new Date(changes.runAt).toISOString();
    }

    if (changes.timezone !== undefined) row["timezone"] = changes.timezone;

    await this.db.update("schedules", { id }, row);
  }

  /** Soft-delete a schedule. */
  async unregister(id: string): Promise<void> {
    await this.db.update("schedules", { id }, {
      enabled: 0,
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  /** List schedules, optionally filtered. */
  async list(filter?: {
    enabled?: boolean;
    action?: string;
  }): Promise<Schedule[]> {
    const where: Record<string, unknown> = {};
    if (filter?.enabled !== undefined) where["enabled"] = filter.enabled ? 1 : 0;
    if (filter?.action !== undefined) where["action"] = filter.action;

    return (
      await this.db.query("schedules", { where })
    ).filter((s) => s["deleted_at"] == null) as unknown as Schedule[];
  }

  /** Compute next_fire_at for any enabled schedule missing it. */
  private async initializeNextFireTimes(): Promise<void> {
    const schedules = (
      await this.db.query("schedules", { where: { enabled: 1 } })
    ).filter(
      (s) => s["deleted_at"] == null && s["next_fire_at"] == null,
    ) as unknown as Schedule[];

    for (const s of schedules) {
      let nextFire: string | null = null;

      if (s.type === "recurring" && s.cron) {
        nextFire = computeNextFire(s.cron, s.timezone);
      } else if (s.type === "one_time" && s.run_at) {
        nextFire = new Date(s.run_at).toISOString();
      }

      if (nextFire) {
        await this.db.update("schedules", { id: s.id }, {
          next_fire_at: nextFire,
          updated_at: new Date().toISOString(),
        });
      }
    }
  }
}
