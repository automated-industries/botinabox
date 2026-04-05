/**
 * MessageInterpreter — async structured extraction from messages.
 * Story 7.3
 *
 * After every message is stored, the interpreter runs async to extract
 * structured data types: tasks, memories, files, user context, and custom types.
 *
 * Uses a cheap LLM (Haiku) for classification and extraction.
 * Pluggable extractors allow apps to add custom data types.
 */

import type { DataStore } from '../data/data-store.js';
import type { HookBus } from '../hooks/hook-bus.js';
import type { ChatMessage } from '../../shared/index.js';

export interface ExtractedTask {
  title: string;
  description?: string;
  dueDate?: string;
  scheduled?: boolean;
  priority?: number;
}

export interface ExtractedMemory {
  summary: string;
  contents: string;
  tags?: string[];
  category?: string;
}

export interface ExtractedFile {
  filename: string;
  fileType: string;
  contents: string;
  summary: string;
}

export interface ExtractedUserContext {
  trait: string;
  value: string;
}

export interface InterpretationResult {
  messageId: string;
  tasks: ExtractedTask[];
  memories: ExtractedMemory[];
  files: ExtractedFile[];
  userContext: ExtractedUserContext[];
  custom: Record<string, unknown[]>;
  isTaskRequest: boolean;
}

export type LLMCallFn = (params: {
  model: string;
  messages: ChatMessage[];
  system?: string;
  maxTokens?: number;
}) => Promise<{ content: string }>;

/**
 * Pluggable extractor interface for custom data types.
 */
export interface Extractor {
  readonly type: string;
  extract(
    message: { body: string; attachments?: Array<Record<string, unknown>> },
    llmCall: LLMCallFn,
  ): Promise<unknown[]>;
}

export interface MessageInterpreterConfig {
  /** Additional custom extractors beyond built-in ones */
  extractors?: Extractor[];
  /** Model for interpretation LLM calls. Default: 'fast' */
  model?: string;
  /** LLM call function */
  llmCall: LLMCallFn;
  /** Auto-create tasks from extracted tasks. Default: false */
  autoCreateTasks?: boolean;
}

const INTERPRET_SYSTEM = `You are a message parser. Extract structured data from the user's message.

Return a JSON object with these fields:
{
  "tasks": [{ "title": "...", "description": "...", "priority": 1-10 }],
  "memories": [{ "summary": "one-line", "contents": "full text", "tags": ["tag1"], "category": "..." }],
  "user_context": [{ "trait": "...", "value": "..." }],
  "is_task_request": true/false
}

Rules:
- "tasks": actionable requests the user wants done. NOT conversational messages.
- "memories": information, notes, random thoughts to remember. Parse thematically — one message can have multiple memories.
- "user_context": personality traits, preferences, or learnings about the user.
- "is_task_request": true if the message contains at least one actionable task.
- If the message is just a greeting or conversation, return empty arrays and is_task_request: false.
- Return ONLY valid JSON, no markdown or explanation.`;

export class MessageInterpreter {
  private readonly extractors: Extractor[];
  private readonly model: string;
  private readonly llmCall: LLMCallFn;
  private readonly autoCreateTasks: boolean;

  constructor(
    private db: DataStore,
    private hooks: HookBus,
    config: MessageInterpreterConfig,
  ) {
    this.extractors = config.extractors ?? [];
    this.model = config.model ?? 'fast';
    this.llmCall = config.llmCall;
    this.autoCreateTasks = config.autoCreateTasks ?? false;
  }

  /**
   * Interpret a stored message asynchronously.
   * Extracts tasks, memories, files, user context, and custom types.
   */
  async interpret(messageId: string): Promise<InterpretationResult> {
    const message = await this.db.get('messages', { id: messageId });
    if (!message) throw new Error(`Message not found: ${messageId}`);

    const body = message['body'] as string;
    const userId = message['user_id'] as string | undefined;

    // Get attachments
    const attachments = await this.db.query('message_attachments', {
      where: { message_id: messageId },
    });

    // Run built-in LLM extraction
    const parsed = await this.extractWithLLM(body);

    // Store extracted memories
    for (const memory of parsed.memories) {
      await this.db.insert('memories', {
        message_id: messageId,
        user_id: userId,
        summary: memory.summary,
        contents: memory.contents,
        tags: JSON.stringify(memory.tags ?? []),
        category: memory.category,
      });
    }

    // Store user context as memories with 'user_context' category
    for (const ctx of parsed.userContext) {
      await this.db.insert('memories', {
        message_id: messageId,
        user_id: userId,
        summary: ctx.trait,
        contents: ctx.value,
        tags: JSON.stringify(['user_context']),
        category: 'user_context',
      });
    }

    // Extract from attachments (file contents/summaries)
    const files: ExtractedFile[] = [];
    for (const att of attachments) {
      if (att['contents']) {
        files.push({
          filename: (att['filename'] as string) ?? 'unknown',
          fileType: (att['file_type'] as string) ?? 'file',
          contents: att['contents'] as string,
          summary: (att['summary'] as string) ?? '',
        });
      }
    }

    // Run custom extractors
    const custom: Record<string, unknown[]> = {};
    for (const extractor of this.extractors) {
      try {
        const results = await extractor.extract(
          { body, attachments },
          this.llmCall,
        );
        if (results.length > 0) {
          custom[extractor.type] = results;
        }
      } catch {
        // Custom extractor failed — continue with others
      }
    }

    const result: InterpretationResult = {
      messageId,
      tasks: parsed.tasks,
      memories: parsed.memories,
      files,
      userContext: parsed.userContext,
      custom,
      isTaskRequest: parsed.isTaskRequest,
    };

    await this.hooks.emit('interpretation.completed', {
      messageId,
      taskCount: result.tasks.length,
      memoryCount: result.memories.length,
      fileCount: result.files.length,
      isTaskRequest: result.isTaskRequest,
    });

    return result;
  }

  /**
   * Extract structured data from message text using LLM.
   */
  private async extractWithLLM(body: string): Promise<{
    tasks: ExtractedTask[];
    memories: ExtractedMemory[];
    userContext: ExtractedUserContext[];
    isTaskRequest: boolean;
  }> {
    try {
      const result = await this.llmCall({
        model: this.model,
        messages: [{ role: 'user', content: body }],
        system: INTERPRET_SYSTEM,
        maxTokens: 1000,
      });

      const parsed = JSON.parse(result.content) as {
        tasks?: Array<{ title: string; description?: string; priority?: number }>;
        memories?: Array<{ summary: string; contents: string; tags?: string[]; category?: string }>;
        user_context?: Array<{ trait: string; value: string }>;
        is_task_request?: boolean;
      };

      return {
        tasks: (parsed.tasks ?? []).map(t => ({
          title: t.title,
          description: t.description,
          priority: t.priority,
        })),
        memories: (parsed.memories ?? []).map(m => ({
          summary: m.summary,
          contents: m.contents,
          tags: m.tags,
          category: m.category,
        })),
        userContext: (parsed.user_context ?? []).map(u => ({
          trait: u.trait,
          value: u.value,
        })),
        isTaskRequest: parsed.is_task_request ?? false,
      };
    } catch {
      // LLM parse failed — return empty
      return {
        tasks: [],
        memories: [],
        userContext: [],
        isTaskRequest: false,
      };
    }
  }
}
