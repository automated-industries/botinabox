import { describe, it, expect, vi } from "vitest";
import { SlackAdapter } from "../adapter.js";
import type { BoltClient } from "../adapter.js";

function makeMockClient(): BoltClient & { calls: { channel: string; text: string; threadTs?: string }[] } {
  const calls: { channel: string; text: string; threadTs?: string }[] = [];
  return {
    calls,
    async postMessage(channel, text, threadTs) {
      calls.push({ channel, text, threadTs });
      return { ok: true, ts: "1234567890.000001" };
    },
  };
}

describe("SlackAdapter — Story 4.5", () => {
  it("connect sets connected state", async () => {
    const adapter = new SlackAdapter();
    await adapter.connect({ botToken: "xoxb-test" });
    const health = await adapter.healthCheck();
    expect(health.ok).toBe(true);
  });

  it("disconnect clears connected state", async () => {
    const adapter = new SlackAdapter();
    await adapter.connect({ botToken: "xoxb-test" });
    await adapter.disconnect();
    const health = await adapter.healthCheck();
    expect(health.ok).toBe(false);
  });

  it("send returns success: false when not connected", async () => {
    const adapter = new SlackAdapter();
    const result = await adapter.send({ peerId: "C123" }, { text: "hello" });
    expect(result.success).toBe(false);
  });

  it("send uses mock client when provided", async () => {
    const client = makeMockClient();
    const adapter = new SlackAdapter(client);
    await adapter.connect({ botToken: "xoxb-test" });

    const result = await adapter.send({ peerId: "C123" }, { text: "hello" });
    expect(result.success).toBe(true);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].channel).toBe("C123");
    expect(client.calls[0].text).toBe("hello");
  });

  it("send converts **bold** to *bold* in mrkdwn", async () => {
    const client = makeMockClient();
    const adapter = new SlackAdapter(client);
    await adapter.connect({ botToken: "xoxb-test" });

    await adapter.send({ peerId: "C123" }, { text: "**bold text**" });
    expect(client.calls[0].text).toBe("*bold text*");
  });

  it("send passes threadId as threadTs", async () => {
    const client = makeMockClient();
    const adapter = new SlackAdapter(client);
    await adapter.connect({ botToken: "xoxb-test" });

    await adapter.send({ peerId: "C123", threadId: "1234.0001" }, { text: "reply" });
    expect(client.calls[0].threadTs).toBe("1234.0001");
  });

  it("healthCheck returns ok: false before connecting", async () => {
    const adapter = new SlackAdapter();
    const health = await adapter.healthCheck();
    expect(health.ok).toBe(false);
  });

  it("id is 'slack'", () => {
    const adapter = new SlackAdapter();
    expect(adapter.id).toBe("slack");
  });
});

describe("parseSlackEvent — Story 4.5", () => {
  it("parses a basic message event", async () => {
    const { parseSlackEvent } = await import("../inbound.js");
    const event = {
      type: "message",
      client_msg_id: "abc-123",
      ts: "1617000000.000001",
      channel: "C123",
      user: "U456",
      text: "Hello world",
    };
    const msg = parseSlackEvent(event);
    expect(msg.id).toBe("abc-123");
    expect(msg.channel).toBe("C123");
    expect(msg.from).toBe("U456");
    expect(msg.body).toBe("Hello world");
    expect(msg.threadId).toBeUndefined();
  });

  it("parses thread_ts when present", async () => {
    const { parseSlackEvent } = await import("../inbound.js");
    const event = {
      type: "message",
      ts: "1617000001.000001",
      channel: "C123",
      user: "U456",
      text: "In a thread",
      thread_ts: "1617000000.000001",
    };
    const msg = parseSlackEvent(event);
    expect(msg.threadId).toBe("1617000000.000001");
  });

  it("falls back to ts as id when no client_msg_id", async () => {
    const { parseSlackEvent } = await import("../inbound.js");
    const event = {
      type: "message",
      ts: "1617000000.000001",
      channel: "C123",
      user: "U456",
      text: "Hi",
    };
    const msg = parseSlackEvent(event);
    expect(msg.id).toBe("1617000000.000001");
  });
});

describe("formatForSlack — Story 4.5", () => {
  it("converts **bold** to *bold*", async () => {
    const { formatForSlack } = await import("../outbound.js");
    expect(formatForSlack("**hello**")).toBe("*hello*");
  });

  it("converts __bold__ to *bold*", async () => {
    const { formatForSlack } = await import("../outbound.js");
    expect(formatForSlack("__hello__")).toBe("*hello*");
  });

  it("leaves _italic_ unchanged", async () => {
    const { formatForSlack } = await import("../outbound.js");
    expect(formatForSlack("_italic_")).toBe("_italic_");
  });

  it("leaves `code` unchanged", async () => {
    const { formatForSlack } = await import("../outbound.js");
    expect(formatForSlack("`code`")).toBe("`code`");
  });
});
