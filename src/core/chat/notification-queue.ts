/**
 * NotificationQueue — persistent outbound notification queue with retry.
 * Story 4.4
 */

import type { DataStore } from "../data/data-store.js";
import type { HookBus } from "../hooks/hook-bus.js";
import type { ChannelRegistry } from "./channel-registry.js";
import type { OutboundPayload } from "./types.js";

export interface NotificationQueueOpts {
  maxRetries?: number;
  pollIntervalMs?: number;
}

export class NotificationQueue {
  private readonly maxRetries: number;
  private readonly pollIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly db: DataStore,
    private readonly hooks: HookBus,
    private readonly channelRegistry: ChannelRegistry,
    opts?: NotificationQueueOpts,
  ) {
    this.maxRetries = opts?.maxRetries ?? 3;
    this.pollIntervalMs = opts?.pollIntervalMs ?? 5_000;
  }

  /**
   * Enqueue a notification for delivery.
   * Returns the notification ID.
   */
  async enqueue(
    channel: string,
    recipient: string,
    payload: { text: string; threadId?: string; [key: string]: unknown },
  ): Promise<string> {
    if (!this.channelRegistry.has(channel)) {
      throw new Error(`No registered adapter for channel: ${channel}`);
    }

    const row = await this.db.insert("notifications", {
      channel,
      recipient_id: recipient,
      message: JSON.stringify(payload),
      status: "pending",
      retries: 0,
    });

    await this.hooks.emit("notification.enqueued", {
      notificationId: row["id"],
      channel,
      recipient,
    });

    return row["id"] as string;
  }

  /** Start the background worker polling for pending notifications. */
  startWorker(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.processNext();
    }, this.pollIntervalMs);
  }

  /** Stop the background worker. */
  stopWorker(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async processNext(): Promise<void> {
    // Query up to 10 pending or retry notifications
    const rows = await this.db.query("notifications", {
      where: { status: "pending" },
      limit: 10,
    });

    for (const row of rows) {
      const id = row["id"] as string;
      const channel = row["channel"] as string;
      const recipient = row["recipient_id"] as string;
      const retries = (row["retries"] as number) ?? 0;
      let payload: OutboundPayload;

      try {
        payload = JSON.parse(row["message"] as string) as OutboundPayload;
      } catch {
        await this.db.update("notifications", { id }, { status: "failed", error: "Invalid payload" });
        continue;
      }

      const adapter = this.channelRegistry.get(channel);
      if (!adapter) {
        await this.db.update("notifications", { id }, {
          status: "failed",
          error: `No adapter for channel: ${channel}`,
        });
        continue;
      }

      try {
        await adapter.send({ peerId: recipient, threadId: payload.threadId }, payload);
        await this.db.update("notifications", { id }, {
          status: "sent",
          sent_at: new Date().toISOString(),
        });
        await this.hooks.emit("notification.sent", { notificationId: id, channel, recipient });
      } catch (err) {
        const newRetries = retries + 1;
        if (newRetries >= this.maxRetries) {
          await this.db.update("notifications", { id }, {
            status: "failed",
            retries: newRetries,
            error: String(err),
          });
          await this.hooks.emit("notification.failed", { notificationId: id, channel, recipient, error: String(err) });
        } else {
          await this.db.update("notifications", { id }, {
            status: "pending",
            retries: newRetries,
            error: String(err),
          });
        }
      }
    }
  }
}
