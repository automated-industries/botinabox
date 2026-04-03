import Ajv, { type ValidateFunction } from "ajv";

const ajv = new Ajv({ allErrors: true, coerceTypes: false });

const BOT_CONFIG_SCHEMA = {
  type: "object",
  additionalProperties: true,
  properties: {
    data: {
      type: "object",
      required: ["path", "walMode"],
      properties: {
        path: { type: "string", minLength: 1 },
        walMode: { type: "boolean" },
        backupDir: { type: "string" },
      },
    },
    models: {
      type: "object",
      required: ["aliases", "default", "routing", "fallbackChain"],
      properties: {
        aliases: { type: "object", additionalProperties: { type: "string" } },
        default: { type: "string", minLength: 1 },
        routing: { type: "object", additionalProperties: { type: "string" } },
        fallbackChain: { type: "array", items: { type: "string" } },
        costLimit: {
          type: "object",
          properties: {
            perRunCents: { type: "number", minimum: 0 },
          },
        },
      },
    },
    security: {
      type: "object",
      properties: {
        fieldLengthLimits: { type: "object", additionalProperties: { type: "number" } },
        allowedFilePrefixes: { type: "array", items: { type: "string" } },
      },
    },
    render: {
      type: "object",
      required: ["outputDir", "watchIntervalMs"],
      properties: {
        outputDir: { type: "string", minLength: 1 },
        watchIntervalMs: { type: "number", minimum: 1000 },
      },
    },
    updates: {
      type: "object",
      required: ["policy", "checkIntervalMs"],
      properties: {
        policy: { type: "string", enum: ["auto-all", "auto-compatible", "auto-patch", "notify", "manual"] },
        checkIntervalMs: { type: "number", minimum: 60_000 },
      },
    },
    budget: {
      type: "object",
      required: ["warnPercent"],
      properties: {
        warnPercent: { type: "number", minimum: 1, maximum: 100 },
        globalMonthlyCents: { type: "number", minimum: 0 },
      },
    },
    agents: {
      type: "array",
      items: {
        type: "object",
        required: ["slug", "name", "adapter"],
        properties: {
          slug: { type: "string", minLength: 1, pattern: "^[a-z0-9-]+$" },
          name: { type: "string", minLength: 1 },
          adapter: { type: "string", minLength: 1 },
          model: { type: "string" },
          workdir: { type: "string" },
          maxConcurrentRuns: { type: "number", minimum: 1 },
          budgetMonthlyCents: { type: "number", minimum: 0 },
          canCreateAgents: { type: "boolean" },
          skipPermissions: { type: "boolean" },
        },
      },
    },
    channels: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["enabled"],
        properties: {
          enabled: { type: "boolean" },
        },
      },
    },
    providers: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["enabled"],
        properties: {
          enabled: { type: "boolean" },
        },
      },
    },
  },
} as const;

let _validate: ValidateFunction | null = null;

function getValidator(): ValidateFunction {
  if (!_validate) {
    _validate = ajv.compile(BOT_CONFIG_SCHEMA);
  }
  return _validate;
}

export interface SchemaError {
  path: string;
  message: string;
}

export function validateConfig(config: unknown): SchemaError[] {
  const validate = getValidator();
  const valid = validate(config);
  if (valid) return [];
  return (validate.errors ?? []).map(err => ({
    path: err.instancePath || "/",
    message: err.message ?? "invalid",
  }));
}
