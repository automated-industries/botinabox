import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataStore } from '../../data/data-store.js';
import { HookBus } from '../../hooks/hook-bus.js';
import { defineCoreTables } from '../../data/core-schema.js';
import { RunManager } from '../run-manager.js';

let db: DataStore;
let hooks: HookBus;
let manager: RunManager;

beforeEach(() => {
  db = new DataStore({ dbPath: ':memory:' });
  defineCoreTables(db);
  db.init();
  hooks = new HookBus();
  manager = new RunManager(db, hooks, { staleThresholdMs: 100 });
});

afterEach(() => {
  manager.stopOrphanReaper();
  db.close();
});

describe('RunManager — Story 3.3', () => {
  it('startRun creates run record and returns id', async () => {
    const runId = await manager.startRun('agent-1', 'task-1');
    expect(typeof runId).toBe('string');
    const run = db.get('runs', { id: runId });
    expect(run!['status']).toBe('running');
  });

  it('isLocked returns true after startRun', async () => {
    expect(manager.isLocked('agent-1')).toBe(false);
    await manager.startRun('agent-1', 'task-1');
    expect(manager.isLocked('agent-1')).toBe(true);
  });

  it('startRun throws if agent already has active run', async () => {
    await manager.startRun('agent-1', 'task-1');
    await expect(manager.startRun('agent-1', 'task-2')).rejects.toThrow('Agent already has an active run');
  });

  it('finishRun marks run succeeded when exitCode=0', async () => {
    const runId = await manager.startRun('agent-1', 'task-1');
    await manager.finishRun(runId, { exitCode: 0 });
    const run = db.get('runs', { id: runId });
    expect(run!['status']).toBe('succeeded');
    expect(manager.isLocked('agent-1')).toBe(false);
  });

  it('finishRun marks run failed when exitCode!=0', async () => {
    const runId = await manager.startRun('agent-1', 'task-1');
    await manager.finishRun(runId, { exitCode: 1 });
    const run = db.get('runs', { id: runId });
    expect(run!['status']).toBe('failed');
  });

  it('finishRun emits run.completed hook', async () => {
    const events: Record<string, unknown>[] = [];
    hooks.register('run.completed', (ctx) => { events.push(ctx); });
    const runId = await manager.startRun('agent-1', 'task-1');
    await manager.finishRun(runId, { exitCode: 0 });
    expect(events).toHaveLength(1);
    expect(events[0]!['runId']).toBe(runId);
  });

  it('reapOrphans marks stale running runs as failed', async () => {
    // Insert a run directly with a very old started_at
    const row = db.insert('runs', {
      agent_id: 'agent-stale',
      task_id: 'task-stale',
      status: 'running',
      started_at: new Date(Date.now() - 5000).toISOString(), // 5 seconds ago
    });

    // Use a very short stale threshold
    const shortManager = new RunManager(db, hooks, { staleThresholdMs: 100 });
    await new Promise((r) => setTimeout(r, 150));
    await shortManager.reapOrphans();

    const run = db.get('runs', { id: row['id'] });
    expect(run!['status']).toBe('failed');
  });

  it('multiple agents can run concurrently', async () => {
    const run1 = await manager.startRun('agent-1', 'task-1');
    const run2 = await manager.startRun('agent-2', 'task-2');
    expect(run1).not.toBe(run2);
    expect(manager.isLocked('agent-1')).toBe(true);
    expect(manager.isLocked('agent-2')).toBe(true);
  });
});
