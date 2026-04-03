import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataStore } from '../../data/data-store.js';
import { HookBus } from '../../hooks/hook-bus.js';
import { defineCoreTables } from '../../data/core-schema.js';
import { AgentRegistry } from '../agent-registry.js';

let db: DataStore;
let hooks: HookBus;
let registry: AgentRegistry;

beforeEach(async () => {
  db = new DataStore({ dbPath: ':memory:' });
  defineCoreTables(db);
  await db.init();
  hooks = new HookBus();
  registry = new AgentRegistry(db, hooks);
});

afterEach(() => {
  db.close();
});

describe('AgentRegistry — Story 3.1', () => {
  it('register inserts agent and returns id', async () => {
    const id = await registry.register({ slug: 'bot-1', name: 'Bot One', adapter: 'cli' });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('register emits agent.created hook', async () => {
    const events: Record<string, unknown>[] = [];
    hooks.register('agent.created', (ctx) => { events.push(ctx); });
    await registry.register({ slug: 'bot-2', name: 'Bot Two', adapter: 'api' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ slug: 'bot-2' });
  });

  it('register throws if required fields missing', async () => {
    await expect(
      registry.register({ slug: '', name: 'No Slug', adapter: 'cli' })
    ).rejects.toThrow();
    await expect(
      registry.register({ slug: 'x', name: '', adapter: 'cli' })
    ).rejects.toThrow();
    await expect(
      registry.register({ slug: 'x', name: 'X', adapter: '' })
    ).rejects.toThrow();
  });

  it('getById returns agent', async () => {
    const id = await registry.register({ slug: 'bot-3', name: 'Bot Three', adapter: 'cli' });
    const agent = await registry.getById(id);
    expect(agent).toBeDefined();
    expect(agent!['slug']).toBe('bot-3');
  });

  it('getBySlug returns agent', async () => {
    await registry.register({ slug: 'bot-4', name: 'Bot Four', adapter: 'cli' });
    const agent = await registry.getBySlug('bot-4');
    expect(agent).toBeDefined();
    expect(agent!['name']).toBe('Bot Four');
  });

  it('list filters by status', async () => {
    const id1 = await registry.register({ slug: 'bot-5a', name: 'Bot 5a', adapter: 'cli' });
    const id2 = await registry.register({ slug: 'bot-5b', name: 'Bot 5b', adapter: 'cli' });
    await registry.setStatus(id1, 'running');

    const running = await registry.list({ status: 'running' });
    expect(running.some((a) => a['id'] === id1)).toBe(true);
    expect(running.some((a) => a['id'] === id2)).toBe(false);
  });

  it('list filters by role', async () => {
    await registry.register({ slug: 'bot-6a', name: 'Bot 6a', adapter: 'cli', role: 'worker' });
    await registry.register({ slug: 'bot-6b', name: 'Bot 6b', adapter: 'cli', role: 'overseer' });
    const workers = await registry.list({ role: 'worker' });
    expect(workers.every((a) => a['role'] === 'worker')).toBe(true);
  });

  it('update creates config_revision', async () => {
    const id = await registry.register({ slug: 'bot-7', name: 'Bot Seven', adapter: 'cli' });
    await registry.update(id, { name: 'Bot Seven Updated' });
    const revisions = await db.query('config_revisions', { where: { notes: id } });
    expect(revisions.length).toBeGreaterThan(0);
  });

  it('setStatus validates transitions', async () => {
    const id = await registry.register({ slug: 'bot-8', name: 'Bot Eight', adapter: 'cli' });
    // idle → running is valid
    await registry.setStatus(id, 'running');
    // running → terminated is valid
    await registry.setStatus(id, 'terminated');
    // terminated → anything throws
    await expect(registry.setStatus(id, 'idle')).rejects.toThrow('Invalid status transition');
  });

  it('terminate sets deleted_at and writes activity_log', async () => {
    const id = await registry.register({ slug: 'bot-9', name: 'Bot Nine', adapter: 'cli' });
    await registry.terminate(id);
    const agent = await registry.getById(id);
    expect(agent!['status']).toBe('terminated');
    expect(agent!['deleted_at']).toBeTruthy();

    const logs = await db.query('activity_log', { where: { agent_id: id } });
    expect(logs.some((l) => l['event_type'] === 'agent.terminated')).toBe(true);
  });

  it('seedFromConfig skips existing agents', async () => {
    await registry.register({ slug: 'bot-10', name: 'Original', adapter: 'cli' });
    await registry.seedFromConfig([
      { slug: 'bot-10', name: 'Overwrite', adapter: 'api' },
      { slug: 'bot-10b', name: 'New Bot', adapter: 'cli' },
    ]);

    const original = await registry.getBySlug('bot-10');
    expect(original!['name']).toBe('Original'); // Not overwritten

    const newBot = await registry.getBySlug('bot-10b');
    expect(newBot).toBeDefined();
  });
});
