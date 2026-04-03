import type {
  LLMProvider,
  ChatParams,
  ChatResult,
  ModelInfo,
  ToolDefinition,
} from '@botinabox/shared';

interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
}

interface OllamaTagsResponse {
  models: OllamaModel[];
}

interface OllamaMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface OllamaChatResponse {
  model: string;
  message: OllamaMessage;
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaChatChunk {
  model: string;
  message: OllamaMessage;
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider implements LLMProvider {
  readonly id = 'ollama';
  readonly displayName = 'Ollama';

  private baseUrl: string;
  private cachedModels: ModelInfo[] = [];
  private cacheTimestamp = 0;
  private readonly cacheTtlMs = 5 * 60 * 1000; // 5 minutes

  constructor({ baseUrl = 'http://localhost:11434' }: { baseUrl?: string } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  get models(): ModelInfo[] {
    return this.cachedModels;
  }

  serializeTools(_tools: ToolDefinition[]): unknown {
    // Ollama uses a similar format to OpenAI for tools
    return _tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  async getModels(): Promise<ModelInfo[]> {
    const now = Date.now();
    if (this.cachedModels.length > 0 && now - this.cacheTimestamp < this.cacheTtlMs) {
      return this.cachedModels;
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        return [];
      }
      const data = (await response.json()) as OllamaTagsResponse;

      this.cachedModels = data.models.map((m) => ({
        id: m.name,
        displayName: m.name,
        contextWindow: 128000,
        maxOutputTokens: 4096,
        capabilities: ['chat', 'streaming'] as Array<'chat' | 'tools' | 'vision' | 'streaming'>,
      }));
      this.cacheTimestamp = now;
      return this.cachedModels;
    } catch {
      return [];
    }
  }

  async chat(params: ChatParams): Promise<ChatResult> {
    const { messages, system, model, maxTokens, temperature } = params;

    const ollamaMessages: OllamaMessage[] = [];

    if (system) {
      ollamaMessages.push({ role: 'system', content: system });
    }

    for (const msg of messages) {
      const content =
        typeof msg.content === 'string'
          ? msg.content
          : msg.content
              .filter((b) => b.type === 'text')
              .map((b) => (b.type === 'text' ? b.text : ''))
              .join('');
      ollamaMessages.push({
        role: msg.role as 'user' | 'assistant' | 'system',
        content,
      });
    }

    const body: Record<string, unknown> = {
      model,
      messages: ollamaMessages,
      stream: false,
    };

    if (maxTokens !== undefined) {
      body['options'] = { ...((body['options'] as object | undefined) ?? {}), num_predict: maxTokens };
    }
    if (temperature !== undefined) {
      body['options'] = { ...((body['options'] as object | undefined) ?? {}), temperature };
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: params.abortSignal,
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as OllamaChatResponse;

    return {
      content: data.message.content,
      usage: {
        inputTokens: data.prompt_eval_count ?? 0,
        outputTokens: data.eval_count ?? 0,
      },
      model: data.model,
      stopReason: 'end_turn',
    };
  }

  async *chatStream(params: ChatParams): AsyncGenerator<string, ChatResult, unknown> {
    const { messages, system, model, maxTokens, temperature } = params;

    const ollamaMessages: OllamaMessage[] = [];

    if (system) {
      ollamaMessages.push({ role: 'system', content: system });
    }

    for (const msg of messages) {
      const content =
        typeof msg.content === 'string'
          ? msg.content
          : msg.content
              .filter((b) => b.type === 'text')
              .map((b) => (b.type === 'text' ? b.text : ''))
              .join('');
      ollamaMessages.push({
        role: msg.role as 'user' | 'assistant' | 'system',
        content,
      });
    }

    const body: Record<string, unknown> = {
      model,
      messages: ollamaMessages,
      stream: true,
    };

    if (maxTokens !== undefined) {
      body['options'] = { ...((body['options'] as object | undefined) ?? {}), num_predict: maxTokens };
    }
    if (temperature !== undefined) {
      body['options'] = { ...((body['options'] as object | undefined) ?? {}), temperature };
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: params.abortSignal,
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('No response body for streaming');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let lastChunk: OllamaChatChunk | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line) as OllamaChatChunk;
            if (chunk.message?.content) {
              fullContent += chunk.message.content;
              yield chunk.message.content;
            }
            if (chunk.done) {
              lastChunk = chunk;
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      content: fullContent,
      usage: {
        inputTokens: lastChunk?.prompt_eval_count ?? 0,
        outputTokens: lastChunk?.eval_count ?? 0,
      },
      model,
      stopReason: 'end_turn',
    };
  }
}
