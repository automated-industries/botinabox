import type { SqliteAdapter } from './sqlite-adapter.js';

const MIGRATIONS_TABLE = '__lattice_migrations';

export class MigrationRunner {
  constructor(private readonly adapter: SqliteAdapter) {}

  run(migrations: Array<{ version: string; sql: string }>): void {
    // Create migrations table if not exists
    this.adapter.run(`
      CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
        version TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `);

    // Get already-applied versions
    const applied = new Set(
      this.adapter.all<{ version: string }>(`SELECT version FROM ${MIGRATIONS_TABLE}`)
        .map(r => r.version)
    );

    // Run new migrations in order
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;

      const tx = this.adapter.db.transaction(() => {
        this.adapter.run(migration.sql);
        this.adapter.run(
          `INSERT INTO ${MIGRATIONS_TABLE} (version, applied_at) VALUES (?, ?)`,
          [migration.version, Date.now()]
        );
      });
      tx();
    }
  }
}
