import type { DataStore } from '../data/data-store.js';
import type { HookBus } from '../hooks/hook-bus.js';
import { MAX_CHAIN_DEPTH, checkChainDepth } from './chain-guard.js';

export { MAX_CHAIN_DEPTH };

export class TaskQueue {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly pollIntervalMs: number;
  private readonly staleThresholdMs: number;

  constructor(
    private db: DataStore,
    private hooks: HookBus,
    private config?: { pollIntervalMs?: number; staleThresholdMs?: number },
  ) {
    this.pollIntervalMs = config?.pollIntervalMs ?? 30_000;
    this.staleThresholdMs = config?.staleThresholdMs ?? 5 * 60 * 1_000;
  }

  async create(task: {
    title: string;
    description?: string;
    assignee_id?: string;
    priority?: number;
    chain_depth?: number;
    chain_origin_id?: string;
    [key: string]: unknown;
  }): Promise<string> {
    const depth = task.chain_depth ?? 0;
    checkChainDepth(depth, MAX_CHAIN_DEPTH);

    const row = this.db.insert('tasks', {
      title: task.title,
      description: task.description,
      assignee_id: task.assignee_id,
      priority: task.priority ?? 5,
      chain_depth: depth,
      chain_origin_id: task.chain_origin_id,
      status: 'todo',
      ...Object.fromEntries(
        Object.entries(task).filter(([k]) =>
          !['title', 'description', 'assignee_id', 'priority', 'chain_depth', 'chain_origin_id', 'status'].includes(k)
        )
      ),
    });

    await this.hooks.emit('task.created', { taskId: row['id'], title: task.title });
    return row['id'] as string;
  }

  async update(id: string, changes: Record<string, unknown>): Promise<void> {
    this.db.update('tasks', { id }, {
      ...changes,
      updated_at: new Date().toISOString(),
    });
  }

  async get(id: string): Promise<Record<string, unknown> | undefined> {
    return this.db.get('tasks', { id }) ?? undefined;
  }

  async list(filter?: { status?: string; assignee_id?: string }): Promise<Record<string, unknown>[]> {
    const where: Record<string, unknown> = {};
    if (filter?.status) where['status'] = filter.status;
    if (filter?.assignee_id) where['assignee_id'] = filter.assignee_id;
    return this.db.query('tasks', Object.keys(where).length ? { where } : undefined);
  }

  startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll(): Promise<void> {
    // Find tasks with status='todo', assignee_id NOT NULL
    const todoTasks = this.db.query('tasks', { where: { status: 'todo' } })
      .filter((t) => t['assignee_id'] != null);

    // Check which have no active run
    const activeTasks = new Set(
      this.db.query('runs', { where: { status: 'running' } }).map((r) => r['task_id'] as string)
    );

    const eligible = todoTasks
      .filter((t) => !activeTasks.has(t['id'] as string))
      .sort((a, b) => (a['priority'] as number) - (b['priority'] as number));

    for (const task of eligible) {
      await this.hooks.emit('agent.wakeup', {
        agentId: task['assignee_id'],
        taskId: task['id'],
        source: 'poll',
      });
    }
  }
}
