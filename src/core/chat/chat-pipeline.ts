/**
 * ChatPipeline — configurable 6-layer chat orchestration.
 * Story 7.4
 *
 * Replaces duplicated handler code across apps with a single configurable
 * pipeline. Apps provide: system prompt, routing rules, LLM call function,
 * and optional message filter. Everything else is framework-level.
 *
 * Layers:
 *   1. Dedup + Storage (MessageStore)
 *   2. Fast Response (ChatResponder)
 *   3. Interpretation (MessageInterpreter)
 *   4. Post-Interpretation Response
 *   5. Task Dispatch (TriageRouter)
 *   6. Task Execution Response
 */

import { createHash, randomUUID } from 'node:crypto';
import type { DataStore } from '../data/data-store.js';
import type { HookBus } from '../hooks/hook-bus.js';
import type { InboundMessage } from './types.js';
import { MessageStore } from './message-store.js';
import { ChatResponder } from './chat-responder.js';
import type { ChatResponderConfig } from './chat-responder.js';
import { MessageInterpreter } from './message-interpreter.js';
import type { Extractor, InterpretationResult, ExtractedTask } from './message-interpreter.js';
import { TriageRouter } from './triage-router.js';
import type { RoutingRule } from './triage-router.js';

export interface ChatPipelineConfig {
  /** LLM call function for chat responses and interpretation */
  llmCall: ChatResponderConfig['llmCall'];
  /** System prompt for the conversational responder */
  systemPrompt: string;
  /** Agent routing rules for task dispatch */
  routingRules: RoutingRule[];
  /** Default agent when no rule matches */
  fallbackAgent: string;
  /** Optional message filter — return false to ignore a message */
  messageFilter?: (msg: InboundMessage) => boolean;
  /** Optional capabilities description for the responder */
  capabilities?: string;
  /** Channel this pipeline handles (default: 'slack') */
  channel?: string;
  /** Custom extractors for MessageInterpreter */
  extractors?: Extractor[];
  /** Dedup window in ms (default: 300_000 = 5 min) */
  dedupWindowMs?: number;
  /** Model for fast responses (default: 'fast') */
  model?: string;
  /** Enable LLM fallback routing (default: false) */
  llmRouting?: boolean;
  /** TaskQueue instance — required for task dispatch */
  tasks: {
    create(task: Record<string, unknown>): Promise<string>;
    update(id: string, changes: Record<string, unknown>): Promise<void>;
    get(id: string): Promise<Record<string, unknown> | undefined>;
  };
  /** WakeupQueue instance — required for agent waking */
  wakeups: {
    enqueue(agentId: string, source: string, context?: Record<string, unknown>): Promise<string>;
  };
}

const DEFAULT_DEDUP_WINDOW_MS = 5 * 60 * 1000;

export class ChatPipeline {
  readonly messageStore: MessageStore;
  readonly responder: ChatResponder;
  readonly interpreter: MessageInterpreter;
  readonly router: TriageRouter;

  private readonly channel: string;
  private readonly messageFilter?: (msg: InboundMessage) => boolean;
  private readonly capabilities?: string;
  private readonly dedupWindowMs: number;
  private readonly tasks: ChatPipelineConfig['tasks'];
  private readonly wakeups: ChatPipelineConfig['wakeups'];

  // In-memory thread → channel mapping for response routing
  // (before thread_task_map exists)
  private readonly threadChannelMap = new Map<string, string>();

  /** Last dispatch promise — exposed for testing. */
  lastDispatch: Promise<void> = Promise.resolve();

  constructor(
    private db: DataStore,
    private hooks: HookBus,
    config: ChatPipelineConfig,
  ) {
    this.channel = config.channel ?? 'slack';
    this.messageFilter = config.messageFilter;
    this.capabilities = config.capabilities;
    this.dedupWindowMs = config.dedupWindowMs ?? DEFAULT_DEDUP_WINDOW_MS;
    this.tasks = config.tasks;
    this.wakeups = config.wakeups;

    this.messageStore = new MessageStore(db, hooks);

    this.responder = new ChatResponder(db, hooks, this.messageStore, {
      llmCall: config.llmCall,
      model: config.model ?? 'fast',
      systemPrompt: config.systemPrompt,
    });

    this.interpreter = new MessageInterpreter(db, hooks, {
      llmCall: config.llmCall,
      model: config.model ?? 'fast',
      extractors: config.extractors,
    });

    this.router = new TriageRouter(db, hooks, {
      rules: config.routingRules,
      fallbackAgent: config.fallbackAgent,
      llmFallback: config.llmRouting ?? false,
      persist: true,
    });

    this.registerHandlers();
  }

