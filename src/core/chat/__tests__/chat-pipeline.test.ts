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
    // Interpretation
    if (system.includes('message parser')) {
      const lower = userContent.toLowerCase();
      const isTask = lower.includes('fix') || lower.includes('deploy') || lower.includes('build');
      return {
        content: JSON.stringify({
          tasks: isTask ? [{ title: userContent.slice(0, 80), priority: 5 }] : [],
          memories: lower.includes('remember') ? [{ summary: 'Note', contents: userContent }] : [],
          user_context: [],
          is_task_request: isTask,
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

afterEach(() => { db.close(); });

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

    it('does not create tasks for conversational messages', async () => {
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
      expect(allTasks).toHaveLength(0);
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

      const channel = await pipeline.resolveChannel('thread-123');
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
});
