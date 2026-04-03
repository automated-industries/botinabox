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

async function createTaskWithRetries(maxRetries: number, retryCount = 0): Promise<string> {
  const row = await db.insert('tasks', {
    title: 'Retryable Task',
    status: 'todo',
    priority: 5,
    max_retries: maxRetries,
    retry_count: retryCount,
  });
  return row['id'] as string;
}

describe('Retry Policy — Story 5.3', () => {
  it('failed task with retries < max resets to todo', async () => {
    const taskId = await createTaskWithRetries(3, 0);
    const runId = await manager.startRun('agent-1', taskId);
    await manager.finishRun(runId, { exitCode: 1, output: 'error' });

    const task = await db.get('tasks', { id: taskId });
    expect(task!['status']).toBe('todo');
    expect(task!['retry_count']).toBe(1);
  });

  it('sets next_retry_at when resetting to todo', async () => {
    const taskId = await createTaskWithRetries(3, 0);
    const before = Date.now();
    const runId = await manager.startRun('agent-1', taskId);
    await manager.finishRun(runId, { exitCode: 1 });

    const task = await db.get('tasks', { id: taskId });
    expect(task!['next_retry_at']).toBeTruthy();
    const retryAt = new Date(task!['next_retry_at'] as string).getTime();
    expect(retryAt).toBeGreaterThan(before);
  });

  it('exponential backoff: first retry ~5s', async () => {
    const taskId = await createTaskWithRetries(3, 0);
    const before = Date.now();
    const runId = await manager.startRun('agent-1', taskId);
    await manager.finishRun(runId, { exitCode: 1 });

    const task = await db.get('tasks', { id: taskId });
    const retryAt = new Date(task!['next_retry_at'] as string).getTime();
    // First retry: 5000ms backoff
    expect(retryAt - before).toBeGreaterThanOrEqual(4900);
    expect(retryAt - before).toBeLessThan(6000);
  });

  it('exponential backoff: second retry ~10s', async () => {
    const taskId = await createTaskWithRetries(3, 1); // already retried once
    const before = Date.now();
    const runId = await manager.startRun('agent-1', taskId);
    await manager.finishRun(runId, { exitCode: 1 });

    const task = await db.get('tasks', { id: taskId });
    const retryAt = new Date(task!['next_retry_at'] as string).getTime();
    // Second retry: 10000ms backoff
    expect(retryAt - before).toBeGreaterThanOrEqual(9900);
    expect(retryAt - before).toBeLessThan(11000);
  });

  it('exponential backoff: third retry ~20s', async () => {
    const taskId = await createTaskWithRetries(3, 2); // already retried twice
    const before = Date.now();
    const runId = await manager.startRun('agent-1', taskId);
    await manager.finishRun(runId, { exitCode: 1 });

    const task = await db.get('tasks', { id: taskId });
    const retryAt = new Date(task!['next_retry_at'] as string).getTime();
    // Third retry: 20000ms backoff
    expect(retryAt - before).toBeGreaterThanOrEqual(19900);
    expect(retryAt - before).toBeLessThan(21000);
  });

  it('max retries exhausted — stays failed (does not reset to todo)', async () => {
    const taskId = await createTaskWithRetries(2, 2); // maxRetries=2, already used both
    const runId = await manager.startRun('agent-1', taskId);
    await manager.finishRun(runId, { exitCode: 1 });

    // Task should NOT be reset to todo
    const task = await db.get('tasks', { id: taskId });
    expect(task!['status']).not.toBe('todo');
    expect(task!['retry_count']).toBe(2); // unchanged
  });

  it('task with max_retries=0 does not retry', async () => {
    const taskId = await createTaskWithRetries(0, 0);
    const runId = await manager.startRun('agent-1', taskId);
    await manager.finishRun(runId, { exitCode: 1 });

    const task = await db.get('tasks', { id: taskId });
    expect(task!['status']).not.toBe('todo');
  });

  it('backoff capped at maxBackoffMs', async () => {
    const cappedManager = new RunManager(db, hooks, { staleThresholdMs: 100, maxBackoffMs: 8000 });
    const taskId = await createTaskWithRetries(10, 5); // retry_count=5 → raw backoff = 5000*32 = 160s, capped at 8s
    const before = Date.now();
    const runId = await cappedManager.startRun('agent-2', taskId);
    await cappedManager.finishRun(runId, { exitCode: 1 });

    const task = await db.get('tasks', { id: taskId });
    const retryAt = new Date(task!['next_retry_at'] as string).getTime();
    expect(retryAt - before).toBeLessThan(9000);
    expect(retryAt - before).toBeGreaterThanOrEqual(7900);
    cappedManager.stopOrphanReaper();
  });
});
