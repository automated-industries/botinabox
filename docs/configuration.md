# Configuration Reference

Bot in a Box uses a YAML configuration file loaded at startup. Environment variables are interpolated using `${VAR_NAME}` syntax.

## Loading Config

```typescript
import { loadConfig, initConfig, getConfig } from '@botinabox/core';

// Option A: Direct load (returns config + errors)
const { config, errors } = loadConfig({
  configPath: 'botinabox.config.yml',
  overrides: { /* partial overrides */ },
  env: process.env,
});

// Option B: Singleton (call once, access anywhere)
const errors = initConfig({ configPath: 'botinabox.config.yml' });
const config = getConfig(); // Frozen, immutable
```

Load order: **Defaults** < **Config File** < **Runtime Overrides**

## Full Schema

### `data`

Database configuration.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `path` | `string` | `"./data/bot.db"` | SQLite database file path. Use `":memory:"` for testing |
| `walMode` | `boolean` | `true` | Enable WAL mode for concurrent reads |
| `backupDir` | `string` | — | Directory for database backups |

### `channels`

Channel adapter configuration. Keys are channel IDs (e.g., `slack`, `discord`, `webhook`).

```yaml
channels:
  slack:
    enabled: true
    botToken: ${SLACK_BOT_TOKEN}
    appToken: ${SLACK_APP_TOKEN}
  discord:
    enabled: true
    botToken: ${DISCORD_BOT_TOKEN}
  webhook:
    enabled: true
    port: 8080
    secret: ${WEBHOOK_SECRET}
    callbackUrl: https://example.com/webhook
```

Each channel entry must include `enabled: boolean`. Additional fields are channel-specific.

### `providers`

LLM provider configuration. Keys are provider IDs.

```yaml
providers:
  anthropic:
    enabled: true
    apiKey: ${ANTHROPIC_API_KEY}
  openai:
    enabled: true
    apiKey: ${OPENAI_API_KEY}
  ollama:
    enabled: true
    baseUrl: http://localhost:11434
```

### `agents`

Array of agent definitions.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `slug` | `string` | **required** | Kebab-case unique identifier |
| `name` | `string` | **required** | Display name |
| `adapter` | `string` | **required** | Execution adapter ID (`api`, `cli`, or custom) |
| `role` | `string` | — | Role label (e.g., `"general"`, `"admin"`) |
| `model` | `string` | — | Model ID or alias |
| `workdir` | `string` | — | Working directory for CLI adapter |
| `instructionsFile` | `string` | — | Path to agent instructions file |
| `maxConcurrentRuns` | `number` | — | Max parallel executions |
| `budgetMonthlyCents` | `number` | — | Monthly cost cap in cents |
| `canCreateAgents` | `boolean` | `false` | Allow this agent to register new agents |
| `skipPermissions` | `boolean` | `false` | Skip permission checks in CLI adapter |
| `config` | `object` | — | Adapter-specific configuration |

```yaml
agents:
  - slug: researcher
    name: Research Agent
    adapter: api
    model: smart
    budgetMonthlyCents: 5000

  - slug: builder
    name: Build Agent
    adapter: cli
    workdir: ./projects/my-app
    model: smart
    skipPermissions: true
```

### `models`

Model aliasing and routing.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `default` | `string` | `"smart"` | Default model for unspecified agents |
| `aliases` | `object` | see below | Short names mapping to model IDs |
| `routing` | `object` | see below | Purpose-based model selection |
| `fallbackChain` | `string[]` | `[]` | Models to try if primary is unavailable |
| `costLimit.perRunCents` | `number` | — | Per-run cost cap |

Default aliases:

```yaml
aliases:
  fast: claude-haiku-4-5
  smart: claude-opus-4-6
  balanced: claude-sonnet-4-6
```

Default routing:

```yaml
routing:
  conversation: fast
  task_execution: smart
  classification: fast
```

### `entities`

Custom entity definitions for the data layer. See [API Reference](api-reference.md) for `EntityConfig` schema.

### `security`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `fieldLengthLimits` | `object` | `{ default: 65535 }` | Max byte length per field name |
| `allowedFilePrefixes` | `string[]` | — | Restrict file access to these paths |

```yaml
security:
  fieldLengthLimits:
    default: 65535
    description: 10000
    body: 100000
  allowedFilePrefixes:
    - ./data/
    - ./context/
```

### `render`

Entity context rendering configuration.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `outputDir` | `string` | `"./context"` | Directory for rendered markdown files |
| `watchIntervalMs` | `number` | `30000` | File watcher poll interval (min 1000) |

### `updates`

Self-update configuration.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `policy` | `string` | `"auto-compatible"` | Update policy (see below) |
| `checkIntervalMs` | `number` | `86400000` | Check interval (min 60000) |
| `maintenanceWindow` | `object` | — | Restrict updates to a time window |

**Update policies:**

| Policy | Behavior |
|--------|----------|
| `auto-all` | Install all updates automatically |
| `auto-compatible` | Auto-install minor and patch updates |
| `auto-patch` | Auto-install patch updates only |
| `notify` | Emit hook, don't install |
| `manual` | No automatic checks |

```yaml
updates:
  policy: auto-compatible
  checkIntervalMs: 86400000
  maintenanceWindow:
    utcHourStart: 2
    utcHourEnd: 6
    days: [sat, sun]
```

### `budget`

Global budget controls.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `globalMonthlyCents` | `number` | — | Global monthly cost cap |
| `warnPercent` | `number` | `80` | Warning threshold (1-100) |

### `workflows`

Named workflow definitions. See [Orchestration](orchestration.md) for details.

```yaml
workflows:
  code-review:
    name: Code Review Pipeline
    steps:
      - id: analyze
        name: Static Analysis
        agentSlug: analyzer
        taskTemplate:
          title: "Analyze PR #${pr_number}"
          description: "Run static analysis on PR"
      - id: review
        name: Code Review
        agentSlug: reviewer
        dependsOn: [analyze]
        taskTemplate:
          title: "Review PR #${pr_number}"
          description: "Review code changes"
```

## Environment Variable Interpolation

Any string value containing `${VAR_NAME}` is replaced with the corresponding environment variable at load time. This works at any depth in the config tree.

```yaml
providers:
  anthropic:
    apiKey: ${ANTHROPIC_API_KEY}    # Replaced with process.env.ANTHROPIC_API_KEY
```

Undefined variables are left as-is (the literal `${VAR_NAME}` string remains).

## Validation

Config is validated against a JSON Schema using AJV. Required fields, type constraints, and enum values are all enforced. `loadConfig()` returns an `errors` array with any validation failures — check this before using the config.
