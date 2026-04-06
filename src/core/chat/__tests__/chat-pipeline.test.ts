import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataStore } from '../../data/data-store.js';
import { HookBus } from '../../hooks/hook-bus.js';
import { defineCoreTables } from '../../data/core-schema.js';
import { TaskQueue } from '../../orchestrator/task-queue.js';
import { WakeupQueue } from '../../orchestrator/wakeup-queue.js';
import { ChatPipeline } from '../chat-pipeline.js';
import type { InboundMessage } from '../types.js';

let db: DataStore;
let hooks: HookBus;

function mockLlmCall(response?: string) {
  return async (params: { system?: string; messages: Array<{ content: string }> }) => {
    const system = params.system ?? '';
    const userContent = params.messages[params.messages.length - 1]?.content ?? '';

    // Redundancy check
    if (userContent.includes('duplicate or substantially overlap')) {
      return { content: 'not redundant' };
    }
    // Response filter
    if (userContent.includes('Rewrite this agent/system message')) {
      const match = userContent.match(/---\n(.+)$/s);
      return { content: match?.[1] ?? userContent };
    }
    // Interpretation — always create a task (default to action)
    if (system.includes('message parser')) {
      const lower = userContent.toLowerCase();
      return {
        content: JSON.stringify({
          tasks: [{ title: userContent.slice(0, 80), priority: 5 }],
          memories: lower.includes('remember') ? [{ summary: 'Note', contents: userContent }] : [],
          user_context: [],
          is_task_request: true,
        }),
      };
    }
    return { content: response ?? 'Got it!' };
  };
}

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

let realTasks: TaskQueue;
let realWakeups: WakeupQueue;

beforeEach(async () => {
  db = new DataStore({ dbPath: ':memory:' });
  defineCoreTables(db);
  await db.init();
  hooks = new HookBus();
  realTasks = new TaskQueue(db, hooks);
  realWakeups = new WakeupQueue(db);

  // Seed an agent for routing
  await db.insert('agents', {
    slug: 'engineer', name: 'Engineer', role: 'engineer',
    adapter: 'cli', status: 'idle', adapter_config: '{}', heartbeat_config: '{}',
  });
});

afterEach(async () => {
  // Wait for any pending async dispatches to complete before closing DB
  await new Promise(r => setTimeout(r, 100));
  db.close();
});

async function waitForAsync(): Promise<void> {
  // Needs enough time for: LLM ack → LLM interpretation → task dispatch
  await new Promise(r => setTimeout(r, 300));
}

