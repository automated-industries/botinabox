/**
 * ChatResponder — fast conversational layer with LLM-filtered responses.
 * Story 7.2
 *
 * Provides rapid (<2s) conversational responses using a cheap LLM (Haiku).
 * The responder has awareness of tools and capabilities but does NOT execute
 * anything — it keeps the conversation going while work happens async.
 *
 * All outbound messages (direct, post-interpretation, task execution) are
 * filtered through this layer for human readability and redundancy checking.
 */

import type { DataStore } from '../data/data-store.js';
import type { HookBus } from '../hooks/hook-bus.js';
import type { ChatMessage } from '../../shared/index.js';
import type { MessageStore } from './message-store.js';

export interface ChatResponderConfig {
  /** System prompt for the conversational responder */
  systemPrompt?: string;
  /** Max tokens for context window. Default: 4000 */
  contextWindowTokens?: number;
  /** Max recent outbound messages to check for redundancy. Default: 10 */
  redundancyWindow?: number;
  /** Model to use for responses. Default: 'fast' (resolved via ModelRouter) */
  model?: string;
  /** Caller-provided LLM call function */
  llmCall: (params: {
    model: string;
    messages: ChatMessage[];
    system?: string;
    maxTokens?: number;
  }) => Promise<{ content: string }>;
}

const DEFAULT_SYSTEM_PROMPT = `You are a helpful, enthusiastic AI digital assistant. Your job is to:
- Acknowledge the user's message and relay what you understand
- Let them know what will happen next (if a task is being worked on)
- Answer conversational questions directly
- Be honest when you need to look something up — say "let me find out"
- Keep responses concise and friendly

You are aware of tools and capabilities in the system but you do NOT execute anything.
You cannot run code, search databases, or take actions. You are purely conversational.
If the user asks you to DO something, acknowledge it and say it will be handled.`;

const DEFAULT_CONTEXT_TOKENS = 4000;
const DEFAULT_REDUNDANCY_WINDOW = 10;
const APPROX_CHARS_PER_TOKEN = 4;

export class ChatResponder {
  private readonly systemPrompt: string;
  private readonly contextWindowTokens: number;
  private readonly redundancyWindow: number;
  private readonly model: string;
  private readonly llmCall: ChatResponderConfig['llmCall'];

  constructor(
    private db: DataStore,
    private hooks: HookBus,
    private messageStore: MessageStore,
    config: ChatResponderConfig,
  ) {
    this.systemPrompt = config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.contextWindowTokens = config.contextWindowTokens ?? DEFAULT_CONTEXT_TOKENS;
    this.redundancyWindow = config.redundancyWindow ?? DEFAULT_REDUNDANCY_WINDOW;
    this.model = config.model ?? 'fast';
    this.llmCall = config.llmCall;
  }

  /**
   * Generate a fast conversational response to an inbound message.
   * Uses rolling context window from thread history.
   */
  async respond(opts: {
    messageBody: string;
    threadId: string;
    channel: string;
    userName?: string;
    capabilities?: string;
    additionalContext?: string;
  }): Promise<string> {
    // Build context window from channel history (not thread — DM thread_ids are unreliable)
    const history = await this.messageStore.getChannelHistory(
      opts.channel,
      50,
    );

    const messages = this.buildContextWindow(history, opts.messageBody);

    // Build system prompt with optional capabilities awareness
    let system = this.systemPrompt;
    if (opts.capabilities) {
      system += `\n\nSystem capabilities you are aware of:\n${opts.capabilities}`;
    }
    if (opts.userName) {
      system += `\n\nYou are talking to: ${opts.userName}`;
    }
    if (opts.additionalContext) {
      system += opts.additionalContext;
    }

    const result = await this.llmCall({
      model: this.model,
      messages,
      system,
      maxTokens: 500,
    });

    return result.content;
  }

