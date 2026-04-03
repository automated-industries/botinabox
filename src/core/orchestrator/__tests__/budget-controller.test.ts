import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataStore } from '../../data/data-store.js';
import { HookBus } from '../../hooks/hook-bus.js';
import { defineCoreTables } from '../../data/core-schema.js';
import { BudgetController } from '../budget-controller.js';

let db: DataStore;
let hooks: HookBus;
let controller: BudgetController;

beforeEach(async () => {
  db = new DataStore({ dbPath: ':memory:' });
  defineCoreTables(db);
  await db.init();
  hooks = new HookBus();
  controller = new BudgetController(db, hooks);
});

afterEach(() => {
  db.close();
});

async function createAgent(overrides: Record<string, unknown> = {}): Promise<string> {
  const row = await db.insert('agents', {
    slug: `agent-${Math.random().toString(36).slice(2)}`,
    name: 'Test Agent',
    adapter: 'cli',
    budget_monthly_cents: 1000,
    spent_monthly_cents: 0,
    ...overrides,
  });
  return row['id'] as string;
}

describe('BudgetController — Story 3.6', () => {
  it('allows when spend is below limit', async () => {
    const id = await createAgent({ budget_monthly_cents: 1000, spent_monthly_cents: 500 });
    const result = await controller.checkBudget(id);
    expect(result.allowed).toBe(true);
    expect(result.currentSpendCents).toBe(500);
    expect(result.limitCents).toBe(1000);
  });

  it('blocks when spend equals limit', async () => {
    const id = await createAgent({ budget_monthly_cents: 1000, spent_monthly_cents: 1000 });
    const result = await controller.checkBudget(id);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Monthly budget exceeded');
  });

  it('blocks when spend exceeds limit', async () => {
    const id = await createAgent({ budget_monthly_cents: 1000, spent_monthly_cents: 1100 });
    const result = await controller.checkBudget(id);
    expect(result.allowed).toBe(false);
  });

  it('emits budget.exceeded hook at warn threshold', async () => {
    const events: Record<string, unknown>[] = [];
    hooks.register('budget.exceeded', (ctx) => { events.push(ctx); });

    const id = await createAgent({ budget_monthly_cents: 1000, spent_monthly_cents: 850 });
    const result = await controller.checkBudget(id);

    expect(result.allowed).toBe(true); // Still allowed
    expect(events).toHaveLength(1); // But warning emitted
    expect(events[0]!['agentId']).toBe(id);
  });

  it('no budget = always allowed', async () => {
    const id = await createAgent({ budget_monthly_cents: 0, spent_monthly_cents: 0 });
    const result = await controller.checkBudget(id);
    expect(result.allowed).toBe(true);
  });

  it('resetMonthlySpend sets spent to zero', async () => {
    const id = await createAgent({ budget_monthly_cents: 1000, spent_monthly_cents: 500 });
    await controller.resetMonthlySpend(id);
    const agent = await db.get('agents', { id });
    expect(agent!['spent_monthly_cents']).toBe(0);
  });

  it('globalCheck returns allowed when total < global limit', async () => {
    await createAgent({ spent_monthly_cents: 100 });
    await createAgent({ spent_monthly_cents: 200 });

    await db.insert('budget_policies', {
      scope: 'global',
      monthly_limit_cents: 1000,
      warn_percent: 80,
    });

    const result = await controller.globalCheck();
    expect(result.allowed).toBe(true);
    expect(result.totalSpentCents).toBe(300);
    expect(result.limitCents).toBe(1000);
  });

  it('globalCheck returns not allowed when total >= global limit', async () => {
    await createAgent({ spent_monthly_cents: 600 });
    await createAgent({ spent_monthly_cents: 500 });

    await db.insert('budget_policies', {
      scope: 'global',
      monthly_limit_cents: 1000,
      warn_percent: 80,
    });

    const result = await controller.globalCheck();
    expect(result.allowed).toBe(false);
    expect(result.totalSpentCents).toBe(1100);
  });

  it('globalCheck allows when no global policy exists', async () => {
    await createAgent({ spent_monthly_cents: 999_999 });
    const result = await controller.globalCheck();
    expect(result.allowed).toBe(true);
  });
});
