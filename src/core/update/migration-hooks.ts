import type { DataStore } from '../data/data-store.js';

export interface PackageMigration {
  version: string;
  package: string;
  sql: string;
}

/**
 * Runs package migrations using the __lattice_migrations table for tracking.
 * Each migration is keyed by "{package}:{version}" to ensure idempotency.
 */
export async function runPackageMigrations(
  db: DataStore,
  migrations: PackageMigration[],
): Promise<void> {
  await db.migrate(
    migrations.map((m) => ({
      version: `${m.package}:${m.version}`,
      sql: m.sql,
    })),
  );
}
