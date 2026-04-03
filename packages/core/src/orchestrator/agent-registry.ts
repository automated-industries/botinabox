import type { DataStore } from '../data/data-store.js';
import type { HookBus } from '../hooks/hook-bus.js';
import { createConfigRevision } from './config-revisions.js';

const VALID_TRANSITIONS: Record<string, string[]> = {
  idle: ['running', 'paused'],
  running: ['idle', 'paused', 'terminated'],
  paused: ['idle', 'terminated'],
  terminated: [],
};

const WRITE_ACTIVITY_LOG_STATUSES = new Set(['paused', 'terminated']);

export class AgentRegistry {
  constructor(private db: DataStore, private hooks: HookBus) {}

  async register(
    agent: {
      slug: string;
      name: string;
      adapter: string;
      role?: string;
      [key: string]: unknown;
    },
    opts?: { actorAgentId?: string },
  ): Promise<string> {
    if (!agent.slug || !agent.name || !agent.adapter) {
      throw new Error('Agent must have slug, name, and adapter');
    }

    // Permission check: if actorAgentId is set, verify the actor can create agents
    if (opts?.actorAgentId) {
      const actor = this.db.get('agents', { id: opts.actorAgentId });
      if (!actor) throw new Error(`Actor agent not found: ${opts.actorAgentId}`);

      // Check canCreateAgents in adapter_config JSON
      let canCreate = false;
      try {
        const cfg = JSON.parse((actor['adapter_config'] as string) ?? '{}') as Record<string, unknown>;
        canCreate = cfg['canCreateAgents'] === true;
      } catch {
        canCreate = false;
      }

      if (!canCreate) {
        throw new Error(`Agent ${opts.actorAgentId} does not have permission to create agents`);
      }
    }

    const row = this.db.insert('agents', {
      slug: agent.slug,
      name: agent.name,
      adapter: agent.adapter,
      role: agent.role ?? 'general',
      ...Object.fromEntries(
        Object.entries(agent).filter(([k]) => !['slug', 'name', 'adapter', 'role'].includes(k))
      ),
    });

    const newAgentId = row['id'] as string;

    if (opts?.actorAgentId) {
      this.db.insert('activity_log', {
        agent_id: opts.actorAgentId,
        event_type: 'agent_created_by_agent',
        payload: JSON.stringify({
          actorAgentId: opts.actorAgentId,
          newAgentId,
          slug: agent.slug,
        }),
      });
    }

    await this.hooks.emit('agent.created', { agentId: newAgentId, slug: agent.slug });
    return newAgentId;
  }

  async getById(id: string): Promise<Record<string, unknown> | undefined> {
    return this.db.get('agents', { id }) ?? undefined;
  }

  async getBySlug(slug: string): Promise<Record<string, unknown> | undefined> {
    const rows = this.db.query('agents', { where: { slug } });
    return rows[0] ?? undefined;
  }

  async list(filter?: { status?: string; role?: string }): Promise<Record<string, unknown>[]> {
    const where: Record<string, unknown> = {};
    if (filter?.status) where['status'] = filter.status;
    if (filter?.role) where['role'] = filter.role;
    return this.db.query('agents', Object.keys(where).length ? { where } : undefined);
  }

  async update(id: string, changes: Record<string, unknown>): Promise<void> {
    const existing = this.db.get('agents', { id });
    if (!existing) throw new Error(`Agent not found: ${id}`);

    const before = { ...existing };
    await createConfigRevision(this.db, id, before, { ...before, ...changes });

    this.db.update('agents', { id }, {
      ...changes,
      updated_at: new Date().toISOString(),
    });
  }

  async setStatus(id: string, newStatus: string): Promise<void> {
    const agent = this.db.get('agents', { id });
    if (!agent) throw new Error(`Agent not found: ${id}`);

    const currentStatus = agent['status'] as string;
    const allowed = VALID_TRANSITIONS[currentStatus] ?? [];

    if (!allowed.includes(newStatus)) {
      throw new Error(
        `Invalid status transition: ${currentStatus} → ${newStatus}`
      );
    }

    this.db.update('agents', { id }, {
      status: newStatus,
      updated_at: new Date().toISOString(),
    });

    if (WRITE_ACTIVITY_LOG_STATUSES.has(newStatus)) {
      this.db.insert('activity_log', {
        agent_id: id,
        event_type: `agent.${newStatus}`,
        payload: JSON.stringify({ agentId: id, status: newStatus }),
      });
    }
  }

  async terminate(id: string): Promise<void> {
    const agent = this.db.get('agents', { id });
    if (!agent) throw new Error(`Agent not found: ${id}`);

    const currentStatus = agent['status'] as string;
    if (currentStatus === 'terminated') {
      // Already terminated — no-op
      return;
    }

    this.db.update('agents', { id }, {
      status: 'terminated',
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    this.db.insert('activity_log', {
      agent_id: id,
      event_type: 'agent.terminated',
      payload: JSON.stringify({ agentId: id }),
    });
  }

  async seedFromConfig(
    agentConfigs: Array<{ slug: string; name: string; adapter: string; [key: string]: unknown }>
  ): Promise<void> {
    for (const config of agentConfigs) {
      const existing = await this.getBySlug(config.slug);
      if (existing) continue; // Skip — DB values take precedence

      await this.register(config);
    }
  }
}
