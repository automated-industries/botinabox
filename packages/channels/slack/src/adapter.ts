/**
 * SlackAdapter — ChannelAdapter implementation for Slack.
 * Story 4.5
 */

import type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelMeta,
  ChannelConfig,
  InboundMessage,
  OutboundPayload,
  SendResult,
  HealthStatus,
} from "@botinabox/shared";
import type { SlackConfig } from "./models.js";
import { formatForSlack } from "./outbound.js";

/** Minimal Bolt-compatible client interface for mockability. */
export interface BoltClient {
  postMessage(channel: string, text: string, threadTs?: string): Promise<{ ok: boolean; ts?: string }>;
}

export class SlackAdapter implements ChannelAdapter {
  readonly id = "slack";

  readonly meta: ChannelMeta = {
    displayName: "Slack",
    icon: "https://slack.com/favicon.ico",
    homepage: "https://slack.com",
  };

  readonly capabilities: ChannelCapabilities = {
    chatTypes: ["direct", "group", "channel"],
    threads: true,
    reactions: true,
    editing: true,
    media: true,
    polls: false,
    maxTextLength: 40_000,
    formattingMode: "mrkdwn",
  };

  onMessage?: (message: InboundMessage) => Promise<void>;

  private connected = false;
  private config: SlackConfig | null = null;
  private client: BoltClient | null;

  constructor(client?: BoltClient) {
    this.client = client ?? null;
  }

  async connect(config: ChannelConfig): Promise<void> {
    this.config = config as unknown as SlackConfig;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.config = null;
  }

  async healthCheck(): Promise<HealthStatus> {
    return { ok: this.connected };
  }

  async send(
    target: { peerId: string; threadId?: string },
    payload: OutboundPayload,
  ): Promise<SendResult> {
    if (!this.connected) {
      return { success: false, error: "Not connected" };
    }

    const text = formatForSlack(payload.text);

    if (this.client) {
      try {
        const result = await this.client.postMessage(target.peerId, text, target.threadId);
        return { success: result.ok, messageId: result.ts };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    }

    // No-op when no client provided
    return { success: true };
  }

  /** Simulate receiving an inbound message (for testing/webhooks). */
  async receive(event: Record<string, unknown>): Promise<void> {
    if (this.onMessage) {
      const { parseSlackEvent } = await import("./inbound.js");
      const msg = parseSlackEvent(event as Parameters<typeof parseSlackEvent>[0]);
      await this.onMessage(msg);
    }
  }
}

/** Factory function — default export for auto-discovery. */
export default function createSlackAdapter(client?: BoltClient): SlackAdapter {
  return new SlackAdapter(client);
}
