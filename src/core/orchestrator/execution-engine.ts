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

  hooks.register('task.created', async (ctx) => {
    const taskId = ctx.id as string ?? ctx.taskId as string;
    if (!taskId) return;

    const task = await db.get('tasks', { id: taskId });
    if (!task || task.status !== 'todo') return;

    const assigneeId = task.assignee_id as string;
    if (!assigneeId) return;
    if (runs.isLocked(assigneeId)) return;

    const agent = await db.get('agents', { id: assigneeId });
    if (!agent) return;

    const runId = await runs.startRun(assigneeId, taskId, 'api');
    const prompt = (task.description as string) ?? (task.title as string) ?? '';

    try {
      const systemPrompt = [
        `You are ${agent.name}, an AI agent with role: ${agent.role}.`,
        systemContext ? `\n${systemContext}` : '',
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
        }

        const response = await config.client.messages.create(createParams);
        totalInput += response.usage.input_tokens;
        totalOutput += response.usage.output_tokens;

        // Collect text
        const textBlocks = response.content
          .filter(b => b.type === 'text')
          .map(b => b.text ?? '');
        if (textBlocks.length > 0) finalOutput += textBlocks.join('');

        if (response.stop_reason !== 'tool_use') break;

        // Process tool calls
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
  });
}
