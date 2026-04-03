import type { DataStore } from '../data/data-store.js';
import type { HookBus } from '../hooks/hook-bus.js';
import type { TaskQueue } from './task-queue.js';
import { detectCycle } from './dependency-resolver.js';
import { interpolate } from './template-interpolate.js';

export interface WorkflowStep {
  id: string;
  name: string;
  agentSlug?: string;
  taskTemplate: { title: string; description: string };
  dependsOn?: string[];
  onComplete?: 'next' | 'parallel' | 'end';
  onFail?: 'abort' | 'skip' | 'retry';
}

export interface WorkflowDefinition {
  name: string;
  description?: string;
  steps: WorkflowStep[];
  trigger?: {
    type: 'task_completed' | 'event' | 'schedule' | 'manual';
    filter?: Record<string, unknown>;
  };
}

export class WorkflowEngine {
  constructor(
    private db: DataStore,
    private hooks: HookBus,
    private taskQueue: TaskQueue,
  ) {
    // Subscribe to task.completed to advance workflow steps
    this.hooks.register('task.completed', async (ctx) => {
      const taskId = ctx['taskId'] as string | undefined;
      const output = (ctx['output'] as string | undefined) ?? '';
      if (taskId) {
        await this.onStepCompleted(taskId, output);
      }
    });
  }

  /**
   * Define/register a workflow.
   */
  async define(slug: string, def: WorkflowDefinition): Promise<void> {
    // Validate: no duplicate step IDs
    const ids = def.steps.map((s) => s.id);
    const unique = new Set(ids);
    if (unique.size !== ids.length) {
      throw new Error('Workflow has duplicate step IDs');
    }

    // Validate: no invalid dependsOn references
    for (const step of def.steps) {
      for (const dep of step.dependsOn ?? []) {
        if (!unique.has(dep)) {
          throw new Error(`Step "${step.id}" depends on unknown step "${dep}"`);
        }
      }
    }

    // Validate: no cycles
    if (detectCycle(def.steps)) {
      throw new Error('Workflow has cyclic step dependencies');
    }

    // Store in workflows table
    const existing = await this.db.query('workflows', { where: { slug } });
    if (existing.length > 0) {
      await this.db.update('workflows', { slug }, {
        name: def.name,
        description: def.description,
        definition: JSON.stringify(def),
        updated_at: new Date().toISOString(),
      });
    } else {
      await this.db.insert('workflows', {
        slug,
        name: def.name,
        description: def.description,
        definition: JSON.stringify(def),
      });
    }
  }

  /**
   * Start a workflow run.
   */
  async start(workflowSlug: string, context: Record<string, unknown>): Promise<string> {
    const workflows = await this.db.query('workflows', { where: { slug: workflowSlug } });
    if (workflows.length === 0) {
      throw new Error(`Workflow not found: ${workflowSlug}`);
    }
    const workflow = workflows[0]!;
    const def = JSON.parse(workflow['definition'] as string) as WorkflowDefinition;

    // Create workflow_run record
    const runRow = await this.db.insert('workflow_runs', {
      workflow_id: workflow['id'],
      status: 'running',
      step_results: JSON.stringify({}),
      context: JSON.stringify(context),
    });
    const workflowRunId = runRow['id'] as string;

    // Find initial steps (no dependsOn or empty dependsOn)
    const initialSteps = def.steps.filter((s) => !s.dependsOn || s.dependsOn.length === 0);

    for (const step of initialSteps) {
      await this._createStepTask(step, workflowRunId, workflow['id'] as string, context);
    }

    return workflowRunId;
  }