  /**
   * Resolve the Slack channel ID for a thread (for response delivery).
   */
  resolveChannel(threadId: string, taskId?: string): Promise<string | undefined> {
    return this.resolveChannelId(threadId, taskId);
  }

  /**
   * Register the 6-layer pipeline on the HookBus.
   */
  private registerHandlers(): void {
    // Layer 1-5: Inbound message handler
    this.hooks.register('message.inbound', async (ctx) => {
      const msg = ctx as unknown as InboundMessage;
      if (msg.channel !== this.channel) return;

      // Optional message filter
      if (this.messageFilter && !this.messageFilter(msg)) return;

      // Dedup check
      if (await this.isDuplicate(msg)) return;

      // Resolve thread ID:
      // Always use the channel ID (msg.account) as the stable thread identifier.
      // In DMs, Slack auto-creates threads which fragment context. Using the
      // channel ID ensures all messages in the same DM share one conversation.
      const channelId = msg.account ?? '';
      const threadTs = channelId || msg.threadId || msg.id;

      // Track thread → channel for response routing
      if (threadTs && channelId) {
        this.threadChannelMap.set(threadTs, channelId);
      }

      // ── Layer 1: Storage ───────────────────────────────────────
      // Set threadId on message so all messages in the same DM share a thread
      const msgWithThread = { ...msg, threadId: threadTs };
      const { messageId } = await this.messageStore.storeInbound(msgWithThread);

      // ── Layer 2: Fast Response ─────────────────────────────────
      // Include recent user message history for channel-wide context
      const userHistory = await this.messageStore.getUserHistory(
        msg.from, this.channel, 50,
      );
      const historyContext = userHistory
        .map(m => {
          const dir = m.direction === 'inbound' ? 'User' : 'Bot';
          return `${dir}: ${(m.body as string)?.slice(0, 200) ?? ''}`;
        })
        .join('\n');

      const ackResponse = await this.responder.respond({
        messageBody: msg.body,
        threadId: threadTs,
        channel: this.channel,
        capabilities: this.capabilities,
        additionalContext: historyContext ? `\n\nRecent conversation history:\n${historyContext}` : undefined,
      });

      await this.responder.sendResponse({
        text: ackResponse,
        channel: this.channel,
        threadId: threadTs,
        source: 'responder',
        skipFilter: true,
        skipRedundancyCheck: true,
      });

      // ── Layer 3-5: Interpretation + guaranteed task dispatch ────
      // ALWAYS create a task programmatically. Interpretation enriches
      // it with classification, but task creation is not LLM-dependent.
      const dispatchPromise = this.interpretAndDispatch(messageId, msg, threadTs, channelId);
      this.lastDispatch = dispatchPromise;
      void dispatchPromise;
    });

    // Layer 6: Task execution response + file attachments
    this.hooks.register('run.completed', async (ctx) => {
      const taskId = ctx.taskId as string;
      if (!taskId) return;

      const task = await this.db.get('tasks', { id: taskId });
      const output = task?.result as string | undefined;
      if (!output) return;

      const mappings = await this.db.query('thread_task_map', {
        where: { task_id: taskId },
      });
      if (mappings.length === 0) return;

      const mapping = mappings[0]!;
      const threadId = mapping.thread_ts as string;

      // Send text response
      await this.responder.sendResponse({
        text: output,
        channel: this.channel,
        threadId,
        agentId: ctx.agentId as string,
        taskId,
        source: 'agent',
        skipRedundancyCheck: true,
      });

      // Check if the original message requested a file — look up in DB and emit attachment
      const taskDesc = (task?.description as string) ?? '';
      try {
        const files = await this.db.query('file');
        for (const file of files) {
          const fileName = (file.name as string ?? '').toLowerCase();
          const descLower = taskDesc.toLowerCase();
          if (fileName && descLower.includes(fileName.split(' ')[0]!.toLowerCase()) &&
              descLower.includes(fileName.split(' ').pop()!.toLowerCase())) {
            // Fuzzy match — file name words appear in task description
            const filePath = file.file_path as string;
            if (filePath) {
              await this.hooks.emit('file.deliver', {
                filePath,
                fileName: file.name,
                channel: this.channel,
                threadId,
                taskId,
              });
            }
          }
        }
      } catch {
        // File lookup is best-effort
      }
    }, { priority: 90 });
  }

