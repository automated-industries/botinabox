import type { DataStore } from '../data/data-store.js';
import type { HookBus } from '../hooks/hook-bus.js';

export class BudgetController {
  constructor(private db: DataStore, private hooks: HookBus) {}

  async checkBudget(agentId: string): Promise<{
    allowed: boolean;
    reason?: string;
    currentSpendCents: number;
    limitCents: number;
  }> {
    const agent = await this.db.get('agents', { id: agentId });
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const limitCents = (agent['budget_monthly_cents'] as number) ?? 0;
    const currentSpendCents = (agent['spent_monthly_cents'] as number) ?? 0;

    // No budget set = always allowed
    if (limitCents <= 0) {
      return { allowed: true, currentSpendCents, limitCents };
    }

    if (currentSpendCents >= limitCents) {
      return {
        allowed: false,
        reason: 'Monthly budget exceeded',
        currentSpendCents,
        limitCents,
      };
    }

    // Check warn threshold — look up agent-specific policy first, then global
    let warnPercent = 80;
    const agentPolicies = await this.db.query('budget_policies', {
      where: { agent_id: agentId },
    });
    if (agentPolicies.length > 0) {
      warnPercent = (agentPolicies[0]!['warn_percent'] as number) ?? 80;
    }

    const warnThreshold = limitCents * (warnPercent / 100);
    if (currentSpendCents >= warnThreshold) {
      await this.hooks.emit('budget.exceeded', {
        agentId,
        currentSpendCents,
        limitCents,
        warnPercent,
        message: `Budget warning: ${currentSpendCents} of ${limitCents} cents used (${warnPercent}% threshold)`,
      });
    }

    return { allowed: true, currentSpendCents, limitCents };
  }

  async resetMonthlySpend(agentId: string): Promise<void> {
    await this.db.update('agents', { id: agentId }, {
      spent_monthly_cents: 0,
      updated_at: new Date().toISOString(),
    });
  }

  async globalCheck(): Promise<{
    allowed: boolean;
    totalSpentCents: number;
    limitCents: number;
  }> {
    const agents = await this.db.query('agents');
    const totalSpentCents = agents.reduce(
      (sum, a) => sum + ((a['spent_monthly_cents'] as number) ?? 0),
      0,
    );

    // Find global budget policy
    const globalPolicies = await this.db.query('budget_policies', {
      where: { scope: 'global' },
    });

    if (globalPolicies.length === 0) {
      return { allowed: true, totalSpentCents, limitCents: 0 };
    }

    const limitCents = (globalPolicies[0]!['monthly_limit_cents'] as number) ?? 0;

    if (limitCents <= 0) {
      return { allowed: true, totalSpentCents, limitCents };
    }

    return {
      allowed: totalSpentCents < limitCents,
      totalSpentCents,
      limitCents,
    };
  }
}