describe('ChatPipeline — Story 7.4', () => {
  describe('Layer 1: Message dedup + storage', () => {
    it('stores inbound messages in the database', async () => {
      new ChatPipeline(db, hooks, {
        llmCall: mockLlmCall(),
        systemPrompt: 'Test',
        routingRules: [],
        fallbackAgent: 'engineer',
        tasks: realTasks,
        wakeups: realWakeups,
      });

      await hooks.emit('message.inbound', makeMessage('hello') as unknown as Record<string, unknown>);

      const messages = await db.query('messages', { where: { direction: 'inbound' } });
      expect(messages.length).toBeGreaterThanOrEqual(1);
    });

    it('deduplicates identical messages within window', async () => {
      new ChatPipeline(db, hooks, {
        llmCall: mockLlmCall(),
        systemPrompt: 'Test',
        routingRules: [],
        fallbackAgent: 'engineer',
        tasks: realTasks,
        wakeups: realWakeups,
      });

      const msg = makeMessage('fix the bug');
      await hooks.emit('message.inbound', msg as unknown as Record<string, unknown>);
      await waitForAsync();
      await hooks.emit('message.inbound', { ...msg, id: 'msg-dup' } as unknown as Record<string, unknown>);
      await waitForAsync();

      // Only one task should be created (dedup prevents second)
      const allTasks = await db.query('tasks');
      expect(allTasks.length).toBeLessThanOrEqual(1);
    });
  });

  describe('Layer 2: Fast response', () => {
    it('emits response.ready with ack response', async () => {
      const responses: Record<string, unknown>[] = [];
      hooks.register('response.ready', (ctx) => { responses.push(ctx); });

      new ChatPipeline(db, hooks, {
        llmCall: mockLlmCall('I can help with that!'),
        systemPrompt: 'Test',
        routingRules: [],
        fallbackAgent: 'engineer',
        tasks: realTasks,
        wakeups: realWakeups,
      });

      await hooks.emit('message.inbound', makeMessage('hello') as unknown as Record<string, unknown>);

      expect(responses.length).toBeGreaterThanOrEqual(1);
      expect(responses[0]!.channel).toBe('slack');
    });
  });

  describe('Layer 3-5: Interpretation + task dispatch', () => {
    it('creates tasks for actionable messages', async () => {
      const errors: string[] = [];
      hooks.register('interpretation.error', (ctx) => {
        errors.push(ctx.error as string);
      });

      new ChatPipeline(db, hooks, {
        llmCall: mockLlmCall(),
        systemPrompt: 'Test',
        routingRules: [{ agentSlug: 'engineer', keywords: ['fix', 'build', 'deploy'] }],
        fallbackAgent: 'engineer',
        tasks: realTasks,
        wakeups: realWakeups,
      });

      await hooks.emit('message.inbound', makeMessage('fix the auth bug') as unknown as Record<string, unknown>);
      await waitForAsync();

      if (errors.length > 0) console.log('INTERPRETATION ERRORS:', errors);
      expect(errors).toHaveLength(0);
      const allTasks = await db.query('tasks');
      expect(allTasks.length).toBe(1);
      expect(allTasks[0]!.title).toContain('fix the auth bug');
    });

    it('stores memories for non-task messages', async () => {
      new ChatPipeline(db, hooks, {
        llmCall: mockLlmCall(),
        systemPrompt: 'Test',
        routingRules: [],
        fallbackAgent: 'engineer',
        tasks: realTasks,
        wakeups: realWakeups,
      });

      await hooks.emit('message.inbound', makeMessage('remember that the server password changed') as unknown as Record<string, unknown>);
      await waitForAsync();

      const memories = await db.query('memories');
      expect(memories.length).toBeGreaterThanOrEqual(1);
    });

    it('creates tasks even for conversational messages (default to action)', async () => {
      new ChatPipeline(db, hooks, {
        llmCall: mockLlmCall(),
        systemPrompt: 'Test',
        routingRules: [],
        fallbackAgent: 'engineer',
        tasks: realTasks,
        wakeups: realWakeups,
      });

      await hooks.emit('message.inbound', makeMessage('hello, how are you?') as unknown as Record<string, unknown>);
      await waitForAsync();

      const allTasks = await db.query('tasks');
      expect(allTasks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('message filter', () => {
    it('ignores messages that fail the filter', async () => {
      const responses: unknown[] = [];
      hooks.register('response.ready', (ctx) => { responses.push(ctx); });

      new ChatPipeline(db, hooks, {
        llmCall: mockLlmCall(),
        systemPrompt: 'Test',
        routingRules: [],
        fallbackAgent: 'engineer',
        messageFilter: (msg) => msg.from === 'allowed-user',
        tasks: realTasks,
        wakeups: realWakeups,
      });

      await hooks.emit('message.inbound', makeMessage('hello', { from: 'blocked-user' }) as unknown as Record<string, unknown>);

      expect(responses).toHaveLength(0);
    });
  });

  describe('thread tracking', () => {
    it('maps threads to channels for response routing', async () => {
      const pipeline = new ChatPipeline(db, hooks, {
        llmCall: mockLlmCall(),
        systemPrompt: 'Test',
        routingRules: [{ agentSlug: 'engineer', keywords: ['deploy'] }],
        fallbackAgent: 'engineer',
        tasks: realTasks,
        wakeups: realWakeups,
      });

      const msg = makeMessage('deploy now', { threadId: 'thread-123', account: 'C_CHAN' });
      await hooks.emit('message.inbound', msg as unknown as Record<string, unknown>);
      await waitForAsync();

      // Pipeline uses channelId (msg.account) as thread_ts, not threadId
      const channel = await pipeline.resolveChannel('C_CHAN');
      expect(channel).toBe('C_CHAN');
    });

    it('creates thread_task_map entries for dispatched tasks', async () => {
      new ChatPipeline(db, hooks, {
        llmCall: mockLlmCall(),
        systemPrompt: 'Test',
        routingRules: [{ agentSlug: 'engineer', keywords: ['build'] }],
        fallbackAgent: 'engineer',
        tasks: realTasks,
        wakeups: realWakeups,
      });

      await hooks.emit('message.inbound', makeMessage('build the app', { threadId: 'thread-456', account: 'C_CHAN' }) as unknown as Record<string, unknown>);
      await waitForAsync();

      const mappings = await db.query('thread_task_map');
      expect(mappings.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Layer 6: Task execution response', () => {
    it('regression: agent output is sent with skipFilter=true to prevent meta-commentary', async () => {
      // Bug: filterResponse returned "That's already pretty conversational!"
      // because agent output was being rewritten by the LLM filter.
      // Agent output should bypass the filter entirely.
      let filterCalled = false;
      const trackFilterLlm = async (params: { messages: Array<{ content: string }> }) => {
        const content = params.messages[params.messages.length - 1]?.content ?? '';
        if (content.includes('Rewrite this agent/system message')) {
          filterCalled = true;
        }
        if (content.includes('duplicate or substantially overlap')) {
          return { content: 'not redundant' };
        }
        return { content: 'Got it!' };
      };

      const pipeline = new ChatPipeline(db, hooks, {
        llmCall: trackFilterLlm,
        systemPrompt: 'Test',
        routingRules: [],
        fallbackAgent: 'engineer',
        tasks: realTasks,
        wakeups: realWakeups,
      });

      // Simulate: send a message to create a task and thread mapping
      const msg = makeMessage('do something', { account: 'C_TEST' });
      await hooks.emit('message.inbound', msg as unknown as Record<string, unknown>);
      await waitForAsync();

      // Find the task that was created
      const allTasks = await db.query('tasks');
      expect(allTasks.length).toBeGreaterThanOrEqual(1);
      const task = allTasks[0]!;
      const taskId = task.id as string;

      // Simulate task completion with result
      await db.update('tasks', { id: taskId }, {
        status: 'done',
        result: 'Here is a long agent output that is over 100 chars. '.repeat(3),
      });

      // Reset filter tracking
      filterCalled = false;

      // Emit run.completed to trigger Layer 6
      await hooks.emit('run.completed', {
        runId: 'run-1',
        agentId: task.assignee_id as string,
        taskId,
        status: 'succeeded',
        exitCode: 0,
      });

      // The filterResponse LLM call should NOT have been invoked for agent output
      expect(filterCalled).toBe(false);
    });
  });

  describe('resilience', () => {
    it('does not crash when LLM call fails during interpretation', async () => {
      let callCount = 0;
      const failingLlm = async (params: { system?: string; messages: Array<{ content: string }> }) => {
        callCount++;
        const system = params.system ?? '';
        const userContent = params.messages[params.messages.length - 1]?.content ?? '';
        // Redundancy check passes
        if (userContent.includes('duplicate or substantially overlap')) return { content: 'not redundant' };
        // Ack response works fine
        if (!system.includes('message parser')) return { content: 'Got it!' };
        // Interpretation LLM call throws
        throw new Error('LLM API timeout');
      };

      const errors: string[] = [];
      hooks.register('interpretation.error', (ctx) => {
        errors.push(ctx.error as string);
      });

      new ChatPipeline(db, hooks, {
        llmCall: failingLlm,
        systemPrompt: 'Test',
        routingRules: [],
        fallbackAgent: 'engineer',
        tasks: realTasks,
        wakeups: realWakeups,
      });

      // Should NOT throw — ack is sent, interpretation fails silently
      await hooks.emit('message.inbound', makeMessage('do something') as unknown as Record<string, unknown>);
      await waitForAsync();

      // Ack was still sent
      const outbound = await db.query('messages', { where: { direction: 'outbound' } });
      expect(outbound.length).toBeGreaterThanOrEqual(1);

      // Interpreter catches LLM errors internally and returns empty results.
      // The pipeline does NOT crash — that's the critical assertion.
      // The ack response above proves the process survived.
    });

    it('does not crash when LLM returns invalid JSON during interpretation', async () => {
      const badJsonLlm = async (params: { system?: string }) => {
        const system = params.system ?? '';
        if (system.includes('message parser')) return { content: 'not valid json at all {{{}' };
        return { content: 'Got it!' };
      };

      new ChatPipeline(db, hooks, {
        llmCall: badJsonLlm,
        systemPrompt: 'Test',
        routingRules: [],
        fallbackAgent: 'engineer',
        tasks: realTasks,
        wakeups: realWakeups,
      });

      // Should NOT throw
      await hooks.emit('message.inbound', makeMessage('hello') as unknown as Record<string, unknown>);
      await waitForAsync();

      // Ack was still sent
      const outbound = await db.query('messages', { where: { direction: 'outbound' } });
      expect(outbound.length).toBeGreaterThanOrEqual(1);
    });

    it('does not crash when redundancy check fails', async () => {
      let callCount = 0;
      const failOnRedundancy = async (params: { messages: Array<{ content: string }> }) => {
        callCount++;
        const content = params.messages[params.messages.length - 1]?.content ?? '';
        if (content.includes('duplicate or substantially overlap')) throw new Error('Redundancy check crashed');
        return { content: 'Got it!' };
      };

      new ChatPipeline(db, hooks, {
        llmCall: failOnRedundancy,
        systemPrompt: 'Test',
        routingRules: [],
        fallbackAgent: 'engineer',
        tasks: realTasks,
        wakeups: realWakeups,
      });

      // Should NOT throw even if redundancy check fails
      await hooks.emit('message.inbound', makeMessage('test message') as unknown as Record<string, unknown>);
      await waitForAsync();

      // Message was stored
      const inbound = await db.query('messages', { where: { direction: 'inbound' } });
      expect(inbound.length).toBeGreaterThanOrEqual(1);
    });

    it('stores inbound messages with consistent thread_id for DM context', async () => {
      new ChatPipeline(db, hooks, {
        llmCall: mockLlmCall(),
        systemPrompt: 'Test',
        routingRules: [],
        fallbackAgent: 'engineer',
        tasks: realTasks,
        wakeups: realWakeups,
      });

      // Two messages in same DM (same account/channel, no threadId)
      const msg1 = makeMessage('first message', { threadId: undefined, account: 'D_CHANNEL' });
      const msg2 = makeMessage('second message', { threadId: undefined, account: 'D_CHANNEL' });

      await hooks.emit('message.inbound', msg1 as unknown as Record<string, unknown>);
      await waitForAsync();
      await hooks.emit('message.inbound', msg2 as unknown as Record<string, unknown>);
      await waitForAsync();

      // Both messages should share the same thread_id (the channel ID)
      const stored = await db.query('messages', { where: { direction: 'inbound' } });
      const threadIds = stored.map(m => m.thread_id).filter(Boolean);
      const unique = new Set(threadIds);
      expect(unique.size).toBe(1); // All share same thread
      expect(threadIds[0]).toBe('D_CHANNEL');
    });

    it('creates a task for EVERY message (default to action)', async () => {
      new ChatPipeline(db, hooks, {
        llmCall: mockLlmCall(),
        systemPrompt: 'Test',
        routingRules: [],
        fallbackAgent: 'engineer',
        tasks: realTasks,
        wakeups: realWakeups,
      });

      // Even a greeting should produce a task
      await hooks.emit('message.inbound', makeMessage('hello how are you') as unknown as Record<string, unknown>);
      await waitForAsync();

      const allTasks = await db.query('tasks');
      expect(allTasks.length).toBeGreaterThanOrEqual(1);
    });
  });
});
