import { describe, it, expect, beforeEach } from "vitest";
import { ProviderRegistry } from "../provider-registry.js";
import type { LLMProvider, ModelInfo } from "../types.js";

function makeProvider(id: string, models: ModelInfo[] = []): LLMProvider {
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

describe("ProviderRegistry — Story 2.1", () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  it("register + get: provider retrievable by ID", () => {
    const provider = makeProvider("anthropic");
    registry.register(provider);
    expect(registry.get("anthropic")).toBe(provider);
  });

  it("register duplicate throws", () => {
    registry.register(makeProvider("anthropic"));
    expect(() => registry.register(makeProvider("anthropic"))).toThrow(
      "Provider already registered: anthropic",
    );
  });

  it("unregister: provider no longer in get/list", () => {
    const provider = makeProvider("anthropic");
    registry.register(provider);
    registry.unregister("anthropic");
    expect(registry.get("anthropic")).toBeUndefined();
    expect(registry.list()).toHaveLength(0);
  });

  it("unregister non-existent id is a no-op", () => {
    expect(() => registry.unregister("nonexistent")).not.toThrow();
  });

  it("list returns all registered providers", () => {
    registry.register(makeProvider("anthropic"));
    registry.register(makeProvider("openai"));
    const ids = registry.list().map((p) => p.id).sort();
    expect(ids).toEqual(["anthropic", "openai"]);
  });

  it("listModels aggregates models from 2 providers", () => {
    const model1 = makeModel("claude-opus-4-5");
    const model2 = makeModel("claude-haiku-4-5");
    const model3 = makeModel("gpt-4o");

    registry.register(makeProvider("anthropic", [model1, model2]));
    registry.register(makeProvider("openai", [model3]));

    const models = registry.listModels();
    expect(models).toHaveLength(3);
    const ids = models.map((m) => m.id).sort();
    expect(ids).toEqual(["claude-haiku-4-5", "claude-opus-4-5", "gpt-4o"]);
  });

  it("listModels returns empty array when no providers registered", () => {
    expect(registry.listModels()).toEqual([]);
  });

  it("get returns undefined for unknown id", () => {
    expect(registry.get("unknown")).toBeUndefined();
  });
});
