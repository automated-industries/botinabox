# Architecture

botinabox is a single npm package for building multi-agent bots. It uses a layered architecture where each layer communicates through a central event bus (HookBus) and persists state to a shared SQLite database (DataStore, powered by LatticeSQL).

## System Layers

```
 Inbound                                                    Outbound
 ───────                                                    ────────
 Slack       ┌──────────────────────────────────────────┐   Slack
 Discord  ──►│            Channel Layer                 │──► Discord
 Webhook     │  ChannelRegistry, InboundMessage,        │   Webhook
             │  OutboundPayload, ChannelAdapter          │
             └──────────────────┬───────────────────────┘
                                │
             ┌──────────────────▼───────────────────────┐
             │          Message Pipeline                  │
             │  Routing, policy evaluation, allowlists,  │
             │  mention gates, user resolution            │
             └──────────────────┬───────────────────────┘
                                │
             ┌──────────────────▼───────────────────────┐
             │           Task Layer                      │
             │  TaskQueue.create() — priority, retry,    │
             │  chain depth, followup templates           │
             └──────────────────┬───────────────────────┘
                                │
             ┌──────────────────▼───────────────────────┐
             │          Run Layer                         │
             │  RunManager — locking, startRun/finishRun │
             │  Retry with exponential backoff            │
             │  Followup chain creation                   │
             └──────────────────┬───────────────────────┘
                                │
             ┌──────────────────▼───────────────────────┐
             │        Execution Layer                     │
             │  ApiExecutionAdapter — LLM tool loop       │
             │  CliExecutionAdapter — subprocess spawn    │
             └──────────────────┬───────────────────────┘
                                │
             ┌──────────────────▼───────────────────────┐
             │           LLM Layer                       │
             │  ProviderRegistry, ModelRouter, CostTracker│
             │  Anthropic, OpenAI, Ollama providers       │
             └──────────────────────────────────────────┘

 Cross-cutting concerns (accessible by all layers):
 ──────────────────────────────────────────────────
 HookBus ────── event-driven decoupling between layers
 DataStore ──── LatticeSQL-backed schema, CRUD, migrations
 Security ───── sanitization, audit logging, column validation
 Config ─────── YAML loader, env interpolation, AJV validation
 Update ─────── self-update checker, policy + maintenance windows
```

## HookBus: The Central Nervous System

All inter-layer communication flows through the HookBus. Layers emit events; other layers subscribe. This keeps layers fully decoupled -- the orchestrator does not import the chat layer, the LLM layer knows nothing about channels, and new behaviors can be wired in without touching existing code.

### How It Works

```typescript
import { HookBus } from 'botinabox';

const hooks = new HookBus();

// Register a handler (priority 0-100, lower runs first, default 50)
const unsubscribe = hooks.register('task.created', async (ctx) => {
  console.log(`New task: ${ctx.taskId}`);
}, { priority: 10 });

// Emit an event (handlers run in priority order)
await hooks.emit('task.created', { taskId: 'abc', title: 'Research' });

// One-shot handler (auto-unsubscribes after first invocation)
hooks.register('run.completed', handler, { once: true });

// Filtered handler (only fires when context matches all filter values)
hooks.register('run.completed', handler, {
  filter: { status: 'failed' },
});

// Unsubscribe
unsubscribe();

// Introspection
hooks.hasListeners('task.created');  // true/false
hooks.listRegistered();              // ['task.created', 'run.completed', ...]
hooks.clear('task.created');         // Remove all handlers for an event
hooks.clear();                       // Remove all handlers
```

### Key Properties

- **Priority ordering**: Handlers run in ascending priority order (0 first, 100 last). Ties broken by registration order.
- **Error isolation**: A failing handler is caught and logged. It never blocks other handlers.
- **Synchronous variant**: `emitSync()` available for fire-and-forget paths where async is unnecessary.

### Event Flow

```
message.inbound  --> Pipeline evaluates routing + policy
                 --> TaskQueue.create()
task.created     --> Poll cycle picks up eligible tasks
agent.wakeup     --> RunManager starts a run
run.completed    --> CostTracker records spend
                 --> RunManager creates followup task (if configured)
                 --> WorkflowEngine advances workflow steps
                 --> NotificationQueue sends result to channel
budget.exceeded  --> Your handler: alert admin, pause agent, etc.
schedule.fired   --> Scheduler action dispatched
workflow.completed --> Your handler: notify stakeholders
```

### Built-in Events

