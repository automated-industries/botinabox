import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteAdapter } from '../sqlite-adapter.js';
import { SchemaManager } from '../schema-manager.js';
import { CrudOps } from '../crud.js';

function makeSetup() {
  const adapter = new SqliteAdapter(':memory:');
  adapter.open();
  const schema = new SchemaManager(adapter);
  schema.define('users', {
    columns: {
      id: 'TEXT PRIMARY KEY',
      name: 'TEXT NOT NULL',
      age: 'INTEGER',
      deleted_at: 'INTEGER',
      status: 'TEXT',
    },
  });
  schema.init();
  const ops = new CrudOps(adapter, schema);
  return { adapter, schema, ops };
}

describe('CrudOps', () => {
  let ops: CrudOps;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    ({ ops, adapter } = makeSetup());
  });

  it('insert creates a row with auto-generated UUID', () => {
    const row = ops.insert('users', { name: 'Alice', age: 30 });
    expect(row['id']).toBeTruthy();
    expect(typeof row['id']).toBe('string');
    expect(row['name']).toBe('Alice');
  });

  it('insert with explicit id uses that id', () => {
    const row = ops.insert('users', { id: 'custom-id', name: 'Bob' });
    expect(row['id']).toBe('custom-id');
  });

  it('upsert creates then updates on duplicate', () => {
    ops.insert('users', { id: 'u1', name: 'Alice' });
    const updated = ops.upsert('users', { id: 'u1', name: 'Alice Updated' });
    expect(updated['name']).toBe('Alice Updated');

    const all = ops.query('users');
    expect(all.length).toBe(1);
  });

  it('update changes fields', () => {
    ops.insert('users', { id: 'u2', name: 'Carol', age: 25 });
    const updated = ops.update('users', 'u2', { age: 26 });
    expect(updated['age']).toBe(26);
    expect(updated['name']).toBe('Carol');
  });

  it('delete removes a row', () => {
    ops.insert('users', { id: 'u3', name: 'Dave' });
    ops.delete('users', 'u3');
    const found = ops.get('users', 'u3');
    expect(found).toBeUndefined();
  });

  it('get returns row or undefined', () => {
    ops.insert('users', { id: 'u4', name: 'Eve' });
    const row = ops.get('users', 'u4');
    expect(row).toBeTruthy();
    expect(row!['name']).toBe('Eve');

    const missing = ops.get('users', 'does-not-exist');
    expect(missing).toBeUndefined();
  });

  it('query with where filter', () => {
    ops.insert('users', { id: 'u5', name: 'Alice', age: 30 });
    ops.insert('users', { id: 'u6', name: 'Bob', age: 25 });
    const rows = ops.query('users', { where: { name: 'Alice' } });
    expect(rows.length).toBe(1);
    expect(rows[0]['name']).toBe('Alice');
  });

  it('query with filter gt', () => {
    ops.insert('users', { id: 'u7', name: 'Alice', age: 30 });
    ops.insert('users', { id: 'u8', name: 'Bob', age: 25 });
    const rows = ops.query('users', { filters: [{ col: 'age', op: 'gt', val: 28 }] });
    expect(rows.length).toBe(1);
    expect(rows[0]['name']).toBe('Alice');
  });

  it('query with filter like', () => {
    ops.insert('users', { id: 'u9', name: 'Alice', age: 30 });
    ops.insert('users', { id: 'u10', name: 'Bob', age: 25 });
    const rows = ops.query('users', { filters: [{ col: 'name', op: 'like', val: 'Ali%' }] });
    expect(rows.length).toBe(1);
    expect(rows[0]['name']).toBe('Alice');
  });

  it('query with filter in', () => {
    ops.insert('users', { id: 'u11', name: 'Alice', age: 30 });
    ops.insert('users', { id: 'u12', name: 'Bob', age: 25 });
    ops.insert('users', { id: 'u13', name: 'Carol', age: 22 });
    const rows = ops.query('users', { filters: [{ col: 'name', op: 'in', val: ['Alice', 'Carol'] }] });
    expect(rows.length).toBe(2);
    const names = rows.map(r => r['name']);
    expect(names).toContain('Alice');
    expect(names).toContain('Carol');
  });

  it('query with filter isNull', () => {
    ops.insert('users', { id: 'u14', name: 'Alice', age: 30 });
    ops.insert('users', { id: 'u15', name: 'Bob', age: 25, deleted_at: 1234567890 });
    const rows = ops.query('users', { filters: [{ col: 'deleted_at', op: 'isNull' }] });
    expect(rows.every(r => r['deleted_at'] == null)).toBe(true);
  });

  it('query with orderBy + limit + offset', () => {
    ops.insert('users', { id: 'u16', name: 'Charlie', age: 35 });
    ops.insert('users', { id: 'u17', name: 'Alice', age: 30 });
    ops.insert('users', { id: 'u18', name: 'Bob', age: 25 });

    const rows = ops.query('users', {
      orderBy: 'age',
      orderDir: 'asc',
      limit: 2,
      offset: 0,
    });
    expect(rows.length).toBe(2);
    expect(rows[0]['name']).toBe('Bob');
    expect(rows[1]['name']).toBe('Alice');
  });

  it('count with filters', () => {
    ops.insert('users', { id: 'u19', name: 'Alice', age: 30, status: 'active' });
    ops.insert('users', { id: 'u20', name: 'Bob', age: 25, status: 'inactive' });
    ops.insert('users', { id: 'u21', name: 'Carol', age: 22, status: 'active' });

    const count = ops.count('users', { where: { status: 'active' } });
    expect(count).toBe(2);
  });
});
