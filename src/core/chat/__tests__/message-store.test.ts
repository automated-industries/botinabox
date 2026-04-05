import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataStore } from '../../data/data-store.js';
import { HookBus } from '../../hooks/hook-bus.js';
import { defineCoreTables } from '../../data/core-schema.js';
import { MessageStore } from '../message-store.js';
import type { InboundMessage } from '../types.js';

let db: DataStore;
let hooks: HookBus;
let store: MessageStore;

beforeEach(async () => {
  db = new DataStore({ dbPath: ':memory:' });
  defineCoreTables(db);
  await db.init();
  hooks = new HookBus();
  store = new MessageStore(db, hooks);
});

afterEach(() => {
  db.close();
});

function makeMessage(body: string, overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    channel: 'slack',
    from: 'user-1',
    body,
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('MessageStore — Story 7.1', () => {
  describe('storeInbound', () => {
    it('stores a message and returns ID', async () => {
      const result = await store.storeInbound(makeMessage('hello'));

      expect(result.messageId).toBeDefined();
      expect(result.attachmentIds).toHaveLength(0);

      const msg = await db.get('messages', { id: result.messageId });
      expect(msg!['body']).toBe('hello');
      expect(msg!['direction']).toBe('inbound');
    });

    it('stores attachments linked to message', async () => {
      const msg = makeMessage('check this file', {
        attachments: [
          { type: 'image', filename: 'photo.jpg', mimeType: 'image/jpeg', size: 1024 },
          { type: 'file', filename: 'doc.pdf', mimeType: 'application/pdf' },
        ],
      });

      const result = await store.storeInbound(msg);

      expect(result.attachmentIds).toHaveLength(2);

      const atts = await store.getAttachments(result.messageId);
      expect(atts).toHaveLength(2);
      expect(atts[0]!['filename']).toBe('photo.jpg');
      expect(atts[1]!['filename']).toBe('doc.pdf');
    });

    it('emits message.stored hook', async () => {
      const events: Record<string, unknown>[] = [];
      hooks.register('message.stored', (ctx) => { events.push(ctx); });

      await store.storeInbound(makeMessage('test'));

      expect(events).toHaveLength(1);
      expect(events[0]!['direction']).toBe('inbound');
    });
  });

  describe('storeOutbound', () => {
    it('stores outbound message before sending', async () => {
      const id = await store.storeOutbound({
        channel: 'slack',
        text: 'I will look into that',
        threadId: 'thread-1',
        agentSlug: 'assistant',
      });

      expect(id).toBeDefined();

      const msg = await db.get('messages', { id });
      expect(msg!['direction']).toBe('outbound');
      expect(msg!['body']).toBe('I will look into that');
      expect(msg!['from_agent']).toBe('assistant');
    });
  });

  describe('getThreadHistory', () => {
    it('returns messages in a thread ordered by time', async () => {
      await store.storeInbound(makeMessage('first', { threadId: 'thread-1' }));
      await store.storeOutbound({ channel: 'slack', text: 'reply', threadId: 'thread-1' });
      await store.storeInbound(makeMessage('followup', { threadId: 'thread-1' }));

      const history = await store.getThreadHistory('thread-1');
      expect(history).toHaveLength(3);
    });
  });

  describe('getRecentOutbound', () => {
    it('returns only outbound messages', async () => {
      await store.storeInbound(makeMessage('hello', { threadId: 'thread-2' }));
      await store.storeOutbound({ channel: 'slack', text: 'hi there', threadId: 'thread-2' });
      await store.storeInbound(makeMessage('thanks', { threadId: 'thread-2' }));
      await store.storeOutbound({ channel: 'slack', text: 'you are welcome', threadId: 'thread-2' });

      const outbound = await store.getRecentOutbound('thread-2');
      expect(outbound).toHaveLength(2);
      expect(outbound.every(m => m['direction'] === 'outbound')).toBe(true);
    });
  });
});
