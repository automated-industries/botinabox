/**
 * ChatPipelineV2 — Primary Agent Architecture.
 *
 * Replaces the 6-layer "dumb ack + headless execution" pattern with a
 * 3-phase "conversational brain + tool delegation" pattern:
 *
 *   Phase 1: RECEIVE — Store message, build history, emit typing indicator
 *   Phase 2: THINK  — Call primary agent LLM with history + tools in a loop
 *   Phase 3: RESPOND — Deliver agent's text, run async memory extraction
 *
 * The primary agent is the conversational hub. It has full conversation
 * context and uses tools to answer directly (single-agent) or delegate
 * work (multi-agent). One response per message — no separate ack.
 */

import { createHash } from 'node:crypto';
import type { DataStore } from '../data/data-store.js';
import type { HookBus } from '../hooks/hook-bus.js';
import type { InboundMessage } from './types.js';
import type { ToolDefinition, ToolHandler, ToolContext } from '../orchestrator/execution-engine.js';
import type { SystemContextOptions } from '../data/context-builder.js';
import type { Extractor } from './message-interpreter.js';
import { MessageStore } from './message-store.js';
import { ChatResponder } from './chat-responder.js';
import { MessageInterpreter } from './message-interpreter.js';
import { buildSystemContext } from '../data/context-builder.js';

type ContentBlock = { type: string; text?: string; id?: string; name?: string; input?: unknown };
type MessageParam = { role: string; content: string | ContentBlock[] };

export interface ChatPipelineV2Config {
  /** Primary agent LLM call — supports tool use */
  llmCall: (params: {
    model: string;
    messages: MessageParam[];
    system?: string;
    maxTokens?: number;
    tools?: ToolDefinition[];
    tool_choice?: { type: string };
  }) => Promise<{
    content: ContentBlock[];
    stop_reason: string;
    usage?: { input_tokens: number; output_tokens: number };
  }>;

  /** System prompt for the primary agent */
  systemPrompt: string;

  /** Tools available to the primary agent */
  tools?: Array<{ definition: ToolDefinition; handler: ToolHandler }>;

  /** Model (default: 'claude-sonnet-4-6') */
  model?: string;

  /** Max tool loop iterations (default: 5) */
  maxIterations?: number;

  /** Max tokens for response (default: 4096) */
  maxTokens?: number;

  /** Optional message filter */
  messageFilter?: (msg: InboundMessage) => boolean;

  /** Channel (default: 'slack') */
  channel?: string;

  /** Dedup window ms (default: 300_000) */
  dedupWindowMs?: number;

  /** Conversation history config */
  history?: {
    maxMessages?: number;       // default: 50
    maxAgeDays?: number;        // default: 7
    includeAssistant?: boolean; // default: true
  };

  /** Include system context from DB (default: true) */
  includeSystemContext?: boolean;

  /** Options for buildSystemContext */
  systemContextOptions?: SystemContextOptions;

  /** TaskQueue for dispatch_task and sub-agent result delivery */
  tasks: {
    create(task: Record<string, unknown>): Promise<string>;
    update(id: string, changes: Record<string, unknown>): Promise<void>;
    get(id: string): Promise<Record<string, unknown> | undefined>;
  };

  /** WakeupQueue for agent wakeup */
  wakeups: {
    enqueue(agentId: string, source: string, context?: Record<string, unknown>): Promise<string>;
  };

  /** Custom extractors for async memory extraction */
  extractors?: Extractor[];

  /** Sub-agent result handling (default: 'passthrough') */
  subAgentResultMode?: 'passthrough' | 'synthesize';

  /** Resolve file paths from DB-relative to absolute */
  resolveFilePath?: (path: string) => string;
}

const DEFAULT_DEDUP_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ITERATIONS = 5;
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_MAX_MESSAGES = 50;
const DEFAULT_MAX_AGE_DAYS = 7;
const APPROX_CHARS_PER_TOKEN = 4;

export class ChatPipelineV2 {
  readonly messageStore: MessageStore;
  readonly responder: ChatResponder;
  readonly interpreter: MessageInterpreter;

  private readonly channel: string;
  private readonly messageFilter?: (msg: InboundMessage) => boolean;
  private readonly dedupWindowMs: number;
  private readonly threadChannelMap = new Map<string, string>();
  private readonly toolDefs: ToolDefinition[];
  private readonly toolHandlers: Map<string, ToolHandler>;

