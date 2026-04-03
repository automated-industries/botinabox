import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteAdapter } from '../sqlite-adapter.js';
import { MigrationRunner } from '../migration.js';

describe('MigrationRunner', () => {
  let adapter: SqliteAdapter;
  let runner: MigrationRunner;

  beforeEach(() => {
    adapter = new SqliteAdapter(':memory:');
    adapter.open();
    runner = new MigrationRunner(adapter);
  });

  it('migrations run in order', () => {
    runner.run([
      { version: '001', sql: 'CREATE TABLE foo (id TEXT PRIMARY KEY)' },
      { version: '002', sql: 'CREATE TABLE bar (id TEXT PRIMARY KEY)' },
    ]);

    const tables = adapter.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    const names = tables.map(t => t.name);
    expect(names).toContain('foo');
    expect(names).toContain('bar');
  });

  it('already-applied version is skipped on re-run', () => {
    runner.run([
      { version: '001', sql: 'CREATE TABLE foo (id TEXT PRIMARY KEY)' },
    ]);

    // Run again — should not throw (duplicate table creation)
    expect(() => {
      runner.run([
        { version: '001', sql: 'CREATE TABLE foo (id TEXT PRIMARY KEY)' },
        { version: '002', sql: 'CREATE TABLE bar (id TEXT PRIMARY KEY)' },
      ]);
    }).not.toThrow();

    const tables = adapter.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    const names = tables.map(t => t.name);
    expect(names).toContain('bar');
  });

  it('version tracked in __lattice_migrations', () => {
    runner.run([
      { version: 'v1', sql: 'CREATE TABLE test1 (id TEXT PRIMARY KEY)' },
      { version: 'v2', sql: 'CREATE TABLE test2 (id TEXT PRIMARY KEY)' },
    ]);

    const applied = adapter.all<{ version: string }>('SELECT version FROM __lattice_migrations ORDER BY version');
    expect(applied.map(r => r.version)).toEqual(['v1', 'v2']);
  });

  it('each migration has applied_at timestamp', () => {
    runner.run([{ version: 'v1', sql: 'CREATE TABLE ts_test (id TEXT PRIMARY KEY)' }]);
    const row = adapter.get<{ version: string; applied_at: number }>(
      'SELECT * FROM __lattice_migrations WHERE version = ?', ['v1']
    );
    expect(row).toBeTruthy();
    expect(typeof row!.applied_at).toBe('number');
    expect(row!.applied_at).toBeGreaterThan(0);
  });
});
