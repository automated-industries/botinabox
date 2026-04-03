import { describe, it, expect } from "vitest";
import { DiscordAdapter } from "../adapter.js";
import type { DiscordClient } from "../adapter.js";

function makeMockClient(): DiscordClient & { calls: { channelId: string; content: string }[] } {
  const calls: { channelId: string; content: string }[] = [];
  return {
    calls,
    async sendMessage(channelId, content) {
      calls.push({ channelId, content });
      return { id: "message-id-1" };
    },
  };
}

describe("DiscordAdapter — Story 4.6", () => {
  it("connect sets connected state", async () => {
    const adapter = new DiscordAdapter();
    await adapter.connect({ token: "Bot TOKEN" });
    const health = await adapter.healthCheck();
    expect(health.ok).toBe(true);
  });

  it("disconnect clears connected state", async () => {
    const adapter = new DiscordAdapter();
    await adapter.connect({ token: "Bot TOKEN" });
    await adapter.disconnect();
    const health = await adapter.healthCheck();
    expect(health.ok).toBe(false);
  });

  it("send returns success: false when not connected", async () => {
    const adapter = new DiscordAdapter();
    const result = await adapter.send({ peerId: "channel-id" }, { text: "hello" });
    expect(result.success).toBe(false);
  });

  it("send uses mock client when provided", async () => {
    const client = makeMockClient();
    const adapter = new DiscordAdapter(client);
    await adapter.connect({ token: "Bot TOKEN" });

    const result = await adapter.send({ peerId: "channel-id" }, { text: "hello" });
    expect(result.success).toBe(true);
    expect(result.messageId).toBe("message-id-1");
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].channelId).toBe("channel-id");
    expect(client.calls[0].content).toBe("hello");
  });

  it("id is 'discord'", () => {
    const adapter = new DiscordAdapter();
    expect(adapter.id).toBe("discord");
  });

  it("healthCheck returns ok: false before connecting", async () => {
    const adapter = new DiscordAdapter();
    const health = await adapter.healthCheck();
    expect(health.ok).toBe(false);
  });
});

describe("parseDiscordEvent — Story 4.6", () => {
  it("parses a basic message event", async () => {
    const { parseDiscordEvent } = await import("../inbound.js");
    const event = {
      id: "123456789",
      channel_id: "987654321",
      author: { id: "user-id-1", username: "testuser" },
      content: "Hello Discord!",
      timestamp: "2024-01-01T12:00:00.000Z",
    };
    const msg = parseDiscordEvent(event);
    expect(msg.id).toBe("123456789");
    expect(msg.channel).toBe("987654321");
    expect(msg.from).toBe("user-id-1");
    expect(msg.body).toBe("Hello Discord!");
    expect(msg.replyToId).toBeUndefined();
  });

  it("parses reply reference when present", async () => {
    const { parseDiscordEvent } = await import("../inbound.js");
    const event = {
      id: "123456789",
      channel_id: "987654321",
      author: { id: "user-id-1" },
      content: "Replying!",
      message_reference: { message_id: "original-msg-id" },
      timestamp: "2024-01-01T12:00:00.000Z",
    };
    const msg = parseDiscordEvent(event);
    expect(msg.replyToId).toBe("original-msg-id");
  });
});

describe("chunkForDiscord — Story 4.6", () => {
  it("short text returns single chunk", async () => {
    const { chunkForDiscord } = await import("../outbound.js");
    expect(chunkForDiscord("hello")).toEqual(["hello"]);
  });

  it("splits at word boundary for long text", async () => {
    const { chunkForDiscord } = await import("../outbound.js");
    const word = "a".repeat(10);
    const text = Array.from({ length: 250 }, () => word).join(" "); // ~2499 chars
    const chunks = chunkForDiscord(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });
});
