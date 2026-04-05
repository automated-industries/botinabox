import type { DataStore } from "./data-store.js";

/**
 * Define all 18 core tables on a DataStore instance.
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
      channel: "TEXT NOT NULL DEFAULT 'slack'",
      direction: "TEXT NOT NULL DEFAULT 'inbound'",
      from_user: "TEXT",
      from_agent: "TEXT",
      agent_id: "TEXT",
      user_id: "TEXT",
      body: "TEXT NOT NULL",
      thread_id: "TEXT",
      task_id: "TEXT",
      created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      deleted_at: "TEXT",
    },
    tableConstraints: [
      "CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at)",
      "CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id)",
      "CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(agent_id)",
    ],
  });

  db.define("sessions", {
    columns: {
      id: "TEXT PRIMARY KEY",
      agent_id: "TEXT NOT NULL",
      channel: "TEXT NOT NULL",
      peer_id: "TEXT NOT NULL",
      user_id: "TEXT",
      context: "TEXT NOT NULL DEFAULT '{}'",
      message_count: "INTEGER NOT NULL DEFAULT 0",
      last_message_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      expires_at: "TEXT",
    },
    tableConstraints: [
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_agent_channel_peer ON sessions(agent_id, channel, peer_id)",
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

  // --- Protected primitives (v0.2.0) ---

  db.define("users", {
    columns: {
      id: "TEXT PRIMARY KEY",
      org_id: "TEXT",
      name: "TEXT NOT NULL",
      email: "TEXT",
      role: "TEXT",
      title: "TEXT",
      external_id: "TEXT",
      channel: "TEXT",
      timezone: "TEXT",
      preferences: "TEXT NOT NULL DEFAULT '{}'",
      notes: "TEXT",
      created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      updated_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      deleted_at: "TEXT",
    },
    tableConstraints: [
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL AND deleted_at IS NULL",
      "CREATE INDEX IF NOT EXISTS idx_users_external_id ON users(external_id) WHERE deleted_at IS NULL",
    ],
  });

  db.define("user_identities", {
    columns: {
      id: "TEXT PRIMARY KEY",
      user_id: "TEXT NOT NULL",
      channel: "TEXT NOT NULL",
      external_id: "TEXT NOT NULL",
      display_name: "TEXT",
      verified: "INTEGER NOT NULL DEFAULT 0",
      created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
    },
    tableConstraints: [
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_user_identities_channel_ext ON user_identities(channel, external_id)",
      "FOREIGN KEY (user_id) REFERENCES users(id)",
    ],
  });

  db.define("schedules", {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT NOT NULL",
      description: "TEXT",
      type: "TEXT NOT NULL DEFAULT 'recurring'",
      cron: "TEXT",
      run_at: "TEXT",
      timezone: "TEXT DEFAULT 'UTC'",
      enabled: "INTEGER NOT NULL DEFAULT 1",
      action: "TEXT NOT NULL",
      action_config: "TEXT DEFAULT '{}'",
      last_fired_at: "TEXT",
      next_fire_at: "TEXT",
      created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      updated_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      deleted_at: "TEXT",
    },
    tableConstraints: [
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_schedules_name ON schedules(name) WHERE deleted_at IS NULL",
      "CREATE INDEX IF NOT EXISTS idx_schedules_next ON schedules(enabled, next_fire_at) WHERE deleted_at IS NULL",
    ],
  });

  db.define("secrets", {
    columns: {
      id: "TEXT PRIMARY KEY",
      org_id: "TEXT",
      name: "TEXT NOT NULL",
      type: "TEXT NOT NULL DEFAULT 'api_key'",
      environment: "TEXT NOT NULL DEFAULT 'production'",
      value: "TEXT",
      location: "TEXT",
      description: "TEXT",
      rotation_schedule: "TEXT",
      expires_at: "TEXT",
      notes: "TEXT",
      created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      updated_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      deleted_at: "TEXT",
    },
    tableConstraints: [
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_secrets_name_env ON secrets(name, environment, org_id) WHERE deleted_at IS NULL",
    ],
  });

  // --- Learning pipeline (v1.6.0) ---

  db.define("feedback", {
    columns: {
      id: "TEXT PRIMARY KEY",
      agent_id: "TEXT NOT NULL",
      task_id: "TEXT",
      issue: "TEXT NOT NULL",
      root_cause: "TEXT",
      severity: "TEXT NOT NULL DEFAULT 'medium'",
      repeatable: "INTEGER NOT NULL DEFAULT 0",
      accuracy_score: "REAL",
      efficiency_score: "REAL",
      tags: "TEXT NOT NULL DEFAULT '[]'",
      created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
    },
    tableConstraints: [
      "CREATE INDEX IF NOT EXISTS idx_feedback_agent ON feedback(agent_id, created_at)",
      "CREATE INDEX IF NOT EXISTS idx_feedback_issue ON feedback(issue)",
    ],
  });

  db.define("playbooks", {
    columns: {
      id: "TEXT PRIMARY KEY",
      pattern: "TEXT NOT NULL",
      rule: "TEXT NOT NULL",
      feedback_ids: "TEXT NOT NULL DEFAULT '[]'",
      project_scoped: "INTEGER NOT NULL DEFAULT 1",
      created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      updated_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      deleted_at: "TEXT",
    },
    tableConstraints: [
      "CREATE INDEX IF NOT EXISTS idx_playbooks_pattern ON playbooks(pattern)",
    ],
  });

  db.define("agent_playbooks", {
    columns: {
      agent_id: "TEXT NOT NULL",
      playbook_id: "TEXT NOT NULL",
      assigned_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
    },
    primaryKey: ["agent_id", "playbook_id"],
    tableConstraints: [
      "FOREIGN KEY (agent_id) REFERENCES agents(id)",
      "FOREIGN KEY (playbook_id) REFERENCES playbooks(id)",
    ],
  });

  // --- Chat layer (v1.7.0) ---

  db.define("message_attachments", {
    columns: {
      id: "TEXT PRIMARY KEY",
      message_id: "TEXT NOT NULL",
      file_type: "TEXT NOT NULL DEFAULT 'file'",
      filename: "TEXT",
      mime_type: "TEXT",
      size_bytes: "INTEGER",
      contents: "TEXT",
      summary: "TEXT",
      url: "TEXT",
      created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
    },
    tableConstraints: [
      "CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON message_attachments(message_id)",
      "FOREIGN KEY (message_id) REFERENCES messages(id)",
    ],
  });

  db.define("thread_task_map", {
    columns: {
      id: "TEXT PRIMARY KEY",
      thread_ts: "TEXT NOT NULL",
      channel_id: "TEXT NOT NULL",
      task_id: "TEXT NOT NULL",
      created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
    },
    tableConstraints: [
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_task_map_thread ON thread_task_map(thread_ts, channel_id)",
      "CREATE INDEX IF NOT EXISTS idx_thread_task_map_task ON thread_task_map(task_id)",
    ],
  });

  db.define("message_dedup", {
    columns: {
      id: "TEXT PRIMARY KEY",
      content_hash: "TEXT NOT NULL",
      channel_id: "TEXT NOT NULL",
      created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
    },
    tableConstraints: [
      "CREATE INDEX IF NOT EXISTS idx_message_dedup_hash ON message_dedup(content_hash, created_at)",
    ],
  });

  db.define("memories", {
    columns: {
      id: "TEXT PRIMARY KEY",
      message_id: "TEXT",
      user_id: "TEXT",
      summary: "TEXT NOT NULL",
      contents: "TEXT NOT NULL",
      tags: "TEXT NOT NULL DEFAULT '[]'",
      category: "TEXT",
      created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      updated_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      deleted_at: "TEXT",
    },
    tableConstraints: [
      "CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id, created_at)",
      "CREATE INDEX IF NOT EXISTS idx_memories_message ON memories(message_id)",
    ],
  });
}
