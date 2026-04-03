import { describe, it, expect, beforeEach } from "vitest";
import { DataStore } from "../data-store.js";
import { defineCoreTables } from "../core-schema.js";

const ALL_15_TABLES = [
  "agents", "tasks", "runs", "wakeups", "sessions",
  "skills", "agent_skills", "cost_events", "budget_policies",
  "activity_log", "notifications", "config_revisions",
  "workflows", "workflow_runs", "update_history",
];

const SOFT_DELETE_TABLES = [
  "agents", "tasks", "skills", "workflows",
];

let db: DataStore;

beforeEach(async () => {
  db = new DataStore({ dbPath: ":memory:" });
  defineCoreTables(db);
  await db.init();
});

describe("defineCoreTables — Story 1.6", () => {
  it("all 15 tables created after init", () => {
    const adapter = (db as unknown as { adapter: { all: <T>(sql: string) => T[] } }).adapter;
    const tables = adapter.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '__lattice_%' AND name NOT LIKE 'sqlite_%'"
    ).map(r => r.name).sort();
    const expected = [...ALL_15_TABLES].sort();
    expect(tables).toEqual(expected);
  });

  it("agents table has expected columns", () => {
    const adapter = (db as unknown as { adapter: { tableInfo: (t: string) => Array<{ name: string }> } }).adapter;
    const cols = adapter.tableInfo("agents").map((c) => c.name);
    expect(cols).toContain("id");
    expect(cols).toContain("slug");
    expect(cols).toContain("name");
    expect(cols).toContain("status");
    expect(cols).toContain("adapter");
    expect(cols).toContain("budget_monthly_cents");
    expect(cols).toContain("deleted_at");
  });

  it("tasks table has expected columns", () => {
    const adapter = (db as unknown as { adapter: { tableInfo: (t: string) => Array<{ name: string }> } }).adapter;
    const cols = adapter.tableInfo("tasks").map((c) => c.name);
    expect(cols).toContain("assignee_id");
    expect(cols).toContain("chain_origin_id");
    expect(cols).toContain("workflow_run_id");
    expect(cols).toContain("status");
    expect(cols).toContain("deleted_at");
  });

  it("all soft-delete tables have deleted_at column", () => {
    const adapter = (db as unknown as { adapter: { tableInfo: (t: string) => Array<{ name: string }> } }).adapter;
    for (const table of SOFT_DELETE_TABLES) {
      const cols = adapter.tableInfo(table).map((c: { name: string }) => c.name);
      expect(cols, `${table} should have deleted_at`).toContain("deleted_at");
    }
  });

  it("indexes created on tasks", () => {
    const adapter = (db as unknown as { adapter: { all: <T>(sql: string, ...args: unknown[]) => T[] } }).adapter;
    const indexes = adapter.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='tasks'"
    ).map(r => r.name);
    expect(indexes.some(n => n.includes("status_assignee"))).toBe(true);
    expect(indexes.some(n => n.includes("chain_origin"))).toBe(true);
  });

  it("agent_skills has composite primary key", () => {
    const adapter = (db as unknown as { adapter: { run: (sql: string) => unknown } }).adapter;
    // Insert rows into parent tables first
    adapter.run("INSERT INTO agents(id,slug,name,adapter) VALUES('a1','test-agent','Test','cli')");
    adapter.run("INSERT INTO skills(id,slug,name) VALUES('s1','skill-a','Skill A')");
    adapter.run("INSERT INTO skills(id,slug,name) VALUES('s2','skill-b','Skill B')");
    adapter.run("INSERT INTO agent_skills(agent_id,skill_id) VALUES('a1','s1')");
    adapter.run("INSERT INTO agent_skills(agent_id,skill_id) VALUES('a1','s2')");
    // Duplicate should fail (composite PK constraint)
    expect(() => {
      adapter.run("INSERT INTO agent_skills(agent_id,skill_id) VALUES('a1','s1')");
    }).toThrow();
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
});