| Event | Payload | Emitted By |
|-------|---------|------------|
| `agent.created` | `{ agentId, slug }` | AgentRegistry |
| `agent.paused` | `{ agentId, status }` | AgentRegistry |
| `agent.terminated` | `{ agentId }` | AgentRegistry |
| `task.created` | `{ taskId, title }` | TaskQueue |
| `task.followup.created` | `{ originTaskId, followupAgentId, chainDepth }` | RunManager |
| `run.completed` | `{ runId, agentId, taskId, status, exitCode }` | RunManager |
| `budget.exceeded` | `{ agentId, currentSpendCents, limitCents, warnPercent }` | BudgetController |
| `message.inbound` | `{ message, channel }` | MessagePipeline |
| `message.processed` | `{ message, channel, agentId, userId }` | MessagePipeline |
| `workflow.completed` | `{ workflowRunId }` | WorkflowEngine |
| `workflow.failed` | `{ workflowRunId, error }` | WorkflowEngine |
| `schedule.fired` | `{ schedule_id, schedule_name, action, fired_at }` | Scheduler |
| `schedule.error` | `{ schedule_id, schedule_name, error }` | Scheduler |
| `update.available` | `{ manifest }` | UpdateManager |
| `update.completed` | `{ updates }` | UpdateManager |
| `update.failed` | `{ updates, error }` | UpdateManager |
| `user.created` | `{ user }` | UserRegistry |
| `secret.created` | `{ name }` | SecretStore |
| `secret.accessed` | `{ name, environment }` | SecretStore |
| `secret.rotated` | `{ name, environment }` | SecretStore |
| `secret.deleted` | `{ name, environment }` | SecretStore |
| `cost.recorded` | `{ agentId, model, costCents }` | CostTracker |
| `audit` | `{ table, action, ... }` | AuditEmitter |

## DataStore + LatticeSQL

The data layer is a thin wrapper around [LatticeSQL](https://github.com/automated-industries/lattice) that provides schema definition, CRUD, migrations, and entity context rendering.

### Schema Definition

Tables are defined before initialization:

```typescript
import { DataStore, defineCoreTables } from 'botinabox';

const db = new DataStore({
  dbPath: './data/bot.db',
  outputDir: './context',
  wal: true,
  hooks,
});

// Register the 20 built-in tables
defineCoreTables(db);

// Define custom domain tables
db.define('customers', {
  columns: {
    id: 'TEXT PRIMARY KEY',
    name: 'TEXT NOT NULL',
    email: 'TEXT',
    tier: "TEXT NOT NULL DEFAULT 'free'",
    created_at: 'TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP',
    deleted_at: 'TEXT',
  },
  tableConstraints: [
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email ON customers(email)',
  ],
});

// Initialize (creates tables, runs migrations)
await db.init({ migrations: [...] });
```

### Core Tables

| Table | Purpose |
|-------|---------|
| `agents` | Agent definitions, status, config, monthly spend |
| `tasks` | Task queue with priority, retry, chain metadata |
| `runs` | Execution records with cost, tokens, timing |
| `sessions` | Chat session state per agent/channel/peer |
| `messages` | Inbound and outbound message log |
| `wakeups` | Agent wake-up queue |
| `workflows` | Workflow definitions (JSON DAG) |
| `workflow_runs` | Workflow execution instances |
| `notifications` | Outbound message delivery queue |
| `cost_events` | Per-call token usage and cost records |
| `budget_policies` | Per-agent and global budget rules |
| `activity_log` | Audit trail of agent actions |
| `config_revisions` | Configuration change history |
| `update_history` | Package update tracking |
| `skills` | Skill definitions |
| `agent_skills` | Agent-skill junction table |
| `users` | User records (cross-channel identity) |
| `user_identities` | Channel-specific user identities |
| `schedules` | Cron and one-time schedule definitions |
| `secrets` | Secret metadata and encrypted values |

All tables use TEXT UUIDs as primary keys and ISO 8601 timestamps. Soft deletes use a `deleted_at` column.

### Entity Context Rendering

DataStore can render database state into markdown files, giving agents readable context about the entities they work with.

```typescript
import { defineCoreEntityContexts } from 'botinabox';

defineCoreEntityContexts(db);

// Or define custom entity contexts
db.defineEntityContext('customers', {
  table: 'customers',
  directory: 'customers',
  slugColumn: 'name',
  indexFile: 'customers/CUSTOMERS.md',
  files: {
    'CUSTOMER.md': {
      source: { type: 'self' },
      render: (rows) => {
        const c = rows[0];
        return `# ${c.name}\n\n**Tier:** ${c.tier}\n`;
      },
    },
  },
});

// Render all entity contexts to outputDir
await db.render();
```

This produces a file tree like:

```
context/
  agents/
    AGENTS.md         # Index of all agents
    researcher/
      AGENT.md        # Per-agent context
    builder/
      AGENT.md
  customers/
    CUSTOMERS.md      # Index of all customers
    acme-corp/
      CUSTOMER.md     # Per-customer context
```

### CRUD Operations

```typescript
// Insert (returns the created row with generated ID)
const row = await db.insert('tasks', { title: 'Research', priority: 10 });

