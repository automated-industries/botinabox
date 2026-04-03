import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DataStore } from "../data-store.js";
import { defineCoreTables } from "../core-schema.js";

const SOFT_DELETE_TABLES = [
  "agents", "tasks", "skills", "workflows",
];

let db: DataStore;

beforeEach(async () => {
  db = new DataStore({ dbPath: ":memory:" });
  defineCoreTables(db);
  await db.init();
});

afterEach(() => {
  db.close();
});

describe("defineCoreTables — Story 1.6", () => {
  it("agents table has expected columns", () => {
    const cols = db.tableInfo("agents").map((c) => c.name);
    expect(cols).toContain("id");
    expect(cols).toContain("slug");
    expect(cols).toContain("name");
    expect(cols).toContain("status");
    expect(cols).toContain("adapter");
    expect(cols).toContain("budget_monthly_cents");
    expect(cols).toContain("deleted_at");
  });

  it("tasks table has expected columns", () => {
    const cols = db.tableInfo("tasks").map((c) => c.name);
    expect(cols).toContain("assignee_id");
    expect(cols).toContain("chain_origin_id");
    expect(cols).toContain("workflow_run_id");
    expect(cols).toContain("status");
    expect(cols).toContain("deleted_at");
  });

  it("all soft-delete tables have deleted_at column", () => {
    for (const table of SOFT_DELETE_TABLES) {
      const cols = db.tableInfo(table).map((c) => c.name);
      expect(cols, `${table} should have deleted_at`).toContain("deleted_at");
    }
  });

  it("agent_skills has composite primary key", async () => {
    await db.insert("agents", { id: "a1", slug: "test-agent", name: "Test", adapter: "cli" });
    await db.insert("skills", { id: "s1", slug: "skill-a", name: "Skill A" });
    await db.insert("skills", { id: "s2", slug: "skill-b", name: "Skill B" });
    await db.link("agent_skills", { agent_id: "a1", skill_id: "s1" });
    await db.link("agent_skills", { agent_id: "a1", skill_id: "s2" });
    // Duplicate should be ignored (INSERT OR IGNORE via link)
    await db.link("agent_skills", { agent_id: "a1", skill_id: "s1" });
    // Verify only 2 rows exist
    const rows = await db.query("agent_skills");
    expect(rows).toHaveLength(2);
  });

  it("CRUD operations work on core tables (agents)", async () => {
    const row = await db.insert("agents", {
      slug: "my-agent",
      name: "My Agent",
      adapter: "cli",
    });
    expect(row.slug).toBe("my-agent");
    const fetched = await db.get("agents", row.id as string);
    expect(fetched?.name).toBe("My Agent");
  });

  it("core tables accept inserts (runs, cost_events, notifications)", async () => {
    const agent = await db.insert("agents", { slug: "a", name: "A", adapter: "cli" });
    const task = await db.insert("tasks", { title: "T", assignee_id: agent.id });
    const run = await db.insert("runs", { task_id: task.id, agent_id: agent.id });
    expect(run.id).toBeDefined();

    const cost = await db.insert("cost_events", {
      model: "claude-opus-4-6", provider: "anthropic", cost_cents: 5,
    });
    expect(cost.id).toBeDefined();

    const notif = await db.insert("notifications", {
      channel: "slack", recipient_id: "U1", message: "hello",
    });
    expect(notif.id).toBeDefined();
  });
});
