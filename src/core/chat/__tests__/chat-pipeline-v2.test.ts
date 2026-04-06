import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataStore } from '../../data/data-store.js';
import { HookBus } from '../../hooks/hook-bus.js';
import { defineCoreTables } from '../../data/core-schema.js';
import { TaskQueue } from '../../orchestrator/task-queue.js';
import { WakeupQueue } from '../../orchestrator/wakeup-queue.js';
import { ChatPipelineV2 } from '../chat-pipeline-v2.js';
import type { ChatPipelineV2Config } from '../chat-pipeline-v2.js';
import type { InboundMessage } from '../types.js';

let db: DataStore;
let hooks: HookBus;
let realTasks: TaskQueue;
let realWakeups: WakeupQueue;

function makeMessage(body: string, overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    channel: 'slack',
    account: 'C_CHANNEL',
    from: 'user-1',
    body,
    threadId: `thread-${Math.random().toString(36).slice(2)}`,
    receivedAt: new Date().toISOString(),
    raw: { ts: `${Date.now() / 1000}` },
    ...overrides,
  };
}

/**
 * Mock LLM that supports the v2 tool-use interface.
 * Returns content blocks (text + tool_use) like the Anthropic API.
 */
function mockLlmCallV2(opts?: {
  textResponse?: string;
  toolCall?: { name: string; input: Record<string, unknown> };
}) {
  const textResponse = opts?.textResponse ?? 'Here is my response.';
  const toolCall = opts?.toolCall;

  return async (params: {
    system?: string;
    messages: Array<{ role: string; content: unknown }>;
    tools?: unknown[];
  }) => {
    const lastMsg = params.messages[params.messages.length - 1];
    const lastContent = typeof lastMsg?.content === 'string'
      ? lastMsg.content
      : '';

    // If this is a tool_result message (follow-up after tool use), return text
    if (Array.isArray(lastMsg?.content) &&
        (lastMsg.content as Array<{ type: string }>).some(b => b.type === 'tool_result')) {
      return {
        content: [{ type: 'text', text: textResponse }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 20 },
      };
    }

    // If tool call requested and this is the first call, return tool_use
    if (toolCall) {
      return {
        content: [
          { type: 'text', text: 'Let me handle that.' },
          { type: 'tool_use', id: 'tool-1', name: toolCall.name, input: toolCall.input },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 20 },
      };
    }

    // Default: just return text
    return {
      content: [{ type: 'text', text: textResponse }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 20 },
    };
  };
}

beforeEach(async () => {
  db = new DataStore({ dbPath: ':memory:' });
  defineCoreTables(db);
  await db.init();
  hooks = new HookBus();
  realTasks = new TaskQueue(db, hooks);
  realWakeups = new WakeupQueue(db);

  // Seed agents for routing
  await db.insert('agents', {
    slug: 'chief', name: 'Chief', role: 'coordinator',
    adapter: 'api', status: 'idle', adapter_config: '{}', heartbeat_config: '{}',
  });
  await db.insert('agents', {
    slug: 'engineer', name: 'Engineer', role: 'engineer',
    adapter: 'cli', status: 'idle', adapter_config: '{}', heartbeat_config: '{}',
  });
});

afterEach(async () => {
  await new Promise(r => setTimeout(r, 100));
  db.close();
});

async function waitForAsync(): Promise<void> {
  await new Promise(r => setTimeout(r, 300));
}

