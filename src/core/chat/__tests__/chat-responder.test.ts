import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataStore } from '../../data/data-store.js';
import { HookBus } from '../../hooks/hook-bus.js';
import { defineCoreTables } from '../../data/core-schema.js';
import { MessageStore } from '../message-store.js';
import { ChatResponder } from '../chat-responder.js';

let db: DataStore;
let hooks: HookBus;
let messageStore: MessageStore;

beforeEach(async () => {
  db = new DataStore({ dbPath: ':memory:' });
  defineCoreTables(db);
  await db.init();
  hooks = new HookBus();
  messageStore = new MessageStore(db, hooks);
});

afterEach(() => {
  db.close();
});

function mockLlmCall(response: string) {
  return async () => ({ content: response });
}

describe('ChatResponder — Story 7.2', () => {
  describe('respond', () => {
    it('generates a conversational response', async () => {
      const responder = new ChatResponder(db, hooks, messageStore, {
        llmCall: mockLlmCall('Hi there! I can help with that.'),
      });

      const response = await responder.respond({
        messageBody: 'hello',
        threadId: 'thread-1',
        channel: 'slack',
      });

      expect(response).toBe('Hi there! I can help with that.');
    });

    it('includes thread history in context', async () => {
      let capturedMessages: unknown[] = [];
      const llmCall = async (params: any) => {
        capturedMessages = params.messages;
        return { content: 'Got it!' };
      };

      const responder = new ChatResponder(db, hooks, messageStore, { llmCall });

      // Seed thread history
      await messageStore.storeInbound({
        id: 'msg-1', channel: 'slack', from: 'user-1',
        body: 'earlier message', threadId: 'thread-2', receivedAt: new Date().toISOString(),
      });

      await responder.respond({
        messageBody: 'follow up',
        threadId: 'thread-2',
        channel: 'slack',
      });

      // Should include the earlier message + current
      expect(capturedMessages.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('filterResponse', () => {
    it('passes through short messages without filtering', async () => {
      const responder = new ChatResponder(db, hooks, messageStore, {
        llmCall: mockLlmCall('should not be called'),
      });

      const result = await responder.filterResponse('OK');
      expect(result).toBe('OK');
    });

    it('filters long messages through LLM', async () => {
      const longText = 'a'.repeat(200);
      const responder = new ChatResponder(db, hooks, messageStore, {
        llmCall: mockLlmCall('Cleaned up response'),
      });

      const result = await responder.filterResponse(longText);
      expect(result).toBe('Cleaned up response');
    });

    it('regression: prompt instructs LLM to never add meta-commentary about the text', async () => {
      // Bug: LLM returned "That's already pretty conversational!" instead of original text.
      // The prompt must explicitly forbid meta-commentary.
      let capturedPrompt = '';
      const captureLlm = async (params: { messages: Array<{ content: string }> }) => {
        capturedPrompt = params.messages[0]?.content ?? '';
        return { content: 'filtered' };
      };

      const responder = new ChatResponder(db, hooks, messageStore, {
        llmCall: captureLlm,
      });

      await responder.filterResponse('a'.repeat(200));

      // The prompt must explicitly forbid meta-commentary
      expect(capturedPrompt).toMatch(/never|do not|must not/i);
      expect(capturedPrompt).toMatch(/comment/i);
    });
  });

  describe('isRedundant', () => {
    it('returns false when no prior messages', async () => {
      const responder = new ChatResponder(db, hooks, messageStore, {
        llmCall: mockLlmCall('not redundant'),
      });

      const result = await responder.isRedundant('hello', 'thread-3');
      expect(result).toBe(false);
    });

    it('returns true when LLM says redundant', async () => {
      const responder = new ChatResponder(db, hooks, messageStore, {
        llmCall: mockLlmCall('redundant'),
      });

      // Add prior outbound message
      await messageStore.storeOutbound({
        channel: 'slack', text: 'I already told you this', threadId: 'thread-4',
      });

      const result = await responder.isRedundant('same thing again', 'thread-4');
      expect(result).toBe(true);
    });

    it('returns false when LLM says not redundant', async () => {
      const responder = new ChatResponder(db, hooks, messageStore, {
        llmCall: mockLlmCall('not redundant'),
      });

      await messageStore.storeOutbound({
        channel: 'slack', text: 'first update', threadId: 'thread-5',
      });

      const result = await responder.isRedundant('different update with new info', 'thread-5');
      expect(result).toBe(false);
    });
  });

  describe('sendResponse', () => {
    it('stores and emits response.ready', async () => {
      const events: Record<string, unknown>[] = [];
      hooks.register('response.ready', (ctx) => { events.push(ctx); });

      const responder = new ChatResponder(db, hooks, messageStore, {
        llmCall: mockLlmCall('not redundant'),
      });

      const id = await responder.sendResponse({
        text: 'Done!',
        channel: 'slack',
        threadId: 'thread-6',
        skipFilter: true,
      });

      expect(id).toBeDefined();
      expect(events).toHaveLength(1);
      expect(events[0]!['text']).toBe('Done!');
    });

    it('suppresses redundant messages', async () => {
      const suppressEvents: Record<string, unknown>[] = [];
      hooks.register('response.suppressed', (ctx) => { suppressEvents.push(ctx); });

      const responder = new ChatResponder(db, hooks, messageStore, {
        llmCall: mockLlmCall('redundant'),
      });

      await messageStore.storeOutbound({
        channel: 'slack', text: 'already said', threadId: 'thread-7',
      });

      const id = await responder.sendResponse({
        text: 'same thing',
        channel: 'slack',
        threadId: 'thread-7',
        skipFilter: true,
      });

      expect(id).toBeUndefined();
      expect(suppressEvents).toHaveLength(1);
    });
  });
});
