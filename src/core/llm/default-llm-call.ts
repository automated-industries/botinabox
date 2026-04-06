/**
 * Default LLM call function — ready-to-use wrapper around the Anthropic SDK.
 *
 * Handles model routing (fast → Haiku, default → Sonnet), message formatting,
 * and response extraction. Apps can use this directly or provide their own.
 */

import type { ChatResponderConfig } from '../chat/chat-responder.js';

export interface DefaultLLMCallConfig {
  /** Fast model ID (for acks, interpretation). Default: claude-haiku-4-5-20251001 */
  fastModel?: string;
  /** Standard model ID (for execution). Default: claude-sonnet-4-20250514 */
  defaultModel?: string;
}

/**
 * Create a default LLM call function using the Anthropic SDK.
 *
 * @param anthropicClient - An initialized Anthropic client instance
 * @param config - Optional model configuration
 */
export function createDefaultLLMCall(
  anthropicClient: {
    messages: {
      create: (params: Record<string, unknown>) => Promise<{
        content: Array<{ type: string; text?: string }>;
        model: string;
        stop_reason: string;
        usage: { input_tokens: number; output_tokens: number };
      }>;
    };
  },
  config?: DefaultLLMCallConfig,
): ChatResponderConfig['llmCall'] {
  const fastModel = config?.fastModel ?? 'claude-haiku-4-5-20251001';
  const defaultModel = config?.defaultModel ?? 'claude-sonnet-4-20250514';

  return async (params) => {
    const model = params.model === 'fast' ? fastModel : defaultModel;

    const response = await anthropicClient.messages.create({
      model,
      max_tokens: params.maxTokens ?? 500,
      system: params.system ?? undefined,
      messages: params.messages.map((m: { role: string; content: string | unknown[] }) => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
    });

    const textBlock = response.content.find((b: { type: string }) => b.type === 'text');
    return { content: (textBlock as { type: 'text'; text: string } | undefined)?.text ?? '' };
  };
}
