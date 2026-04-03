/**
 * WebhookAdapter — ChannelAdapter implementation for webhook-based channels.
 * Story 4.7
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
} from "../../shared/index.js";
import type { WebhookConfig } from "./models.js";
import { WebhookServer } from "./server.js";

export class WebhookAdapter implements ChannelAdapter {
  readonly id = "webhook";

  readonly meta: ChannelMeta = {
    displayName: "Webhook",
    homepage: "https://example.com",
  };

  readonly capabilities: ChannelCapabilities = {
    chatTypes: ["direct"],
    threads: false,
    reactions: false,
    editing: false,
    media: false,
    polls: false,
    maxTextLength: 65535,
    formattingMode: "plain",
  };

  onMessage?: (message: InboundMessage) => Promise<void>;

  private connected = false;
  private config: WebhookConfig | null = null;
  private webhookServer: WebhookServer | null = null;

  async connect(config: ChannelConfig): Promise<void> {
    this.config = config as unknown as WebhookConfig;
    this.connected = true;

    // Start webhook HTTP server if port is specified
    if (this.config.port) {
      this.webhookServer = new WebhookServer({
        port: this.config.port,
        secret: this.config.secret,
        onMessage: async (msg) => {
          if (this.onMessage) await this.onMessage(msg);
        },
      });
      await this.webhookServer.start();
    }
  }

  async disconnect(): Promise<void> {
    if (this.webhookServer) {
      await this.webhookServer.stop();
      this.webhookServer = null;
    }
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

    const callbackUrl = this.config?.callbackUrl;
    if (!callbackUrl) {
      // No callback URL configured — accept silently (fire-and-forget style)
      return { success: true };
    }

    try {
      const body = JSON.stringify({
        to: target.peerId,
        threadId: target.threadId,
        text: payload.text,
      });

      const response = await fetch(callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      if (response.ok) {
        return { success: true };
      }
      return { success: false, error: `HTTP ${response.status}` };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
}

/** Factory function — default export for auto-discovery. */
export default function createWebhookAdapter(): WebhookAdapter {
  return new WebhookAdapter();
}
