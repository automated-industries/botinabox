/**
 * MessageStore — store-before-respond guarantee for all chat interactions.
 * Story 7.1
 *
 * Every inbound message (with attachments) is stored BEFORE the bot responds.
 * Every outbound message is stored BEFORE it is sent to the user.
 * Storage confirmation is required before any response flows.
 */

import type { DataStore } from '../data/data-store.js';
import type { HookBus } from '../hooks/hook-bus.js';
import type { InboundMessage, Attachment } from './types.js';

export interface StoredAttachment {
  fileType: string;       // "image" | "file" | "audio" | "video"
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
  contents?: string;      // transcript if voice, description if image, markdown if doc
  summary?: string;       // one-line summary
  url?: string;
}

export interface StoreResult {
  messageId: string;
  attachmentIds: string[];
}

export class MessageStore {
  constructor(
    private db: DataStore,
    private hooks: HookBus,
  ) {}

  /**
   * Store an inbound message and its attachments.
   * Must complete successfully before any bot response is generated.
   */
  async storeInbound(msg: InboundMessage): Promise<StoreResult> {
    const row = await this.db.insert('messages', {
      channel: msg.channel,
      direction: 'inbound',
      from_user: msg.from,
      user_id: msg.userId,
      body: msg.body,
      thread_id: msg.threadId,
    });

    const messageId = row['id'] as string;
    const attachmentIds: string[] = [];

    // Store each attachment
    if (msg.attachments && msg.attachments.length > 0) {
      for (const att of msg.attachments) {
        const attId = await this.storeAttachment(messageId, {
          fileType: att.type,
          filename: att.filename,
          mimeType: att.mimeType,
          sizeBytes: att.size,
          url: att.url,
        });
        attachmentIds.push(attId);
      }
    }

    await this.hooks.emit('message.stored', {
      messageId,
      direction: 'inbound',
      channel: msg.channel,
      from: msg.from,
      attachmentCount: attachmentIds.length,
    });

    return { messageId, attachmentIds };
  }

  /**
   * Store an outbound message BEFORE sending it.
   * Returns the message ID for confirmation tracking.
   */
  async storeOutbound(opts: {
    channel: string;
    text: string;
    threadId?: string;
    agentId?: string;
    agentSlug?: string;
    taskId?: string;
  }): Promise<string> {
    const row = await this.db.insert('messages', {
      channel: opts.channel,
      direction: 'outbound',
      from_agent: opts.agentSlug,
      agent_id: opts.agentId,
      body: opts.text,
      thread_id: opts.threadId,
      task_id: opts.taskId,
    });

    const messageId = row['id'] as string;

    await this.hooks.emit('message.stored', {
      messageId,
      direction: 'outbound',
      channel: opts.channel,
    });

    return messageId;
  }

  /**
   * Store an attachment linked to a message.
   */
  async storeAttachment(messageId: string, att: StoredAttachment): Promise<string> {
    const row = await this.db.insert('message_attachments', {
      message_id: messageId,
      file_type: att.fileType,
      filename: att.filename,
      mime_type: att.mimeType,
      size_bytes: att.sizeBytes,
      contents: att.contents,
      summary: att.summary,
      url: att.url,
    });
    return row['id'] as string;
  }

  /**
   * Get recent messages in a thread for context building.
   */
  async getThreadHistory(threadId: string, limit = 20): Promise<Array<Record<string, unknown>>> {
    const messages = await this.db.query('messages', {
      where: { thread_id: threadId },
      orderBy: 'created_at',
      limit,
    });
    return messages;
  }

  /**
   * Get recent outbound messages in a thread for redundancy checking.
   */
  async getRecentOutbound(threadId: string, limit = 10): Promise<Array<Record<string, unknown>>> {
    const messages = await this.db.query('messages', {
      where: { thread_id: threadId, direction: 'outbound' },
      orderBy: 'created_at',
      limit,
    });
    return messages;
  }

  /**
   * Get recent messages in a channel (all threads combined).
   * More reliable than getThreadHistory for DMs where thread_ids are inconsistent.
   */
  async getChannelHistory(channel: string, limit = 50): Promise<Array<Record<string, unknown>>> {
    return this.db.query('messages', {
      where: { channel },
      orderBy: 'created_at',
      limit,
    });
  }

  /**
   * Get recent messages from a specific user across all threads.
   */
  async getUserHistory(userId: string, channel: string, limit = 50): Promise<Array<Record<string, unknown>>> {
    return this.db.query('messages', {
      where: { from_user: userId, channel },
      orderBy: 'created_at',
      limit,
    });
  }

  /**
   * Get attachments for a message.
   */
  async getAttachments(messageId: string): Promise<Array<Record<string, unknown>>> {
    return this.db.query('message_attachments', {
      where: { message_id: messageId },
    });
  }
}
