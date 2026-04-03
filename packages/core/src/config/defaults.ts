import type { BotConfig } from "@botinabox/shared";

export const DEFAULT_CONFIG: BotConfig = {
  data: {
    path: "./data/bot.db",
    walMode: true,
  },
  channels: {},
  agents: [],
  providers: {},
  models: {
    aliases: {
      fast: "claude-haiku-4-5",
      smart: "claude-opus-4-6",
      balanced: "claude-sonnet-4-6",
    },
    default: "smart",
    routing: {
      conversation: "fast",
      task_execution: "smart",
      classification: "fast",
    },
    fallbackChain: [],
  },
  entities: {},
  security: {
    fieldLengthLimits: { default: 65535 },
  },
  render: {
    outputDir: "./context",
    watchIntervalMs: 30_000,
  },
  updates: {
    policy: "auto-compatible",
    checkIntervalMs: 86_400_000,
  },
  budget: {
    warnPercent: 80,
  },
};
