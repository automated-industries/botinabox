import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicProvider, MODELS } from '../index.js';

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  const mockFinalMessage = {
    content: [{ type: 'text', text: 'Hello from Claude' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
    model: 'claude-sonnet-4-6',
  };

  const mockStream = {
    [Symbol.asyncIterator]: async function* () {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } };
    },
    finalMessage: vi.fn().mockResolvedValue(mockFinalMessage),
  };

  const mockCreate = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'Hello from Claude' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
    model: 'claude-sonnet-4-6',
  });

  const mockStream2 = vi.fn().mockReturnValue(mockStream);

  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: {
      create: mockCreate,
      stream: mockStream2,
    },
  }));

  return { default: MockAnthropic };
});

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    provider = new AnthropicProvider({ apiKey: 'test-key' });
  });

  it('has correct id and displayName', () => {
    expect(provider.id).toBe('anthropic');
    expect(provider.displayName).toBe('Anthropic');
  });

  it('chat returns structured ChatResult', async () => {
    const result = await provider.chat({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(result.content).toBe('Hello from Claude');
    expect(result.stopReason).toBe('end_turn');
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);
    expect(result.model).toBe('claude-sonnet-4-6');
    expect(result.toolUses).toBeUndefined();
  });

  it('extracts tool calls correctly', async () => {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const mockInstance = (Anthropic as ReturnType<typeof vi.fn>).mock.results[0]?.value as { messages: { create: ReturnType<typeof vi.fn> } };

    mockInstance.messages.create.mockResolvedValueOnce({
      content: [
        { type: 'text', text: 'I will call a tool' },
        { type: 'tool_use', id: 'tool-1', name: 'get_weather', input: { city: 'NYC' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 20, output_tokens: 15 },
      model: 'claude-sonnet-4-6',
    });

    const result = await provider.chat({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'What is the weather?' }],
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather for a city',
          parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
        },
      ],
    });

    expect(result.stopReason).toBe('tool_use');
    expect(result.toolUses).toHaveLength(1);
    expect(result.toolUses?.[0]?.id).toBe('tool-1');
    expect(result.toolUses?.[0]?.name).toBe('get_weather');
    expect(result.toolUses?.[0]?.input).toEqual({ city: 'NYC' });
  });

  it('chatStream yields text chunks and returns ChatResult', async () => {
    const chunks: string[] = [];
    let finalResult: Awaited<ReturnType<typeof provider.chat>> | undefined;

    const gen = provider.chatStream({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'Hello' }],
    });

    let next = await gen.next();
    while (!next.done) {
      chunks.push(next.value);
      next = await gen.next();
    }
    finalResult = next.value;

    expect(chunks).toEqual(['Hello', ' world']);
    expect(finalResult?.content).toBe('Hello from Claude');
    expect(finalResult?.model).toBe('claude-sonnet-4-6');
  });

  it('model catalog has all 3 models with required fields', () => {
    expect(MODELS).toHaveLength(3);
    for (const model of MODELS) {
      expect(model.id).toBeTruthy();
      expect(model.displayName).toBeTruthy();
      expect(model.contextWindow).toBeGreaterThan(0);
      expect(model.maxOutputTokens).toBeGreaterThan(0);
      expect(model.capabilities).toContain('chat');
      expect(model.capabilities).toContain('streaming');
    }
    expect(MODELS.map((m) => m.id)).toEqual([
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
    ]);
  });
});
