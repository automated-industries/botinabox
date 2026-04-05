import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataStore } from '../../data/data-store.js';
import { HookBus } from '../../hooks/hook-bus.js';
import { defineCoreTables } from '../../data/core-schema.js';
import { MessageInterpreter } from '../message-interpreter.js';
import type { Extractor, LLMCallFn } from '../message-interpreter.js';

let db: DataStore;
let hooks: HookBus;

beforeEach(async () => {
  db = new DataStore({ dbPath: ':memory:' });
  defineCoreTables(db);
  await db.init();
  hooks = new HookBus();
});

afterEach(() => {
  db.close();
});

async function insertMessage(body: string): Promise<string> {
  const row = await db.insert('messages', {
    channel: 'slack',
    direction: 'inbound',
    from_user: 'user-1',
    body,
  });
  return row['id'] as string;
}

function mockLlmExtraction(response: Record<string, unknown>) {
  return async () => ({ content: JSON.stringify(response) });
}

describe('MessageInterpreter — Story 7.3', () => {
  describe('interpret', () => {
    it('extracts tasks from actionable messages', async () => {
      const interpreter = new MessageInterpreter(db, hooks, {
        llmCall: mockLlmExtraction({
          tasks: [{ title: 'Deploy to staging', priority: 3 }],
          memories: [],
          user_context: [],
          is_task_request: true,
        }),
      });

      const messageId = await insertMessage('please deploy to staging');
      const result = await interpreter.interpret(messageId);

      expect(result.isTaskRequest).toBe(true);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0]!.title).toBe('Deploy to staging');
    });

    it('extracts memories from notes', async () => {
      const interpreter = new MessageInterpreter(db, hooks, {
        llmCall: mockLlmExtraction({
          tasks: [],
          memories: [
            { summary: 'Meeting note', contents: 'Discussed Q2 roadmap with team', tags: ['meeting', 'planning'], category: 'work' },
          ],
          user_context: [],
          is_task_request: false,
        }),
      });

      const messageId = await insertMessage('Just had a meeting about Q2 roadmap with the team');
      const result = await interpreter.interpret(messageId);

      expect(result.isTaskRequest).toBe(false);
      expect(result.memories).toHaveLength(1);
      expect(result.memories[0]!.summary).toBe('Meeting note');

      // Verify stored in DB
      const memories = await db.query('memories', { where: { message_id: messageId } });
      expect(memories).toHaveLength(1);
      expect(memories[0]!['summary']).toBe('Meeting note');
    });

    it('extracts user context traits', async () => {
      const interpreter = new MessageInterpreter(db, hooks, {
        llmCall: mockLlmExtraction({
          tasks: [],
          memories: [],
          user_context: [
            { trait: 'timezone', value: 'EST' },
            { trait: 'communication_style', value: 'concise' },
          ],
          is_task_request: false,
        }),
      });

      const messageId = await insertMessage('BTW I prefer short answers, and I am in EST');
      const result = await interpreter.interpret(messageId);

      expect(result.userContext).toHaveLength(2);

      // User context stored as memories with user_context category
      const stored = await db.query('memories', { where: { message_id: messageId } });
      expect(stored).toHaveLength(2);
      expect(stored[0]!['category']).toBe('user_context');
    });

    it('handles conversational messages gracefully', async () => {
      const interpreter = new MessageInterpreter(db, hooks, {
        llmCall: mockLlmExtraction({
          tasks: [],
          memories: [],
          user_context: [],
          is_task_request: false,
        }),
      });

      const messageId = await insertMessage('hey whats up');
      const result = await interpreter.interpret(messageId);

      expect(result.isTaskRequest).toBe(false);
      expect(result.tasks).toHaveLength(0);
      expect(result.memories).toHaveLength(0);
    });

    it('emits interpretation.completed hook', async () => {
      const events: Record<string, unknown>[] = [];
      hooks.register('interpretation.completed', (ctx) => { events.push(ctx); });

      const interpreter = new MessageInterpreter(db, hooks, {
        llmCall: mockLlmExtraction({
          tasks: [{ title: 'Test task' }],
          memories: [{ summary: 'Test note', contents: 'Details' }],
          user_context: [],
          is_task_request: true,
        }),
      });

      const messageId = await insertMessage('do this and remember that');
      await interpreter.interpret(messageId);

      expect(events).toHaveLength(1);
      expect(events[0]!['taskCount']).toBe(1);
      expect(events[0]!['memoryCount']).toBe(1);
      expect(events[0]!['isTaskRequest']).toBe(true);
    });

    it('handles LLM parse failures gracefully', async () => {
      const interpreter = new MessageInterpreter(db, hooks, {
        llmCall: async () => ({ content: 'not valid json at all' }),
      });

      const messageId = await insertMessage('random message');
      const result = await interpreter.interpret(messageId);

      // Should not throw, returns empty results
      expect(result.tasks).toHaveLength(0);
      expect(result.memories).toHaveLength(0);
      expect(result.isTaskRequest).toBe(false);
    });
  });

  describe('custom extractors', () => {
    it('runs custom extractors alongside built-in ones', async () => {
      const customExtractor: Extractor = {
        type: 'project_mention',
        extract: async (msg) => {
          const matches = msg.body.match(/project (\w+)/gi);
          return (matches ?? []).map(m => ({ mention: m }));
        },
      };

      const interpreter = new MessageInterpreter(db, hooks, {
        llmCall: mockLlmExtraction({
          tasks: [],
          memories: [],
          user_context: [],
          is_task_request: false,
        }),
        extractors: [customExtractor],
      });

      const messageId = await insertMessage('check on project Alpha and project Beta');
      const result = await interpreter.interpret(messageId);

      expect(result.custom['project_mention']).toHaveLength(2);
    });

    it('continues if custom extractor fails', async () => {
      const failingExtractor: Extractor = {
        type: 'broken',
        extract: async () => { throw new Error('extractor crash'); },
      };

      const interpreter = new MessageInterpreter(db, hooks, {
        llmCall: mockLlmExtraction({
          tasks: [{ title: 'Still works' }],
          memories: [],
          user_context: [],
          is_task_request: true,
        }),
        extractors: [failingExtractor],
      });

      const messageId = await insertMessage('do something');
      const result = await interpreter.interpret(messageId);

      // Built-in extraction still works
      expect(result.tasks).toHaveLength(1);
      // Failing extractor doesn't appear in results
      expect(result.custom['broken']).toBeUndefined();
    });
  });
});
