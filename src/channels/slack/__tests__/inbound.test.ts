import { describe, it, expect } from 'vitest';
import { parseSlackEvent } from '../inbound.js';

describe('parseSlackEvent — threadId resolution', () => {
  it('sets threadId to thread_ts for thread replies', () => {
    const event = {
      type: 'message',
      ts: '1776308368.646379',
      thread_ts: '1776308000.000001',
      channel: 'C_TEST',
      user: 'U_USER',
      text: 'reply in thread',
    };
    const msg = parseSlackEvent(event);
    expect(msg.threadId).toBe('1776308000.000001');
  });

  it('sets threadId to own ts for top-level channel messages', () => {
    const event = {
      type: 'message',
      ts: '1776308368.646379',
      channel: 'C_TEST',
      user: 'U_USER',
      text: 'top-level channel message',
    };
    const msg = parseSlackEvent(event);
    expect(msg.threadId).toBe('1776308368.646379');
  });

  it('sets threadId to own ts for group channel messages (G prefix)', () => {
    const event = {
      type: 'message',
      ts: '1776308368.646379',
      channel: 'G_GROUP',
      user: 'U_USER',
      text: 'group message',
    };
    const msg = parseSlackEvent(event);
    expect(msg.threadId).toBe('1776308368.646379');
  });

  it('leaves threadId undefined for top-level DMs (D prefix)', () => {
    const event = {
      type: 'message',
      ts: '1776308368.646379',
      channel: 'D_DM',
      user: 'U_USER',
      text: 'DM message',
    };
    const msg = parseSlackEvent(event);
    expect(msg.threadId).toBeUndefined();
  });

  it('sets threadId to thread_ts for DM thread replies', () => {
    const event = {
      type: 'message',
      ts: '1776308368.646379',
      thread_ts: '1776308000.000001',
      channel: 'D_DM',
      user: 'U_USER',
      text: 'DM thread reply',
    };
    const msg = parseSlackEvent(event);
    expect(msg.threadId).toBe('1776308000.000001');
  });

  it('channel thread replies share threadId with the parent message', () => {
    const parentTs = '1776308000.000001';

    // Parent (top-level channel message)
    const parent = parseSlackEvent({
      type: 'message',
      ts: parentTs,
      channel: 'C_TEST',
      user: 'U_USER',
      text: 'parent message',
    });

    // Reply (references parent via thread_ts)
    const reply = parseSlackEvent({
      type: 'message',
      ts: '1776308999.999999',
      thread_ts: parentTs,
      channel: 'C_TEST',
      user: 'U_USER',
      text: 'thread reply',
    });

    expect(parent.threadId).toBe(parentTs);
    expect(reply.threadId).toBe(parentTs);
    expect(parent.threadId).toBe(reply.threadId);
  });
});
