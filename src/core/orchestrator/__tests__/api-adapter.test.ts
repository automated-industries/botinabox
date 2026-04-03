import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { LLMProvider, ModelInfo, ChatResult } from "../../../shared/index.js";
import { ProviderRegistry } from '../../llm/provider-registry.js';
import { ModelRouter } from '../../llm/model-router.js';
import { ApiExecutionAdapter } from '../adapters/api-adapter.js';

function makeProvider(id: string, chatImpl: () => Promise<ChatResult>): LLMProvider {
  return {
    id,
    displayName: `Provider ${id}`,
    models: [
      {
        id: 'test-model',
        displayName: 'Test Model',
        contextWindow: 200_000,
        maxOutputTokens: 8192,
        capabilities: ['chat'],
      } satisfies ModelInfo,
    ],
    chat: chatImpl,
    async *chatStream() { throw new Error('not implemented'); },
    serializeTools: () => [],
  };
}

function makeRouter(chatImpl: () => Promise<ChatResult>): ModelRouter {
  const registry = new ProviderRegistry();
  registry.register(makeProvider('test-provider', chatImpl));
  return new ModelRouter(registry, {
    aliases: {},
    default: 'test-model',
    routing: {},
    fallbackChain: [],
  });
}

describe('ApiExecutionAdapter — Story 3.4', () => {
  it('execute returns output from LLM', async () => {
    const router = makeRouter(async () => ({
      content: 'Hello, world!',
      usage: { inputTokens: 10, outputTokens: 5 },
      model: 'test-model',
      stopReason: 'end_turn' as const,
    }));

    const adapter = new ApiExecutionAdapter(router);
    const result = await adapter.execute({
      agent: { id: 'agent-1', model: 'test-model' },
      task: { description: 'Say hello' },
    });

    expect(result.output).toBe('Hello, world!');
    expect(result.exitCode).toBe(0);
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);
  });

  it('execute calls onLog with output', async () => {
    const router = makeRouter(async () => ({
      content: 'Log me',
      usage: { inputTokens: 5, outputTokens: 3 },
      model: 'test-model',
      stopReason: 'end_turn' as const,
    }));

    const adapter = new ApiExecutionAdapter(router);
    const logs: Array<[string, string]> = [];

    await adapter.execute({
      agent: { id: 'agent-1' },
      task: { description: 'Test' },
      onLog: (stream, chunk) => { logs.push([stream, chunk]); },
    });

    expect(logs.some(([, chunk]) => chunk.includes('Log me'))).toBe(true);
  });

  it('execute reads context files into system prompt', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'api-adapter-test-'));
    const filePath = join(tmpDir, 'context.txt');
    writeFileSync(filePath, 'Context content here');

    let capturedSystem: string | undefined;
    const router = makeRouter(async (params: unknown) => {
      capturedSystem = (params as { system?: string }).system;
      return {
        content: 'done',
        usage: { inputTokens: 1, outputTokens: 1 },
        model: 'test-model',
        stopReason: 'end_turn' as const,
      };
    });

    const adapter = new ApiExecutionAdapter(router);
    await adapter.execute({
      agent: { id: 'agent-1' },
      task: { description: 'Test' },
      contextFiles: [filePath],
    });

    rmSync(tmpDir, { recursive: true });
    expect(capturedSystem).toContain('Context content here');
  });

  it('execute returns exitCode=1 on LLM error', async () => {
    const router = makeRouter(async () => {
      throw new Error('LLM failure');
    });

    const adapter = new ApiExecutionAdapter(router);
    const result = await adapter.execute({
      agent: { id: 'agent-1' },
      task: { description: 'Should fail' },
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('LLM failure');
  });

  it('execute respects abort signal', async () => {
    const controller = new AbortController();
    controller.abort(); // Already aborted

    const chatSpy = vi.fn(async () => ({
      content: 'should not reach',
      usage: { inputTokens: 0, outputTokens: 0 },
      model: 'test-model',
      stopReason: 'end_turn' as const,
    }));

    const router = makeRouter(chatSpy);
    const adapter = new ApiExecutionAdapter(router);

    const result = await adapter.execute({
      agent: { id: 'agent-1' },
      task: { description: 'Test abort' },
      abortSignal: controller.signal,
    });

    // Aborted — LLM should not have been called
    expect(chatSpy).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(0); // Aborted early, empty output
  });
});
