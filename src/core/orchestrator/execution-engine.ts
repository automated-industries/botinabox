/**
 * ExecutionEngine — generic task executor with pluggable tools and tool loop.
 *
 * Listens for task.created events, picks up tasks, runs them through an LLM
 * with tools, and finishes the run with the result.
 *
 * Apps configure: model, tools, system prompt, max iterations.
 * Framework handles: task pickup, locking, tool loop, cost tracking, result storage.
 */

import type { DataStore } from '../data/data-store.js';
import type { HookBus } from '../hooks/hook-bus.js';
import type { RunManager } from './run-manager.js';
import { buildSystemContext } from '../data/context-builder.js';

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type ToolHandler = (
  input: Record<string, unknown>,
  context: ToolContext,
) => Promise<string>;

export interface ToolContext {
  taskId: string;
  agentId: string;
  hooks: HookBus;
  db: DataStore;
  /** Resolve a relative file path to an absolute path (environment-aware). */
  resolveFilePath?: (path: string) => string;
}

export interface ContextFile {
  /** Absolute path, used as the `path` attribute in the wrapped XML tag. */
  path: string;
  /** Raw file contents (UTF-8). The engine does not read the filesystem itself. */
  content: string;
}

export interface ExecutionEngineConfig {
  /** Anthropic client instance */
  client: {
    messages: {
      create: (params: Record<string, unknown>) => Promise<{
        content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
        stop_reason: string;
        usage: { input_tokens: number; output_tokens: number };
      }>;
    };
  };
  /** Model to use. Default: claude-sonnet-4-20250514 */
  model?: string;
  /** Max tool loop iterations. Default: 5 */
  maxIterations?: number;
  /** Tools available to the agent */
  tools?: Array<{ definition: ToolDefinition; handler: ToolHandler }>;
  /** Additional system prompt text (appended after system context) */
  systemPromptSuffix?: string;
  /** Include system context (users, files, etc). Default: true */
  includeSystemContext?: boolean;
  /** Resolve file paths from DB-relative to absolute (for cross-environment support). */
  resolveFilePath?: (path: string) => string;
  /**
   * Optional per-dispatch context resolver. Called once per task pickup with
   * the resolved agent and task rows. Returned files are wrapped in
   * `<file path="...">...</file>` XML tags and inserted into the system
   * prompt between the static `buildSystemContext` block and the tool
   * listing. Intended for apps that want to inject per-agent or per-project
   * rendered context (rules, playbooks, agent definitions) that is not
   * already covered by `buildSystemContext`.
   *
   * The resolver owns all filesystem / database lookups — the engine does
   * not touch the disk. If the resolver throws, the task fails loudly per
   * Rule-16-style fail-loud semantics; there is no silent fallback.
   */
  resolveContextFiles?: (
    ctx: { agent: Record<string, unknown>; task: Record<string, unknown> },
  ) => Promise<ContextFile[]> | ContextFile[];
}

/**
 * Wrap a set of context files in `<file path="...">...</file>` XML tags,
 * joined by blank lines. Returns an empty string if the input is empty so
 * callers can safely concatenate the result into a larger prompt without
 * needing a conditional. Pure function — no I/O — so it can be unit-tested
 * without touching the filesystem or a model.
 */
export function formatContextFilesBlock(files: ContextFile[]): string {
  if (!files || files.length === 0) return '';
  return files
    .map((f) => `<file path="${f.path}">\n${f.content}\n</file>`)
    .join('\n\n');
}

