import OpenAI from 'openai';
import type {
  LLMProvider,
  ChatParams,
  ChatResult,
  ModelInfo,
  ToolDefinition,
  ToolUse,
} from '@botinabox/shared';
import { MODELS } from './models.js';
import { convertTools } from './tool-converter.js';

export class OpenAIProvider implements LLMProvider {
  readonly id = 'openai';
  readonly displayName = 'OpenAI';
  readonly models: ModelInfo[] = MODELS;

  private client: OpenAI;

  constructor({ apiKey }: { apiKey: string }) {
    this.client = new OpenAI({ apiKey });
  }

  serializeTools(tools: ToolDefinition[]): unknown {
    return convertTools(tools);
  }

  async chat(params: ChatParams): Promise<ChatResult> {
    const { messages, system, tools, maxTokens, temperature, model, abortSignal } = params;

    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (system) {
      openaiMessages.push({ role: 'system', content: system });
    }

    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        openaiMessages.push({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content,
        });
      } else {
        // content blocks — convert text blocks to string
        const textContent = msg.content
          .filter((b) => b.type === 'text')
          .map((b) => (b.type === 'text' ? b.text : ''))
          .join('');
        openaiMessages.push({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: textContent,
        });
      }
    }

    const response = await this.client.chat.completions.create(
      {
        model,
        messages: openaiMessages,
        ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        ...(tools && tools.length > 0 ? { tools: convertTools(tools) } : {}),
      },
      { signal: abortSignal },
    );

    const choice = response.choices[0];
    if (!choice) {
      throw new Error('No choices returned from OpenAI');
    }

    const messageContent = choice.message.content ?? '';
    const toolUses: ToolUse[] = [];

    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        let input: unknown;
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          input = tc.function.arguments;
        }
        toolUses.push({
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }
    }

    const stopReason = mapFinishReason(choice.finish_reason);

    return {
      content: messageContent,
      toolUses: toolUses.length > 0 ? toolUses : undefined,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
      model: response.model,
      stopReason,
    };
  }

  async *chatStream(params: ChatParams): AsyncGenerator<string, ChatResult, unknown> {
    const { messages, system, tools, maxTokens, temperature, model, abortSignal } = params;

    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (system) {
      openaiMessages.push({ role: 'system', content: system });
    }

    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        openaiMessages.push({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content,
        });
      } else {
        const textContent = msg.content
          .filter((b) => b.type === 'text')
          .map((b) => (b.type === 'text' ? b.text : ''))
          .join('');
        openaiMessages.push({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: textContent,
        });
      }
    }

    const stream = this.client.chat.completions.stream(
      {
        model,
        messages: openaiMessages,
        ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        ...(tools && tools.length > 0 ? { tools: convertTools(tools) } : {}),
      },
      { signal: abortSignal },
    );

    let accumulatedContent = '';

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        accumulatedContent += delta;
        yield delta;
      }
    }

    const finalCompletion = await stream.finalChatCompletion();
    const choice = finalCompletion.choices[0];
    if (!choice) {
      throw new Error('No choices in final completion');
    }

    const toolUses: ToolUse[] = [];
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        let input: unknown;
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          input = tc.function.arguments;
        }
        toolUses.push({ id: tc.id, name: tc.function.name, input });
      }
    }

    return {
      content: choice.message.content ?? accumulatedContent,
      toolUses: toolUses.length > 0 ? toolUses : undefined,
      usage: {
        inputTokens: finalCompletion.usage?.prompt_tokens ?? 0,
        outputTokens: finalCompletion.usage?.completion_tokens ?? 0,
      },
      model: finalCompletion.model,
      stopReason: mapFinishReason(choice.finish_reason),
    };
  }
}

function mapFinishReason(
  reason: string | null | undefined,
): ChatResult['stopReason'] {
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'tool_calls':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'stop_sequence';
    default:
      return 'end_turn';
  }
}
