import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DataStore } from '../../data/data-store.js';
import { HookBus } from '../../hooks/hook-bus.js';
import { defineCoreTables } from '../../data/core-schema.js';
import { TaskQueue, MAX_CHAIN_DEPTH } from '../task-queue.js';

let db: DataStore;
let hooks: HookBus;
let queue: TaskQueue;

beforeEach(() => {
  db = new DataStore({ dbPath: ':memory:' });
  defineCoreTables(db);
  db.init();
  hooks = new HookBus();
  queue = new TaskQueue(db, hooks, { pollIntervalMs: 50 });
});

afterEach(() => {
  queue.stopPolling();
  db.close();
});

describe('TaskQueue — Story 3.2', () => {
  it('create inserts task with status=todo and returns id', async () => {
    const id = await queue.create({ title: 'Do something' });
    expect(typeof id).toBe('string');
    const task = await queue.get(id);
    expect(task!['status']).toBe('todo');
  });

  it('create emits task.created hook', async () => {
    const events: Record<string, unknown>[] = [];
    hooks.register('task.created', (ctx) => { events.push(ctx); });
    await queue.create({ title: 'Hook task' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ title: 'Hook task' });
  });

  it('create throws if chain_depth exceeds MAX_CHAIN_DEPTH', async () => {
    await expect(
      queue.create({ title: 'Deep task', chain_depth: MAX_CHAIN_DEPTH + 1 })
    ).rejects.toThrow('Chain depth limit exceeded');
  });

  it('create allows chain_depth equal to MAX_CHAIN_DEPTH', async () => {
    const id = await queue.create({ title: 'Max depth task', chain_depth: MAX_CHAIN_DEPTH });
    expect(typeof id).toBe('string');
  });

  it('update changes task fields', async () => {
    const id = await queue.create({ title: 'Update me' });
    await queue.update(id, { status: 'in_progress' });
    const task = await queue.get(id);
    expect(task!['status']).toBe('in_progress');
  });

  it('list filters by status', async () => {
    const id1 = await queue.create({ title: 'Task A' });
    await queue.create({ title: 'Task B' });
    await queue.update(id1, { status: 'done' });
    const done = await queue.list({ status: 'done' });
    expect(done.some((t) => t['id'] === id1)).toBe(true);
    expect(done.every((t) => t['status'] === 'done')).toBe(true);
  });

  it('list filters by assignee_id', async () => {
    await queue.create({ title: 'Assigned', assignee_id: 'agent-1' });
    await queue.create({ title: 'Unassigned' });
    const assigned = await queue.list({ assignee_id: 'agent-1' });
    expect(assigned).toHaveLength(1);
    expect(assigned[0]!['assignee_id']).toBe('agent-1');
  });

  it('startPolling emits agent.wakeup for todo tasks with assignee', async () => {
    const agentId = 'agent-poll-test';
    await queue.create({ title: 'Poll task', assignee_id: agentId, priority: 1 });

    const wakeups: Record<string, unknown>[] = [];
    hooks.register('agent.wakeup', (ctx) => { wakeups.push(ctx); });

    queue.startPolling();
    await new Promise((r) => setTimeout(r, 120));
    queue.stopPolling();

    expect(wakeups.length).toBeGreaterThan(0);
    expect(wakeups[0]!['agentId']).toBe(agentId);
  });
});
