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

describe('Agent Creates Agent — Story 5.5', () => {
  it('agent with canCreateAgents permission creates agent successfully', async () => {
    // Create actor agent with permission
    const actorId = await registry.register({
      slug: 'factory-agent',
      name: 'Factory Agent',
      adapter: 'cli',
      adapter_config: JSON.stringify({ canCreateAgents: true }),
    });

    // Actor creates a new agent
    const newId = await registry.register(
      { slug: 'child-agent', name: 'Child Agent', adapter: 'api' },
      { actorAgentId: actorId },
    );

    expect(typeof newId).toBe('string');
    const newAgent = await registry.getById(newId);
    expect(newAgent!['slug']).toBe('child-agent');
  });

  it('agent without canCreateAgents is blocked', async () => {
    const actorId = await registry.register({
      slug: 'limited-agent',
      name: 'Limited Agent',
      adapter: 'cli',
      adapter_config: JSON.stringify({ canCreateAgents: false }),
    });

    await expect(
      registry.register(
        { slug: 'forbidden-agent', name: 'Forbidden', adapter: 'api' },
        { actorAgentId: actorId },
      )
    ).rejects.toThrow('does not have permission to create agents');
  });

  it('agent with no adapter_config canCreateAgents is blocked', async () => {
    const actorId = await registry.register({
      slug: 'plain-agent',
      name: 'Plain Agent',
      adapter: 'cli',
    });

    await expect(
      registry.register(
        { slug: 'another-agent', name: 'Another', adapter: 'api' },
        { actorAgentId: actorId },
      )
    ).rejects.toThrow('does not have permission to create agents');
  });

  it('logs agent_created_by_agent event to activity_log', async () => {
    const actorId = await registry.register({
      slug: 'creator-agent',
      name: 'Creator',
      adapter: 'cli',
      adapter_config: JSON.stringify({ canCreateAgents: true }),
    });

    const newId = await registry.register(
      { slug: 'created-agent', name: 'Created', adapter: 'api' },
      { actorAgentId: actorId },
    );

    const logs = await db.query('activity_log', { where: { event_type: 'agent_created_by_agent' } });
    expect(logs).toHaveLength(1);
    const payload = JSON.parse(logs[0]!['payload'] as string) as Record<string, unknown>;
    expect(payload['actorAgentId']).toBe(actorId);
    expect(payload['newAgentId']).toBe(newId);
    expect(payload['slug']).toBe('created-agent');
  });

  it('no actorAgentId — registers normally without permission check', async () => {
    const id = await registry.register({ slug: 'normal-agent', name: 'Normal', adapter: 'cli' });
    expect(typeof id).toBe('string');
  });

  it('nonexistent actorAgentId throws', async () => {
    await expect(
      registry.register(
        { slug: 'some-agent', name: 'Some', adapter: 'api' },
        { actorAgentId: 'nonexistent-id' },
      )
    ).rejects.toThrow('Actor agent not found');
  });
});
