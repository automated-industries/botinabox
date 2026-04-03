import type { ModelConfig } from "@botinabox/shared";
import type { ModelInfo, ResolvedModel } from "./types.js";
import type { ProviderRegistry } from "./provider-registry.js";

export class ModelRouter {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly config: ModelConfig,
  ) {}

  /**
   * Resolve a model ID or alias to a ResolvedModel.
   * 1. Look up alias in config.aliases (or use as-is)
   * 2. Search all registered providers for a model with that id
   */
  resolve(modelIdOrAlias: string): ResolvedModel | undefined {
    const modelId = this.config.aliases[modelIdOrAlias] ?? modelIdOrAlias;

    for (const provider of this.registry.list()) {
      const found = provider.models.find((m) => m.id === modelId);
      if (found) {
        return { provider: provider.id, model: found.id };
      }
    }

    return undefined;
  }

  /**
   * Try primary model, then each in config.fallbackChain.
   * Throws if none found.
   */
  resolveWithFallback(modelIdOrAlias: string): ResolvedModel {
    const primary = this.resolve(modelIdOrAlias);
    if (primary) return primary;

    for (const fallback of this.config.fallbackChain) {
      const resolved = this.resolve(fallback);
      if (resolved) return resolved;
    }

    throw new Error(
      `No available model found for "${modelIdOrAlias}" and fallback chain [${this.config.fallbackChain.join(", ")}]`,
    );
  }

  /**
   * Use config.routing[purpose] ?? config.default, then resolveWithFallback.
   */
  resolveForPurpose(purpose: string): ResolvedModel {
    const modelIdOrAlias = this.config.routing[purpose] ?? this.config.default;
    return this.resolveWithFallback(modelIdOrAlias);
  }

  /** Returns all models from all registered providers. */
  listAvailable(): ModelInfo[] {
    return this.registry.listModels();
  }
}
