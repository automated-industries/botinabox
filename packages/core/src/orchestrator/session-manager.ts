import type { DataStore } from '../data/data-store.js';

export class SessionManager {
  constructor(private db: DataStore) {}

  async save(
    agentId: string,
    channelId: string,
    peerId: string,
    params: Record<string, unknown>,
  ): Promise<string> {
    const existing = this._find(agentId, channelId, peerId);

    if (existing) {
      this.db.update('sessions', { id: existing['id'] }, {
        context: JSON.stringify(params),
        last_message_at: new Date().toISOString(),
        message_count: ((existing['message_count'] as number) ?? 0) + 1,
      });
      return existing['id'] as string;
    } else {
      const row = this.db.insert('sessions', {
        agent_id: agentId,
        channel: channelId,
        peer_id: peerId,
        context: JSON.stringify(params),
        last_message_at: new Date().toISOString(),
        message_count: 1,
      });
      return row['id'] as string;
    }
  }

  async load(
    agentId: string,
    channelId: string,
    peerId: string,
  ): Promise<Record<string, unknown> | undefined> {
    const session = this._find(agentId, channelId, peerId);
    if (!session) return undefined;

    const context = session['context']
      ? JSON.parse(session['context'] as string)
      : {};

    return { ...session, ...context };
  }

  async clear(agentId: string, channelId: string, peerId: string): Promise<void> {
    const session = this._find(agentId, channelId, peerId);
    if (session) {
      this.db.delete('sessions', { id: session['id'] });
    }
  }

  async shouldClear(
    session: Record<string, unknown>,
    opts: { maxRuns?: number; maxAgeHours?: number },
  ): Promise<boolean> {
    if (opts.maxRuns !== undefined) {
      const messageCount = (session['message_count'] as number) ?? 0;
      if (messageCount > opts.maxRuns) return true;
    }

    if (opts.maxAgeHours !== undefined) {
      const createdAt = session['created_at'] as string | undefined;
      if (createdAt) {
        const ageMs = Date.now() - new Date(createdAt).getTime();
        const ageHours = ageMs / (1000 * 60 * 60);
        if (ageHours > opts.maxAgeHours) return true;
      }
    }

    return false;
  }

  private _find(
    agentId: string,
    channelId: string,
    peerId: string,
  ): Record<string, unknown> | undefined {
    const rows = this.db.query('sessions', {
      where: { agent_id: agentId, channel: channelId, peer_id: peerId },
    });
    return rows[0] ?? undefined;
  }
}
