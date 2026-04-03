import type { DataStore } from "./data-store.js";

/**
 * Define all 15 core tables on a DataStore instance.
 * Call before db.init().
 */
export function defineCoreTables(db: DataStore): void {
  db.define("agents", {
    columns: {
      id: "TEXT PRIMARY KEY",
      slug: "TEXT UNIQUE NOT NULL",
      name: "TEXT NOT NULL",
      role: "TEXT NOT NULL DEFAULT 'general'",
      status: "TEXT NOT NULL DEFAULT 'idle'",
      adapter: "TEXT NOT NULL",
      adapter_config: "TEXT NOT NULL DEFAULT '{}'",
      heartbeat_config: "TEXT NOT NULL DEFAULT '{}'",
      budget_monthly_cents: "INTEGER NOT NULL DEFAULT 0",
      spent_monthly_cents: "INTEGER NOT NULL DEFAULT 0",
      reports_to: "TEXT",
      cwd: "TEXT",
      instructions_file: "TEXT",
      created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      updated_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      deleted_at: "TEXT",
    },
  });

  db.define("tasks", {
    columns: {
      id: "TEXT PRIMARY KEY",
      title: "TEXT NOT NULL",
      description: "TEXT",
      status: "TEXT NOT NULL DEFAULT 'backlog'",
      priority: "INTEGER NOT NULL DEFAULT 5",
      assignee_id: "TEXT",
      created_by: "TEXT",
      parent_id: "TEXT",
      chain_origin_id: "TEXT",
      chain_depth: "INTEGER NOT NULL DEFAULT 0",
      workflow_run_id: "TEXT",
      workflow_step_id: "TEXT",
      tags: "TEXT NOT NULL DEFAULT '[]'",
      context: "TEXT",
      result: "TEXT",
      retry_count: "INTEGER NOT NULL DEFAULT 0",
      max_retries: "INTEGER NOT NULL DEFAULT 0",
      next_retry_at: "TEXT",
      followup_agent_id: "TEXT",
      followup_template: "TEXT",
      execution_run_id: "TEXT",
      created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      updated_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      deleted_at: "TEXT",
    },
    tableConstraints: [
      "CREATE INDEX IF NOT EXISTS idx_tasks_status_assignee ON tasks(status, assignee_id)",
      "CREATE INDEX IF NOT EXISTS idx_tasks_chain_origin ON tasks(chain_origin_id)",
    ],
  });

  db.define("runs", {
    columns: {
      id: "TEXT PRIMARY KEY",
      task_id: "TEXT NOT NULL",
      agent_id: "TEXT NOT NULL",
      status: "TEXT NOT NULL DEFAULT 'queued'",
      model: "TEXT",
      adapter: "TEXT",
      log_path: "TEXT",
      exit_code: "INTEGER",
      error_message: "TEXT",
      cost_cents: "INTEGER NOT NULL DEFAULT 0",
      input_tokens: "INTEGER NOT NULL DEFAULT 0",
      output_tokens: "INTEGER NOT NULL DEFAULT 0",
      started_at: "TEXT",
      completed_at: "TEXT",
      created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
    },
    tableConstraints: [
      "CREATE INDEX IF NOT EXISTS idx_runs_task_id ON runs(task_id)",
      "CREATE INDEX IF NOT EXISTS idx_runs_agent_id ON runs(agent_id)",
      "CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status)",
    ],
  });

  db.define("wakeups", {
    columns: {
      id: "TEXT PRIMARY KEY",
      agent_id: "TEXT NOT NULL",
      scheduled_at: "TEXT NOT NULL",
      fired_at: "TEXT",
      run_id: "TEXT",
      context: "TEXT",
      created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
    },
    tableConstraints: [
      "CREATE INDEX IF NOT EXISTS idx_wakeups_agent_scheduled ON wakeups(agent_id, scheduled_at)",
    ],
  });

  db.define("messages", {
    columns: {
      id: "TEXT PRIMARY KEY",
      agent_id: "TEXT NOT NULL",
      channel: "TEXT NOT NULL",
      peer_id: "TEXT NOT NULL",
      last_message_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      message_count: "INTEGER NOT NULL DEFAULT 0",
      context: "TEXT NOT NULL DEFAULT '{}'",
      created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      expires_at: "TEXT",
    },
    tableConstraints: [
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_agent_channel_peer ON messages(agent_id, channel, peer_id)",
    ],
  });

  db.define("skills", {
    columns: {
      id: "TEXT PRIMARY KEY",
      slug: "TEXT UNIQUE NOT NULL",
      name: "TEXT NOT NULL",
      description: "TEXT",
      category: "TEXT",
      definition: "TEXT",
      created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      updated_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      deleted_at: "TEXT",
    },
  });

  db.define("agent_skills", {
    columns: {
      agent_id: "TEXT NOT NULL",
      skill_id: "TEXT NOT NULL",
      granted_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
    },
    primaryKey: ["agent_id", "skill_id"],
    tableConstraints: [
      "FOREIGN KEY (agent_id) REFERENCES agents(id)",
      "FOREIGN KEY (skill_id) REFERENCES skills(id)",
    ],
  });

  db.define("cost_events", {
    columns: {
      id: "TEXT PRIMARY KEY",
      agent_id: "TEXT",
      run_id: "TEXT",
      model: "TEXT NOT NULL",
      provider: "TEXT NOT NULL",
      input_tokens: "INTEGER NOT NULL DEFAULT 0",
      output_tokens: "INTEGER NOT NULL DEFAULT 0",
      cost_cents: "INTEGER NOT NULL DEFAULT 0",
      recorded_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
    },
    tableConstraints: [
      "CREATE INDEX IF NOT EXISTS idx_cost_events_agent ON cost_events(agent_id, recorded_at)",
    ],
  });

  db.define("budget_policies", {
    columns: {
      id: "TEXT PRIMARY KEY",
      agent_id: "TEXT",
      scope: "TEXT NOT NULL DEFAULT 'global'",
      monthly_limit_cents: "INTEGER NOT NULL",
      warn_percent: "INTEGER NOT NULL DEFAULT 80",
      created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      updated_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
    },
  });

  db.define("activity_log", {
    columns: {
      id: "TEXT PRIMARY KEY",
      agent_id: "TEXT",
      event_type: "TEXT NOT NULL",
      payload: "TEXT NOT NULL DEFAULT '{}'",
      recorded_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
    },
    tableConstraints: [
      "CREATE INDEX IF NOT EXISTS idx_activity_log_recorded ON activity_log(recorded_at)",
      "CREATE INDEX IF NOT EXISTS idx_activity_log_agent ON activity_log(agent_id, recorded_at)",
    ],
  });

  db.define("notifications", {
    columns: {
      id: "TEXT PRIMARY KEY",
      channel: "TEXT NOT NULL",
      recipient_id: "TEXT NOT NULL",
      message: "TEXT NOT NULL",
      status: "TEXT NOT NULL DEFAULT 'pending'",
      retries: "INTEGER NOT NULL DEFAULT 0",
      created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      sent_at: "TEXT",
      error: "TEXT",
    },
    tableConstraints: [
      "CREATE INDEX IF NOT EXISTS idx_notifications_pending ON notifications(status, created_at)",
    ],
  });

  db.define("config_revisions", {
    columns: {
      id: "TEXT PRIMARY KEY",
      version: "INTEGER NOT NULL",
      config_yaml: "TEXT NOT NULL",
      applied_by: "TEXT",
      applied_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      notes: "TEXT",
    },
  });

  db.define("workflows", {
    columns: {
      id: "TEXT PRIMARY KEY",
      slug: "TEXT UNIQUE NOT NULL",
      name: "TEXT NOT NULL",
      description: "TEXT",
      definition: "TEXT NOT NULL DEFAULT '{}'",
      created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      updated_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      deleted_at: "TEXT",
    },
  });

  db.define("workflow_runs", {
    columns: {
      id: "TEXT PRIMARY KEY",
      workflow_id: "TEXT NOT NULL",
      trigger_task_id: "TEXT",
      status: "TEXT NOT NULL DEFAULT 'running'",
      current_step: "TEXT",
      step_results: "TEXT NOT NULL DEFAULT '{}'",
      error: "TEXT",
      started_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      completed_at: "TEXT",
    },
    tableConstraints: [
      "CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id, status)",
    ],
  });

  db.define("update_history", {
    columns: {
      id: "TEXT PRIMARY KEY",
      from_version: "TEXT NOT NULL",
      to_version: "TEXT NOT NULL",
      status: "TEXT NOT NULL DEFAULT 'pending'",
      migration_log: "TEXT",
      applied_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      rolled_back_at: "TEXT",
    },
  });
}
