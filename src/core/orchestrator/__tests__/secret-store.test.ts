import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataStore } from '../../data/data-store.js';
import { HookBus } from '../../hooks/hook-bus.js';
import { defineCoreTables } from '../../data/core-schema.js';
import { SecretStore } from '../secret-store.js';

let db: DataStore;
let hooks: HookBus;
let store: SecretStore;

beforeEach(async () => {
  db = new DataStore({ dbPath: ':memory:' });
  defineCoreTables(db);
  await db.init();
  hooks = new HookBus();
  store = new SecretStore(db, hooks);
});

afterEach(() => {
  db.close();
});

describe('SecretStore.set — upsert', () => {
  it('set() then get() returns the value', async () => {
    await store.set({ name: 'k', type: 'generic', value: 'v1' });
    expect(await store.get('k')).toBe('v1');
  });

  it('re-setting the same name keeps exactly ONE live row and returns the latest value', async () => {
    await store.set({ name: 'k', type: 'generic', value: 'v1' });
    await store.set({ name: 'k', type: 'generic', value: 'v2' });
    await store.set({ name: 'k', type: 'generic', value: 'v3' });

    expect(await store.get('k')).toBe('v3');
    const live = await db.query('secrets', {
      where: { name: 'k' },
      filters: [{ col: 'deleted_at', op: 'isNull' as const }],
    });
    expect(live.length).toBe(1); // not 3 — no duplicate accumulation
  });

  it('keeps separate rows per environment', async () => {
    await store.set({ name: 'k', type: 'generic', value: 'prod', environment: 'production' });
    await store.set({ name: 'k', type: 'generic', value: 'dev', environment: 'development' });
    expect(await store.get('k', 'production')).toBe('prod');
    expect(await store.get('k', 'development')).toBe('dev');
  });
});

describe('SecretStore.get — deterministic among legacy duplicates', () => {
  it('returns the newest row when pre-upsert duplicates exist', async () => {
    // Simulate the pre-upsert state: multiple live rows for the same key
    // (org_id NULL → the unique index treats them as distinct).
    await db.insert('secrets', {
      id: 'old', name: 'leg', type: 'generic', value: 'old',
      environment: 'production', created_at: '2026-01-01T00:00:00.000Z',
    });
    await db.insert('secrets', {
      id: 'new', name: 'leg', type: 'generic', value: 'new',
      environment: 'production', created_at: '2026-02-01T00:00:00.000Z',
    });
    expect(await store.get('leg')).toBe('new');
  });
});
