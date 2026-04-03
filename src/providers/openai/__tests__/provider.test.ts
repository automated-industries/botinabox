import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider, MODELS } from '../index.js';

const mockFinalCompletion = {
  choices: [
    {
      message: { content: 'Hello from GPT', tool_calls: null },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
  model: 'gpt-4o',
};

const mockStream = {
  [Symbol.asyncIterator]: async function* () {
    yield { choices: [{ delta: { content: 'Hello' } }] };
    yield { choices: [{ delta: { content: ' world' } }] };
  },
  finalChatCompletion: vi.fn().mockResolvedValue(mockFinalCompletion),
};

vi.mock('openai', () => {
  const mockCreate = vi.fn().mockResolvedValue({
    choices: [
      {
        message: { content: 'Hello from GPT', tool_calls: null },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
    model: 'gpt-4o',
  });

  const inlineMockStream = {
    [Symbol.asyncIterator]: async function* () {
      yield { choices: [{ delta: { content: 'Hello' } }] };
      yield { choices: [{ delta: { content: ' world' } }] };
    },
    finalChatCompletion: vi.fn().mockResolvedValue({
      choices: [
        {
          message: { content: 'Hello from GPT', tool_calls: null },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      model: 'gpt-4o',
    }),
  };

  const mockStreamFn = vi.fn().mockReturnValue(inlineMockStream);

  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
        stream: mockStreamFn,
      },
    },
  }));

  return { default: MockOpenAI };
});

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider({ apiKey: 'test-key' });
  });

  it('has correct id and displayName', () => {
    expect(provider.id).toBe('openai');
    expect(provider.displayName).toBe('OpenAI');
  });

  it('chat returns structured ChatResult', async () => {
    const result = await provider.chat({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(result.content).toBe('Hello from GPT');
    expect(result.stopReason).toBe('end_turn');
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);
    expect(result.model).toBe('gpt-4o');
    expect(result.toolUses).toBeUndefined();
  });

  it('extracts tool calls correctly', async () => {
    const { default: OpenAI } = await import('openai');
    const mockInstance = (OpenAI as ReturnType<typeof vi.fn>).mock.results[0]?.value as {
      chat: { completions: { create: ReturnType<typeof vi.fn> } };
    };

    mockInstance.chat.completions.create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call-1',
                function: {
                  name: 'get_weather',
                  arguments: JSON.stringify({ city: 'NYC' }),
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 15 },
      model: 'gpt-4o',
    });

    const result = await provider.chat({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'What is the weather?' }],
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object', properties: { city: { type: 'string' } } },
        },
      ],
    });

    expect(result.stopReason).toBe('tool_use');
    expect(result.toolUses).toHaveLength(1);
    expect(result.toolUses?.[0]?.id).toBe('call-1');
    expect(result.toolUses?.[0]?.name).toBe('get_weather');
    expect(result.toolUses?.[0]?.input).toEqual({ city: 'NYC' });
  });

  it('chatStream yields text chunks and returns ChatResult', async () => {
    const chunks: string[] = [];

    const gen = provider.chatStream({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
    });

    let next = await gen.next();
    while (!next.done) {
      chunks.push(next.value);
      next = await gen.next();
    }
    const finalResult = next.value;

    expect(chunks).toEqual(['Hello', ' world']);
    expect(finalResult?.model).toBe('gpt-4o');
  });

  it('model catalog has all 3 models with required fields', () => {
    expect(MODELS).toHaveLength(3);
    for (const model of MODELS) {
      expect(model.id).toBeTruthy();
      expect(model.displayName).toBeTruthy();
      expect(model.contextWindow).toBeGreaterThan(0);
      expect(model.maxOutputTokens).toBeGreaterThan(0);
      expect(model.capabilities).toContain('chat');
    }
    expect(MODELS.map((m) => m.id)).toEqual(['gpt-4o', 'gpt-4o-mini', 'o3-mini']);
  });
});