describe('ChatPipelineV2 — Primary Agent Architecture', () => {
  describe('Phase 1: RECEIVE', () => {
    it('stores inbound messages in the database', async () => {
      new ChatPipelineV2(db, hooks, {
        llmCall: mockLlmCallV2(),
        systemPrompt: 'Test',
        tasks: realTasks,
        wakeups: realWakeups,
      });

      await hooks.emit('message.inbound', makeMessage('hello') as unknown as Record<string, unknown>);
      await waitForAsync();

      const messages = await db.query('messages', { where: { direction: 'inbound' } });
      expect(messages.length).toBeGreaterThanOrEqual(1);
    });

    it('deduplicates identical messages within window', async () => {
      new ChatPipelineV2(db, hooks, {
        llmCall: mockLlmCallV2(),
        systemPrompt: 'Test',
        tasks: realTasks,
        wakeups: realWakeups,
      });

      const msg = makeMessage('fix the bug');
      await hooks.emit('message.inbound', msg as unknown as Record<string, unknown>);
      await waitForAsync();

      const inboundAfterFirst = await db.query('messages', { where: { direction: 'inbound' } });

      // Send duplicate — should be silently dropped
      await hooks.emit('message.inbound', { ...msg, id: 'msg-dup' } as unknown as Record<string, unknown>);
      await waitForAsync();

      // Duplicate was NOT stored (dedup prevented it)
      const inboundAfterSecond = await db.query('messages', { where: { direction: 'inbound' } });
      expect(inboundAfterSecond.length).toBe(inboundAfterFirst.length);
    });

    it('ignores messages that fail the filter', async () => {
      const responses: unknown[] = [];
      hooks.register('response.ready', (ctx) => { responses.push(ctx); });

      new ChatPipelineV2(db, hooks, {
        llmCall: mockLlmCallV2(),
        systemPrompt: 'Test',
        messageFilter: (msg) => msg.from === 'allowed-user',
        tasks: realTasks,
        wakeups: realWakeups,
      });

      await hooks.emit('message.inbound', makeMessage('hello', { from: 'blocked-user' }) as unknown as Record<string, unknown>);
      await waitForAsync();

      expect(responses).toHaveLength(0);
    });
  });

  describe('Phase 2: THINK', () => {
    it('single-agent: calls LLM with tools and gets direct answer', async () => {
      let maxToolsSeen = 0;
      let primaryCallCount = 0;
      const llmCall = async (params: Record<string, unknown>) => {
        primaryCallCount++;
        const tools = (params.tools as unknown[]) ?? [];
        if (tools.length > maxToolsSeen) maxToolsSeen = tools.length;
        return {
          content: [{ type: 'text', text: 'The answer is 42.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      };

      const listFilesTool = {
        definition: { name: 'list_files', description: 'List files', input_schema: { type: 'object', properties: {} } },
        handler: async () => 'file1.txt\nfile2.txt',
      };

      const responses: Record<string, unknown>[] = [];
      hooks.register('response.ready', (ctx) => { responses.push(ctx); });

      new ChatPipelineV2(db, hooks, {
        llmCall,
        systemPrompt: 'Test',
        tools: [listFilesTool],
        tasks: realTasks,
        wakeups: realWakeups,
      });

      await hooks.emit('message.inbound', makeMessage('what files do we have?') as unknown as Record<string, unknown>);
      await waitForAsync();

      // Primary agent was called
      expect(primaryCallCount).toBeGreaterThanOrEqual(1);
      // Tools were passed to the primary think call (track max since adapter calls may lack tools)
      expect(maxToolsSeen).toBe(1);
      // Got a response
      expect(responses.length).toBeGreaterThanOrEqual(1);
      expect(responses[0]!.text).toBe('The answer is 42.');
    });

    it('multi-agent: dispatch_task creates task and thread mapping', async () => {
      const dispatchTool = {
        definition: {
          name: 'dispatch_task',
          description: 'Dispatch task to agent',
          input_schema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              agent_slug: { type: 'string' },
            },
            required: ['title', 'agent_slug'],
          },
        },
        handler: async (input: Record<string, unknown>) => {
          const agents = await db.query('agents', { where: { slug: input.agent_slug } });
          const agent = agents[0];
          if (!agent) return `Error: agent not found`;
          const row = await db.insert('tasks', {
            title: input.title,
            assignee_id: agent.id,
            status: 'todo',
          });
          return `Task "${input.title}" dispatched to ${agent.name} (ID: ${row.id}).`;
        },
      };

      new ChatPipelineV2(db, hooks, {
        llmCall: mockLlmCallV2({
          toolCall: { name: 'dispatch_task', input: { title: 'Review code', agent_slug: 'engineer' } },
          textResponse: 'I\'ve dispatched an engineer to review the code.',
        }),
        systemPrompt: 'Test',
        tools: [dispatchTool],
        tasks: realTasks,
        wakeups: realWakeups,
      });

      await hooks.emit('message.inbound', makeMessage('review the auth code', { account: 'C_TEST' }) as unknown as Record<string, unknown>);
      await waitForAsync();

      // Task was created
      const tasks = await db.query('tasks');
      expect(tasks.length).toBeGreaterThanOrEqual(1);
      expect(tasks.some(t => (t.title as string).includes('Review code'))).toBe(true);

      // Thread mapping exists for sub-agent result routing
      const mappings = await db.query('thread_task_map');
      expect(mappings.length).toBeGreaterThanOrEqual(1);
    });

    it('passes full conversation history (user + assistant) to LLM', async () => {
      const allCapturedMessages: Array<Array<{ role: string; content: unknown }>> = [];
      const llmCall = async (params: { messages: Array<{ role: string; content: unknown }> }) => {
        allCapturedMessages.push([...params.messages]);
        return {
          content: [{ type: 'text', text: 'Got it.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      };

      new ChatPipelineV2(db, hooks, {
        llmCall,
        systemPrompt: 'Test',
        tasks: realTasks,
        wakeups: realWakeups,
      });

      // Send first message and wait for full pipeline completion
      await hooks.emit('message.inbound', makeMessage('first question', { account: 'C_HIST' }) as unknown as Record<string, unknown>);
      await new Promise(r => setTimeout(r, 500));

      // Verify first message was stored
      const storedAfterFirst = await db.query('messages');
      expect(storedAfterFirst.length).toBeGreaterThanOrEqual(1);

      // Send second message (should include history from first)
      await hooks.emit('message.inbound', makeMessage('follow up', { account: 'C_HIST' }) as unknown as Record<string, unknown>);
      await new Promise(r => setTimeout(r, 500));

      // The think() calls should show increasing context:
      // First call: just "first question"
      // Second call: history from first + "follow up"
      // (Additional calls may come from the simpleLlmCall adapter for interpreter)
      const thinkCalls = allCapturedMessages.filter(msgs =>
        msgs.some(m => typeof m.content === 'string' && m.content.includes('follow up'))
      );
      expect(thinkCalls.length).toBeGreaterThanOrEqual(1);
      // The call containing "follow up" should have more than just the current message
      const secondThink = thinkCalls[0]!;
      expect(secondThink.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Phase 3: RESPOND', () => {
    it('emits typing.start and typing.stop events', async () => {
      const typingEvents: string[] = [];
      hooks.register('typing.start', () => { typingEvents.push('start'); });
      hooks.register('typing.stop', () => { typingEvents.push('stop'); });

      new ChatPipelineV2(db, hooks, {
        llmCall: mockLlmCallV2({ textResponse: 'Done.' }),
        systemPrompt: 'Test',
        tasks: realTasks,
        wakeups: realWakeups,
      });

      await hooks.emit('message.inbound', makeMessage('hello') as unknown as Record<string, unknown>);
      await waitForAsync();

      expect(typingEvents).toContain('start');
      expect(typingEvents).toContain('stop');
    });

    it('sends exactly ONE response per message (no separate ack)', async () => {
      const responses: unknown[] = [];
      hooks.register('response.ready', (ctx) => { responses.push(ctx); });

      new ChatPipelineV2(db, hooks, {
        llmCall: mockLlmCallV2({ textResponse: 'Here is the answer.' }),
        systemPrompt: 'Test',
        tasks: realTasks,
        wakeups: realWakeups,
      });

      await hooks.emit('message.inbound', makeMessage('what time is it?') as unknown as Record<string, unknown>);
      await waitForAsync();

      // Exactly one response — not two (no separate ack + result)
      expect(responses.length).toBe(1);
    });

    it('delivers sub-agent results via run.completed', async () => {
      const responses: Record<string, unknown>[] = [];
      hooks.register('response.ready', (ctx) => { responses.push(ctx); });

      new ChatPipelineV2(db, hooks, {
        llmCall: mockLlmCallV2({ textResponse: 'On it.' }),
        systemPrompt: 'Test',
        tasks: realTasks,
        wakeups: realWakeups,
      });

      // Simulate: create a task with thread mapping (as if dispatch_task ran)
      const taskId = await realTasks.create({ title: 'Test task', assignee_id: 'agent-1' });
      await db.insert('thread_task_map', {
        thread_ts: 'C_RESULT',
        channel_id: 'C_RESULT',
        task_id: taskId,
      });

      // Simulate task completion with result
      await db.update('tasks', { id: taskId }, {
        status: 'done',
        result: 'Sub-agent completed the analysis.',
      });

      // Emit run.completed
      await hooks.emit('run.completed', {
        runId: 'run-1',
        agentId: 'agent-1',
        taskId,
        status: 'succeeded',
        exitCode: 0,
      });

      // Sub-agent result should be delivered
      const resultResponse = responses.find(r => (r.text as string)?.includes('Sub-agent completed'));
      expect(resultResponse).toBeDefined();
    });
  });

  describe('resilience', () => {
    it('does not crash when LLM fails', async () => {
      const failingLlm = async () => { throw new Error('LLM API timeout'); };

      const pipeline = new ChatPipelineV2(db, hooks, {
        llmCall: failingLlm,
        systemPrompt: 'Test',
        tasks: realTasks,
        wakeups: realWakeups,
      });

      // Should NOT throw
      await hooks.emit('message.inbound', makeMessage('hello') as unknown as Record<string, unknown>);
      await waitForAsync();

      // Message was still stored
      const inbound = await db.query('messages', { where: { direction: 'inbound' } });
      expect(inbound.length).toBeGreaterThanOrEqual(1);
    });

    it('stores messages with consistent thread_id for DM context', async () => {
      new ChatPipelineV2(db, hooks, {
        llmCall: mockLlmCallV2(),
        systemPrompt: 'Test',
        tasks: realTasks,
        wakeups: realWakeups,
      });

      const msg1 = makeMessage('first', { threadId: undefined, account: 'D_DM' });
      const msg2 = makeMessage('second', { threadId: undefined, account: 'D_DM' });

      await hooks.emit('message.inbound', msg1 as unknown as Record<string, unknown>);
      await waitForAsync();
      await hooks.emit('message.inbound', msg2 as unknown as Record<string, unknown>);
      await waitForAsync();

      const stored = await db.query('messages', { where: { direction: 'inbound' } });
      const threadIds = stored.map(m => m.thread_id).filter(Boolean);
      const unique = new Set(threadIds);
      expect(unique.size).toBe(1);
      expect(threadIds[0]).toBe('D_DM');
    });
  });
});
