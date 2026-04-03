import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataStore } from '../../data/data-store.js';
import { defineCoreTables } from '../../data/core-schema.js';
import { WakeupQueue } from '../wakeup-queue.js';

let db: DataStore;
let queue: WakeupQueue;

beforeEach(async () => {
  db = new DataStore({ dbPath: ':memory:' });
  defineCoreTables(db);
  await db.init();
  queue = new WakeupQueue(db);
});

afterEach(() => {
  db.close();
});

describe('WakeupQueue — Story 3.3', () => {
  it('enqueue inserts a wakeup and returns id', async () => {
    const id = await queue.enqueue('agent-1', 'heartbeat');
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('getNext returns oldest queued wakeup', async () => {
    await queue.enqueue('agent-1', 'heartbeat');
    await new Promise((r) => setTimeout(r, 5)); // ensure different timestamps
    await queue.enqueue('agent-1', 'poll');
    const next = await queue.getNext('agent-1');
    expect(next).toBeDefined();
  });

  it('coalesce merges context into existing queued wakeup', async () => {
    await queue.enqueue('agent-1', 'heartbeat', { key1: 'val1' });
    await queue.coalesce('agent-1', { key2: 'val2' });
    const next = await queue.getNext('agent-1');
    const ctx = JSON.parse(next!['context'] as string);
    expect(ctx['key1']).toBe('val1');
    expect(ctx['key2']).toBe('val2');
  });

  it('markFired sets fired_at and run_id', async () => {
    const id = await queue.enqueue('agent-1', 'heartbeat');
    await queue.markFired(id, 'run-123');
    const next = await queue.getNext('agent-1'); // Should be undefined now
    expect(next).toBeUndefined(); // marked as fired, no unfired wakeups
  });
});
