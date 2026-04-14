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
        await boltApp.client.chat.postMessage({
          token: botToken,
          channel: channelId,
          text: chunk,
          ...(threadId ? { thread_ts: threadId } : {}),
        });
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
            ...(threadId ? { thread_ts: threadId } : {}),
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
