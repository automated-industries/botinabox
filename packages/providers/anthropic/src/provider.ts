import Anthropic from '@anthropic-ai/sdk';
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

export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic';
  readonly displayName = 'Anthropic';
  readonly models: ModelInfo[] = MODELS;

  private client: Anthropic;

  constructor({ apiKey }: { apiKey: string }) {
    this.client = new Anthropic({ apiKey });
  }

  serializeTools(tools: ToolDefinition[]): unknown {
    return convertTools(tools);
  }

  async chat(params: ChatParams): Promise<ChatResult> {
    const { messages, system, tools, maxTokens, temperature, model, abortSignal } = params;

    const anthropicMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : m.content,
      }));

    const response = await this.client.messages.create(
      {
        model,
        max_tokens: maxTokens ?? 4096,
        messages: anthropicMessages,
        ...(system ? { system } : {}),
        ...(tools && tools.length > 0 ? { tools: convertTools(tools) } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
      },
      { signal: abortSignal },
    );

    let content = '';
    const toolUses: ToolUse[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolUses.push({
          id: block.id,
          name: block.name,
          input: block.input,
        });
      }
    }

    const stopReason = mapStopReason(response.stop_reason);

    return {
      content,
      toolUses: toolUses.length > 0 ? toolUses : undefined,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      model: response.model,
      stopReason,
    };
  }

  async *chatStream(params: ChatParams): AsyncGenerator<string, ChatResult, unknown> {
    const { messages, system, tools, maxTokens, temperature, model, abortSignal } = params;

    const anthropicMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : m.content,
      }));

    const stream = this.client.messages.stream(
      {
        model,
        max_tokens: maxTokens ?? 4096,
        messages: anthropicMessages,
        ...(system ? { system } : {}),
        ...(tools && tools.length > 0 ? { tools: convertTools(tools) } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
      },
      { signal: abortSignal },
    );

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield event.delta.text;
      }
    }

    const finalMessage = await stream.finalMessage();
    let content = '';
    const toolUses: ToolUse[] = [];

    for (const block of finalMessage.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolUses.push({
          id: block.id,
          name: block.name,
          input: block.input,
        });
      }
    }

    return {
      content,
      toolUses: toolUses.length > 0 ? toolUses : undefined,
      usage: {
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
      },
      model: finalMessage.model,
      stopReason: mapStopReason(finalMessage.stop_reason),
    };
  }
}

function mapStopReason(
  reason: string | null | undefined,
): ChatResult['stopReason'] {
  switch (reason) {
    case 'end_turn':
      return 'end_turn';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    default:
      return 'end_turn';
  }
}
