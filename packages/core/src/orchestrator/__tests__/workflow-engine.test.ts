import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataStore } from '../../data/data-store.js';
import { HookBus } from '../../hooks/hook-bus.js';
import { defineCoreTables } from '../../data/core-schema.js';
import { TaskQueue } from '../task-queue.js';
import { WorkflowEngine } from '../workflow-engine.js';

let db: DataStore;
let hooks: HookBus;
let taskQueue: TaskQueue;
let engine: WorkflowEngine;

beforeEach(() => {
  db = new DataStore({ dbPath: ':memory:' });
  defineCoreTables(db);
  db.init();
  hooks = new HookBus();
  taskQueue = new TaskQueue(db, hooks, { pollIntervalMs: 999999 });
  engine = new WorkflowEngine(db, hooks, taskQueue);
});

afterEach(() => {
  taskQueue.stopPolling();
  db.close();
});

describe('WorkflowEngine — Story 5.1', () => {
  it('define stores workflow in DB', async () => {
    await engine.define('my-flow', {
      name: 'My Flow',
      steps: [{ id: 'step-1', name: 'Step 1', taskTemplate: { title: 'Do it', description: 'Desc' } }],
    });
    const rows = db.query('workflows', { where: { slug: 'my-flow' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!['name']).toBe('My Flow');
  });

  it('define throws on duplicate step IDs', async () => {
    await expect(engine.define('bad-flow', {
      name: 'Bad',
      steps: [
        { id: 'step-1', name: 'A', taskTemplate: { title: 'T', description: 'D' } },
        { id: 'step-1', name: 'B', taskTemplate: { title: 'T', description: 'D' } },
      ],
    })).rejects.toThrow('duplicate step IDs');
  });

  it('define throws on invalid dependsOn reference', async () => {
    await expect(engine.define('bad-deps', {
      name: 'Bad Deps',
      steps: [
        { id: 'step-1', name: 'A', taskTemplate: { title: 'T', description: 'D' }, dependsOn: ['nonexistent'] },
      ],
    })).rejects.toThrow('unknown step');
  });

  it('define throws on cyclic steps', async () => {
    await expect(engine.define('cyclic', {
      name: 'Cyclic',
      steps: [
        { id: 'a', name: 'A', taskTemplate: { title: 'T', description: 'D' }, dependsOn: ['b'] },
        { id: 'b', name: 'B', taskTemplate: { title: 'T', description: 'D' }, dependsOn: ['a'] },
      ],
    })).rejects.toThrow('cyclic');
  });

  it('start creates workflow_run and initial tasks', async () => {
    await engine.define('seq-flow', {
      name: 'Sequential',
      steps: [
        { id: 'step-1', name: 'First', taskTemplate: { title: 'Task 1', description: 'Do first' } },
        { id: 'step-2', name: 'Second', taskTemplate: { title: 'Task 2', description: 'Do second' }, dependsOn: ['step-1'] },
      ],
    });

    const runId = await engine.start('seq-flow', {});
    expect(typeof runId).toBe('string');

    const run = db.get('workflow_runs', { id: runId });
    expect(run!['status']).toBe('running');

    // Only step-1 should be created initially
    const tasks = db.query('tasks', { where: { workflow_run_id: runId } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!['workflow_step_id']).toBe('step-1');
  });

  it('start creates parallel initial steps when no dependsOn', async () => {
    await engine.define('parallel-flow', {
      name: 'Parallel',
      steps: [
        { id: 'step-a', name: 'A', taskTemplate: { title: 'Task A', description: 'A' } },
        { id: 'step-b', name: 'B', taskTemplate: { title: 'Task B', description: 'B' } },
        { id: 'step-c', name: 'C', taskTemplate: { title: 'Task C', description: 'C' }, dependsOn: ['step-a', 'step-b'] },
      ],
    });

    const runId = await engine.start('parallel-flow', {});
    const tasks = db.query('tasks', { where: { workflow_run_id: runId } });
    expect(tasks).toHaveLength(2); // step-a and step-b
    const stepIds = tasks.map((t) => t['workflow_step_id']);
    expect(stepIds).toContain('step-a');
    expect(stepIds).toContain('step-b');
  });

  it('completes sequential workflow when all steps done', async () => {
    await engine.define('seq-complete', {
      name: 'Sequential Complete',
      steps: [
        { id: 's1', name: 'S1', taskTemplate: { title: 'T1', description: 'D1' } },
        { id: 's2', name: 'S2', taskTemplate: { title: 'T2', description: 'D2' }, dependsOn: ['s1'] },
      ],
    });

    const runId = await engine.start('seq-complete', {});
    const tasks1 = db.query('tasks', { where: { workflow_run_id: runId } });
    const task1 = tasks1[0]!;

    // Mark task1 as done
    db.update('tasks', { id: task1['id'] }, { status: 'done' });

    // Trigger onStepCompleted
    await engine.onStepCompleted(task1['id'] as string, 'output1');

    // Should create task for s2
    const tasks2 = db.query('tasks', { where: { workflow_run_id: runId } });
    expect(tasks2).toHaveLength(2);

    const task2 = tasks2.find((t) => t['workflow_step_id'] === 's2')!;
    db.update('tasks', { id: task2['id'] }, { status: 'done' });
    await engine.onStepCompleted(task2['id'] as string, 'output2');

    const run = db.get('workflow_runs', { id: runId });
    expect(run!['status']).toBe('completed');
  });

  it('converges parallel steps before next step', async () => {
    await engine.define('converge-flow', {
      name: 'Convergent',
      steps: [
        { id: 'a', name: 'A', taskTemplate: { title: 'A', description: 'A' } },
        { id: 'b', name: 'B', taskTemplate: { title: 'B', description: 'B' } },
        { id: 'c', name: 'C', taskTemplate: { title: 'C', description: 'C' }, dependsOn: ['a', 'b'] },
      ],
    });

    const runId = await engine.start('converge-flow', {});
    const initTasks = db.query('tasks', { where: { workflow_run_id: runId } });
    expect(initTasks).toHaveLength(2);

    // Complete task A
    const taskA = initTasks.find((t) => t['workflow_step_id'] === 'a')!;
    db.update('tasks', { id: taskA['id'] }, { status: 'done' });
    await engine.onStepCompleted(taskA['id'] as string, 'a-done');

    // C should not be created yet
    const afterA = db.query('tasks', { where: { workflow_run_id: runId } });
    expect(afterA).toHaveLength(2); // still just a and b

    // Complete task B
    const taskB = initTasks.find((t) => t['workflow_step_id'] === 'b')!;
    db.update('tasks', { id: taskB['id'] }, { status: 'done' });
    await engine.onStepCompleted(taskB['id'] as string, 'b-done');

    // C should now be created
    const afterB = db.query('tasks', { where: { workflow_run_id: runId } });
    expect(afterB).toHaveLength(3);
    expect(afterB.some((t) => t['workflow_step_id'] === 'c')).toBe(true);
  });

  it('interpolates template with context', async () => {
    await engine.define('interp-flow', {
      name: 'Interpolation',
      steps: [
        {
          id: 's1',
          name: 'S1',
          taskTemplate: { title: 'Hello {{name}}', description: 'Run for {{name}}' },
        },
      ],
    });

    const runId = await engine.start('interp-flow', { name: 'World' });
    const tasks = db.query('tasks', { where: { workflow_run_id: runId } });
    expect(tasks[0]!['title']).toBe('Hello World');
    expect(tasks[0]!['description']).toBe('Run for World');
  });

  it('interpolates steps.stepId.output in subsequent steps', async () => {
    await engine.define('output-flow', {
      name: 'Output Flow',
      steps: [
        { id: 'step1', name: 'S1', taskTemplate: { title: 'First', description: 'D1' } },
        {
          id: 'step2',
          name: 'S2',
          taskTemplate: { title: 'After {{steps.step1.output}}', description: 'D2' },
          dependsOn: ['step1'],
        },
      ],
    });

    const runId = await engine.start('output-flow', {});
    const [task1] = db.query('tasks', { where: { workflow_run_id: runId } });
    db.update('tasks', { id: task1!['id'] }, { status: 'done' });
    await engine.onStepCompleted(task1!['id'] as string, 'result-xyz');

    const tasks = db.query('tasks', { where: { workflow_run_id: runId } });
    const task2 = tasks.find((t) => t['workflow_step_id'] === 'step2')!;
    expect(task2['title']).toBe('After result-xyz');
  });

  it('step failure aborts workflow', async () => {
    await engine.define('abort-flow', {
      name: 'Abort',
      steps: [
        { id: 's1', name: 'S1', taskTemplate: { title: 'T', description: 'D' }, onFail: 'abort' },
        { id: 's2', name: 'S2', taskTemplate: { title: 'T2', description: 'D2' }, dependsOn: ['s1'] },
      ],
    });

    const runId = await engine.start('abort-flow', {});
    const [task1] = db.query('tasks', { where: { workflow_run_id: runId } });

    await engine.onStepFailed(task1!['id'] as string, 'step failed');

    const run = db.get('workflow_runs', { id: runId });
    expect(run!['status']).toBe('failed');
  });

  it('start throws if workflow not found', async () => {
    await expect(engine.start('nonexistent', {})).rejects.toThrow('not found');
  });
});