// Get by primary key
const task = await db.get('tasks', { id: row.id });

// Query with filters
const todos = await db.query('tasks', {
  where: { status: 'todo', assignee_id: agentId },
});

// Update
await db.update('tasks', { id: taskId }, { status: 'done' });

// Delete
await db.delete('tasks', { id: taskId });

// Count
const total = await db.count('tasks', { where: { status: 'todo' } });

// Junction tables
await db.link('agent_skills', { agent_id: agentId, skill_id: skillId });
await db.unlink('agent_skills', { agent_id: agentId, skill_id: skillId });

// Seeding (upsert by natural key)
await db.seed([{
  table: 'agents',
  rows: [{ slug: 'researcher', name: 'Research Agent', adapter: 'api' }],
  naturalKey: 'slug',
}]);
```

## The Orchestration Layer

The orchestration layer coordinates agents, tasks, runs, workflows, budgets, schedules, sessions, users, and secrets. Each component is a class that takes `DataStore` and `HookBus` as constructor dependencies.

### Core Components

| Component | Purpose |
|-----------|---------|
| `AgentRegistry` | Agent lifecycle: register, list, status transitions, permissions |
| `TaskQueue` | Task creation, priority scheduling, polling for eligible work |
| `RunManager` | Execution locking, result processing, retry, followup chains |
| `WorkflowEngine` | Multi-step DAG workflows with dependency resolution |
| `BudgetController` | Per-agent and global cost enforcement with warning thresholds |
| `WakeupQueue` | Agent wake-up signaling with coalescing |
| `Scheduler` | Cron-based recurring and one-time job scheduling |
| `SessionManager` | Per-agent/channel/peer session state |
| `UserRegistry` | Cross-channel user identity resolution |
| `SecretStore` | Secret management with rotation and audit |

See [Orchestration](orchestration.md) for full API documentation with code examples.

## Execution Adapters

Two built-in execution adapters handle how agent tasks are actually carried out.

### API Adapter (LLM Tool Loop)

The `ApiExecutionAdapter` sends the task to an LLM via the `ModelRouter`, then runs an agentic tool-use loop. The LLM can call tools, receive results, and iterate until it produces a final response.

```
Task Description + Context Files
        │
        ▼
  ┌─────────────┐     ┌──────────────┐
  │ ModelRouter  │────►│ LLM Provider │
  │ (resolve)    │     │ (Anthropic,  │
  └─────────────┘     │  OpenAI, ...) │
                       └──────┬───────┘
                              │
                    ┌─────────▼─────────┐
                    │    Tool Loop       │
                    │ (up to 20 rounds)  │
                    │                    │
                    │  LLM response      │
                    │    ├── text → done  │
                    │    └── tool_use     │
                    │         │           │
                    │         ▼           │
                    │    Execute tool     │
                    │         │           │
                    │         ▼           │
                    │    Feed result back │
                    └───────────────────┘
                              │
                              ▼
                     Output + Token Usage
```

### CLI Adapter (Subprocess)

The `CliExecutionAdapter` spawns a subprocess with the task prompt, captures stdout/stderr, and returns the output with the exit code.

```
Task Title + Description
        │
        ▼
  ┌─────────────────┐
  │  spawnProcess()  │
  │  cwd: agent.cwd  │
  │  args: --print   │
  └────────┬────────┘
           │
    stdout/stderr captured
           │
           ▼
    Output + Exit Code
```

### Choosing an Adapter

| Adapter | Use Case | Strengths |
|---------|----------|-----------|
| `api` | Conversational tasks, analysis, writing | In-process, tool-use, session history |
| `cli` | Code tasks, file operations, builds | Full shell access, existing CLI tools |

## Data Flow: Message to Response

1. **Channel adapter** receives a platform event (Slack message, Discord message, webhook POST), normalizes it to an `InboundMessage`.
2. **MessagePipeline** emits `message.inbound`, resolves which agent handles this channel, evaluates policies (allowlist, mention gate), and resolves the sender to a user record.
3. **TaskQueue** creates a task assigned to the resolved agent with priority.
4. **Poll cycle** detects the new `todo` task, emits `agent.wakeup`.
5. **RunManager** acquires a lock on the agent and starts a run.
6. **Execution adapter** executes the task (API tool loop or CLI subprocess).
7. **RunManager** records the result, updates cost tracking, releases the lock.
8. **Followup chain**: If the task has a `followup_agent_id`, a new task is created for the next agent with incremented chain depth.
9. **Notification queue** sends the response back through the originating channel.

## Data Flow: Workflow Execution

1. **WorkflowEngine.start()** creates a `workflow_run` record, parses the DAG, and dispatches initial steps (those with no dependencies) as tasks.
2. Steps whose dependencies are all satisfied run in parallel.
3. On `task.completed`, the engine calls `onStepCompleted()` to find newly unblocked steps.
4. If a step fails, the configured `onFail` policy applies:
   - `abort` -- mark the entire workflow as failed.
   - `skip` -- continue to the next step.
   - `retry` -- use the step's retry policy via RunManager.
5. When all steps complete, the workflow run is marked `completed` and `workflow.completed` is emitted.

## Security Model

### Input Sanitization

All string data written through the system is sanitized by `sanitize()`:
- Null bytes (`\x00`) are stripped.
- Control characters are stripped (preserving newlines, tabs, carriage returns).
- Fields exceeding their byte length limit are truncated with a `[truncated]` suffix.

```typescript
import { sanitize } from 'botinabox';