  /**
   * Check and record message dedup (SHA256 hash, configurable window).
   */
  private async isDuplicate(msg: InboundMessage): Promise<boolean> {
    const hash = createHash('sha256')
      .update(`${msg.from}:${msg.body}`)
      .digest('hex');

    const cutoff = new Date(Date.now() - this.dedupWindowMs).toISOString();
    const recent = await this.db.query('message_dedup', {
      where: { content_hash: hash },
    });

    if (recent.some(r => (r.created_at as string) > cutoff)) {
      return true;
    }

    await this.db.insert('message_dedup', {
      content_hash: hash,
      channel_id: msg.account ?? '',
    });

    return false;
  }

  /**
   * Async interpretation + task dispatch (Layers 3-5).
   *
   * ALWAYS creates a task programmatically — task creation does not depend
   * on LLM classification. Interpretation enriches but never gates dispatch.
   */
  private async interpretAndDispatch(
    messageId: string,
    msg: InboundMessage,
    threadTs: string,
    channelId: string,
  ): Promise<void> {
    // Layer 5: ALWAYS create a task — this is programmatic, not LLM-dependent
    await this.guaranteedTaskDispatch(msg, threadTs, channelId);

    // Layer 3-4: Interpretation is best-effort enrichment (memories, user context)
    try {
      const result = await this.interpreter.interpret(messageId);

      // Store any extracted memories (enrichment only — task already created above)
      if (result.memories.length > 0 || result.userContext.length > 0) {
        try {
          const parts: string[] = [];
          if (result.memories.length > 0) {
            parts.push(`Noted ${result.memories.length} thing${result.memories.length > 1 ? 's' : ''} to remember.`);
          }
          if (parts.length > 0) {
            await this.responder.sendResponse({
              text: parts.join(' '),
              channel: this.channel,
              threadId: threadTs,
              source: 'interpretation',
            });
          }
        } catch {
          // Non-fatal
        }
      }
    } catch (err) {
      // Interpretation failure is non-fatal — task was already created above
      const errMsg = err instanceof Error ? err.message : String(err);
      await this.hooks.emit('interpretation.error', {
        messageId,
        error: errMsg,
      });
    }
  }

  /**
   * Programmatic task creation — guaranteed, no LLM dependency.
   */
  private async guaranteedTaskDispatch(
    msg: InboundMessage,
    threadTs: string,
    channelId: string,
  ): Promise<void> {
    // Route to best agent
    const { agentSlug: targetSlug } = await this.router.route(msg);
    if (!targetSlug) return;

    const agents = await this.db.query('agents', { where: { slug: targetSlug } });
    const targetAgent = agents[0];
    if (!targetAgent) return;
    const handlerAgentId = targetAgent.id as string;

    // Follow-up in existing thread
    if (threadTs) {
      const existing = await this.db.query('thread_task_map', {
        where: { thread_ts: threadTs, channel_id: channelId },
      });
      if (existing.length > 0) {
        const taskId = existing[0]!.task_id as string;
        const task = await this.tasks.get(taskId);
        if (task && task.status !== 'done' && task.status !== 'cancelled') {
          const updatedDesc = `${task.description ?? ''}\n\n---\n**Follow-up (${new Date().toISOString()}):**\n${msg.body}`;
          await this.tasks.update(taskId, { description: updatedDesc });
          await this.wakeups.enqueue(handlerAgentId, 'chat_followup', { taskId });
          return;
        }
      }
    }

    // New task — programmatic, guaranteed
    const description = `## Chat Message\n\n**Channel:** ${channelId}\n**Thread:** ${threadTs}\n**From:** ${msg.from}\n**Time:** ${msg.receivedAt}\n\n---\n\n${msg.body}`;

    const taskId = randomUUID();
    if (threadTs) {
      // Upsert: update existing mapping if thread already mapped (task was done),
      // otherwise insert new mapping
      const existingMap = await this.db.query('thread_task_map', {
        where: { thread_ts: threadTs, channel_id: channelId },
      });
      if (existingMap.length > 0) {
        await this.db.update('thread_task_map', { id: existingMap[0]!.id }, {
          task_id: taskId,
        });
      } else {
        await this.db.insert('thread_task_map', {
          thread_ts: threadTs,
          channel_id: channelId,
          task_id: taskId,
        });
      }
    }

    await this.tasks.create({
      id: taskId,
      title: msg.body.slice(0, 120),
      description,
      assignee_id: handlerAgentId,
      priority: 5,
    });

    await this.wakeups.enqueue(handlerAgentId, 'chat_dispatch', { taskId });
  }

