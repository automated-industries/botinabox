import type { DataStore } from "./data-store.js";

/**
 * Options for domain table generation.
 * Enable/disable optional tables based on your app's needs.
 */
export interface DomainSchemaOptions {
  /** Include client + invoice tables (default: true) */
  clients?: boolean;
  /** Include repository table (default: true) */
  repositories?: boolean;
  /** Include file table (default: true) */
  files?: boolean;
  /** Include channel table (default: true) */
  channels?: boolean;
  /** Include rule table + junction tables (default: true) */
  rules?: boolean;
  /** Include event audit log (default: true) */
  events?: boolean;
  /** Include cross-domain junction tables (default: true) */
  junctions?: boolean;
}

/**
 * Define standard domain tables that most multi-agent apps need.
 * Call after defineCoreTables() and before db.init().
 *
 * Provides: org, project, + optional client, invoice, repository,
 * file, channel, rule, event tables with appropriate junction tables.
 *
 * @example
 * ```ts
 * defineCoreTables(db);
 * defineDomainTables(db);          // all tables
 * defineDomainTables(db, { clients: false }); // skip client/invoice
 * ```
 */
export function defineDomainTables(
  db: DataStore,
  options: DomainSchemaOptions = {},
): void {
  const opts = {
    clients: true,
    repositories: true,
    files: true,
    channels: true,
    rules: true,
    events: true,
    junctions: true,
    ...options,
  };

  // --- Core domain entities ---

  db.define("org", {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT NOT NULL",
      type: "TEXT NOT NULL DEFAULT 'company'",
      description: "TEXT",
      mission: "TEXT",
      website: "TEXT",
      created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      updated_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      deleted_at: "TEXT",
    },
  });

  db.define("project", {
    columns: {
      id: "TEXT PRIMARY KEY",
      org_id: "TEXT NOT NULL",
      name: "TEXT NOT NULL",
      status: "TEXT",
      description: "TEXT",
      tech_stack: "TEXT",
      github_repo: "TEXT",
      deploy_target: "TEXT",
      production_url: "TEXT",
      branch_strategy: "TEXT",
      repo_path: "TEXT",
      codename: "TEXT",
      notes: "TEXT",
      created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      updated_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      deleted_at: "TEXT",
    },
  });

  // Agent ↔ project junction
  db.define("agent_project", {
    columns: {
      agent_id: "TEXT NOT NULL",
      project_id: "TEXT NOT NULL",
      role: "TEXT",
      created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
    },
    primaryKey: ["agent_id", "project_id"],
  });

  // Secret ↔ project junction
  db.define("secret_project", {
    columns: {
      secret_id: "TEXT NOT NULL",
      project_id: "TEXT NOT NULL",
      created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
    },
    primaryKey: ["secret_id", "project_id"],
  });

  // Secret ↔ org junction
  db.define("secret_org", {
    columns: {
      secret_id: "TEXT NOT NULL",
      org_id: "TEXT NOT NULL",
      created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
    },
    primaryKey: ["secret_id", "org_id"],
  });

  // --- Optional: clients + invoicing ---

  if (opts.clients) {
    db.define("client", {
      columns: {
        id: "TEXT PRIMARY KEY",
        org_id: "TEXT NOT NULL",
        name: "TEXT NOT NULL",
        contact_name: "TEXT",
        contact_email: "TEXT",
        phone: "TEXT",
        address: "TEXT",
        status: "TEXT NOT NULL DEFAULT 'active'",
        notes: "TEXT",
        created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
        updated_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
        deleted_at: "TEXT",
      },
    });

    db.define("invoice", {
      columns: {
        id: "TEXT PRIMARY KEY",
        org_id: "TEXT NOT NULL",
        client_id: "TEXT NOT NULL",
        number: "TEXT",
        amount_cents: "INTEGER",
        currency: "TEXT DEFAULT 'USD'",
        status: "TEXT NOT NULL DEFAULT 'draft'",
        description: "TEXT",
        hours: "REAL",
        rate_cents: "INTEGER",
        items_json: "TEXT",
        issued_at: "TEXT",
        due_at: "TEXT",
        paid_at: "TEXT",
        notes: "TEXT",
        created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
        updated_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
        deleted_at: "TEXT",
      },
      tableConstraints: [
        "CREATE INDEX IF NOT EXISTS idx_invoice_client ON invoice(client_id)",
      ],
    });

    db.define("agent_client", {
      columns: {
        agent_id: "TEXT NOT NULL",
        client_id: "TEXT NOT NULL",
        created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      },
      primaryKey: ["agent_id", "client_id"],
    });
  }

  // --- Optional: repositories ---

  if (opts.repositories) {
    db.define("repository", {
      columns: {
        id: "TEXT PRIMARY KEY",
        org_id: "TEXT NOT NULL",
        project_id: "TEXT",
        client_id: "TEXT",
        name: "TEXT NOT NULL",
        url: "TEXT",
        local_path: "TEXT",
        default_branch: "TEXT DEFAULT 'main'",
        platform: "TEXT DEFAULT 'github'",
        status: "TEXT NOT NULL DEFAULT 'active'",
        notes: "TEXT",
        created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
        updated_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
        deleted_at: "TEXT",
      },
      tableConstraints: [
        "CREATE INDEX IF NOT EXISTS idx_repository_project ON repository(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_repository_client ON repository(client_id)",
      ],
    });
  }

  // --- Optional: files ---

  if (opts.files) {
    db.define("file", {
      columns: {
        id: "TEXT PRIMARY KEY",
        org_id: "TEXT",
        name: "TEXT NOT NULL",
        file_path: "TEXT",
        mime_type: "TEXT",
        size_bytes: "INTEGER",
        project_id: "TEXT",
        access_level: "TEXT NOT NULL DEFAULT 'org'",
        description: "TEXT",
        tags: "TEXT",
        notes: "TEXT",
        created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
        updated_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
        deleted_at: "TEXT",
      },
    });
  }

  // --- Optional: channels ---

  if (opts.channels) {
    db.define("channel", {
      columns: {
        id: "TEXT PRIMARY KEY",
        org_id: "TEXT",
        platform: "TEXT NOT NULL",
        external_id: "TEXT",
        name: "TEXT NOT NULL",
        type: "TEXT NOT NULL DEFAULT 'channel'",
        instructions: "TEXT",
        created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
        updated_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
        deleted_at: "TEXT",
      },
    });
  }

  // --- Optional: rules ---

  if (opts.rules) {
    db.define("rule", {
      columns: {
        id: "TEXT PRIMARY KEY",
        org_id: "TEXT",
        title: "TEXT NOT NULL",
        rule_text: "TEXT NOT NULL",
        scope: "TEXT NOT NULL DEFAULT 'org'",
        category: "TEXT NOT NULL DEFAULT 'process'",
        priority: "INTEGER NOT NULL DEFAULT 50",
        rationale: "TEXT",
        enforcement: "TEXT DEFAULT 'advisory'",
        created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
        updated_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
        deleted_at: "TEXT",
      },
    });

    db.define("rule_agent", {
      columns: {
        rule_id: "TEXT NOT NULL",
        agent_id: "TEXT NOT NULL",
        created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      },
      primaryKey: ["rule_id", "agent_id"],
    });

    db.define("rule_project", {
      columns: {
        rule_id: "TEXT NOT NULL",
        project_id: "TEXT NOT NULL",
        created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      },
      primaryKey: ["rule_id", "project_id"],
    });

    db.define("rule_org", {
      columns: {
        rule_id: "TEXT NOT NULL",
        org_id: "TEXT NOT NULL",
        created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      },
      primaryKey: ["rule_id", "org_id"],
    });
  }

  // --- Optional: event audit log ---

  if (opts.events) {
    db.define("event", {
      columns: {
        id: "TEXT PRIMARY KEY",
        org_id: "TEXT",
        type: "TEXT NOT NULL",
        summary: "TEXT NOT NULL",
        details: "TEXT",
        severity: "TEXT NOT NULL DEFAULT 'info'",
        actor_agent_id: "TEXT",
        actor_user_id: "TEXT",
        project_id: "TEXT",
        channel_id: "TEXT",
        source: "TEXT",
        created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
        deleted_at: "TEXT",
      },
      tableConstraints: [
        "CREATE INDEX IF NOT EXISTS idx_event_type ON event(type, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_event_project ON event(project_id)",
      ],
    });
  }

  // --- Optional: cross-domain junction tables ---

  if (opts.junctions) {
    db.define("secret_client", {
      columns: {
        secret_id: "TEXT NOT NULL",
        client_id: "TEXT NOT NULL",
        created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      },
      primaryKey: ["secret_id", "client_id"],
    });

    db.define("secret_user", {
      columns: {
        secret_id: "TEXT NOT NULL",
        user_id: "TEXT NOT NULL",
        created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      },
      primaryKey: ["secret_id", "user_id"],
    });

    db.define("secret_repository", {
      columns: {
        secret_id: "TEXT NOT NULL",
        repository_id: "TEXT NOT NULL",
        created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      },
      primaryKey: ["secret_id", "repository_id"],
    });

    db.define("file_agent", {
      columns: {
        file_id: "TEXT NOT NULL",
        agent_id: "TEXT NOT NULL",
        created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      },
      primaryKey: ["file_id", "agent_id"],
    });

    db.define("user_channel", {
      columns: {
        user_id: "TEXT NOT NULL",
        channel_id: "TEXT NOT NULL",
        role: "TEXT",
        created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      },
      primaryKey: ["user_id", "channel_id"],
    });

    db.define("user_project", {
      columns: {
        user_id: "TEXT NOT NULL",
        project_id: "TEXT NOT NULL",
        role: "TEXT",
        created_at: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      },
      primaryKey: ["user_id", "project_id"],
    });
  }
}
