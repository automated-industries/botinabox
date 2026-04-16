import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataStore } from '../../data/data-store.js';
import { HookBus } from '../../hooks/hook-bus.js';
import { defineCoreTables } from '../../data/core-schema.js';
import { RunManager } from '../run-manager.js';

let db: DataStore;
let hooks: HookBus;
let manager: RunManager;

beforeEach(async () => {
  db = new DataStore({ dbPath: ':memory:' });
  defineCoreTables(db);
  await db.init();
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
    const run = await db.get('runs', { id: runId });
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
    const run = await db.get('runs', { id: runId });
    expect(run!['status']).toBe('succeeded');
    expect(manager.isLocked('agent-1')).toBe(false);
  });

  it('finishRun sets task.result and task.status=done on success', async () => {
    // Regression: finishRun did not update the task, so run.completed hook
    // handlers could not read task.result — every consumer had to store it
    // manually before calling finishRun.
    await db.insert('tasks', { id: 'task-result', title: 'Test', status: 'todo' });
    const runId = await manager.startRun('agent-1', 'task-result');
    await manager.finishRun(runId, { exitCode: 0, output: 'The answer is 42' });

    const task = await db.get('tasks', { id: 'task-result' });
    expect(task!['status']).toBe('done');
    expect(task!['result']).toBe('The answer is 42');
  });

  it('task.result is available when run.completed hook fires', async () => {
    // Regression: task.result was written AFTER run.completed was emitted,
    // so hook handlers read null.
    await db.insert('tasks', { id: 'task-hook', title: 'Hook test', status: 'todo' });
    let resultAtHookTime: unknown = undefined;
    hooks.register('run.completed', async (ctx) => {
      const task = await db.get('tasks', { id: ctx.taskId as string });
      resultAtHookTime = task?.['result'];
    });

    const runId = await manager.startRun('agent-1', 'task-hook');
    await manager.finishRun(runId, { exitCode: 0, output: 'Hook result' });

    expect(resultAtHookTime).toBe('Hook result');
  });

  it('finishRun marks run failed when exitCode!=0', async () => {
    const runId = await manager.startRun('agent-1', 'task-1');
    await manager.finishRun(runId, { exitCode: 1 });
    const run = await db.get('runs', { id: runId });
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

  it('finishRun writes model to runs table when provided', async () => {
    const runId = await manager.startRun('agent-1', 'task-1');
    await manager.finishRun(runId, {
      exitCode: 0,
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
    });
    const run = await db.get('runs', { id: runId });
    expect(run!['model']).toBe('claude-sonnet-4-20250514');
  });

  it('finishRun includes model/provider/usage in run.completed hook', async () => {
    const events: Record<string, unknown>[] = [];
    hooks.register('run.completed', (ctx) => { events.push(ctx); });
    const runId = await manager.startRun('agent-1', 'task-1');
    await manager.finishRun(runId, {
      exitCode: 0,
      model: 'claude-haiku-4-5-20251001',
      provider: 'anthropic',
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    expect(events[0]!['model']).toBe('claude-haiku-4-5-20251001');
    expect(events[0]!['provider']).toBe('anthropic');
    const usage = events[0]!['usage'] as Record<string, unknown>;
    expect(usage['inputTokens']).toBe(100);
    expect(usage['outputTokens']).toBe(50);
  });

  it('reapOrphans marks stale running runs as failed', async () => {
    // Insert a run directly with a very old started_at
    const row = await db.insert('runs', {
      agent_id: 'agent-stale',
      task_id: 'task-stale',
      status: 'running',
      started_at: new Date(Date.now() - 5000).toISOString(), // 5 seconds ago
    });

    // Use a very short stale threshold
    const shortManager = new RunManager(db, hooks, { staleThresholdMs: 100 });
    await new Promise((r) => setTimeout(r, 150));
    await shortManager.reapOrphans();

    const run = await db.get('runs', { id: row['id'] });
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