export async function registerExecutionEngine(opts: {
  db: DataStore;
  hooks: HookBus;
  runs: RunManager;
  config: ExecutionEngineConfig;
}): Promise<void> {
  const { db, hooks, runs, config } = opts;
  const model = config.model ?? 'claude-sonnet-4-20250514';
  const maxIterations = config.maxIterations ?? 5;
  const includeContext = config.includeSystemContext ?? true;

  const systemContext = includeContext ? await buildSystemContext(db) : '';

  const toolDefs = (config.tools ?? []).map(t => t.definition);
  const toolHandlers = new Map(
    (config.tools ?? []).map(t => [t.definition.name, t.handler]),
  );

  // ── Shared task execution logic ───────────────────────────────
  async function tryExecuteTask(taskId: string, hintAgentId?: string): Promise<void> {
    const task = await db.get('tasks', { id: taskId });
    if (!task || task.status !== 'todo') return;

    // Respect retry backoff
    const nextRetryAt = task['next_retry_at'] as string | undefined;
    if (nextRetryAt && new Date(nextRetryAt) > new Date()) return;

    const assigneeId = hintAgentId ?? task.assignee_id as string;
    if (!assigneeId) return;
    if (runs.isLocked(assigneeId)) return;

    const agent = await db.get('agents', { id: assigneeId });
    if (!agent) return;

    let runId: string;
    try {
      runId = await runs.startRun(assigneeId, taskId, 'api');
    } catch {
      return; // Agent became locked between check and start (race condition)
    }

    const prompt = (task.description as string) ?? (task.title as string) ?? '';

    try {
      // Per-dispatch context files (e.g. rendered agent/project rules).
      // The resolver owns all I/O; the engine just concatenates what it
      // gets back. Thrown errors propagate up to the outer catch and fail
      // the run loudly — no silent fallback to an empty context.
      const contextFiles = config.resolveContextFiles
        ? await config.resolveContextFiles({ agent, task })
        : [];
      const contextFilesBlock = formatContextFilesBlock(contextFiles);

      const toolListing = toolDefs.length > 0
        ? `\n## Available Tools\n${toolDefs.map(t => `- **${t.name}**: ${t.description}`).join('\n')}\n\nUse your tools to take action. Do NOT describe what you would do — call the tool.`
        : '';

      const systemPrompt = [
        `You are ${agent.name}, an AI agent with role: ${agent.role}.`,
        systemContext ? `\n${systemContext}` : '',
        contextFilesBlock ? `\n${contextFilesBlock}` : '',
        toolListing,
        config.systemPromptSuffix ?? '',
      ].filter(Boolean).join('\n');

      type MessageParam = { role: string; content: string | unknown[] };
      const messages: MessageParam[] = [{ role: 'user', content: prompt }];
      let finalOutput = '';
      let totalInput = 0;
      let totalOutput = 0;

      for (let i = 0; i < maxIterations; i++) {
        const createParams: Record<string, unknown> = {
          model,
          max_tokens: 4096,
          system: systemPrompt,
          messages,
        };
        if (toolDefs.length > 0) {
          createParams.tools = toolDefs;
          // Force tool use on first iteration — agents must act, not narrate.
          // Subsequent iterations use 'auto' so the agent can finish with text.
          createParams.tool_choice = i === 0 ? { type: 'any' } : { type: 'auto' };
        }

        const response = await config.client.messages.create(createParams);
        totalInput += response.usage.input_tokens;
        totalOutput += response.usage.output_tokens;

        const textBlocks = response.content
          .filter(b => b.type === 'text')
          .map(b => b.text ?? '');
        if (textBlocks.length > 0) finalOutput += textBlocks.join('');

        if (response.stop_reason !== 'tool_use') break;

        const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
        const toolResults: Array<{ type: string; tool_use_id: string; content: string }> = [];

        for (const toolUse of toolUseBlocks) {
          const handler = toolHandlers.get(toolUse.name!);
          if (handler) {
            try {
              const result = await handler(
                toolUse.input as Record<string, unknown>,
                { taskId, agentId: assigneeId, hooks, db, resolveFilePath: config.resolveFilePath },
              );
              toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id!, content: result });
            } catch (err) {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id!,
                content: `Error: ${err instanceof Error ? err.message : String(err)}`,
              });
            }
          }
        }

        messages.push({ role: 'assistant', content: response.content as unknown[] });
        messages.push({ role: 'user', content: toolResults as unknown[] });
      }

      const costCents = Math.round((totalInput * 0.3 + totalOutput * 1.5) / 100);

      await runs.finishRun(runId, {
        exitCode: 0,
        output: finalOutput,
        costCents,
        usage: { inputTokens: totalInput, outputTokens: totalOutput },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await runs.finishRun(runId, { exitCode: 1, output: `Execution error: ${msg}` });
    }
  }

  // ── Hook: immediate execution on task creation ────────────────
  hooks.register('task.created', async (ctx) => {
    const taskId = ctx.id as string ?? ctx.taskId as string;
    if (!taskId) return;
    await tryExecuteTask(taskId);
  });

  // ── Hook: poll-based retry for tasks that missed task.created ─
  hooks.register('agent.wakeup', async (ctx) => {
    const taskId = ctx.taskId as string;
    const agentId = ctx.agentId as string;
    if (!taskId) return;
    await tryExecuteTask(taskId, agentId);
  });

  // ── Hook: immediate pickup after a run completes ──────────────
  hooks.register('run.completed', async (ctx) => {
    const agentId = ctx.agentId as string;
    if (!agentId) return;

    const pendingTasks = (await db.query('tasks', { where: { status: 'todo' } }))
      .filter(t => t['assignee_id'] === agentId)
      .sort((a, b) => (a['priority'] as number) - (b['priority'] as number));

    if (pendingTasks.length > 0) {
      await tryExecuteTask(pendingTasks[0]!['id'] as string, agentId);
    }
  });
}
