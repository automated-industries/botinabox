import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataStore } from '../../data/data-store.js';
import { defineCoreTables } from '../../data/core-schema.js';
import { SessionManager } from '../session-manager.js';

let db: DataStore;
let manager: SessionManager;

beforeEach(() => {
  db = new DataStore({ dbPath: ':memory:' });
  defineCoreTables(db);
  db.init();
  manager = new SessionManager(db);
});

afterEach(() => {
  db.close();
});

describe('SessionManager — Story 3.7', () => {
  it('save creates a session and returns id', async () => {
    const id = await manager.save('agent-1', 'slack', 'user-1', { history: [] });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('save/load round-trip preserves params', async () => {
    const params = { history: [{ role: 'user', content: 'Hello' }] };
    await manager.save('agent-1', 'slack', 'user-1', params);
    const loaded = await manager.load('agent-1', 'slack', 'user-1');
    expect(loaded).toBeDefined();
    expect(loaded!['history']).toEqual(params.history);
  });

  it('save updates existing session (upsert)', async () => {
    const id1 = await manager.save('agent-1', 'slack', 'user-1', { v: 1 });
    const id2 = await manager.save('agent-1', 'slack', 'user-1', { v: 2 });
    expect(id1).toBe(id2); // Same session
    const loaded = await manager.load('agent-1', 'slack', 'user-1');
    expect(loaded!['v']).toBe(2);
  });

  it('load returns undefined for missing session', async () => {
    const result = await manager.load('agent-1', 'slack', 'unknown-user');
    expect(result).toBeUndefined();
  });

  it('clear removes the session', async () => {
    await manager.save('agent-1', 'slack', 'user-1', {});
    await manager.clear('agent-1', 'slack', 'user-1');
    const result = await manager.load('agent-1', 'slack', 'user-1');
    expect(result).toBeUndefined();
  });

  it('shouldClear returns false when within limits', async () => {
    const session = { message_count: 3, created_at: new Date().toISOString() };
    const result = await manager.shouldClear(session, { maxRuns: 10, maxAgeHours: 24 });
    expect(result).toBe(false);
  });

  it('shouldClear returns true when message_count exceeds maxRuns', async () => {
    const session = { message_count: 15, created_at: new Date().toISOString() };
    const result = await manager.shouldClear(session, { maxRuns: 10 });
    expect(result).toBe(true);
  });

  it('shouldClear returns true when session is too old', async () => {
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago
    const session = { message_count: 1, created_at: oldDate };
    const result = await manager.shouldClear(session, { maxAgeHours: 24 });
    expect(result).toBe(true);
  });
});