  constructor(
    private db: DataStore,
    private hooks: HookBus,
    private config: ChatPipelineV2Config,
  ) {
    this.channel = config.channel ?? 'slack';
    this.messageFilter = config.messageFilter;
    this.dedupWindowMs = config.dedupWindowMs ?? DEFAULT_DEDUP_WINDOW_MS;

    this.toolDefs = (config.tools ?? []).map(t => t.definition);
    this.toolHandlers = new Map(
      (config.tools ?? []).map(t => [t.definition.name, t.handler]),
    );

    this.messageStore = new MessageStore(db, hooks);

    // ChatResponder is reused ONLY for sendResponse (storage + delivery).
    // The primary agent IS the responder now — ChatResponder never calls LLM.
    // We pass a simple adapter that extracts text from the V2 content blocks.
    // Adapter: wraps V2 tool-capable llmCall into the simple string-based
    // llmCall that ChatResponder and MessageInterpreter expect.
    const simpleLlmCall = async (params: {
      model: string;
      messages: Array<{ role: string; content: string | ContentBlock[] }>;
      system?: string;
      maxTokens?: number;
    }) => {
      const result = await config.llmCall({
        model: params.model ?? config.model ?? 'fast',
        messages: params.messages.map(m => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : m.content.map(b => ('text' in b ? b.text : '')).join(''),
        })),
        system: params.system,
        maxTokens: params.maxTokens ?? 500,
      });
      const text = result.content
        .filter(b => b.type === 'text')
        .map(b => b.text ?? '')
        .join('');
      return { content: text };
    };

    this.responder = new ChatResponder(db, hooks, this.messageStore, {
      llmCall: simpleLlmCall,
      model: config.model ?? 'fast',
      systemPrompt: config.systemPrompt,
    });

    this.interpreter = new MessageInterpreter(db, hooks, {
      llmCall: simpleLlmCall,
      model: 'fast',
      extractors: config.extractors,
    });

    this.registerHandlers();
  }

  /**
   * Resolve the channel ID for a thread (for response delivery).
   */
  async resolveChannel(threadId: string, taskId?: string): Promise<string | undefined> {
    if (taskId) {
      const mappings = await this.db.query('thread_task_map', { where: { task_id: taskId } });
      if (mappings.length > 0) return mappings[0]!.channel_id as string;
    }
    if (threadId) {
      const mappings = await this.db.query('thread_task_map', { where: { thread_ts: threadId } });
      if (mappings.length > 0) return mappings[0]!.channel_id as string;
    }
    return this.threadChannelMap.get(threadId);
  }

  private registerHandlers(): void {
    // ── Primary handler: RECEIVE → THINK → RESPOND ─────────────
    this.hooks.register('message.inbound', async (ctx) => {
      const msg = ctx as unknown as InboundMessage;
      if (msg.channel !== this.channel) return;
      if (this.messageFilter && !this.messageFilter(msg)) return;
      if (await this.isDuplicate(msg)) return;

      // Resolve stable thread ID (same DM logic as v1)
      const channelId = msg.account ?? '';
      const threadTs = channelId || msg.threadId || msg.id;

      if (threadTs && channelId) {
        this.threadChannelMap.set(threadTs, channelId);
      }

      // ── Phase 1: RECEIVE ───────────────────────────────────
      const msgWithThread = { ...msg, threadId: threadTs };
      const { messageId } = await this.messageStore.storeInbound(msgWithThread);

      await this.hooks.emit('typing.start', { channel: this.channel, threadId: threadTs });

      try {
        // Build conversation history
        const history = await this.buildHistory(channelId);

        // Build system context from DB
        let systemPrompt = this.config.systemPrompt;
        if (this.config.includeSystemContext !== false) {
          const ctx = await buildSystemContext(this.db, this.config.systemContextOptions);
          if (ctx) systemPrompt += `\n\n${ctx}`;
        }

        // ── Phase 2: THINK ─────────────────────────────────────
        const { text, tasksDispatched } = await this.think(
          systemPrompt, history, msg.body, threadTs, channelId,
        );

        // ── Phase 3: RESPOND ───────────────────────────────────
        await this.hooks.emit('typing.stop', { channel: this.channel, threadId: threadTs });

        if (text) {
          await this.responder.sendResponse({
            text,
            channel: this.channel,
            threadId: threadTs,
            source: 'primary',
            skipFilter: true,
            skipRedundancyCheck: true,
          });
        }

        // Async memory extraction (non-blocking, non-fatal)
        void this.extractAsync(messageId);
      } catch (err) {
        await this.hooks.emit('typing.stop', { channel: this.channel, threadId: threadTs });
        // LLM failure is non-fatal — message was stored, just no response
        await this.hooks.emit('pipeline.error', {
          messageId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    // ── Sub-agent result delivery ──────────────────────────────
    this.hooks.register('run.completed', async (ctx) => {
      const taskId = ctx.taskId as string;
      if (!taskId) return;

      const task = await this.db.get('tasks', { id: taskId });
      const output = task?.result as string | undefined;
      if (!output) return;

      const mappings = await this.db.query('thread_task_map', { where: { task_id: taskId } });
      if (mappings.length === 0) return;

      const threadId = mappings[0]!.thread_ts as string;

      await this.responder.sendResponse({
        text: output,
        channel: this.channel,
        threadId,
        agentId: ctx.agentId as string,
        taskId,
        source: 'agent',
        skipFilter: true,
        skipRedundancyCheck: true,
      });
    }, { priority: 90 });
  }

  /**
   * Primary agent tool loop — adapted from ExecutionEngine pattern.
   */
  private async think(
    systemPrompt: string,
    history: MessageParam[],
    currentMessage: string,
    threadTs: string,
    channelId: string,
  ): Promise<{ text: string; tasksDispatched: string[] }> {
    const model = this.config.model ?? 'claude-sonnet-4-6';
    const maxIterations = this.config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const maxTokens = this.config.maxTokens ?? DEFAULT_MAX_TOKENS;
    const tasksDispatched: string[] = [];

    // Build messages: history + current
    const messages: MessageParam[] = [
      ...history,
      { role: 'user', content: currentMessage },
    ];

    let finalText = '';

    for (let i = 0; i < maxIterations; i++) {
      const params: Record<string, unknown> = {
        model,
        messages,
        system: systemPrompt,
        maxTokens,
      };

      if (this.toolDefs.length > 0) {
        params.tools = this.toolDefs;
        params.tool_choice = { type: 'auto' };
      }

      const response = await this.config.llmCall(params as Parameters<ChatPipelineV2Config['llmCall']>[0]);

      // Collect text blocks
      const textBlocks = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text ?? '');
      if (textBlocks.length > 0) finalText += textBlocks.join('');

      // If no tool use, we're done
      if (response.stop_reason !== 'tool_use') break;

      // Execute tool calls
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const toolResults: ContentBlock[] = [];

      for (const toolUse of toolUseBlocks) {
        const handler = this.toolHandlers.get(toolUse.name!);
        if (handler) {
          try {
            const toolCtx: ToolContext = {
              taskId: '',
              agentId: 'primary',
              hooks: this.hooks,
              db: this.db,
              resolveFilePath: this.config.resolveFilePath,
            };
            const result = await handler(
              toolUse.input as Record<string, unknown>,
              toolCtx,
            );

            // Track dispatched tasks for thread mapping
            if (toolUse.name === 'dispatch_task' && result.includes('ID:')) {
              const idMatch = result.match(/ID:\s*([a-f0-9-]+)/);
              if (idMatch) {
                const taskId = idMatch[1]!;
                tasksDispatched.push(taskId);
                // Create thread-task mapping for sub-agent result routing
                try {
                  const existing = await this.db.query('thread_task_map', {
                    where: { thread_ts: threadTs, channel_id: channelId },
                  });
                  if (existing.length > 0) {
                    await this.db.update('thread_task_map', { id: existing[0]!.id }, { task_id: taskId });
                  } else {
                    await this.db.insert('thread_task_map', {
                      thread_ts: threadTs,
                      channel_id: channelId,
                      task_id: taskId,
                    });
                  }
                } catch {
                  // Thread mapping is best-effort
                }
              }
            }

            toolResults.push({
              type: 'tool_result',
              id: toolUse.id!,
              text: result,
            } as unknown as ContentBlock);
          } catch (err) {
            toolResults.push({
              type: 'tool_result',
              id: toolUse.id!,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            } as unknown as ContentBlock);
          }
        }
      }

      // Add assistant response + tool results to conversation
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });
    }

    return { text: finalText, tasksDispatched };
  }

  /**
   * Build conversation history from channel messages.
   * Includes BOTH user and assistant messages (unlike v1 which excluded bot messages).
   */
  private async buildHistory(channelId: string): Promise<MessageParam[]> {
    const maxMessages = this.config.history?.maxMessages ?? DEFAULT_MAX_MESSAGES;
    const maxAgeDays = this.config.history?.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
    const includeAssistant = this.config.history?.includeAssistant !== false;

    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();

    let rows: Array<Record<string, unknown>>;
    try {
      rows = await this.db.query('messages', {
        where: { channel: this.channel },
        orderBy: 'created_at',
        orderDir: 'desc',
        limit: maxMessages,
      });
      rows.reverse();
      // Apply age filter in JS (simpler, works with all DB backends)
      rows = rows.filter(r => {
        const ts = r.created_at as string | undefined;
        return !ts || ts >= cutoff; // Include rows with missing timestamp
      });
    } catch {
      return [];
    }

    const messages: MessageParam[] = [];
    const maxChars = 16000; // ~4K tokens
    let charCount = 0;

    for (const row of rows) {
      const body = (row.body as string) ?? '';
      const direction = row.direction as string;

      if (!includeAssistant && direction !== 'inbound') continue;
      if (charCount + body.length > maxChars) break;

      messages.push({
        role: direction === 'inbound' ? 'user' : 'assistant',
        content: body,
      });
      charCount += body.length;
    }

    return messages;
  }

  /**
   * Dedup check (same as v1).
   */
  private async isDuplicate(msg: InboundMessage): Promise<boolean> {
    const hash = createHash('sha256')
      .update(`${msg.from}:${msg.body}`)
      .digest('hex');

    const cutoff = new Date(Date.now() - this.dedupWindowMs).toISOString();
    const recent = await this.db.query('message_dedup', { where: { content_hash: hash } });

    if (recent.some(r => (r.created_at as string) > cutoff)) return true;

    await this.db.insert('message_dedup', {
      content_hash: hash,
      channel_id: msg.account ?? '',
      created_at: new Date().toISOString(),
    });

    return false;
  }

  /**
   * Async memory extraction (non-blocking, non-fatal).
   */
  private async extractAsync(messageId: string): Promise<void> {
    try {
      await this.interpreter.interpret(messageId);
    } catch (err) {
      await this.hooks.emit('interpretation.error', {
        messageId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
