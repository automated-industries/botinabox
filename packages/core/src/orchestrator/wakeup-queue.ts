import type { DataStore } from '../data/data-store.js';

export class WakeupQueue {
  constructor(private db: DataStore) {}

  async enqueue(
    agentId: string,
    source: string,
    context?: Record<string, unknown>,
  ): Promise<string> {
    const row = this.db.insert('wakeups', {
      agent_id: agentId,
      scheduled_at: new Date().toISOString(),
      context: context ? JSON.stringify({ source, ...context }) : JSON.stringify({ source }),
    });
    return row['id'] as string;
  }

  async coalesce(agentId: string, context?: Record<string, unknown>): Promise<void> {
    // Find existing queued wakeup (no fired_at) for agent
    const existing = this.db.query('wakeups', {
      where: { agent_id: agentId },
    }).filter((w) => w['fired_at'] == null);

    if (existing.length === 0) return;

    // Merge context into oldest queued wakeup
    const wakeup = existing[0]!;
    const currentCtx = wakeup['context']
      ? JSON.parse(wakeup['context'] as string)
      : {};
    const merged = { ...currentCtx, ...(context ?? {}) };

    this.db.update('wakeups', { id: wakeup['id'] }, {
      context: JSON.stringify(merged),
    });
  }

  async getNext(agentId: string): Promise<Record<string, unknown> | undefined> {
    const queued = this.db.query('wakeups', {
      where: { agent_id: agentId },
    })
      .filter((w) => w['fired_at'] == null)
      .sort((a, b) =>
        (a['scheduled_at'] as string).localeCompare(b['scheduled_at'] as string)
      );

    return queued[0] ?? undefined;
  }

  async markFired(wakeupId: string, runId: string): Promise<void> {
    this.db.update('wakeups', { id: wakeupId }, {
      fired_at: new Date().toISOString(),
      run_id: runId,
    });
  }
}