  /**
   * Route and dispatch extracted tasks.
   */
  private async dispatchTasks(
    result: InterpretationResult,
    msg: InboundMessage,
    threadTs: string,
    channelId: string,
  ): Promise<void> {
    for (const extractedTask of result.tasks) {
      const { agentSlug: targetSlug } = await this.router.route(msg);
      if (!targetSlug) continue;

      const agents = await this.db.query('agents', { where: { slug: targetSlug } });
      const targetAgent = agents[0];
      if (!targetAgent) continue;
      const handlerAgentId = targetAgent.id as string;

      // Follow-up in existing thread
      if (threadTs) {
        const existing = await this.db.query('thread_task_map', {
          where: { thread_ts: threadTs, channel_id: channelId },
        });
        if (existing.length > 0) {
          const taskId = existing[0]!.task_id as string;
          const task = await this.tasks.get(taskId);
          if (task && task.status !== 'done' && task.status !== 'cancelled') {
            const updatedDesc = `${task.description ?? ''}\n\n---\n**Follow-up (${new Date().toISOString()}):**\n${msg.body}`;
            await this.tasks.update(taskId, { description: updatedDesc });
            await this.wakeups.enqueue(handlerAgentId, 'chat_followup', { taskId });
            return;
          }
        }
      }

      // New task
      const description = `## Chat Message\n\n**Channel:** ${channelId}\n**Thread:** ${threadTs}\n**From:** ${msg.from}\n**Time:** ${msg.receivedAt}\n\n---\n\n${extractedTask.description ?? msg.body}`;

      const taskId = randomUUID();
      if (threadTs) {
        await this.db.insert('thread_task_map', {
          thread_ts: threadTs,
          channel_id: channelId,
          task_id: taskId,
        });
      }

      await this.tasks.create({
        id: taskId,
        title: extractedTask.title.slice(0, 120),
        description,
        assignee_id: handlerAgentId,
        priority: extractedTask.priority ?? 5,
      });

      await this.wakeups.enqueue(handlerAgentId, 'chat_dispatch', { taskId });
    }
  }

  /**
   * Resolve Slack channel ID from thread_task_map or in-memory fallback.
   */
  private async resolveChannelId(
    threadId: string,
    taskId?: string,
  ): Promise<string | undefined> {
    if (taskId) {
      const mappings = await this.db.query('thread_task_map', {
        where: { task_id: taskId },
      });
      if (mappings.length > 0) return mappings[0]!.channel_id as string;
    }
    if (threadId) {
      const mappings = await this.db.query('thread_task_map', {
        where: { thread_ts: threadId },
      });
      if (mappings.length > 0) return mappings[0]!.channel_id as string;
    }
    return this.threadChannelMap.get(threadId);
  }

  /**
   * Build human-readable interpretation summary.
   */
  private buildSummary(result: InterpretationResult): string {
    const parts: string[] = [];
    if (result.tasks.length > 0) {
      const names = result.tasks.map((t: ExtractedTask) => t.title).join(', ');
      parts.push(`I've identified ${result.tasks.length} task${result.tasks.length > 1 ? 's' : ''}: ${names}. Working on ${result.tasks.length > 1 ? 'them' : 'it'} now.`);
    }
    if (result.memories.length > 0) {
      parts.push(`Noted ${result.memories.length} thing${result.memories.length > 1 ? 's' : ''} to remember.`);
    }
    return parts.join(' ');
  }
}
