import type { DataStore } from '../data/data-store.js';
import type { HookBus } from '../hooks/hook-bus.js';
import type { CircuitBreaker } from './circuit-breaker.js';
import { checkChainDepth, MAX_CHAIN_DEPTH } from './chain-guard.js';
import { interpolate } from './template-interpolate.js';

const DEFAULT_STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const BASE_BACKOFF_MS = 5_000;
const DEFAULT_MAX_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes

export class RunManager {
  private locks = new Map<string, string>(); // agentId → runId
  private orphanTimer: ReturnType<typeof setInterval> | null = null;
  private readonly staleThresholdMs: number;
  private circuitBreaker?: CircuitBreaker;

  constructor(
    private db: DataStore,
    private hooks: HookBus,
    private config?: { staleThresholdMs?: number; maxBackoffMs?: number },
  ) {
    this.staleThresholdMs = config?.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;
  }

  /**
   * Attach a CircuitBreaker to prevent retries on broken agents.
   */
  setCircuitBreaker(cb: CircuitBreaker): void {
    this.circuitBreaker = cb;
  }

  isLocked(agentId: string): boolean {
    return this.locks.has(agentId);
  }

  async startRun(agentId: string, taskId: string, adapter?: string): Promise<string> {
    if (this.locks.has(agentId)) {
      throw new Error(`Agent already has an active run`);
    }

    const row = await this.db.insert('runs', {
      agent_id: agentId,
      task_id: taskId,
      adapter: adapter,
      status: 'running',
      started_at: new Date().toISOString(),
    });

    const runId = row['id'] as string;
    this.locks.set(agentId, runId);
    return runId;
  }

  async finishRun(
    runId: string,
    result: {
      exitCode: number;
      output?: string;
      costCents?: number;
      usage?: unknown;
    },
  ): Promise<void> {
    const run = await this.db.get('runs', { id: runId });
    if (!run) throw new Error(`Run not found: ${runId}`);

    const succeeded = result.exitCode === 0;
    const status = succeeded ? 'succeeded' : 'failed';
    const usage = result.usage as Record<string, unknown> | undefined;

    await this.db.update('runs', { id: runId }, {
      status,
      completed_at: new Date().toISOString(),
      exit_code: result.exitCode,
      cost_cents: result.costCents ?? 0,
      input_tokens: usage?.['inputTokens'] ?? 0,
      output_tokens: usage?.['outputTokens'] ?? 0,
      error_message: result.exitCode !== 0 ? result.output : undefined,
    });

    // Release lock
    const agentId = run['agent_id'] as string;
    this.locks.delete(agentId);

    const taskId = run['task_id'] as string;

    if (!succeeded) {
      // Record failure in circuit breaker (if attached)
      if (this.circuitBreaker) {
        await this.circuitBreaker.recordFailure(agentId, result.output);
      }

      // Retry policy — skip retry if circuit breaker is open
      const task = await this.db.get('tasks', { id: taskId });
      if (task) {
        const retryCount = (task['retry_count'] as number) ?? 0;
        const maxRetries = (task['max_retries'] as number) ?? 0;
        const circuitOpen = this.circuitBreaker
          ? !this.circuitBreaker.canExecute(agentId)
          : false;

        if (retryCount < maxRetries && !circuitOpen) {
          // Exponential backoff: BASE_BACKOFF_MS * 2^retryCount
          const maxBackoff = this.config?.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
          const backoffMs = Math.min(BASE_BACKOFF_MS * Math.pow(2, retryCount), maxBackoff);
          const nextRetryAt = new Date(Date.now() + backoffMs).toISOString();
          await this.db.update('tasks', { id: taskId }, {
            retry_count: retryCount + 1,
            next_retry_at: nextRetryAt,
            status: 'todo',
            execution_run_id: null,
            updated_at: new Date().toISOString(),
          });
        } else {
          // Retries exhausted or circuit open — mark task as failed
          await this.db.update('tasks', { id: taskId }, {
            status: 'failed',
            updated_at: new Date().toISOString(),
          });
        }
      }
    } else {
      // Record success in circuit breaker (if attached)
      if (this.circuitBreaker) {
        await this.circuitBreaker.recordSuccess(agentId);
      }
      // Mark task done with result before emitting run.completed,
      // so hook handlers can read task.result immediately.
      await this.db.update('tasks', { id: taskId }, {
        status: 'done',
        result: result.output,
        updated_at: new Date().toISOString(),
      });

      // Followup chain
      const task = await this.db.get('tasks', { id: taskId });
      if (task && task['followup_agent_id']) {
        const chainDepth = ((task['chain_depth'] as number) ?? 0) + 1;
        checkChainDepth(chainDepth, MAX_CHAIN_DEPTH);

        const followupAgentId = task['followup_agent_id'] as string;
        const followupTemplate = (task['followup_template'] as string | undefined) ?? 'Followup: {{output}}';
        const context = { output: result.output ?? '' };
        const title = interpolate(followupTemplate, context);
        const chainOriginId = (task['chain_origin_id'] as string | undefined) ?? taskId;

        await this.db.insert('tasks', {
          title,
          description: title,
          assignee_id: followupAgentId,
          status: 'todo',
          priority: (task['priority'] as number) ?? 5,
          chain_depth: chainDepth,
          chain_origin_id: chainOriginId,
        });

        await this.hooks.emit('task.followup.created', {
          originTaskId: taskId,
          followupAgentId,
          chainDepth,
        });
      }
    }

    await this.hooks.emit('run.completed', {
      runId,
      agentId,
      taskId,
      status,
      exitCode: result.exitCode,
    });
  }

  async reapOrphans(): Promise<void> {
    const cutoff = new Date(Date.now() - this.staleThresholdMs).toISOString();

    const staleRuns = (await this.db.query('runs', { where: { status: 'running' } }))
      .filter((r) => {
        const startedAt = r['started_at'] as string | null;
        return startedAt != null && startedAt < cutoff;
      });

    for (const run of staleRuns) {
      await this.db.update('runs', { id: run['id'] }, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: 'Orphaned run reaped by RunManager',
      });

      // Release in-memory lock if we hold it
      const agentId = run['agent_id'] as string;
      if (this.locks.get(agentId) === run['id']) {
        this.locks.delete(agentId);
      }
    }
  }

  startOrphanReaper(intervalMs = 60_000): void {
    if (this.orphanTimer) return;
    this.orphanTimer = setInterval(() => {
      void this.reapOrphans();
    }, intervalMs);
  }

  stopOrphanReaper(): void {
    if (this.orphanTimer) {
      clearInterval(this.orphanTimer);
      this.orphanTimer = null;
    }
  }
}
