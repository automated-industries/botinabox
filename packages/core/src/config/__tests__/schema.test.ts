import { describe, it, expect } from "vitest";
import { validateConfig } from "../schema.js";
import { DEFAULT_CONFIG } from "../defaults.js";

describe("validateConfig — Story 1.2", () => {
  it("DEFAULT_CONFIG passes validation", () => {
    const errors = validateConfig(DEFAULT_CONFIG);
    expect(errors).toHaveLength(0);
  });

  it("valid minimal config passes", () => {
    const cfg = {
      data: { path: "./bot.db", walMode: true },
      channels: {},
      agents: [],
      providers: {},
      models: {
        aliases: { fast: "claude-haiku-4-5" },
        default: "fast",
        routing: {},
        fallbackChain: [],
      },
      entities: {},
      security: {},
      render: { outputDir: "./context", watchIntervalMs: 30_000 },
      updates: { policy: "manual", checkIntervalMs: 86_400_000 },
      budget: { warnPercent: 80 },
    };
    expect(validateConfig(cfg)).toHaveLength(0);
  });

  it("missing required data.path returns error", () => {
    const cfg = { ...DEFAULT_CONFIG, data: { walMode: true } };
    const errors = validateConfig(cfg);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("invalid updates.policy returns error", () => {
    const cfg = { ...DEFAULT_CONFIG, updates: { policy: "invalid-policy", checkIntervalMs: 86_400_000 } };
    const errors = validateConfig(cfg);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("budget.warnPercent > 100 returns error", () => {
    const cfg = { ...DEFAULT_CONFIG, budget: { warnPercent: 150 } };
    const errors = validateConfig(cfg);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("agent slug with invalid chars returns error", () => {
    const cfg = {
      ...DEFAULT_CONFIG,
      agents: [{ slug: "My Agent!", name: "Test", adapter: "cli" }],
    };
    const errors = validateConfig(cfg);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("valid agent config passes", () => {
    const cfg = {
      ...DEFAULT_CONFIG,
      agents: [{
        slug: "my-agent",
        name: "My Agent",
        adapter: "cli",
        model: "smart",
        maxConcurrentRuns: 2,
        canCreateAgents: false,
      }],
    };
    expect(validateConfig(cfg)).toHaveLength(0);
  });

  it("non-object input returns error", () => {
    const errors = validateConfig("not an object");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("null input returns error", () => {
    const errors = validateConfig(null);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("error objects have path and message", () => {
    const cfg = { ...DEFAULT_CONFIG, data: { walMode: true } };
    const errors = validateConfig(cfg);
    expect(errors[0]).toHaveProperty("path");
    expect(errors[0]).toHaveProperty("message");
  });
});