const clean = sanitize(
  { title: 'Hello\x00World', body: longString },
  { fieldLengthLimits: { body: 10000, default: 65535 } },
);
```

### Column Validation

The `ColumnValidatorImpl` validates column names against the live SQLite schema:
- **Writes**: Unknown columns are silently stripped (prevents SQL injection via column names).
- **Reads**: Unknown columns throw an error.

### Audit Logging

The `AuditEmitter` emits fire-and-forget `audit` events via the HookBus for tracked tables. Configure which tables are audited (or use `'*'` for all).

```typescript
import { AuditEmitter } from 'botinabox';

const audit = new AuditEmitter(hooks, { auditTables: ['agents', 'tasks'] });

if (audit.shouldAudit('agents')) {
  audit.emit({ table: 'agents', action: 'insert', row: { slug: 'new-agent' } });
}
```

### Budget Enforcement

The `BudgetController` provides both warning thresholds (configurable percent, default 80%) and hard stops. When spend reaches the warning threshold, `budget.exceeded` is emitted. When spend reaches 100%, `checkBudget()` returns `allowed: false`.

### Webhook HMAC Verification

The webhook channel adapter verifies request signatures using HMAC-SHA256 to prevent unauthorized payloads.

## Architecture Diagram (ASCII)

```
                    ┌──────────────────────────────────────────────┐
                    │              botinabox                        │
                    │                                              │
  ┌─────────┐      │  ┌───────────┐    ┌──────────────────────┐   │
  │  Slack   │◄────►│  │  Channel   │    │      HookBus         │   │
  │  Discord │◄────►│  │  Registry  │◄──►│  (event routing)     │   │
  │  Webhook │◄────►│  └─────┬─────┘    └──────────┬───────────┘   │
  └─────────┘      │        │                      │               │
                    │        ▼                      │               │
                    │  ┌─────────────┐              │               │
                    │  │  Message    │              │               │
                    │  │  Pipeline   │◄─────────────┤               │
                    │  └─────┬───────┘              │               │
                    │        │                      │               │
                    │        ▼                      │               │
                    │  ┌──────────┐  ┌──────────┐  │               │
                    │  │ TaskQueue │  │RunManager│◄─┤               │
                    │  └────┬─────┘  └────┬─────┘  │               │
                    │       │             │        │               │
                    │       ▼             ▼        │               │
                    │  ┌──────────────────────┐    │               │
                    │  │  Execution Adapters   │    │               │
                    │  │  ┌─────┐  ┌───────┐  │    │               │
                    │  │  │ API │  │  CLI  │  │    │               │
                    │  │  └──┬──┘  └───┬───┘  │    │               │
                    │  └─────┼─────────┼──────┘    │               │
                    │        │         │           │               │
                    │        ▼         │           │               │
                    │  ┌────────────┐  │           │               │
                    │  │ModelRouter │  │           │               │
                    │  │ Provider   │  │           │               │
                    │  │ Registry   │  │           │               │
                    │  └─────┬──────┘  │           │               │
                    │        │         │           │               │
  ┌─────────┐      │        ▼         │           │               │
  │Anthropic│◄─────│  ┌──────────┐    │           │               │
  │ OpenAI  │◄─────│  │   LLM    │    │           │               │
  │ Ollama  │◄─────│  │Providers │    │           │               │
  └─────────┘      │  └──────────┘    │           │               │
                    │                  │           │               │
                    │  ┌───────────────▼───────────▼────────────┐  │
                    │  │              DataStore                  │  │
                    │  │    (LatticeSQL + SQLite)                │  │
                    │  │  Schema, CRUD, Migrations, Rendering   │  │
                    │  └────────────────────────────────────────┘  │
                    │                                              │
                    │  ┌────────────────────────────────────────┐  │
                    │  │  Cross-cutting: Security, Config,       │  │
                    │  │  Scheduler, Sessions, Budget, Secrets   │  │
                    │  └────────────────────────────────────────┘  │
                    └──────────────────────────────────────────────┘
```
