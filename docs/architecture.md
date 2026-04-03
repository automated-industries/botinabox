# Architecture

Bot in a Box is organized as a layered monorepo where each layer communicates through a central event bus (HookBus) and persists state to a shared SQLite database (DataStore).

## System Layers

```
┌─────────────────────────────────────────────────────────────┐
│                      Channel Layer                          │
│  ChannelRegistry → Adapters (Slack, Discord, Webhook)       │
│  InboundMessage parsing, OutboundPayload delivery           │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                      Chat Layer                             │
│  MessagePipeline → routing, policy evaluation               │
│  SessionManager → per-agent/channel/peer state              │
│  NotificationQueue → reliable outbound delivery             │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                  Orchestration Layer                         │
│  AgentRegistry → agent lifecycle + state machine            │
│  TaskQueue → priority scheduling, retry, followup chains    │
│  RunManager → execution locking, result processing          │
│  WorkflowEngine → multi-step DAG execution                  │
│  BudgetController → per-agent + global cost enforcement     │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                     LLM Layer                               │
│  ProviderRegistry → provider management + auto-discovery    │
│  ModelRouter → alias resolution, purpose routing, fallback  │
│  CostTracker → token-based cost calculation + recording     │
│  Tool Loop → agentic tool-use execution cycle               │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                     Data Layer                              │
│  DataStore → schema definition, CRUD, query builder         │
│  SqliteAdapter → better-sqlite3 wrapper                     │
│  Migrations → versioned schema evolution                    │
│  Entity Rendering → markdown context generation             │
└─────────────────────────────────────────────────────────────┘

Cross-cutting:
  HookBus ─── event-driven communication between all layers
  Security ── input sanitization, audit logging, field validation
  Config ──── YAML loader with env interpolation + AJV validation
  Update ──── self-update checker with policy + maintenance windows
```

## Design Patterns

### Hook-Based Communication

All inter-layer communication goes through the HookBus. Layers emit events; other layers subscribe. This keeps layers decoupled — the orchestrator doesn't import the chat layer directly, and the LLM layer doesn't know about channels.

Events are processed in priority order (lower number = earlier). Handlers are error-isolated — one failing handler doesn't block others.

```
message.inbound → Pipeline evaluates routing + policy
                → TaskQueue creates task
task.created    → RunManager picks up eligible tasks
run.completed   → CostTracker records spend
                → TaskQueue creates followup task (if configured)
                → NotificationQueue sends result to channel
budget.exceeded → (your handler) alerts admin, pauses agent, etc.
```

### Registry Pattern

Providers, channels, and agents all use registries for runtime management. Registries support:

- Dynamic registration/unregistration
- Auto-discovery (scan `node_modules` for `@botinabox/*` packages with `botinabox.type` in `package.json`)
- Lookup by ID or slug

### Adapter Pattern

Three adapter interfaces abstract away implementation details:

| Interface | Purpose | Built-in Implementations |
|-----------|---------|-------------------------|
| `LLMProvider` | Language model access | Anthropic, OpenAI, Ollama |
| `ChannelAdapter` | Messaging platform I/O | Slack, Discord, Webhook |
| `ExecutionAdapter` | Agent task execution | CLI (subprocess), API (LLM + tools) |

### Factory Functions

Each provider and channel package exports a default factory function:

```typescript
export default function createSlackAdapter(client?: BoltClient): SlackAdapter
export default function createAnthropicProvider(config: { apiKey: string }): LLMProvider
```

This enables lazy initialization and dependency injection.

## Data Flow: Message to Response

1. **Channel adapter** receives a platform event, normalizes it to `InboundMessage`
2. **MessagePipeline** resolves which agent handles this channel, evaluates policies (allowlist, mention gate)
3. **TaskQueue** creates a task assigned to the resolved agent
4. **RunManager** detects the new task, acquires a lock on the agent, starts a run
5. **ExecutionAdapter** executes the task:
   - **API adapter**: Builds prompt from task + context files, calls LLM via ModelRouter, runs tool loop
   - **CLI adapter**: Spawns subprocess in agent's workdir with task as input
6. **RunManager** records the result, updates cost tracking, releases the lock
7. **CostTracker** updates the agent's monthly spend
8. **Followup chain**: If the task has a `followupAgentId`, a new task is created for the next agent (with depth tracking to prevent infinite chains)
9. **NotificationQueue** sends the response back through the originating channel

## Data Flow: Workflow Execution

1. **WorkflowEngine.start()** creates a `workflow_run` record and evaluates the DAG
2. Steps with no unmet dependencies are dispatched as tasks (possibly in parallel)
3. On `task.completed`, the engine calls `advance()` to check for newly unblocked steps
4. If a step fails, the configured `onFail` policy applies (`abort`, `skip`, or `retry`)
5. When all steps complete, the workflow run is marked complete

## Database Schema

Core tables (auto-created by `defineCoreTables()`):

| Table | Purpose |
|-------|---------|
| `agents` | Agent definitions, status, monthly spend |
| `tasks` | Task queue with priority, retry, chain metadata |
| `runs` | Execution records with cost and timing |
| `sessions` | Chat session state (per agent/channel/peer) |
| `workflows` | Workflow definitions (JSON steps) |
| `workflow_runs` | Workflow execution instances |
| `notifications` | Outbound message queue |
| `cost_events` | Token usage records |
| `activity_log` | Audit trail |
| `wakeups` | Agent wake-up queue |
| `update_history` | Version update tracking |
| `budget_policies` | Budget rules |

All tables use UUIDs as primary keys and ISO 8601 timestamps. Soft deletes via `deleted_at` column.

## Entity Context Rendering

The data layer can render database state into markdown files — useful for giving agents readable context about entities they work with.

`EntityContextDef` maps a table to a directory structure:

```typescript
db.defineEntityContext('agent', {
  table: 'agents',
  directory: './context/agents',
  slugColumn: 'slug',
  files: {
    'AGENT.md': {
      source: { type: 'self' },
      render: (rows) => formatAgentMarkdown(rows[0]),
    },
    'TASKS.md': {
      source: { type: 'hasMany', table: 'tasks', foreignKey: 'assignee_id' },
      render: (rows) => formatTaskList(rows),
      omitIfEmpty: true,
    },
  },
});
```

Then `db.render(manifest)` generates the files.

## Security Model

- **Input sanitization**: All data written through DataStore passes through `sanitize()` which strips null bytes, control characters, and truncates oversized fields
- **Column validation**: Schema-driven field type and length enforcement
- **Audit logging**: Configurable activity log tracking agent actions
- **HMAC verification**: Webhook adapter verifies request signatures
- **Budget enforcement**: Hard stops prevent runaway cost

## Monorepo Structure

```
packages/
├── shared/     # Types + constants. Zero runtime dependencies.
│               # Every other package depends on this.
├── core/       # The framework. Depends on shared + better-sqlite3 + yaml + ajv.
│               # This is the only "heavy" package.
├── providers/  # LLM providers. Each depends on shared + its SDK.
│   ├── anthropic/   # @anthropic-ai/sdk
│   ├── openai/      # openai
│   └── ollama/      # HTTP only, no SDK dependency
├── channels/   # Channel adapters. Each depends on shared only.
│   ├── slack/
│   ├── discord/
│   └── webhook/
└── cli/        # Scaffolding tool. Depends on core + shared.
```

Build with `pnpm build` (runs `tsup` in each package). Test with `pnpm test:run` (runs `vitest` in each package).
