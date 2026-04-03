import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DataStore } from "../../data/data-store.js";
import { defineCoreTables } from "../../data/core-schema.js";
import { HookBus } from "../../hooks/hook-bus.js";
import { ChannelRegistry } from "../channel-registry.js";
import { NotificationQueue } from "../notification-queue.js";
import type { ChannelAdapter, ChannelCapabilities, ChannelMeta, OutboundPayload, SendResult, HealthStatus } from "../types.js";

function makeSendAdapter(id: string, fail = false): ChannelAdapter {
  const meta: ChannelMeta = { displayName: `Adapter ${id}` };
  const capabilities: ChannelCapabilities = {
    chatTypes: ["direct"],
    threads: false,
    reactions: false,
    editing: false,
    media: false,
    polls: false,
    maxTextLength: 4000,
    formattingMode: "plain",
  };

  return {
    id,
    meta,
    capabilities,
    async connect() {},
    async disconnect() {},
    async healthCheck(): Promise<HealthStatus> { return { ok: true }; },
    async send(_target, _payload): Promise<SendResult> {
      if (fail) throw new Error("send failed");
      return { success: true, messageId: "msg-1" };
    },
  };
}

let db: DataStore;
let hooks: HookBus;
let channelRegistry: ChannelRegistry;

beforeEach(() => {
  db = new DataStore({ dbPath: ":memory:" });
  defineCoreTables(db);
  db.init();
  hooks = new HookBus();
  channelRegistry = new ChannelRegistry();
});

afterEach(() => {
  db.close();
});

describe("NotificationQueue — Story 4.4", () => {
  it("enqueue inserts a notification with status=pending", async () => {
    const queue = new NotificationQueue(db, hooks, channelRegistry);
    const id = await queue.enqueue("slack", "user-1", { text: "hello" });

    const rows = db.query("notifications");
    expect(rows).toHaveLength(1);
    expect(rows[0]["id"]).toBe(id);
    expect(rows[0]["status"]).toBe("pending");
    expect(rows[0]["channel"]).toBe("slack");
    expect(rows[0]["recipient_id"]).toBe("user-1");
  });

  it("enqueue emits notification.enqueued hook", async () => {
    const queue = new NotificationQueue(db, hooks, channelRegistry);
    let emittedId: string | undefined;
    hooks.register("notification.enqueued", async (ctx) => {
      emittedId = ctx["notificationId"] as string;
    });

    const id = await queue.enqueue("slack", "user-1", { text: "hello" });
    expect(emittedId).toBe(id);
  });

  it("worker sends pending notifications via adapter", async () => {
    const adapter = makeSendAdapter("slack");
    channelRegistry.register(adapter);

    const queue = new NotificationQueue(db, hooks, channelRegistry, { pollIntervalMs: 50 });
    await queue.enqueue("slack", "user-1", { text: "hello" });

    queue.startWorker();
    await new Promise((r) => setTimeout(r, 150));
    queue.stopWorker();

    const rows = db.query("notifications");
    expect(rows[0]["status"]).toBe("sent");
  });

  it("worker marks notification failed after maxRetries", async () => {
    const failingAdapter = makeSendAdapter("slack", true);
    channelRegistry.register(failingAdapter);

    const queue = new NotificationQueue(db, hooks, channelRegistry, {
      pollIntervalMs: 50,
      maxRetries: 2,
    });
    await queue.enqueue("slack", "user-1", { text: "fail me" });

    // Run processNext manually 3 times
    // Access private method via cast
    const q = queue as unknown as { processNext(): Promise<void> };
    await q.processNext();
    await q.processNext();
    await q.processNext();

    const rows = db.query("notifications");
    expect(rows[0]["status"]).toBe("failed");
    expect(rows[0]["retries"]).toBeGreaterThanOrEqual(2);
  });

  it("worker increments retries on failure before giving up", async () => {
    const failingAdapter = makeSendAdapter("slack", true);
    channelRegistry.register(failingAdapter);

    const queue = new NotificationQueue(db, hooks, channelRegistry, {
      pollIntervalMs: 50,
      maxRetries: 3,
    });
    await queue.enqueue("slack", "user-1", { text: "fail me" });

    const q = queue as unknown as { processNext(): Promise<void> };
    await q.processNext();

    const rows = db.query("notifications");
    expect(rows[0]["status"]).toBe("pending"); // still pending, not yet at maxRetries
    expect(Number(rows[0]["retries"])).toBe(1);
  });

  it("worker marks notification failed with no adapter for channel", async () => {
    const queue = new NotificationQueue(db, hooks, channelRegistry, { pollIntervalMs: 50 });
    await queue.enqueue("missing-channel", "user-1", { text: "hello" });

    const q = queue as unknown as { processNext(): Promise<void> };
    await q.processNext();

    const rows = db.query("notifications");
    expect(rows[0]["status"]).toBe("failed");
  });
});

describe("chunkText — Story 4.4", () => {
  it("short text returns single chunk", async () => {
    const { chunkText } = await import("../text-chunker.js");
    expect(chunkText("hello", 100)).toEqual(["hello"]);
  });

  it("splits at paragraph boundary", async () => {
    const { chunkText } = await import("../text-chunker.js");
    const text = "Para one.\n\nPara two.";
    const chunks = chunkText(text, 12);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.some((c) => c.includes("Para one"))).toBe(true);
  });

  it("splits at sentence boundary when no paragraph", async () => {
    const { chunkText } = await import("../text-chunker.js");
    const text = "First sentence. Second sentence.";
    const chunks = chunkText(text, 20);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("hard-cuts when no word boundary", async () => {
    const { chunkText } = await import("../text-chunker.js");
    const text = "abcdefghij";
    const chunks = chunkText(text, 4);
    expect(chunks).toEqual(["abcd", "efgh", "ij"]);
  });
});

describe("formatText — Story 4.4", () => {
  it("mrkdwn: converts **bold** to *bold*", async () => {
    const { formatText } = await import("../formatter.js");
    expect(formatText("**hello**", "mrkdwn")).toBe("*hello*");
  });

  it("html: converts **bold** to <strong>bold</strong>", async () => {
    const { formatText } = await import("../formatter.js");
    expect(formatText("**hello**", "html")).toBe("<strong>hello</strong>");
  });

  it("html: converts `code` to <code>code</code>", async () => {
    const { formatText } = await import("../formatter.js");
    expect(formatText("`hello`", "html")).toBe("<code>hello</code>");
  });

  it("plain: strips **bold** markers", async () => {
    const { formatText } = await import("../formatter.js");
    expect(formatText("**hello**", "plain")).toBe("hello");
  });

  it("plain: strips _italic_ markers", async () => {
    const { formatText } = await import("../formatter.js");
    expect(formatText("_hello_", "plain")).toBe("hello");
  });
});
