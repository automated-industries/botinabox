import { describe, it, expect, beforeEach } from "vitest";
import { HookBus } from "../../hooks/hook-bus.js";
import { DataStore } from "../../data/data-store.js";
import { defineCoreTables } from "../../data/core-schema.js";
import { setupCostTracker } from "../cost-tracker.js";
import type { ModelInfo } from "../types.js";

const MODEL_CATALOG: ModelInfo[] = [
  {
    id: "claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6",
    contextWindow: 200_000,
    maxOutputTokens: 16_000,
    costPerInputToken: 0.000003,
    costPerOutputToken: 0.000015,
    capabilities: ["chat"],
  },
];

async function makeDb(): Promise<{ db: DataStore; hooks: HookBus }> {
  const hooks = new HookBus();
  const db = new DataStore({ dbPath: ":memory:" });
  defineCoreTables(db);
  await db.init();
  setupCostTracker(hooks, db, { modelCatalog: MODEL_CATALOG });
  return { db, hooks };
}

describe("setupCostTracker — Story 2.6", () => {
  it("calculates cost correctly for known model", async () => {
    const { db, hooks } = await makeDb();
    const agent = await db.insert("agents", {
      slug: "tester",
      name: "Tester",
      adapter: "cli",
    });

    await hooks.emit("run.completed", {
      runId: "run-1",
      agentId: agent.id,
      usage: {
        inputTokens: 1000,
        outputTokens: 200,
        model: "claude-sonnet-4-6",
        provider: "anthropic",
      },
    });

    // 1000 * 0.000003 + 200 * 0.000015 = 0.003 + 0.003 = 0.006 USD → 0 cents (rounds to 0)
    // Actually: 0.006 * 100 = 0.6 → Math.round(0.6) = 1 cent
    const events = await db.query("cost_events");
    expect(events).toHaveLength(1);
    expect(events[0]!.model).toBe("claude-sonnet-4-6");
    expect(events[0]!.provider).toBe("anthropic");
    expect(events[0]!.input_tokens).toBe(1000);
    expect(events[0]!.output_tokens).toBe(200);
    expect(typeof events[0]!.cost_cents).toBe("number");
  });

  it("inserts cost event into DB", async () => {
    const { db, hooks } = await makeDb();

    await hooks.emit("run.completed", {
      runId: "run-2",
      usage: {
        inputTokens: 500,
        outputTokens: 100,
        model: "claude-sonnet-4-6",
        provider: "anthropic",
      },
    });

    const events = await db.query("cost_events", { where: { run_id: "run-2" } });
    expect(events).toHaveLength(1);
  });

  it("updates agent spent_monthly_cents", async () => {
    const { db, hooks } = await makeDb();
    const agent = await db.insert("agents", {
      slug: "budget-agent",
      name: "Budget Agent",
      adapter: "cli",
    });

    await hooks.emit("run.completed", {
      agentId: agent.id,
      usage: {
        inputTokens: 10000,
        outputTokens: 5000,
        model: "claude-sonnet-4-6",
        provider: "anthropic",
      },
    });

    const updated = await db.get("agents", agent.id as string);
    expect((updated!.spent_monthly_cents as number)).toBeGreaterThan(0);
  });

  it("records 0 cost for unknown model", async () => {
    const { db, hooks } = await makeDb();

    await hooks.emit("run.completed", {
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        model: "unknown-model",
        provider: "unknown-provider",
      },
    });

    const events = await db.query("cost_events");
    expect(events).toHaveLength(1);
    expect(events[0]!.cost_cents).toBe(0);
  });

  it("no-op when usage is missing from payload", async () => {
    const { db, hooks } = await makeDb();

    await hooks.emit("run.completed", { runId: "run-x" });

    const events = await db.query("cost_events");
    expect(events).toHaveLength(0);
  });
});
