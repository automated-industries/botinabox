# Configuration Reference

botinabox uses a YAML configuration file loaded at startup. Environment variables are interpolated using `${VAR_NAME}` syntax. Configuration is validated against a JSON Schema (AJV) and frozen as an immutable object.

## Loading Config Programmatically

### loadConfig()

Direct load. Returns the merged config and any validation errors.

```typescript
import { loadConfig } from 'botinabox';

const { config, errors } = loadConfig({
  configPath: 'botinabox.config.yml',  // Default: 'botinabox.config.yml'
  overrides: {                          // Partial overrides (highest precedence)
    budget: { warnPercent: 90 },
  },
  env: process.env,                     // Environment for interpolation
});

if (errors.length > 0) {
  for (const err of errors) {
    console.error(`Config error at ${err.field}: ${err.message}`);
  }
}
```

### initConfig() and getConfig()

Singleton pattern. Call `initConfig()` once at startup, then `getConfig()` anywhere.

```typescript
import { initConfig, getConfig } from 'botinabox';

// Initialize (call once)
const errors = initConfig({
  configPath: 'botinabox.config.yml',
});

// Access anywhere (returns frozen, immutable config)
const config = getConfig();
console.log(config.models.default);  // 'smart'
```

### Merge Order

```
Defaults  <  Config File  <  Runtime Overrides
(lowest)                      (highest)
```

Defaults are deep-merged with the config file, then overrides are deep-merged on top. Arrays from overrides replace (not concatenate) arrays from lower layers.

## YAML Config File Structure

The default config file is `botinabox.config.yml` in the project root.

```yaml
# botinabox.config.yml

data:
  path: ./data/bot.db
  walMode: true
  backupDir: ./backups

channels:
  slack:
    enabled: true
    token: ${SLACK_BOT_TOKEN}
    appToken: ${SLACK_APP_TOKEN}
    signingSecret: ${SLACK_SIGNING_SECRET}
  discord:
    enabled: true
    token: ${DISCORD_BOT_TOKEN}
  webhook:
    enabled: true
    port: 8080
    secret: ${WEBHOOK_SECRET}

connectors:
  google:
    enabled: true
    provider: google
    accounts:
      main:
        clientId: ${GOOGLE_CLIENT_ID}
        clientSecret: ${GOOGLE_CLIENT_SECRET}

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

agents:
  - slug: researcher
    name: Research Agent
    adapter: api
    model: smart
    role: research
    budgetMonthlyCents: 5000

  - slug: builder
    name: Build Agent
    adapter: cli
    workdir: ./projects/my-app
    model: smart
    skipPermissions: true

models:
  default: smart
  aliases:
    fast: claude-haiku-4-5
    smart: claude-opus-4-6
    balanced: claude-sonnet-4-6
  routing:
    conversation: fast
    task_execution: smart
    classification: fast
  fallbackChain:
    - balanced
    - fast

entities:
  customers:
    columns:
      name:
        type: text
        required: true
      email:
        type: text
      tier:
        type: text
        default: free

security:
  fieldLengthLimits:
    default: 65535
    description: 10000
    body: 100000
  allowedFilePrefixes:
    - ./data/
    - ./context/

render:
  outputDir: ./context
  watchIntervalMs: 30000

updates:
  policy: auto-compatible
  checkIntervalMs: 86400000
  maintenanceWindow:
    utcHourStart: 2
    utcHourEnd: 6
    days: [sat, sun]

budget:
  globalMonthlyCents: 100000
  warnPercent: 80

workflows:
  code-review:
    name: Code Review Pipeline
    steps:
      - id: analyze
        name: Static Analysis
        agentSlug: researcher
        taskTemplate:
          title: "Analyze PR #${pr_number}"
          description: "Run static analysis on PR"
      - id: review
        name: Code Review
        agentSlug: researcher
        dependsOn: [analyze]
        taskTemplate:
          title: "Review PR #${pr_number}"
          description: "Review code changes"
```

## Environment Variable Interpolation

Any string value containing `${VAR_NAME}` is replaced with the corresponding environment variable at load time. Interpolation works at any depth in the config tree.

```yaml
providers:
  anthropic:
    apiKey: ${ANTHROPIC_API_KEY}   # Replaced with process.env.ANTHROPIC_API_KEY

channels:
  slack:
    token: ${SLACK_BOT_TOKEN}
    nested:
      deep:
        value: ${SOME_SECRET}      # Works at any depth
```

**Undefined variables are preserved as-is.** If `ANTHROPIC_API_KEY` is not set in the environment, the literal string `${ANTHROPIC_API_KEY}` remains in the config. This makes it easy to spot missing variables.

Interpolation applies to string values only. Numbers, booleans, arrays, and objects are recursively walked but only string leaves are interpolated.

