import { describe, it, expect, vi } from "vitest";
import { HookBus } from "../hook-bus.js";

describe("HookBus — Story 1.1", () => {
  it("emit with no listeners is a no-op", async () => {
    const bus = new HookBus();
    await expect(bus.emit("no.listeners", {})).resolves.toBeUndefined();
  });

  it("single handler fires with context", async () => {
    const bus = new HookBus();
    const handler = vi.fn();
    bus.register("test.event", handler);
    await bus.emit("test.event", { foo: "bar" });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ foo: "bar" });
  });

  it("priority ordering — lower priority fires first", async () => {
    const bus = new HookBus();
    const order: number[] = [];
    bus.register("order.test", () => { order.push(90); }, { priority: 90 });
    bus.register("order.test", () => { order.push(10); }, { priority: 10 });
    bus.register("order.test", () => { order.push(50); }, { priority: 50 });
    await bus.emit("order.test", {});
    expect(order).toEqual([10, 50, 90]);
  });

  it("same priority — insertion order as tiebreaker", async () => {
    const bus = new HookBus();
    const order: string[] = [];
    bus.register("same.priority", () => { order.push("first"); }, { priority: 50 });
    bus.register("same.priority", () => { order.push("second"); }, { priority: 50 });
    await bus.emit("same.priority", {});
    expect(order).toEqual(["first", "second"]);
  });

  it("once handler auto-removes after first invocation", async () => {
    const bus = new HookBus();
    const handler = vi.fn();
    bus.register("once.test", handler, { once: true });
    await bus.emit("once.test", {});
    await bus.emit("once.test", {});
    expect(handler).toHaveBeenCalledOnce();
  });

  it("filter matching — handler only fires when context matches", async () => {
    const bus = new HookBus();
    const handler = vi.fn();
    bus.register("filtered", handler, { filter: { channel: "slack" } });
    await bus.emit("filtered", { channel: "discord" });
    expect(handler).not.toHaveBeenCalled();
    await bus.emit("filtered", { channel: "slack", extra: "data" });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("filter — handler skipped when no match", async () => {
    const bus = new HookBus();
    const handler = vi.fn();
    bus.register("filtered2", handler, { filter: { status: "done", priority: 1 } });
    await bus.emit("filtered2", { status: "done" }); // missing priority
    expect(handler).not.toHaveBeenCalled();
  });

  it("handler error isolation — second handler still runs", async () => {
    const bus = new HookBus();
    const second = vi.fn();
    bus.register("error.test", () => { throw new Error("boom"); }, { priority: 10 });
    bus.register("error.test", second, { priority: 20 });
    await expect(bus.emit("error.test", {})).resolves.toBeUndefined();
    expect(second).toHaveBeenCalledOnce();
  });

  it("unsubscribe — returned function removes handler", async () => {
    const bus = new HookBus();
    const handler = vi.fn();
    const unsub = bus.register("unsub.test", handler);
    await bus.emit("unsub.test", {});
    unsub();
    await bus.emit("unsub.test", {});
    expect(handler).toHaveBeenCalledOnce();
  });

  it("hasListeners returns correct state", () => {
    const bus = new HookBus();
    expect(bus.hasListeners("x")).toBe(false);
    const unsub = bus.register("x", vi.fn());
    expect(bus.hasListeners("x")).toBe(true);
    unsub();
    expect(bus.hasListeners("x")).toBe(false);
  });

  it("listRegistered returns events with active handlers", () => {
    const bus = new HookBus();
    bus.register("a", vi.fn());
    bus.register("b", vi.fn());
    expect(bus.listRegistered().sort()).toEqual(["a", "b"]);
  });

  it("async handlers awaited in order", async () => {
    const bus = new HookBus();
    const order: number[] = [];
    bus.register("async.test", async () => {
      await new Promise(r => setTimeout(r, 10));
      order.push(1);
    }, { priority: 10 });
    bus.register("async.test", async () => {
      order.push(2);
    }, { priority: 20 });
    await bus.emit("async.test", {});
    expect(order).toEqual([1, 2]);
  });

  it("clear removes all handlers for an event", async () => {
    const bus = new HookBus();
    const handler = vi.fn();
    bus.register("clear.test", handler);
    bus.clear("clear.test");
    await bus.emit("clear.test", {});
    expect(handler).not.toHaveBeenCalled();
  });
});
