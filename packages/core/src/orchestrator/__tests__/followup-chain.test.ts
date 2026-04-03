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

describe('Followup Chain — Story 5.4', () => {
  it('creates followup task when followup_agent_id is set', async () => {
    const taskRow = db.insert('tasks', {
      title: 'Original Task',
      status: 'todo',
      priority: 5,
      followup_agent_id: 'agent-followup',
      followup_template: 'Followup: {{output}}',
      chain_depth: 0,
    });
    const taskId = taskRow['id'] as string;

    const runId = await manager.startRun('agent-1', taskId);
    await manager.finishRun(runId, { exitCode: 0, output: 'great result' });

    const tasks = db.query('tasks', { where: { assignee_id: 'agent-followup' } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!['title']).toBe('Followup: great result');
  });

  it('chain_depth is incremented in followup task', async () => {
    const taskRow = db.insert('tasks', {
      title: 'Root Task',
      status: 'todo',
      priority: 5,
      followup_agent_id: 'agent-next',
      chain_depth: 0,
    });
    const taskId = taskRow['id'] as string;

    const runId = await manager.startRun('agent-1', taskId);
    await manager.finishRun(runId, { exitCode: 0, output: 'output' });

    const followup = db.query('tasks', { where: { assignee_id: 'agent-next' } });
    expect(followup[0]!['chain_depth']).toBe(1);
  });

  it('chain_origin_id inherited from parent', async () => {
    const taskRow = db.insert('tasks', {
      title: 'Root Task',
      status: 'todo',
      priority: 5,
      followup_agent_id: 'agent-next',
      chain_depth: 0,
      chain_origin_id: null,
    });
    const taskId = taskRow['id'] as string;

    const runId = await manager.startRun('agent-1', taskId);
    await manager.finishRun(runId, { exitCode: 0, output: 'output' });

    const followup = db.query('tasks', { where: { assignee_id: 'agent-next' } });
    // chain_origin_id should be the original task's id since it had no origin
    expect(followup[0]!['chain_origin_id']).toBe(taskId);
  });

  it('no followup created on failure', async () => {
    const taskRow = db.insert('tasks', {
      title: 'Failing Task',
      status: 'todo',
      priority: 5,
      followup_agent_id: 'agent-followup',
    });
    const taskId = taskRow['id'] as string;

    const runId = await manager.startRun('agent-1', taskId);
    await manager.finishRun(runId, { exitCode: 1, output: 'error' });

    const followups = db.query('tasks', { where: { assignee_id: 'agent-followup' } });
    expect(followups).toHaveLength(0);
  });

  it('no followup created when followup_agent_id is not set', async () => {
    const taskRow = db.insert('tasks', {
      title: 'Normal Task',
      status: 'todo',
      priority: 5,
    });
    const taskId = taskRow['id'] as string;

    const runId = await manager.startRun('agent-1', taskId);
    await manager.finishRun(runId, { exitCode: 0, output: 'done' });

    const allTasks = db.query('tasks');
    expect(allTasks).toHaveLength(1); // only the original
  });

  it('depth > 5 throws', async () => {
    const taskRow = db.insert('tasks', {
      title: 'Deep Task',
      status: 'todo',
      priority: 5,
      followup_agent_id: 'agent-next',
      chain_depth: 5, // at limit, +1 would be 6 which exceeds max
    });
    const taskId = taskRow['id'] as string;

    const runId = await manager.startRun('agent-1', taskId);
    await expect(manager.finishRun(runId, { exitCode: 0, output: 'done' })).rejects.toThrow(
      'Chain depth limit exceeded'
    );
  });

  it('emits task.followup.created hook', async () => {
    const events: Record<string, unknown>[] = [];
    hooks.register('task.followup.created', (ctx) => { events.push(ctx); });

    const taskRow = db.insert('tasks', {
      title: 'Task',
      status: 'todo',
      priority: 5,
      followup_agent_id: 'agent-x',
    });
    const taskId = taskRow['id'] as string;

    const runId = await manager.startRun('agent-1', taskId);
    await manager.finishRun(runId, { exitCode: 0, output: 'done' });

    expect(events).toHaveLength(1);
    expect(events[0]!['followupAgentId']).toBe('agent-x');
  });
});
