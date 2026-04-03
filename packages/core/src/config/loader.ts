import { readFileSync, existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { BotConfig } from "@botinabox/shared";
import { DEFAULT_CONFIG } from "./defaults.js";
import { interpolateEnv } from "./interpolate.js";

export interface ConfigLoadError {
  field: string;
  message: string;
}

export interface ConfigLoadResult {
  config: BotConfig;
  errors: ConfigLoadError[];
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (override === undefined || override === null) return base;
  if (base === undefined || base === null) return override;

  if (typeof base !== "object" || typeof override !== "object") return override;
  if (Array.isArray(override)) return override;

  const result = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    if (v !== undefined) {
      result[k] = deepMerge((result as Record<string, unknown>)[k], v);
    }
  }
  return result;
}

/**
 * Load and merge config from file, with env var interpolation and runtime overrides.
 * Merge order: defaults < config file < runtime overrides
 */
export function loadConfig(opts?: {
  configPath?: string;
  overrides?: Partial<BotConfig>;
  env?: Record<string, string | undefined>;
}): ConfigLoadResult {
  const configPath = opts?.configPath ?? "botinabox.config.yml";
  const errors: ConfigLoadError[] = [];

  let fileConfig: Partial<BotConfig> = {};
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      const parsed = parseYaml(raw) as Partial<BotConfig>;
      fileConfig = interpolateEnv(parsed, opts?.env ?? process.env) as Partial<BotConfig>;
    } catch (err) {
      errors.push({ field: "configPath", message: `Failed to parse ${configPath}: ${String(err)}` });
    }
  }

  const merged = deepMerge(
    deepMerge(DEFAULT_CONFIG, fileConfig),
    opts?.overrides ?? {},
  ) as BotConfig;

  return { config: Object.freeze(merged) as BotConfig, errors };
}

let _config: BotConfig | null = null;

/** Get the loaded config singleton. Call loadConfig() first. */
export function getConfig(): BotConfig {
  if (!_config) throw new Error("Config not loaded — call loadConfig() first");
  return _config;
}

/** Initialize the config singleton. Returns errors if any. */
export function initConfig(opts?: Parameters<typeof loadConfig>[0]): ConfigLoadError[] {
  const { config, errors } = loadConfig(opts);
  _config = config;
  return errors;
}

/** Reset the singleton (for testing) */
export function _resetConfig(): void {
  _config = null;
}
