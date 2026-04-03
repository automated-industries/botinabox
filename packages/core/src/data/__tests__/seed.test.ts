import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteAdapter } from '../sqlite-adapter.js';
import { SchemaManager } from '../schema-manager.js';
import { CrudOps } from '../crud.js';
import { seed } from '../seed.js';

function makeSetup() {
  const adapter = new SqliteAdapter(':memory:');
  adapter.open();
  const schema = new SchemaManager(adapter);
  schema.define('users', {
    columns: {
      id: 'TEXT PRIMARY KEY',
      email: 'TEXT UNIQUE',
      name: 'TEXT',
      deleted_at: 'INTEGER',
    },
  });
  schema.define('tags', {
    columns: {
      id: 'TEXT PRIMARY KEY',
      user_id: 'TEXT',
      tag: 'TEXT',
    },
  });
  schema.define('user_tags', {
    columns: {
      user_id: 'TEXT NOT NULL',
      tag_id: 'TEXT NOT NULL',
    },
  });
  schema.init();
  const ops = new CrudOps(adapter, schema);
  return { adapter, schema, ops };
}

describe('seed', () => {
  let ops: CrudOps;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    ({ ops, adapter } = makeSetup());
  });

  it('seed inserts rows', async () => {
    await seed(ops, adapter, [
      {
        table: 'users',
        rows: [
          { id: 'u1', email: 'alice@example.com', name: 'Alice' },
          { id: 'u2', email: 'bob@example.com', name: 'Bob' },
        ],
      },
    ]);

    const rows = ops.query('users');
    expect(rows.length).toBe(2);
  });

  it('seed with naturalKey upserts — second seed does not duplicate', async () => {
    await seed(ops, adapter, [
      {
        table: 'users',
        rows: [{ id: 'u1', email: 'alice@example.com', name: 'Alice' }],
        naturalKey: 'email',
      },
    ]);

    // Seed again with same naturalKey
    await seed(ops, adapter, [
      {
        table: 'users',
        rows: [{ id: 'u1', email: 'alice@example.com', name: 'Alice Updated' }],
        naturalKey: 'email',
      },
    ]);

    const rows = ops.query('users');
    expect(rows.length).toBe(1);
    expect(rows[0]['name']).toBe('Alice Updated');
  });

  it('softDeleteMissing sets deleted_at on rows not in seed', async () => {
    // Insert existing rows
    ops.insert('users', { id: 'u1', email: 'alice@example.com', name: 'Alice' });
    ops.insert('users', { id: 'u2', email: 'bob@example.com', name: 'Bob' });

    // Seed only Alice — Bob should be soft-deleted
    await seed(ops, adapter, [
      {
        table: 'users',
        rows: [{ id: 'u1', email: 'alice@example.com', name: 'Alice' }],
        naturalKey: 'email',
        softDeleteMissing: true,
      },
    ]);

    const bob = ops.get('users', 'u2');
    expect(bob).toBeTruthy();
    expect(bob!['deleted_at']).not.toBeNull();
    expect(bob!['deleted_at']).not.toBeUndefined();

    const alice = ops.get('users', 'u1');
    expect(alice!['deleted_at']).toBeNull();
  });

  it('seed with junctions links rows', async () => {
    ops.insert('users', { id: 'u1', name: 'Alice', email: 'alice@example.com' });
    // Need a tag to reference
    adapter.run("INSERT INTO tags (id, user_id, tag) VALUES ('t1', 'u1', 'admin')");

    await seed(ops, adapter, [
      {
        table: 'users',
        rows: [],
        junctions: [
          {
            table: 'user_tags',
            items: [{ user_id: 'u1', tag_id: 't1' }],
          },
        ],
      },
    ]);

    const links = adapter.all('SELECT * FROM user_tags');
    expect(links.length).toBe(1);
  });
});
