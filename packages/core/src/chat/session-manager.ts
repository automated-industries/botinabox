/**
 * ChatSessionManager — wraps orchestrator SessionManager with SessionKey-based lookup.
 * Story 4.3
 */

import { SessionManager } from "../orchestrator/session-manager.js";
import type { DataStore } from "../data/data-store.js";
import { SessionKey } from "./session-key.js";

export class ChatSessionManager {
  private readonly inner: SessionManager;

  constructor(db: DataStore) {
    this.inner = new SessionManager(db);
  }

  async save(key: SessionKey, params: Record<string, unknown>): Promise<string> {
    return this.inner.save(key.agentId, key.channel, key.scope, params);
  }

  async load(key: SessionKey): Promise<Record<string, unknown> | undefined> {
    return this.inner.load(key.agentId, key.channel, key.scope);
  }

  async clear(key: SessionKey): Promise<void> {
    return this.inner.clear(key.agentId, key.channel, key.scope);
  }

  async shouldClear(
    session: Record<string, unknown>,
    opts: { maxRuns?: number; maxAgeHours?: number },
  ): Promise<boolean> {
    return this.inner.shouldClear(session, opts);
  }
}