## All Config Sections

### `data`

Database configuration.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `path` | `string` | `"./data/bot.db"` | SQLite database file path. Use `":memory:"` for testing. |
| `walMode` | `boolean` | `true` | Enable WAL mode for concurrent reads. |
| `backupDir` | `string` | -- | Directory for database backups (used by UpdateManager). |

```yaml
data:
  path: ./data/bot.db
  walMode: true
  backupDir: ./backups
```

### `channels`

Channel adapter configuration. Keys are channel IDs. Each entry must include `enabled: boolean`. Additional fields are channel-specific.

```yaml
channels:
  slack:
    enabled: true
    token: ${SLACK_BOT_TOKEN}
    appToken: ${SLACK_APP_TOKEN}
    signingSecret: ${SLACK_SIGNING_SECRET}
    requireMention: false        # Mention gate (optional)
    allowFrom: []                # Allowlist (optional, empty = allow all)

  discord:
    enabled: true
    token: ${DISCORD_BOT_TOKEN}

  webhook:
    enabled: true
    port: 8080
    secret: ${WEBHOOK_SECRET}
    callbackUrl: https://example.com/webhook
```

Default: `{}` (no channels enabled).

### `connectors`

External service connector configuration. Keys are connector group IDs.

```yaml
connectors:
  google:
    enabled: true
    provider: google
    accounts:
      main:
        clientId: ${GOOGLE_CLIENT_ID}
        clientSecret: ${GOOGLE_CLIENT_SECRET}
        refreshToken: ${GOOGLE_REFRESH_TOKEN}
```

Each connector entry requires:
- `enabled: boolean` -- whether the connector is active.
- `provider: string` -- the provider identifier (e.g., `"google"`).
- `accounts` -- named account configurations (connector-specific).

Default: `undefined` (no connectors).

### `agents`

Array of agent definitions. Each agent must have `slug`, `name`, and `adapter`.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `slug` | `string` | **required** | Kebab-case unique ID. Pattern: `^[a-z0-9-]+$`. |
| `name` | `string` | **required** | Display name. |
| `adapter` | `string` | **required** | Execution adapter: `"api"`, `"cli"`, or custom. |
| `role` | `string` | -- | Role label (e.g., `"general"`, `"engineering"`). |
| `model` | `string` | -- | Model ID or alias (e.g., `"smart"`, `"claude-sonnet-4-6"`). |
| `workdir` | `string` | -- | Working directory for CLI adapter. |
| `instructionsFile` | `string` | -- | Path to agent instructions/system prompt file. |
| `maxConcurrentRuns` | `number` | -- | Maximum parallel executions. |
| `budgetMonthlyCents` | `number` | -- | Monthly cost cap in cents (e.g., 5000 = $50). |
| `canCreateAgents` | `boolean` | `false` | Allow this agent to register new agents at runtime. |
| `skipPermissions` | `boolean` | `false` | Skip permission checks in CLI adapter. |
| `config` | `object` | -- | Adapter-specific configuration (free-form). |

```yaml
agents:
  - slug: researcher
    name: Research Agent
    adapter: api
    model: smart
    role: research
    budgetMonthlyCents: 5000
    instructionsFile: ./instructions/researcher.md

  - slug: builder
    name: Build Agent
    adapter: cli
    workdir: ./projects/my-app
    model: smart
    skipPermissions: true
    maxConcurrentRuns: 2

  - slug: orchestrator
    name: Orchestrator
    adapter: api
    model: smart
    canCreateAgents: true
    budgetMonthlyCents: 10000
```

Default: `[]` (no agents).

### `providers`

LLM provider configuration. Keys are provider IDs (`anthropic`, `openai`, `ollama`).

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

Each provider entry must include `enabled: boolean`. Additional fields are provider-specific (typically `apiKey` or `baseUrl`).

Default: `{}` (no providers enabled).

### `models` (ModelConfig)

Model aliasing, purpose-based routing, and fallback chains.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `default` | `string` | `"smart"` | Default model alias for agents without an explicit model. |
| `aliases` | `object` | see below | Map of short names to full model IDs. |
| `routing` | `object` | see below | Map of purpose to model alias. |
| `fallbackChain` | `string[]` | `[]` | Models to try if the primary is unavailable. |
| `costLimit.perRunCents` | `number` | -- | Per-run cost cap in cents. |

**Default aliases:**

```yaml
aliases:
  fast: claude-haiku-4-5
  smart: claude-opus-4-6
  balanced: claude-sonnet-4-6
```

**Default routing:**

```yaml
routing:
  conversation: fast         # Chat messages use the fast model
  task_execution: smart      # Task runs use the smart model
  classification: fast       # Classification/routing uses the fast model
```

**How routing works:**

