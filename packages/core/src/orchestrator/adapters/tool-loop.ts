import type {
  ChatMessage,
  ChatParams,
  ChatResult,
  ToolDefinition,
} from '@botinabox/shared';

export interface ToolExecutor {
  (toolName: string, toolInput: unknown): Promise<string>;
}

export async function* toolLoop(
  params: {
    model: string;
    messages: ChatMessage[];
    systemPrompt?: string;
    tools?: ToolDefinition[];
    maxIterations?: number;
    signal?: AbortSignal;
  },
  callLLM: (params: ChatParams) => Promise<ChatResult>,
  executeTool?: ToolExecutor,
): AsyncGenerator<
  | { type: 'text'; content: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'done'; result: ChatResult }
> {
  const maxIterations = params.maxIterations ?? 20;
  const messages: ChatMessage[] = [...params.messages];
  let iterations = 0;

  while (iterations < maxIterations) {
    if (params.signal?.aborted) {
      return;
    }

    iterations++;

    const chatParams: ChatParams = {
      model: params.model,
      messages,
      system: params.systemPrompt,
      tools: params.tools,
    };

    const result = await callLLM(chatParams);

    if (result.content) {
      yield { type: 'text', content: result.content };
    }

    if (result.stopReason === 'end_turn' || result.stopReason === 'stop_sequence' || result.stopReason === 'max_tokens') {
      yield { type: 'done', result };
      return;
    }

    if (result.stopReason === 'tool_use' && result.toolUses && result.toolUses.length > 0) {
      const toolResults: string[] = [];

      for (const toolUse of result.toolUses) {
        yield { type: 'tool_use', name: toolUse.name, input: toolUse.input };

        if (executeTool) {
          const toolResult = await executeTool(toolUse.name, toolUse.input);
          toolResults.push(toolResult);

          // Add assistant message with tool use
          messages.push({
            role: 'assistant',
            content: [
              ...(result.content ? [{ type: 'text' as const, text: result.content }] : []),
              { type: 'tool_use' as const, id: toolUse.id, name: toolUse.name, input: toolUse.input },
            ],
          });

          // Add tool result message
          messages.push({
            role: 'user',
            content: [
              { type: 'tool_result' as const, tool_use_id: toolUse.id, content: toolResult },
            ],
          });
        }
      }

      if (!executeTool) {
        yield { type: 'done', result };
        return;
      }
    } else {
      yield { type: 'done', result };
      return;
    }
  }

  // Max iterations reached — yield final done with last known state
  const finalResult = await callLLM({
    model: params.model,
    messages,
    system: params.systemPrompt,
    tools: params.tools,
  });
  yield { type: 'done', result: finalResult };
}
