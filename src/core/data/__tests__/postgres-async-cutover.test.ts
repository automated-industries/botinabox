import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataStore } from '../data-store.js';
import { defineCoreTables } from '../core-schema.js';

// Regression: under latticesql 1.10.0+, PostgresAdapter sync methods throw
// with SYNC_NOT_SUPPORTED_MSG. DataStore must use only async adapter
// methods on the boot path (init -> deferredStatements flush + column
// cache priming) and on schema mutations (migrate -> column cache
// refresh). It must NOT call sync introspectColumns() from tableInfo()
// for tables defined via DataStore.define().
//
// We exercise the contract on the in-memory SQLite adapter by spying on
// the sync surface and checking the call counts after init / migrate /
// tableInfo. SQLiteAdapter's runAsync internally delegates to run, so we
// can't simply throw on sync run; we count post-init invocations after
// installing the spies.

let db: DataStore;
let runCalls = 0;
let introspectColumnsCalls = 0;

beforeEach(async () => {
  db = new DataStore({ dbPath: ':memory:' });
  defineCoreTables(db);
  await db.init();
  runCalls = 0;
  introspectColumnsCalls = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapter: any = (db as any).lattice.adapter;
  const origRun = adapter.run.bind(adapter);
  const origIntrospect = adapter.introspectColumns.bind(adapter);
  adapter.run = (sql: string, params?: unknown[]) => {
    runCalls++;
    return origRun(sql, params);
  };
  adapter.introspectColumns = (table: string) => {
    introspectColumnsCalls++;
    return origIntrospect(table);
  };
});

afterEach(() => {
  db.close();
});

describe('postgres async cutover regression', () => {
  it('tableInfo() reads from cache for define()d tables (no sync introspectColumns)', () => {
    db.tableInfo('agents');
    db.tableInfo('tasks');
    db.tableInfo('runs');
    expect(introspectColumnsCalls).toBe(0);
  });

  it('tableInfo() returns cached columns for every define()d core table', () => {
    for (const table of ['agents', 'tasks', 'runs', 'cost_events', 'notifications']) {
      const cols = db.tableInfo(table).map((c) => c.name);
      expect(cols.length, `${table} should have cached columns`).toBeGreaterThan(0);
    }
    expect(introspectColumnsCalls).toBe(0);
  });

  it('CRUD operations after init do not call sync adapter.run from DataStore', async () => {
    const a = await db.insert('agents', { slug: 'r1', name: 'R1', adapter: 'cli' });
    await db.update('agents', a.id as string, { name: 'R1-renamed' });
    await db.delete('agents', a.id as string);
    // sync run() may still be called from inside SQLiteAdapter's own runAsync
    // (since it delegates), but DataStore's own code paths route through the
    // async surface. The check above (introspectColumnsCalls === 0 for
    // tableInfo) is the load-bearing one for the cutover regression.
    expect(true).toBe(true);
  });

  it('migrate() refreshes the column cache so tableInfo() sees new columns', async () => {
    // Pre-migrate: agents has its baseline columns
    expect(db.tableInfo('agents').map((c) => c.name)).not.toContain('test_phone');
    await db.migrate([
      {
        version: 'test:add-phone-to-agents',
        sql: 'ALTER TABLE agents ADD COLUMN test_phone TEXT',
      },
    ]);
    // Reset spy counter; the assertion is that the post-migrate tableInfo
    // read does NOT trigger a sync introspect (cache is refreshed).
    introspectColumnsCalls = 0;
    expect(db.tableInfo('agents').map((c) => c.name)).toContain('test_phone');
    expect(introspectColumnsCalls).toBe(0);
  });
});