1. Agent specifies `model: "smart"` (or no model, uses `models.default`).
2. `ModelRouter.resolve("smart")` looks up `aliases.smart` -> `"claude-opus-4-6"`.
3. Searches registered providers for a model with ID `"claude-opus-4-6"`.
4. If not found, tries each model in `fallbackChain` in order.
5. `ModelRouter.resolveForPurpose("conversation")` looks up `routing.conversation` -> `"fast"`, then resolves that alias.

```typescript
import { ModelRouter, ProviderRegistry } from 'botinabox';

const registry = new ProviderRegistry();
// ... register providers ...

const router = new ModelRouter(registry, config.models);

// Resolve an alias
const resolved = router.resolve('smart');
// { provider: 'anthropic', model: 'claude-opus-4-6' }

// Resolve by purpose
const chatModel = router.resolveForPurpose('conversation');
// { provider: 'anthropic', model: 'claude-haiku-4-5' }

// Resolve with fallback chain
const withFallback = router.resolveWithFallback('unavailable-model');
// Tries: unavailable-model -> fallbackChain[0] -> fallbackChain[1] -> throws

// List all available models across all providers
const all = router.listAvailable();
```

### `entities`

Custom entity definitions for the data layer. Each entity maps to a database table.

```yaml
entities:
  customers:
    columns:
      name:
        type: text
        required: true
      email:
        type: text
      tier:
        type: text
        default: free
      lifetime_value:
        type: real
      is_active:
        type: boolean
        default: true
      created_at:
        type: datetime
    relations:
      - type: hasMany
        table: orders
        localKey: id
        remoteKey: customer_id
```

**Column types:** `uuid`, `text`, `integer`, `boolean`, `datetime`, `real`.

**Column fields:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | `string` | **required** | Column type. |
| `required` | `boolean` | `false` | NOT NULL constraint. |
| `default` | `string/number/boolean` | -- | Default value. |
| `references` | `string` | -- | Foreign key reference (e.g., `"users.id"`). |

**Relation types:** `hasMany`, `manyToMany`, `belongsTo`.

Default: `{}` (no custom entities).

### `security` (SecurityConfig)

Input sanitization and access control settings.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `fieldLengthLimits` | `object` | `{ default: 65535 }` | Max byte length per field name. |
| `allowedFilePrefixes` | `string[]` | -- | Restrict file access to these path prefixes. |

```yaml
security:
  fieldLengthLimits:
    default: 65535     # Default max for any field (64 KB)
    description: 10000 # Override for 'description' fields
    body: 100000       # Override for 'body' fields
    title: 1000        # Override for 'title' fields
  allowedFilePrefixes:
    - ./data/
    - ./context/
    - ./instructions/
```

The `sanitize()` function uses these limits. When a string field exceeds its limit, it is truncated and `[truncated]` is appended.

Default `fieldLengthLimits`: `{ default: 65535 }`.

### `render` (RenderConfig)

Entity context rendering configuration.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `outputDir` | `string` | `"./context"` | Directory for rendered markdown files. |
| `watchIntervalMs` | `number` | `30000` | File watcher poll interval in ms (min 1000). |

```yaml
render:
  outputDir: ./context
  watchIntervalMs: 30000
```

### `updates` (UpdateConfig)

Self-update configuration for the botinabox package.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `policy` | `string` | `"auto-compatible"` | Update policy (see table below). |
| `checkIntervalMs` | `number` | `86400000` (24h) | How often to check for updates (min 60000). |
| `maintenanceWindow` | `object` | -- | Restrict updates to a time window. |

**Update policies:**

| Policy | What It Does |
|--------|-------------|
| `auto-all` | Install all updates automatically (including major). |
| `auto-compatible` | Auto-install minor and patch updates. Skip major. |
| `auto-patch` | Auto-install patch updates only. |
| `notify` | Emit `update.available` hook but do not install. |
| `manual` | No automatic checks or installs. |

**Maintenance window:**

Updates are only applied during the maintenance window. If an update is available outside the window, it is deferred.

| Field | Type | Description |
|-------|------|-------------|
| `utcHourStart` | `number` | Start hour in UTC (0-23). |
| `utcHourEnd` | `number` | End hour in UTC (0-23). |
| `days` | `string[]` | Days of week: `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`. |

```yaml
updates:
  policy: auto-compatible
  checkIntervalMs: 86400000
  maintenanceWindow:
    utcHourStart: 2     # 2 AM UTC
    utcHourEnd: 6       # 6 AM UTC
    days: [sat, sun]    # Weekends only
```

The window supports wrapping midnight (e.g., `utcHourStart: 22`, `utcHourEnd: 6` covers 10 PM to 6 AM).

If no `maintenanceWindow` is configured, updates are applied immediately.

