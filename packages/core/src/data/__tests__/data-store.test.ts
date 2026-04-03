import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataStore, DataStoreError } from '../data-store.js';

describe('DataStore', () => {
  let store: DataStore;

  beforeEach(() => {
    store = new DataStore({ dbPath: ':memory:' });
    store.define('items', {
      columns: {
        id: 'TEXT PRIMARY KEY',
        name: 'TEXT NOT NULL',
        value: 'INTEGER',
        category: 'TEXT',
      },
    });
    store.init();
  });

  afterEach(() => {
    store.close();
  });

  it('define + init creates table', () => {
    const rows = store.query('items');
    expect(Array.isArray(rows)).toBe(true);
  });

  it('define after init throws', () => {
    expect(() => {
      store.define('other', { columns: { id: 'TEXT PRIMARY KEY' } });
    }).toThrow(DataStoreError);
  });

  it('CRUD before init throws', () => {
    const uninit = new DataStore({ dbPath: ':memory:' });
    expect(() => uninit.insert('items', { name: 'test' })).toThrow(DataStoreError);
  });

  it('insert auto-generates UUID', () => {
    const row = store.insert('items', { name: 'Widget', value: 42 });
    expect(row['id']).toBeTruthy();
    expect(typeof row['id']).toBe('string');
    expect((row['id'] as string).length).toBeGreaterThan(0);
  });

  it('insert with explicit id', () => {
    const row = store.insert('items', { id: 'explicit-id', name: 'Thing' });
    expect(row['id']).toBe('explicit-id');
  });

  it('upsert creates then updates', () => {
    store.insert('items', { id: 'i1', name: 'Original' });
    const updated = store.upsert('items', { id: 'i1', name: 'Updated' });
    expect(updated['name']).toBe('Updated');
    const all = store.query('items');
    expect(all.length).toBe(1);
  });

  it('update by PK', () => {
    store.insert('items', { id: 'i2', name: 'Foo', value: 1 });
    const updated = store.update('items', 'i2', { value: 99 });
    expect(updated['value']).toBe(99);
    expect(updated['name']).toBe('Foo');
  });

  it('delete by PK', () => {
    store.insert('items', { id: 'i3', name: 'Bar' });
    store.delete('items', 'i3');
    expect(store.get('items', 'i3')).toBeUndefined();
  });

  it('get by PK returns row or undefined', () => {
    store.insert('items', { id: 'i4', name: 'Baz' });
    const row = store.get('items', 'i4');
    expect(row).toBeTruthy();
    expect(row!['name']).toBe('Baz');
    expect(store.get('items', 'nonexistent')).toBeUndefined();
  });

  it('query with where', () => {
    store.insert('items', { name: 'A', category: 'x' });
    store.insert('items', { name: 'B', category: 'y' });
    const rows = store.query('items', { where: { category: 'x' } });
    expect(rows.length).toBe(1);
    expect(rows[0]['name']).toBe('A');
  });

  it('close works without error', () => {
    expect(() => store.close()).not.toThrow();
  });
});
