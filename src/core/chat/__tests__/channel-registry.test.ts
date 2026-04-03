import { describe, it, expect, beforeEach, vi } from "vitest";
import { ChannelRegistry, ChannelRegistryError } from "../channel-registry.js";
import type { ChannelAdapter, ChannelCapabilities, ChannelMeta, OutboundPayload, SendResult, HealthStatus, ChannelConfig } from "../types.js";

function makeAdapter(id: string): ChannelAdapter & {
  connectCalls: ChannelConfig[];
  disconnectCalls: number;
  sendCalls: { target: { peerId: string; threadId?: string }; payload: OutboundPayload }[];
} {
  const connectCalls: ChannelConfig[] = [];
  const sendCalls: { target: { peerId: string; threadId?: string }; payload: OutboundPayload }[] = [];
  let disconnectCalls = 0;

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
    get connectCalls() { return connectCalls; },
    get disconnectCalls() { return disconnectCalls; },
    get sendCalls() { return sendCalls; },
    async connect(config) { connectCalls.push(config); },
    async disconnect() { disconnectCalls++; },
    async healthCheck(): Promise<HealthStatus> { return { ok: true }; },
    async send(target, payload): Promise<SendResult> {
      sendCalls.push({ target, payload });
      return { success: true, messageId: "msg-1" };
    },
  };
}

describe("ChannelRegistry — Story 4.1", () => {
  let registry: ChannelRegistry;

  beforeEach(() => {
    registry = new ChannelRegistry();
  });

  it("register + start calls connect on adapter", async () => {
    const adapter = makeAdapter("test");
    registry.register(adapter, { token: "abc" });
    await registry.start();
    expect(adapter.connectCalls).toHaveLength(1);
    expect(adapter.connectCalls[0]).toEqual({ token: "abc" });
  });

  it("get returns the registered adapter", () => {
    const adapter = makeAdapter("test");
    registry.register(adapter);
    expect(registry.get("test")).toBe(adapter);
  });

  it("list returns all registered adapters", () => {
    const a = makeAdapter("a");
    const b = makeAdapter("b");
    registry.register(a);
    registry.register(b);
    expect(registry.list()).toHaveLength(2);
  });

  it("duplicate registration throws ChannelRegistryError", () => {
    const adapter = makeAdapter("dup");
    registry.register(adapter);
    expect(() => registry.register(adapter)).toThrow(ChannelRegistryError);
    expect(() => registry.register(makeAdapter("dup"))).toThrow(ChannelRegistryError);
  });

  it("unregister calls disconnect and removes from map", async () => {
    const adapter = makeAdapter("test");
    registry.register(adapter);
    await registry.unregister("test");
    expect(adapter.disconnectCalls).toBe(1);
    expect(registry.get("test")).toBeUndefined();
  });

  it("reconfigure calls disconnect then connect with new config", async () => {
    const adapter = makeAdapter("test");
    registry.register(adapter, { token: "old" });
    await registry.start();
    await registry.reconfigure("test", { token: "new" });
    expect(adapter.disconnectCalls).toBe(1);
    // connect called twice: once on start, once on reconfigure
    expect(adapter.connectCalls).toHaveLength(2);
    expect(adapter.connectCalls[1]).toEqual({ token: "new" });
  });

  it("reconfigure throws for unknown adapter", async () => {
    await expect(registry.reconfigure("nonexistent", {})).rejects.toThrow(ChannelRegistryError);
  });

  it("healthCheck aggregates results from all adapters", async () => {
    const a = makeAdapter("a");
    const b = makeAdapter("b");
    registry.register(a);
    registry.register(b);
    const results = await registry.healthCheck();
    expect(results["a"]).toEqual({ ok: true });
    expect(results["b"]).toEqual({ ok: true });
  });

  it("stop disconnects all adapters", async () => {
    const a = makeAdapter("a");
    const b = makeAdapter("b");
    registry.register(a);
    registry.register(b);
    await registry.start();
    await registry.stop();
    expect(a.disconnectCalls).toBe(1);
    expect(b.disconnectCalls).toBe(1);
  });

  it("register after start immediately connects the adapter", async () => {
    await registry.start();
    const adapter = makeAdapter("late");
    registry.register(adapter, { token: "x" });
    // Give the microtask a tick
    await new Promise((r) => setTimeout(r, 10));
    expect(adapter.connectCalls).toHaveLength(1);
  });

  it("inline adapter works correctly", async () => {
    const adapter = makeAdapter("inline");
    registry.register(adapter);
    await registry.start();
    const result = await adapter.send({ peerId: "user-1" }, { text: "hello" });
    expect(result.success).toBe(true);
    expect(adapter.sendCalls).toHaveLength(1);
    expect(adapter.sendCalls[0].payload.text).toBe("hello");
  });
});