  /**
   * Filter any outbound message through the LLM for human readability.
   * This is the single funnel ALL responses pass through.
   */
  async filterResponse(text: string, context?: {
    channel?: string;
    threadId?: string;
    source?: string; // 'agent' | 'interpretation' | 'system'
  }): Promise<string> {
    // Short messages don't need filtering
    if (text.length < 100) return text;

    const result = await this.llmCall({
      model: this.model,
      messages: [
        {
          role: 'user',
          content: `Rewrite this agent/system message to be human-friendly and conversational. Keep the substance, remove jargon, make it feel like a helpful assistant talking to a person. If it's already readable, return it as-is. Do not add preamble like "Here's the rewritten version". Just output the rewritten text.\n\n---\n${text}`,
        },
      ],
      maxTokens: 1000,
    });

    return result.content;
  }

  /**
   * Check if a candidate outbound message is redundant with recent messages.
   * Returns true if the message should be suppressed.
   */
  async isRedundant(text: string, threadId: string): Promise<boolean> {
    const recent = await this.messageStore.getRecentOutbound(threadId, this.redundancyWindow);
    if (recent.length === 0) return false;

    const recentTexts = recent
      .map(m => (m['body'] as string) ?? '')
      .filter(t => t.length > 0)
      .slice(-5) // last 5 outbound messages
      .join('\n---\n');

    const result = await this.llmCall({
      model: this.model,
      messages: [
        {
          role: 'user',
          content: `Does this NEW message duplicate or substantially overlap the RECENT messages already sent? Answer with just "redundant" or "not redundant". If the new message has meaningful new information or updates, it is NOT redundant.\n\nRECENT MESSAGES:\n${recentTexts}\n\nNEW MESSAGE:\n${text}`,
        },
      ],
      maxTokens: 10,
    });

    return result.content.toLowerCase().includes('redundant') &&
           !result.content.toLowerCase().includes('not redundant');
  }

  /**
   * Full send pipeline: check redundancy → filter → store → deliver.
   * Returns the message ID, or undefined if suppressed as redundant.
   */
  async sendResponse(opts: {
    text: string;
    channel: string;
    threadId: string;
    agentId?: string;
    agentSlug?: string;
    taskId?: string;
    source?: string;
    skipRedundancyCheck?: boolean;
    skipFilter?: boolean;
  }): Promise<string | undefined> {
    // 1. Redundancy check
    if (!opts.skipRedundancyCheck) {
      const redundant = await this.isRedundant(opts.text, opts.threadId);
      if (redundant) {
        await this.hooks.emit('response.suppressed', {
          channel: opts.channel,
          threadId: opts.threadId,
          reason: 'redundant',
        });
        return undefined;
      }
    }

    // 2. Filter for readability
    const filtered = opts.skipFilter
      ? opts.text
      : await this.filterResponse(opts.text, {
          channel: opts.channel,
          threadId: opts.threadId,
          source: opts.source,
        });

    // 3. Store outbound message
    const messageId = await this.messageStore.storeOutbound({
      channel: opts.channel,
      text: filtered,
      threadId: opts.threadId,
      agentId: opts.agentId,
      agentSlug: opts.agentSlug,
      taskId: opts.taskId,
    });

    // 4. Emit for delivery (NotificationQueue listens)
    await this.hooks.emit('response.ready', {
      messageId,
      channel: opts.channel,
      threadId: opts.threadId,
      text: filtered,
      taskId: opts.taskId,
    });

    return messageId;
  }

  /**
   * Build a context window from thread history, trimmed to token limit.
   */
  private buildContextWindow(
    history: Array<Record<string, unknown>>,
    currentMessage: string,
  ): ChatMessage[] {
    const maxChars = this.contextWindowTokens * APPROX_CHARS_PER_TOKEN;
    let charCount = currentMessage.length;

    const messages: ChatMessage[] = [];

    // Walk backwards through history, adding messages until we hit the limit
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i]!;
      const body = (msg['body'] as string) ?? '';
      const direction = msg['direction'] as string;

      if (charCount + body.length > maxChars) break;

      messages.unshift({
        role: direction === 'inbound' ? 'user' : 'assistant',
        content: body,
      });
      charCount += body.length;
    }

    // Add current message
    messages.push({ role: 'user', content: currentMessage });

    return messages;
  }
}
