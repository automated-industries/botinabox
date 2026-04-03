import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DataStore } from "../../data/data-store.js";
import { defineCoreTables } from "../../data/core-schema.js";
import { HookBus } from "../../hooks/hook-bus.js";
import { AgentRegistry } from "../../orchestrator/agent-registry.js";
import { TaskQueue } from "../../orchestrator/task-queue.js";
import { MessagePipeline } from "../pipeline.js";
import type { BotConfig } from "../../../shared/index.js";
import type { InboundMessage } from "../types.js";

let db: DataStore;
let hooks: HookBus;
let agentRegistry: AgentRegistry;
let taskQueue: TaskQueue;

function makeMsg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: "msg-1",
    channel: "slack",
    from: "user-1",
    body: "hello world",
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeConfig(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    data: { path: ":memory:", walMode: false },
    channels: {},
    agents: [{ slug: "agent-1", name: "Agent One", adapter: "cli" }],
    providers: {},
    models: {
      aliases: {},
      default: "smart",
      routing: {},
      fallbackChain: [],
    },
    entities: {},
    security: {},
    render: { outputDir: "./context", watchIntervalMs: 30_000 },
    updates: { policy: "manual", checkIntervalMs: 86_400_000 },
    budget: { warnPercent: 80 },
    ...overrides,
  };
}

beforeEach(async () => {
  db = new DataStore({ dbPath: ":memory:" });
  defineCoreTables(db);
  await db.init();
  hooks = new HookBus();
  agentRegistry = new AgentRegistry(db, hooks);
  taskQueue = new TaskQueue(db, hooks);
});

afterEach(() => {
  db.close();
});

describe("MessagePipeline — Story 4.2", () => {
  it("processInbound creates a task", async () => {
    const config = makeConfig();
    const pipeline = new MessagePipeline(hooks, agentRegistry, taskQueue, config);

    await pipeline.processInbound(makeMsg());

    const tasks = await db.query("tasks");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]["assignee_id"]).toBe("agent-1");
  });

  it("processInbound emits message.inbound and message.processed hooks", async () => {
    const config = makeConfig();
    const pipeline = new MessagePipeline(hooks, agentRegistry, taskQueue, config);

    const emitted: string[] = [];
    hooks.register("message.inbound", async () => { emitted.push("inbound"); });
    hooks.register("message.processed", async () => { emitted.push("processed"); });

    await pipeline.processInbound(makeMsg());
    expect(emitted).toContain("inbound");
    expect(emitted).toContain("processed");
  });

  it("resolveAgent returns bound agent when channel matches", () => {
    const config = makeConfig({
      agents: [
        { slug: "slack-agent", name: "Slack Agent", adapter: "cli", config: { channel: "slack" } },
        { slug: "other-agent", name: "Other Agent", adapter: "cli" },
      ],
    });
    const pipeline = new MessagePipeline(hooks, agentRegistry, taskQueue, config);
    expect(pipeline.resolveAgent(makeMsg({ channel: "slack" }))).toBe("slack-agent");
  });

  it("resolveAgent falls back to first agent when no binding", () => {
    const config = makeConfig({
      agents: [{ slug: "default-agent", name: "Default", adapter: "cli" }],
    });
    const pipeline = new MessagePipeline(hooks, agentRegistry, taskQueue, config);
    expect(pipeline.resolveAgent(makeMsg({ channel: "unknown" }))).toBe("default-agent");
  });

  it("resolveAgent returns undefined when no agents configured", () => {
    const config = makeConfig({ agents: [] });
    const pipeline = new MessagePipeline(hooks, agentRegistry, taskQueue, config);
    expect(pipeline.resolveAgent(makeMsg())).toBeUndefined();
  });

  it("allowlist blocks messages from unlisted senders", async () => {
    const config = makeConfig({
      channels: {
        slack: { enabled: true, allowFrom: ["allowed-user"] },
      },
    });
    const pipeline = new MessagePipeline(hooks, agentRegistry, taskQueue, config);

    await pipeline.processInbound(makeMsg({ channel: "slack", from: "blocked-user" }));
    const tasks = await db.query("tasks");
    expect(tasks).toHaveLength(0);
  });

  it("allowlist passes messages from listed senders", async () => {
    const config = makeConfig({
      channels: {
        slack: { enabled: true, allowFrom: ["allowed-user"] },
      },
    });
    const pipeline = new MessagePipeline(hooks, agentRegistry, taskQueue, config);

    await pipeline.processInbound(makeMsg({ channel: "slack", from: "allowed-user" }));
    const tasks = await db.query("tasks");
    expect(tasks).toHaveLength(1);
  });

  it("mention gate in groups: blocks message without mention", async () => {
    const config = makeConfig({
      channels: {
        slack: { enabled: true, requireMention: true },
      },
      agents: [{ slug: "agent-1", name: "Agent One", adapter: "cli" }],
    });
    const pipeline = new MessagePipeline(hooks, agentRegistry, taskQueue, config);

    await pipeline.processInbound(makeMsg({ channel: "slack", body: "hello" }));
    const tasks = await db.query("tasks");
    expect(tasks).toHaveLength(0);
  });

  it("mention gate: passes message with mention", async () => {
    const config = makeConfig({
      channels: {
        slack: { enabled: true, requireMention: true },
      },
      agents: [{ slug: "agent-1", name: "Agent One", adapter: "cli" }],
    });
    const pipeline = new MessagePipeline(hooks, agentRegistry, taskQueue, config);

    await pipeline.processInbound(makeMsg({ channel: "slack", body: "@agent-1 hello" }));
    const tasks = await db.query("tasks");
    expect(tasks).toHaveLength(1);
  });

  it("evaluatePolicy returns true with empty channel config", () => {
    const config = makeConfig();
    const pipeline = new MessagePipeline(hooks, agentRegistry, taskQueue, config);
    expect(pipeline.evaluatePolicy(makeMsg(), "agent-1")).toBe(true);
  });
});
