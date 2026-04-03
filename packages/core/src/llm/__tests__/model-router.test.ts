import { describe, it, expect, beforeEach } from "vitest";
import { ProviderRegistry } from "../provider-registry.js";
import { ModelRouter } from "../model-router.js";
import type { LLMProvider, ModelInfo } from "../types.js";
import type { ModelConfig } from "@botinabox/shared";

function makeProvider(id: string, models: ModelInfo[]): LLMProvider {
  return {
    id,
    displayName: `Provider ${id}`,
    models,
    chat: async () => {
      throw new Error("not implemented");
    },
    async *chatStream() {
      throw new Error("not implemented");
    },
    serializeTools: () => [],
  };
}

function makeModel(id: string): ModelInfo {
  return {
    id,
    displayName: `Model ${id}`,
    contextWindow: 200_000,
    maxOutputTokens: 8192,
    capabilities: ["chat", "tools"],
  };
}

function makeConfig(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    aliases: {},
    default: "claude-opus-4-5",
    routing: {},
    fallbackChain: [],
    ...overrides,
  };
}

describe("ModelRouter — Story 2.2", () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
    registry.register(
      makeProvider("anthropic", [
        makeModel("claude-opus-4-5"),
        makeModel("claude-haiku-4-5"),
        makeModel("claude-sonnet-4-5"),
      ]),
    );
    registry.register(
      makeProvider("openai", [
        makeModel("gpt-4o"),
        makeModel("gpt-4o-mini"),
      ]),
    );
  });

  describe("resolve", () => {
    it("resolve direct model ID returns correct provider + model", () => {
      const router = new ModelRouter(registry, makeConfig());
      const result = router.resolve("claude-opus-4-5");
      expect(result).toEqual({ provider: "anthropic", model: "claude-opus-4-5" });
    });

    it("resolve model from second provider", () => {
      const router = new ModelRouter(registry, makeConfig());
      const result = router.resolve("gpt-4o");
      expect(result).toEqual({ provider: "openai", model: "gpt-4o" });
    });

    it("resolve alias (e.g., 'fast' → 'claude-haiku-4-5')", () => {
      const router = new ModelRouter(
        registry,
        makeConfig({ aliases: { fast: "claude-haiku-4-5" } }),
      );
      const result = router.resolve("fast");
      expect(result).toEqual({ provider: "anthropic", model: "claude-haiku-4-5" });
    });

    it("resolve unknown returns undefined", () => {
      const router = new ModelRouter(registry, makeConfig());
      expect(router.resolve("nonexistent-model")).toBeUndefined();
    });

    it("resolve unknown alias returns undefined", () => {
      const router = new ModelRouter(
        registry,
        makeConfig({ aliases: { fast: "nonexistent-model" } }),
      );
      expect(router.resolve("fast")).toBeUndefined();
    });
  });

  describe("resolveWithFallback", () => {
    it("returns primary model when available", () => {
      const router = new ModelRouter(registry, makeConfig());
      const result = router.resolveWithFallback("claude-opus-4-5");
      expect(result).toEqual({ provider: "anthropic", model: "claude-opus-4-5" });
    });

    it("uses fallback chain when primary unavailable", () => {
      const router = new ModelRouter(
        registry,
        makeConfig({ fallbackChain: ["gpt-4o-mini", "claude-haiku-4-5"] }),
      );
      const result = router.resolveWithFallback("nonexistent-model");
      expect(result).toEqual({ provider: "openai", model: "gpt-4o-mini" });
    });

    it("tries next in chain if first fallback also unavailable", () => {
      const router = new ModelRouter(
        registry,
        makeConfig({ fallbackChain: ["also-nonexistent", "claude-haiku-4-5"] }),
      );
      const result = router.resolveWithFallback("nonexistent-model");
      expect(result).toEqual({ provider: "anthropic", model: "claude-haiku-4-5" });
    });

    it("throws when all fail with clear error message", () => {
      const router = new ModelRouter(
        registry,
        makeConfig({ fallbackChain: ["also-gone", "still-gone"] }),
      );
      expect(() => router.resolveWithFallback("nonexistent")).toThrow(
        /No available model found for "nonexistent"/,
      );
    });

    it("throws when no fallback chain configured and primary unavailable", () => {
      const router = new ModelRouter(registry, makeConfig({ fallbackChain: [] }));
      expect(() => router.resolveWithFallback("nonexistent")).toThrow(
        /No available model found/,
      );
    });
  });

  describe("resolveForPurpose", () => {
    it("uses routing config for known purpose", () => {
      const router = new ModelRouter(
        registry,
        makeConfig({ routing: { chat: "gpt-4o" }, default: "claude-opus-4-5" }),
      );
      const result = router.resolveForPurpose("chat");
      expect(result).toEqual({ provider: "openai", model: "gpt-4o" });
    });

    it("with unknown purpose falls back to config.default", () => {
      const router = new ModelRouter(
        registry,
        makeConfig({ routing: { chat: "gpt-4o" }, default: "claude-haiku-4-5" }),
      );
      const result = router.resolveForPurpose("unknown-purpose");
      expect(result).toEqual({ provider: "anthropic", model: "claude-haiku-4-5" });
    });

    it("routing purpose with alias resolves correctly", () => {
      const router = new ModelRouter(
        registry,
        makeConfig({
          aliases: { fast: "claude-haiku-4-5" },
          routing: { summarize: "fast" },
          default: "claude-opus-4-5",
        }),
      );
      const result = router.resolveForPurpose("summarize");
      expect(result).toEqual({ provider: "anthropic", model: "claude-haiku-4-5" });
    });

    it("throws when purpose resolves to unavailable model with no fallback", () => {
      const router = new ModelRouter(
        registry,
        makeConfig({ routing: { chat: "nonexistent" }, fallbackChain: [], default: "also-nonexistent" }),
      );
      expect(() => router.resolveForPurpose("chat")).toThrow(/No available model found/);
    });
  });

  describe("listAvailable", () => {
    it("returns all models from all registered providers", () => {
      const router = new ModelRouter(registry, makeConfig());
      const models = router.listAvailable();
      expect(models).toHaveLength(5);
      const ids = models.map((m) => m.id).sort();
      expect(ids).toEqual([
        "claude-haiku-4-5",
        "claude-opus-4-5",
        "claude-sonnet-4-5",
        "gpt-4o",
        "gpt-4o-mini",
      ]);
    });
  });
});
