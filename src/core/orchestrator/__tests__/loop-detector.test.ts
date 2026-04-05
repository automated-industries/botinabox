import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataStore } from '../../data/data-store.js';
import { HookBus } from '../../hooks/hook-bus.js';
import { defineCoreTables } from '../../data/core-schema.js';
import { LoopDetector, LoopType } from '../loop-detector.js';

let db: DataStore;
let detector: LoopDetector;

beforeEach(async () => {
  db = new DataStore({ dbPath: ':memory:' });
  defineCoreTables(db);
  await db.init();
  detector = new LoopDetector(db);
});

afterEach(() => {
  db.close();
});

async function createAgent(slug: string): Promise<string> {
  const row = await db.insert('agents', {
    slug,
    name: slug,
    adapter: 'cli',
  });
  return row['id'] as string;
}

async function createTask(assigneeId: string, chainOriginId?: string, chainDepth = 0): Promise<string> {
  const row = await db.insert('tasks', {
    title: 'Test task',
    assignee_id: assigneeId,
    chain_origin_id: chainOriginId,
    chain_depth: chainDepth,
    status: 'todo',
  });
  return row['id'] as string;
}

describe('LoopDetector — Story 6.2', () => {
  describe('self-loop detection', () => {
    it('detects when source and target are the same agent', async () => {
      const agentId = await createAgent('worker');
      const taskId = await createTask(agentId);

      const result = await detector.check(agentId, agentId, taskId);

      expect(result).toBeDefined();
      expect(result!.type).toBe(LoopType.SELF_LOOP);
      expect(result!.agents).toEqual([agentId]);
    });

    it('allows routing to a different agent', async () => {
      const agentA = await createAgent('agent-a');
      const agentB = await createAgent('agent-b');
      const taskId = await createTask(agentA);

      const result = await detector.check(agentA, agentB, taskId);

      expect(result).toBeUndefined();
    });
  });

  describe('blocked re-entry detection', () => {
    it('detects when target agent has a blocked task in the same chain', async () => {
      const agentA = await createAgent('triage');
      const agentB = await createAgent('analyst');

      // Create initial task as chain origin
      const originTaskId = await createTask(agentA);

      // Create a blocked task for agentB in the same chain
      await db.insert('tasks', {
        title: 'Blocked task',
        assignee_id: agentB,
        chain_origin_id: originTaskId,
        chain_depth: 1,
        status: 'blocked',
      });

      // Try to route to agentB again in the same chain
      const result = await detector.check(agentA, agentB, 'new-task', originTaskId);

      expect(result).toBeDefined();
      expect(result!.type).toBe(LoopType.BLOCKED_REENTRY);
      expect(result!.agents).toEqual([agentB]);
    });

    it('allows routing when target has no blocked tasks in chain', async () => {
      const agentA = await createAgent('triage-ok');
      const agentB = await createAgent('analyst-ok');

      const originTaskId = await createTask(agentA);

      // Create a completed (not blocked) task for agentB
      await db.insert('tasks', {
        title: 'Done task',
        assignee_id: agentB,
        chain_origin_id: originTaskId,
        chain_depth: 1,
        status: 'done',
      });

      const result = await detector.check(agentA, agentB, 'new-task', originTaskId);

      expect(result).toBeUndefined();
    });
  });

  describe('ping-pong detection', () => {
    it('detects A→B→A→B pattern in chain history', async () => {
      const agentA = await createAgent('ping');
      const agentB = await createAgent('pong');

      const originId = 'origin-1';

      // Build chain: A → B → A → B
      await db.insert('tasks', {
        title: 'Task 1', assignee_id: agentA,
        chain_origin_id: originId, chain_depth: 1, status: 'done',
      });
      await db.insert('tasks', {
        title: 'Task 2', assignee_id: agentB,
        chain_origin_id: originId, chain_depth: 2, status: 'done',
      });
      await db.insert('tasks', {
        title: 'Task 3', assignee_id: agentA,
        chain_origin_id: originId, chain_depth: 3, status: 'done',
      });

      // Now trying to route back to B — should detect ping-pong
      const result = await detector.check(agentA, agentB, 'task-4', originId);

      expect(result).toBeDefined();
      expect(result!.type).toBe(LoopType.PING_PONG);
      expect(result!.agents).toContain(agentA);
      expect(result!.agents).toContain(agentB);
    });

    it('does not flag non-repeating patterns', async () => {
      const agentA = await createAgent('worker-1');
      const agentB = await createAgent('worker-2');
      const agentC = await createAgent('worker-3');

      const originId = 'origin-2';

      // Chain: A → B → C (no repetition)
      await db.insert('tasks', {
        title: 'Task 1', assignee_id: agentA,
        chain_origin_id: originId, chain_depth: 1, status: 'done',
      });
      await db.insert('tasks', {
        title: 'Task 2', assignee_id: agentB,
        chain_origin_id: originId, chain_depth: 2, status: 'done',
      });

      const result = await detector.check(agentB, agentC, 'task-3', originId);

      expect(result).toBeUndefined();
    });
  });
});
