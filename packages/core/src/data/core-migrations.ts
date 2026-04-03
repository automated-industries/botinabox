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
];
