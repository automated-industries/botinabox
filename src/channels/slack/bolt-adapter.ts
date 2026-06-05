/**
 * SlackBoltAdapter — real Bolt Socket Mode integration for botinabox.
 *
 * Handles:
 * - Bolt app lifecycle (start, stop)
 * - Inbound message parsing + self-filtering
 * - response.ready → Slack message delivery
 * - file.deliver → Slack file upload
 *
 * Apps just instantiate and start:
 *   const slack = new SlackBoltAdapter({ botToken, appToken, hooks, pipeline });
 *   await slack.start();
 */

import type { HookBus } from '../../core/hooks/hook-bus.js';
import type { ChatPipeline } from '../../core/chat/chat-pipeline.js';
import { parseSlackEvent } from './inbound.js';
import { formatForSlack } from './outbound.js';
import { chunkText } from '../../core/chat/text-chunker.js';
import type { AttachmentEnricherMap } from './enrichers/types.js';
import { enrichAttachments } from './enrichers/enrich.js';

/**
 * Slack thread timestamps have the shape `XXXXXXXXXX.XXXXXX` — the original
 * message `ts` of the thread root. Upstream callers sometimes hand us a
 * channel id, a client_msg_id UUID, or a conversation identifier instead,
 * because internal pipeline logic conflates "thread id" with "conversation
 * id". Only forward values that actually parse as a Slack ts; otherwise
 * omit `thread_ts` so the reply posts at the top of the channel.
 */
const SLACK_TS_RE = /^\d+\.\d+$/;
function isValidSlackThreadTs(value: unknown): value is string {
  return typeof value === 'string' && SLACK_TS_RE.test(value);
}

// Minimal Bolt App interface — avoids @slack/bolt as compile-time dependency
interface BoltApp {
  event(name: string, handler: (args: { event: Record<string, unknown> }) => Promise<void>): void;
  client: {
    chat: { postMessage(params: Record<string, unknown>): Promise<unknown> };
    filesUploadV2(params: Record<string, unknown>): Promise<unknown>;
  };
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface SlackBoltAdapterConfig {
  botToken: string;
  appToken: string;
  hooks: HookBus;
  pipeline: ChatPipeline;
  /** Optional per-type attachment enrichers. */
  attachmentEnrichers?: AttachmentEnricherMap;
}

export class SlackBoltAdapter {
  private app: BoltApp | null = null;
  private config: SlackBoltAdapterConfig;

  constructor(config: SlackBoltAdapterConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    // Dynamic import — @slack/bolt is a peer/app dependency
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const boltModule = '@slack/bolt';
    const bolt = await (import(boltModule) as Promise<{
      App: new (config: Record<string, unknown>) => BoltApp;
    }>);
    const { enrichVoiceMessage } = await import('./inbound.js');

    const boltApp = new bolt.App({
      token: this.config.botToken,
      appToken: this.config.appToken,
      socketMode: true,
    });
    this.app = boltApp;
    const { hooks, pipeline, botToken } = this.config;

    // Inbound: Slack event → parse → HookBus
    boltApp.event('message', async ({ event }: { event: Record<string, unknown> }) => {
      if (event.bot_id || event.app_id) return;
      const subtype = event.subtype as string | undefined;

      // Mutation subtypes (edit + delete) get their own hook events so
      // downstream callers can mirror Slack-side changes without
      // running a second Bolt connection (which doesn't work — Socket
      // Mode delivers `message` events to exactly one socket per app
      // per event type, so a second-connection listener silently
      // misses every event).
      if (subtype === 'message_changed') {
        const message = event.message as { ts?: string; text?: string; user?: string } | undefined;
        const previousMessage = event.previous_message as { ts?: string; text?: string } | undefined;
        const ts = message?.ts ?? previousMessage?.ts;
        if (!ts) return;
        await hooks.emit('slack.message.changed', {
          channel: event.channel as string,
          ts,
          newBody: message?.text ?? '',
          previousBody: previousMessage?.text ?? '',
          editorUser: (message?.user as string | undefined) ?? null,
          raw: event,
        });
        return;
      }

      if (subtype === 'message_deleted') {
        const previousMessage = event.previous_message as { ts?: string; text?: string } | undefined;
        const ts = (event.deleted_ts as string | undefined) ?? previousMessage?.ts;
        if (!ts) return;
        await hooks.emit('slack.message.deleted', {
          channel: event.channel as string,
          ts,
          previousBody: previousMessage?.text ?? '',
          raw: event,
        });
        return;
      }

      if (subtype && subtype !== 'file_share') return;

      let inbound = parseSlackEvent(event as Parameters<typeof parseSlackEvent>[0]);
      inbound = { ...inbound, channel: 'slack', account: event.channel as string };
      if (!inbound.body) return;

      if (inbound.body.includes('[Voice message — no transcript available]')) {
        inbound = await enrichVoiceMessage(inbound, botToken);
      }

      if (inbound.attachments?.length && this.config.attachmentEnrichers) {
        inbound = await enrichAttachments(
          inbound,
          { slack: { botToken } },
          this.config.attachmentEnrichers,
        );
      }

      await hooks.emit('message.inbound', inbound as unknown as Record<string, unknown>);
    });

    // Outbound: response.ready → Slack message
    hooks.register('response.ready', async (ctx) => {
      const threadId = ctx.threadId as string;
      const text = ctx.text as string;
      const taskId = ctx.taskId as string | undefined;
      if (!text) return;

      const channelId = await pipeline.resolveChannel(threadId, taskId);
      if (!channelId) return;

      const formatted = formatForSlack(text);
      const chunks = chunkText(formatted, 3800);
      for (const chunk of chunks) {
        const res = await boltApp.client.chat.postMessage({
          token: botToken,
          channel: channelId,
          text: chunk,
          ...(isValidSlackThreadTs(threadId) ? { thread_ts: threadId } : {}),
        });
        // Expose the posted message's ts so downstream callers can later
        // resolve reactions/edits back to the message the bot sent — the
        // Socket Mode transport otherwise has no record of outbound ts.
        const ts = (res as { ts?: string })?.ts;
        if (ts) {
          await hooks.emit('slack.message.outbound', {
            channel: channelId,
            ts,
            threadTs: isValidSlackThreadTs(threadId) ? threadId : null,
            body: chunk,
          });
        }
      }
    }, { priority: 90 });

    // File delivery: file.deliver → Slack file upload
    hooks.register('file.deliver', async (ctx) => {
      const filePath = ctx.filePath as string;
      const fileName = ctx.fileName as string;
      const taskId = ctx.taskId as string;
      const threadId = ctx.threadId as string;

      const channelId = await pipeline.resolveChannel(threadId, taskId);
      if (!channelId || !filePath) return;

      try {
        const { createReadStream, existsSync } = await import('node:fs');
        const { basename } = await import('node:path');
        if (existsSync(filePath)) {
          await boltApp.client.filesUploadV2({
            token: botToken,
            channel_id: channelId,
            file: createReadStream(filePath),
            filename: basename(filePath),
            title: fileName ?? basename(filePath),
            ...(isValidSlackThreadTs(threadId) ? { thread_ts: threadId } : {}),
          });
        }
      } catch {
        // File upload failure is non-fatal
      }
    });

    await boltApp.start();
  }

  async stop(): Promise<void> {
    if (this.app) {
      await this.app.stop();
    }
  }
}
