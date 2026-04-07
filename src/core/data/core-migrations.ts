/** Initial migration set for core tables */
export const CORE_MIGRATIONS: Array<{ version: string; sql: string }> = [
  {
    version: "001_initial_schema",
    sql: `-- Initial schema is applied via DataStore.define() + init().
          -- This migration is a no-op placeholder for version tracking.
          SELECT 1;`,
  },
  {
    version: "002_activity_log_indexes",
    sql: `CREATE INDEX IF NOT EXISTS idx_activity_log_type ON activity_log(event_type, recorded_at);`,
  },
  {
    version: "003_runs_cost_index",
    sql: `CREATE INDEX IF NOT EXISTS idx_runs_cost ON runs(agent_id, completed_at) WHERE cost_cents > 0;`,
  },
  {
    version: "004_schedules_table",
    sql: `CREATE TABLE IF NOT EXISTS schedules (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            type TEXT NOT NULL DEFAULT 'recurring',
            cron TEXT,
            run_at TEXT,
            timezone TEXT DEFAULT 'UTC',
            enabled INTEGER NOT NULL DEFAULT 1,
            action TEXT NOT NULL,
            action_config TEXT DEFAULT '{}',
            last_fired_at TEXT,
            next_fire_at TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            deleted_at TEXT
          )`,
  },
  {
    version: "005_schedules_name_index",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_schedules_name ON schedules(name) WHERE deleted_at IS NULL`,
  },
  {
    version: "006_schedules_next_index",
    sql: `CREATE INDEX IF NOT EXISTS idx_schedules_next ON schedules(enabled, next_fire_at) WHERE deleted_at IS NULL`,
  },
  {
    version: "biab:2.5.0:feedback-user-id",
    sql: `ALTER TABLE feedback ADD COLUMN user_id TEXT`,
  },
  {
    version: "biab:2.5.0:feedback-user-idx",
    sql: `CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id)`,
  },
  {
    version: "biab:2.5.0:playbooks-client-id",
    sql: `ALTER TABLE playbooks ADD COLUMN client_id TEXT`,
  },
];
