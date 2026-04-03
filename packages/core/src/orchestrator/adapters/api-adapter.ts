import { readFileSync, existsSync } from 'node:fs';
import type { ModelRouter } from '../../llm/model-router.js';
import type {
  ChatMessage,
  TokenUsage,
} from '@botinabox/shared';
import { toolLoop } from './tool-loop.js';

export class ApiExecutionAdapter {
  readonly type = 'api';

  constructor(private modelRouter: ModelRouter) {}

  async execute(ctx: {
    agent: { id: string; model?: string; adapter_config?: string };
    task: { description?: string; context?: string };
    sessionParams?: { history?: ChatMessage[] };
    contextFiles?: string[];
    abortSignal?: AbortSignal;
    onLog?: (stream: 'stdout' | 'stderr', chunk: string) => void;
  }): Promise<{
    output: string;
    exitCode: number;
    usage: TokenUsage & { provider: string; model: string };
    sessionParams: { history: ChatMessage[] };
  }> {
    const modelId = ctx.agent.model ?? 'default';
    const resolved = this.modelRouter.resolve(modelId) ?? this.modelRouter.resolveForPurpose('default');
    const { provider, model } = resolved;

    // Get the LLM provider
    const registry = (this.modelRouter as unknown as { registry: { list: () => Array<{ id: string; chat: (p: unknown) => Promise<unknown> }> } }).registry;
    const providerImpl = registry.list().find((p) => p.id === provider);
    if (!providerImpl) {
      throw new Error(`Provider not found: ${provider}`);
    }

    // Build system prompt
    let systemPrompt = '';

    // Load context files
    if (ctx.contextFiles && ctx.contextFiles.length > 0) {
      const fileContents: string[] = [];
      for (const filePath of ctx.contextFiles) {
        if (existsSync(filePath)) {
          const content = readFileSync(filePath, 'utf8');
          fileContents.push(`<file path="${filePath}">\n${content}\n</file>`);
        }
      }
      if (fileContents.length > 0) {
        systemPrompt = fileContents.join('\n\n');
      }
    }

    // Build messages from history + task
    const messages: ChatMessage[] = [
      ...(ctx.sessionParams?.history ?? []),
    ];

    const taskContent = [
      ctx.task.description,
      ctx.task.context,
    ].filter(Boolean).join('\n\n');

    if (taskContent) {
      messages.push({ role: 'user', content: taskContent });
    }

    let outputText = '';
    let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    const history: ChatMessage[] = [...messages];

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const callLLM = (params: any) => providerImpl.chat(params) as Promise<any>;

      for await (const event of toolLoop(
        {
          model,
          messages,
          systemPrompt: systemPrompt || undefined,
          maxIterations: 20,
          signal: ctx.abortSignal,
        },
        callLLM,
      )) {
        if (event.type === 'text') {
          outputText += event.content;
          ctx.onLog?.('stdout', event.content);
        } else if (event.type === 'done') {
          totalUsage = {
            inputTokens: (totalUsage.inputTokens ?? 0) + (event.result.usage.inputTokens ?? 0),
            outputTokens: (totalUsage.outputTokens ?? 0) + (event.result.usage.outputTokens ?? 0),
          };
        }
      }

      history.push({ role: 'assistant', content: outputText });

      return {
        output: outputText,
        exitCode: 0,
        usage: { ...totalUsage, provider, model },
        sessionParams: { history },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.onLog?.('stderr', message);
      return {
        output: message,
        exitCode: 1,
        usage: { inputTokens: 0, outputTokens: 0, provider, model },
        sessionParams: { history },
      };
    }
  }
}
