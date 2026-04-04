import type { HookBus } from "../hooks/hook-bus.js";
import type { DataStore } from "../data/data-store.js";
import type { ModelInfo, TokenUsage } from "./types.js";

interface RunCompletedPayload {
  runId?: string;
  agentId?: string;
  usage?: TokenUsage & { model?: string; provider?: string };
  model?: string;
  provider?: string;
}

function calculateCostCents(usage: TokenUsage, model?: ModelInfo): number {
  if (!model?.inputCostPerMToken) return 0;
  const inputCost = (usage.inputTokens / 1_000_000) * model.inputCostPerMToken;
  const outputCost = (usage.outputTokens / 1_000_000) * (model.outputCostPerMToken ?? 0);
  return Math.round((inputCost + outputCost) * 100);
}

export function setupCostTracker(
  hooks: HookBus,
  db: DataStore,
  opts?: { modelCatalog?: ModelInfo[] },
): void {
  const catalog = opts?.modelCatalog ?? [];

  hooks.register(
    "run.completed",
    async (payload: unknown) => {
      const ctx = payload as RunCompletedPayload;
      if (!ctx.usage) return;

      const modelId = ctx.usage.model ?? ctx.model;
      const providerId = ctx.usage.provider ?? ctx.provider;
      if (!modelId || !providerId) return;

      const modelInfo = catalog.find((m) => m.id === modelId);
      const costCents = calculateCostCents(ctx.usage, modelInfo);

      await db.insert("cost_events", {
        agent_id: ctx.agentId ?? null,
        run_id: ctx.runId ?? null,
        provider: providerId,
        model: modelId,
        input_tokens: ctx.usage.inputTokens,
        output_tokens: ctx.usage.outputTokens,
        cost_cents: costCents,
      });

      if (ctx.agentId) {
        const agent = await db.get("agents", ctx.agentId);
        if (agent) {
          await db.update("agents", ctx.agentId, {
            spent_monthly_cents:
              ((agent.spent_monthly_cents as number) ?? 0) + costCents,
          });
        }
      }
    },
    { priority: 20 },
  );
}