### `budget` (BudgetConfig)

Global budget controls (per-agent budgets are set in the `agents` array).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `globalMonthlyCents` | `number` | -- | Global monthly cost cap across all agents. |
| `warnPercent` | `number` | `80` | Warning threshold (1-100). When spend reaches this %, `budget.exceeded` is emitted. |

```yaml
budget:
  globalMonthlyCents: 100000   # $1000/month global cap
  warnPercent: 80               # Warn at 80% of any budget
```

Budget enforcement flow:

```
Agent spend < warnPercent% of limit  --> allowed, no events
Agent spend >= warnPercent% of limit --> allowed, emits 'budget.exceeded'
Agent spend >= 100% of limit         --> blocked (checkBudget returns allowed: false)
Global spend >= globalMonthlyCents   --> blocked (globalCheck returns allowed: false)
```

### `workflows`

Named workflow definitions. Keys are workflow slugs.

```yaml
workflows:
  deploy-pipeline:
    name: Deploy Pipeline
    description: Build, test, and deploy
    steps:
      - id: build
        name: Build
        agentSlug: builder
        taskTemplate:
          title: Build project
          description: Run the build process
      - id: test
        name: Test
        agentSlug: tester
        dependsOn: [build]
        taskTemplate:
          title: Run tests
          description: Execute test suite
      - id: deploy
        name: Deploy
        agentSlug: deployer
        dependsOn: [test]
        taskTemplate:
          title: Deploy to production
          description: Deploy the built artifact
        onFail: abort
    trigger:
      type: manual
```

See [Orchestration](orchestration.md) for full WorkflowEngine documentation.

## Defaults for Every Field

The complete default config, applied when no config file is present or when fields are omitted:

```yaml
data:
  path: ./data/bot.db
  walMode: true
  # backupDir: (not set)

channels: {}            # No channels enabled

agents: []              # No agents defined

providers: {}           # No providers enabled

models:
  default: smart
  aliases:
    fast: claude-haiku-4-5
    smart: claude-opus-4-6
    balanced: claude-sonnet-4-6
  routing:
    conversation: fast
    task_execution: smart
    classification: fast
  fallbackChain: []
  # costLimit: (not set)

entities: {}            # No custom entities

security:
  fieldLengthLimits:
    default: 65535
  # allowedFilePrefixes: (not set)

render:
  outputDir: ./context
  watchIntervalMs: 30000

updates:
  policy: auto-compatible
  checkIntervalMs: 86400000    # 24 hours
  # maintenanceWindow: (not set)

budget:
  warnPercent: 80
  # globalMonthlyCents: (not set)

# connectors: (not set)
# workflows: (not set)
```

## Validation

Configuration is validated against a JSON Schema using AJV. The following constraints are enforced:

- `data.path`: non-empty string.
- `data.walMode`: boolean.
- `models.default`: non-empty string.
- `models.aliases`: object with string values.
- `models.routing`: object with string values.
- `models.fallbackChain`: array of strings.
- `render.watchIntervalMs`: minimum 1000.
- `updates.policy`: one of `auto-all`, `auto-compatible`, `auto-patch`, `notify`, `manual`.
- `updates.checkIntervalMs`: minimum 60000.
- `budget.warnPercent`: number between 1 and 100.
- `agents[].slug`: non-empty string matching `^[a-z0-9-]+$`.
- `agents[].name`: non-empty string.
- `agents[].adapter`: non-empty string.
- `channels.*`: must include `enabled: boolean`.
- `providers.*`: must include `enabled: boolean`.

```typescript
import { validateConfig } from 'botinabox';

const errors = validateConfig(rawConfig);
// [
//   { path: '/agents/0/slug', message: 'must match pattern "^[a-z0-9-]+$"' },
//   { path: '/budget/warnPercent', message: 'must be >= 1' },
// ]
```

`loadConfig()` returns these errors in its `errors` array. The config is still returned (merged with defaults) so you can inspect it, but you should treat errors as fatal in production.

## Quick Start Config

Minimal config to get started with a single agent on Slack using Anthropic:

```yaml
data:
  path: ./data/bot.db
  walMode: true

channels:
  slack:
    enabled: true
    token: ${SLACK_BOT_TOKEN}
    appToken: ${SLACK_APP_TOKEN}
    signingSecret: ${SLACK_SIGNING_SECRET}

providers:
  anthropic:
    enabled: true
    apiKey: ${ANTHROPIC_API_KEY}

agents:
  - slug: assistant
    name: Assistant
    adapter: api
    model: smart

models:
  default: smart
  aliases:
    fast: claude-haiku-4-5
    smart: claude-sonnet-4-6
  routing: {}
  fallbackChain: [fast]

budget:
  warnPercent: 80
```