  /**
   * Called when a task with workflow_run_id completes.
   */
  async onStepCompleted(taskId: string, output: string): Promise<void> {
    const task = await this.db.get('tasks', { id: taskId });
    if (!task || !task['workflow_run_id']) return;

    const workflowRunId = task['workflow_run_id'] as string;
    const stepId = task['workflow_step_id'] as string | undefined;

    const run = await this.db.get('workflow_runs', { id: workflowRunId });
    if (!run || run['status'] !== 'running') return;

    // Update step_results
    const stepResults = JSON.parse(run['step_results'] as string ?? '{}') as Record<string, unknown>;
    if (stepId) {
      stepResults[stepId] = { output, taskId };
    }
    await this.db.update('workflow_runs', { id: workflowRunId }, {
      step_results: JSON.stringify(stepResults),
      current_step: stepId,
    });

    // Find workflow definition
    const workflow = await this.db.get('workflows', { id: run['workflow_id'] as string });
    if (!workflow) return;
    const def = JSON.parse(workflow['definition'] as string) as WorkflowDefinition;

    // Build context with step outputs
    const runContext = JSON.parse((run['context'] as string) ?? '{}') as Record<string, unknown>;
    const stepsContext: Record<string, unknown> = {};
    for (const [sid, result] of Object.entries(stepResults)) {
      stepsContext[sid] = result;
    }
    const fullContext = { ...runContext, steps: stepsContext };

    // Find completed step IDs (all tasks for this run that succeeded)
    const allRunTasks = await this.db.query('tasks', { where: { workflow_run_id: workflowRunId } });
    const completedStepIds = new Set(
      allRunTasks
        .filter((t) => t['status'] === 'done' || t['id'] === taskId)
        .map((t) => t['workflow_step_id'] as string)
        .filter(Boolean)
    );
    // Mark current task's step as complete
    if (stepId) completedStepIds.add(stepId);

    // Find next steps whose all dependsOn are satisfied and haven't been started
    const startedStepIds = new Set(
      allRunTasks.map((t) => t['workflow_step_id'] as string).filter(Boolean)
    );

    const nextSteps = def.steps.filter((s) => {
      if (startedStepIds.has(s.id) && s.id !== stepId) return false;
      if (s.id === stepId) return false; // Current step
      if (!s.dependsOn || s.dependsOn.length === 0) return false; // Already started as initial
      return s.dependsOn.every((dep) => completedStepIds.has(dep));
    });

    if (nextSteps.length === 0) {
      // Check if all steps are done
      const allStepIds = new Set(def.steps.map((s) => s.id));
      const allDone = [...allStepIds].every((id) => completedStepIds.has(id));
      if (allDone) {
        await this.db.update('workflow_runs', { id: workflowRunId }, {
          status: 'completed',
          completed_at: new Date().toISOString(),
        });
        await this.hooks.emit('workflow.completed', { workflowRunId });
      }
      return;
    }

    for (const step of nextSteps) {
      await this._createStepTask(step, workflowRunId, workflow['id'] as string, fullContext);
    }
  }

  /**
   * Mark a workflow run as failed.
   */
  async onStepFailed(taskId: string, error: string): Promise<void> {
    const task = await this.db.get('tasks', { id: taskId });
    if (!task || !task['workflow_run_id']) return;

    const workflowRunId = task['workflow_run_id'] as string;
    const stepId = task['workflow_step_id'] as string | undefined;

    const run = await this.db.get('workflow_runs', { id: workflowRunId });
    if (!run || run['status'] !== 'running') return;

    // Find workflow definition to check onFail behavior
    const workflow = await this.db.get('workflows', { id: run['workflow_id'] as string });
    if (!workflow) return;
    const def = JSON.parse(workflow['definition'] as string) as WorkflowDefinition;
    const step = stepId ? def.steps.find((s) => s.id === stepId) : undefined;

    if (!step || step.onFail === 'abort' || !step.onFail) {
      await this.db.update('workflow_runs', { id: workflowRunId }, {
        status: 'failed',
        error,
        completed_at: new Date().toISOString(),
      });
      await this.hooks.emit('workflow.failed', { workflowRunId, error });
    }
    // skip/retry handled by retry policy in run-manager
  }

  private async _createStepTask(
    step: WorkflowStep,
    workflowRunId: string,
    workflowId: string,
    context: Record<string, unknown>,
  ): Promise<string> {
    // Find agent id by slug if agentSlug provided
    let assigneeId: string | undefined;
    if (step.agentSlug) {
      const agents = await this.db.query('agents', { where: { slug: step.agentSlug } });
      if (agents.length > 0) {
        assigneeId = agents[0]!['id'] as string;
      }
    }

    const title = interpolate(step.taskTemplate.title, context);
    const description = interpolate(step.taskTemplate.description, context);

    const taskId = await this.taskQueue.create({
      title,
      description,
      assignee_id: assigneeId,
      workflow_run_id: workflowRunId,
      workflow_step_id: step.id,
    });

    return taskId;
  }
}
