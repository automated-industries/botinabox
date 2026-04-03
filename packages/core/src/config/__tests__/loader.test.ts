import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, initConfig, getConfig, _resetConfig } from "../loader.js";
import { DEFAULT_CONFIG } from "../defaults.js";

const TMP = tmpdir();

function writeTmp(name: string, content: string): string {
  const p = join(TMP, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

describe("loadConfig — Story 1.2", () => {
  it("returns defaults when no config file present", () => {
    const { config, errors } = loadConfig({ configPath: "/nonexistent/path.yml" });
    expect(errors).toHaveLength(0);
    expect(config.data.path).toBe(DEFAULT_CONFIG.data.path);
    expect(config.models.default).toBe(DEFAULT_CONFIG.models.default);
  });

  it("merges config file over defaults", () => {
    const path = writeTmp("botinabox-test-merge.yml", `
data:
  path: ./custom/bot.db
  walMode: true
`);
    try {
      const { config, errors } = loadConfig({ configPath: path });
      expect(errors).toHaveLength(0);
      expect(config.data.path).toBe("./custom/bot.db");
      // non-overridden default preserved
      expect(config.models.default).toBe(DEFAULT_CONFIG.models.default);
    } finally {
      unlinkSync(path);
    }
  });

  it("runtime overrides take highest precedence", () => {
    const { config } = loadConfig({
      configPath: "/nonexistent/path.yml",
      overrides: { data: { path: "./override.db", walMode: false } },
    });
    expect(config.data.path).toBe("./override.db");
    expect(config.data.walMode).toBe(false);
  });

  it("interpolates env vars from file", () => {
    const path = writeTmp("botinabox-test-env.yml", `
data:
  path: \${DB_PATH}
  walMode: true
`);
    try {
      const { config, errors } = loadConfig({ configPath: path, env: { DB_PATH: "./env-db.db" } });
      expect(errors).toHaveLength(0);
      expect(config.data.path).toBe("./env-db.db");
    } finally {
      unlinkSync(path);
    }
  });

  it("returns error on invalid YAML, still returns defaults", () => {
    const path = writeTmp("botinabox-test-bad.yml", "{ invalid yaml: [[ unclosed");
    try {
      const { config, errors } = loadConfig({ configPath: path });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].field).toBe("configPath");
      // still returns a valid config (defaults)
      expect(config.data.path).toBe(DEFAULT_CONFIG.data.path);
    } finally {
      unlinkSync(path);
    }
  });

  it("returned config is frozen", () => {
    const { config } = loadConfig({ configPath: "/nonexistent/path.yml" });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("deep merge — nested keys not in override are preserved", () => {
    const { config } = loadConfig({
      configPath: "/nonexistent/path.yml",
      overrides: { models: { default: "fast" } as never },
    });
    // aliases and routing should still be present from defaults
    expect(config.models.aliases).toBeDefined();
    expect(config.models.aliases["fast"]).toBe(DEFAULT_CONFIG.models.aliases["fast"]);
  });

  it("merge order: defaults < file < overrides", () => {
    const path = writeTmp("botinabox-test-order.yml", `
models:
  default: balanced
`);
    try {
      const { config } = loadConfig({
        configPath: path,
        overrides: { models: { default: "fast" } as never },
      });
      expect(config.models.default).toBe("fast");
    } finally {
      unlinkSync(path);
    }
  });
});

describe("initConfig / getConfig singleton — Story 1.2", () => {
  beforeEach(() => _resetConfig());
  afterEach(() => _resetConfig());

  it("getConfig throws before initConfig", () => {
    expect(() => getConfig()).toThrow("Config not loaded");
  });

  it("initConfig returns errors and getConfig returns config", () => {
    const errors = initConfig({ configPath: "/nonexistent/path.yml" });
    expect(errors).toHaveLength(0);
    const cfg = getConfig();
    expect(cfg.data.path).toBe(DEFAULT_CONFIG.data.path);
  });

  it("initConfig twice — second call overwrites singleton", () => {
    initConfig({ configPath: "/nonexistent/path.yml" });
    initConfig({
      configPath: "/nonexistent/path.yml",
      overrides: { data: { path: "./override.db", walMode: true } },
    });
    expect(getConfig().data.path).toBe("./override.db");
  });
});
