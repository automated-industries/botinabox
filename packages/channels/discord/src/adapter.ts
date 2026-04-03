/**
 * DiscordAdapter — ChannelAdapter implementation for Discord.
 * Story 4.6
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
import type { DiscordConfig } from "./models.js";
import { formatForDiscord } from "./outbound.js";

/** Minimal Discord client interface for mockability. */
export interface DiscordClient {
  sendMessage(channelId: string, content: string): Promise<{ id: string }>;
}

export class DiscordAdapter implements ChannelAdapter {
  readonly id = "discord";

  readonly meta: ChannelMeta = {
    displayName: "Discord",
    icon: "https://discord.com/favicon.ico",
    homepage: "https://discord.com",
  };

  readonly capabilities: ChannelCapabilities = {
    chatTypes: ["direct", "group", "channel"],
    threads: true,
    reactions: true,
    editing: true,
    media: true,
    polls: false,
    maxTextLength: 2000,
    formattingMode: "markdown",
  };

  onMessage?: (message: InboundMessage) => Promise<void>;

  private connected = false;
  private config: DiscordConfig | null = null;
  private client: DiscordClient | null;

  constructor(client?: DiscordClient) {
    this.client = client ?? null;
  }

  async connect(config: ChannelConfig): Promise<void> {
    this.config = config as unknown as DiscordConfig;
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

    const text = formatForDiscord(payload.text);

    if (this.client) {
      try {
        const result = await this.client.sendMessage(target.peerId, text);
        return { success: true, messageId: result.id };
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
      const { parseDiscordEvent } = await import("./inbound.js");
      const msg = parseDiscordEvent(event as Parameters<typeof parseDiscordEvent>[0]);
      await this.onMessage(msg);
    }
  }
}

/** Factory function — default export for auto-discovery. */
export default function createDiscordAdapter(client?: DiscordClient): DiscordAdapter {
  return new DiscordAdapter(client);
}
