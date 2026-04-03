import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaProvider } from '../provider.js';

function makeJsonResponse(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: vi.fn().mockResolvedValue(data),
    body: null,
  };
}

function makeStreamResponse(lines: string[]) {
  const encoder = new TextEncoder();
  const chunks = lines.map((l) => encoder.encode(l + '\n'));
  let index = 0;

  const reader = {
    read: vi.fn().mockImplementation(async () => {
      if (index < chunks.length) {
        return { done: false, value: chunks[index++] };
      }
      return { done: true, value: undefined };
    }),
    releaseLock: vi.fn(),
  };

  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: vi.fn(),
    body: { getReader: vi.fn().mockReturnValue(reader) },
  };
}

describe('OllamaProvider', () => {
  let provider: OllamaProvider;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new OllamaProvider({ baseUrl: 'http://localhost:11434' });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has correct id and displayName', () => {
    expect(provider.id).toBe('ollama');
    expect(provider.displayName).toBe('Ollama');
  });

  it('defaults to localhost:11434', () => {
    const defaultProvider = new OllamaProvider();
    expect(defaultProvider.id).toBe('ollama');
  });

  describe('getModels', () => {
    it('parses /api/tags response', async () => {
      fetchMock.mockResolvedValueOnce(
        makeJsonResponse({
          models: [
            { name: 'llama3.2', modified_at: '2024-01-01', size: 1000 },
            { name: 'mistral', modified_at: '2024-01-01', size: 2000 },
          ],
        }),
      );

      const models = await provider.getModels();

      expect(models).toHaveLength(2);
      expect(models[0]?.id).toBe('llama3.2');
      expect(models[0]?.displayName).toBe('llama3.2');
      expect(models[1]?.id).toBe('mistral');
    });

    it('returns [] when Ollama is offline (fetch throws)', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Connection refused'));

      const models = await provider.getModels();
      expect(models).toEqual([]);
    });

    it('returns [] when API returns non-ok', async () => {
      fetchMock.mockResolvedValueOnce(makeJsonResponse({}, false, 500));

      const models = await provider.getModels();
      expect(models).toEqual([]);
    });

    it('uses cached models within TTL', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({
          models: [{ name: 'llama3.2', modified_at: '2024-01-01', size: 1000 }],
        }),
      );

      await provider.getModels();
      await provider.getModels();

      // Should only call fetch once due to cache
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('chat', () => {
    it('returns ChatResult from non-streaming response', async () => {
      fetchMock.mockResolvedValueOnce(
        makeJsonResponse({
          model: 'llama3.2',
          message: { role: 'assistant', content: 'Hello from Ollama' },
          done: true,
          prompt_eval_count: 15,
          eval_count: 8,
        }),
      );

      const result = await provider.chat({
        model: 'llama3.2',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.content).toBe('Hello from Ollama');
      expect(result.model).toBe('llama3.2');
      expect(result.stopReason).toBe('end_turn');
      expect(result.usage.inputTokens).toBe(15);
      expect(result.usage.outputTokens).toBe(8);
      expect(result.toolUses).toBeUndefined();
    });

    it('sends system message when provided', async () => {
      fetchMock.mockResolvedValueOnce(
        makeJsonResponse({
          model: 'llama3.2',
          message: { role: 'assistant', content: 'OK' },
          done: true,
        }),
      );

      await provider.chat({
        model: 'llama3.2',
        messages: [{ role: 'user', content: 'Hello' }],
        system: 'You are a helpful assistant',
      });

      const callBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
        messages: Array<{ role: string; content: string }>;
      };
      expect(callBody.messages[0]).toEqual({
        role: 'system',
        content: 'You are a helpful assistant',
      });
    });

    it('throws on API error', async () => {
      fetchMock.mockResolvedValueOnce(makeJsonResponse({}, false, 500));

      await expect(
        provider.chat({
          model: 'llama3.2',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow('Ollama API error');
    });
  });

  describe('chatStream', () => {
    it('yields chunks from NDJSON body', async () => {
      const lines = [
        JSON.stringify({ model: 'llama3.2', message: { role: 'assistant', content: 'Hello' }, done: false }),
        JSON.stringify({ model: 'llama3.2', message: { role: 'assistant', content: ' world' }, done: false }),
        JSON.stringify({ model: 'llama3.2', message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: 5, eval_count: 3 }),
      ];

      fetchMock.mockResolvedValueOnce(makeStreamResponse(lines));

      const chunks: string[] = [];
      const gen = provider.chatStream({
        model: 'llama3.2',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      let next = await gen.next();
      while (!next.done) {
        chunks.push(next.value);
        next = await gen.next();
      }
      const finalResult = next.value;

      expect(chunks).toEqual(['Hello', ' world']);
      expect(finalResult?.content).toBe('Hello world');
      expect(finalResult?.model).toBe('llama3.2');
      expect(finalResult?.usage.inputTokens).toBe(5);
      expect(finalResult?.usage.outputTokens).toBe(3);
    });
  });

  describe('models getter', () => {
    it('returns empty array before getModels is called', () => {
      expect(provider.models).toEqual([]);
    });

    it('returns cached models after getModels is called', async () => {
      fetchMock.mockResolvedValueOnce(
        makeJsonResponse({
          models: [{ name: 'llama3.2', modified_at: '2024-01-01', size: 1000 }],
        }),
      );

      await provider.getModels();
      expect(provider.models).toHaveLength(1);
      expect(provider.models[0]?.id).toBe('llama3.2');
    });
  });
});
