/**
 * Regression test: Agent lookup by role in built-in tools.
 *
 * Bug: dispatch_task, get_agent_status, get_agent_detail, and reassign_task
 * only look up agents by slug. But tool descriptions and list_agents output
 * lead LLMs to use role names (e.g. "engineer") as identifiers. When the
 * LLM calls dispatch_task({ agent_slug: "engineer" }), it fails because
 * the agent's slug is "bot-eng" — "engineer" is the role.
 *
 * Fix: All agent-resolving tools must fall back: slug → role → name.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataStore } from '../../data/data-store.js';
import { HookBus } from '../../hooks/hook-bus.js';
import { defineCoreTables } from '../../data/core-schema.js';
import { dispatchTaskTool, reassignTaskTool } from '../tools/task-ops.js';
import { getAgentStatusTool, getAgentDetailTool } from '../tools/index.js';
import type { ToolContext } from '../execution-engine.js';

let db: DataStore;
let hooks: HookBus;
let ctx: ToolContext;

beforeEach(async () => {
  db = new DataStore({ dbPath: ':memory:' });
  defineCoreTables(db);
  await db.init();
  hooks = new HookBus();

  // Seed agents: slug and role are different values
  await db.insert('agents', {
    slug: 'bot-eng', name: 'Engineer Bot', adapter: 'cli', role: 'engineer',
  });
  await db.insert('agents', {
    slug: 'bot-qa', name: 'QA Bot', adapter: 'cli', role: 'qa',
  });
  await db.insert('agents', {
    slug: 'bot-res', name: 'Research Bot', adapter: 'cli', role: 'research',
  });

  ctx = { taskId: 'test-task', agentId: 'test-caller', hooks, db, resolvePath: (p: string) => p };
});

afterEach(() => { db.close(); });

describe('dispatch_task — agent lookup by role', () => {
  it('finds agent by slug (baseline)', async () => {
    const result = await dispatchTaskTool.handler(
      { agent_slug: 'bot-eng', title: 'Test task' }, ctx,
    );
    expect(result).toContain('Engineer Bot');
    expect(result).not.toContain('not found');
  });

  it('finds agent by role when slug does not match', async () => {
    const result = await dispatchTaskTool.handler(
      { agent_slug: 'engineer', title: 'Fix the bug' }, ctx,
    );
    expect(result).toContain('Engineer Bot');
    expect(result).not.toContain('not found');
  });

  it('finds agent by name when slug and role do not match', async () => {
    const result = await dispatchTaskTool.handler(
      { agent_slug: 'Engineer Bot', title: 'Fix the bug' }, ctx,
    );
    expect(result).toContain('Engineer Bot');
    expect(result).not.toContain('not found');
  });

  it('finds agent by role case-insensitively', async () => {
    const result = await dispatchTaskTool.handler(
      { agent_slug: 'Engineer', title: 'Fix the bug' }, ctx,
    );
    expect(result).toContain('Engineer Bot');
    expect(result).not.toContain('not found');
  });

  it('still returns error for truly unknown agent', async () => {
    const result = await dispatchTaskTool.handler(
      { agent_slug: 'nonexistent', title: 'Test' }, ctx,
    );
    expect(result).toContain('not found');
  });
});

describe('get_agent_status — agent lookup by role', () => {
  it('finds agent by slug (baseline)', async () => {
    const result = await getAgentStatusTool.handler({ agent_slug: 'bot-eng' }, ctx);
    expect(result).toContain('Engineer Bot');
    expect(result).not.toContain('not found');
  });

  it('finds agent by role', async () => {
    const result = await getAgentStatusTool.handler({ agent_slug: 'engineer' }, ctx);
    expect(result).toContain('Engineer Bot');
    expect(result).not.toContain('not found');
  });

  it('finds agent by name', async () => {
    const result = await getAgentStatusTool.handler({ agent_slug: 'Engineer Bot' }, ctx);
    expect(result).toContain('Engineer Bot');
    expect(result).not.toContain('not found');
  });
});

describe('get_agent_detail — agent lookup by role', () => {
  it('finds agent by slug (baseline)', async () => {
    const result = await getAgentDetailTool.handler({ agent_slug: 'bot-eng' }, ctx);
    expect(result).toContain('Engineer Bot');
    expect(result).not.toContain('not found');
  });

  it('finds agent by role', async () => {
    const result = await getAgentDetailTool.handler({ agent_slug: 'engineer' }, ctx);
    expect(result).toContain('Engineer Bot');
    expect(result).not.toContain('not found');
  });
});

describe('reassign_task — agent lookup by role', () => {
  it('reassigns to agent found by role', async () => {
    const task = await db.insert('tasks', {
      title: 'Reassign me', status: 'todo',
      assignee_id: (await db.query('agents', { where: { slug: 'bot-eng' } }))[0]!.id,
    });

    const result = await reassignTaskTool.handler(
      { task_id: task.id as string, new_agent_slug: 'qa' }, ctx,
    );
    expect(result).toContain('QA Bot');
    expect(result).not.toContain('not found');
  });
});
