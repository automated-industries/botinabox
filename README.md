# Bot in a Box

A modular TypeScript framework for building multi-agent bots with LLM orchestration, multi-channel messaging, and task automation.

## Features

- **Multi-agent orchestration** -- Define agents with different models, roles, and execution adapters. Task queue with priority scheduling, retry policies, and followup chains.
- **LLM provider abstraction** -- Swap between Anthropic, OpenAI, and Ollama with a unified interface. Model aliasing, purpose-based routing, and fallback chains.
- **Channel adapters** -- Connect to Slack, Discord, and webhooks. Auto-discovery, session management, and notification queuing.
- **Workflow engine** -- Define multi-step workflows with dependency resolution, parallel execution, and conditional branching.
- **SQLite data layer** -- Schema-driven tables, migrations, entity context rendering, and query builder via [latticesql](https://github.com/automated-industries/lattice). WAL mode for concurrent reads.
- **Event-driven hooks** -- Priority-ordered, filter-based event bus for decoupled inter-layer communication.
- **Budget controls** -- Per-agent and global cost tracking with warning thresholds and hard stops.
- **Scheduling** -- Database-backed cron and one-time schedules that fire hook events.
- **Connectors** -- Generic `Connector<T>` interface for external service integrations. Ships with Google Gmail and Calendar implementations (OAuth2 and service account auth).
- **Domain tables** -- `defineDomainTables()` and `defineDomainEntityContexts()` for standard multi-agent app schemas (org, project, client, invoice, repository, and more).
- **Auto-update** -- `autoUpdate()` checks npm for newer versions and installs them at startup.
- **Cursor persistence** -- `SecretStore.loadCursor()` / `saveCursor()` for persisting sync state across restarts.
- **Utilities** -- `truncateAtWord()` for word-boundary text truncation, `parseClaudeStream()`, `buildProcessEnv()`, and more.
- **Security** -- Input sanitization, field length enforcement, audit logging, and HMAC webhook verification.

## Install

```bash
npm install botinabox
```

Install peer dependencies for the providers you need:

```bash
# For Anthropic
npm install @anthropic-ai/sdk

# For OpenAI
npm install openai

# For Google connectors
npm install googleapis
```

## Quick Start

```typescript
import {
  HookBus,
  DataStore,
  defineCoreTables,
  AgentRegistry,
  TaskQueue,
  RunManager,
} from 'botinabox';

// 1. Create core services
const hooks = new HookBus();
const db = new DataStore({ dbPath: './data/bot.db', wal: true, hooks });

// 2. Define tables and initialize
defineCoreTables(db);
await db.init();

// 3. Set up orchestration
const agents = new AgentRegistry(db, hooks);
const tasks = new TaskQueue(db, hooks);
const runs = new RunManager(db, hooks);

// 4. Register an agent
const agentId = await agents.register({
  slug: 'assistant',
  name: 'Assistant',
  adapter: 'api',
  role: 'general',
});

// 5. Listen for task creation
hooks.register('task.created', async (ctx) => {
  console.log(`Task created: ${ctx.taskId}`);
});

// 6. Create a task
const taskId = await tasks.create({
  title: 'Summarize the quarterly report',
  description: 'Read the Q4 report and produce a 3-paragraph summary.',
  assignee_id: agentId,
  priority: 3,
});

// 7. Wire up task completion hooks
hooks.register('run.completed', async (ctx) => {
  console.log(`Run finished for task ${ctx.taskId}, exit code: ${ctx.exitCode}`);
});
```

## Subpath Exports

| Import path | Description |
|---|---|
| `botinabox` | Core framework -- HookBus, DataStore, AgentRegistry, TaskQueue, RunManager, ChannelRegistry, MessagePipeline, Scheduler, config, security, and all shared types |
| `botinabox/anthropic` | Anthropic Claude provider (`createAnthropicProvider`) |
| `botinabox/openai` | OpenAI GPT provider (`createOpenAIProvider`) |
| `botinabox/ollama` | Ollama local model provider (`createOllamaProvider`) |
| `botinabox/slack` | Slack channel adapter (`SlackAdapter`) |
| `botinabox/discord` | Discord channel adapter (`DiscordAdapter`) |
| `botinabox/webhook` | Webhook channel adapter with HMAC verification (`WebhookAdapter`) |
| `botinabox/google` | Google connectors -- Gmail and Calendar via OAuth2 |

## Architecture

```
                    +-------------------------------------+
                    |           Channel Adapters           |
                    |     Slack  .  Discord  .  Webhook    |
                    +--------------+-----------------------+
                                   | InboundMessage
                    +--------------v-----------------------+
                    |         Message Pipeline              |
                    |   routing . policies . sessions       |
                    +--------------+-----------------------+
                                   | Task
                    +--------------v-----------------------+
                    |          Task Queue                   |
                    |  priority . retry . followup chains   |
                    +--------------+-----------------------+
                                   |
                    +--------------v-----------------------+
                    |          Run Manager                  |
                    |    locking . retries . cost tracking  |
                    +--------------+-----------------------+
                                   |
              +--------------------+--------------------+
              v                    v                    v
    +------------------+  +------------------+  +---------------+
    |  CLI Adapter      |  |  API Adapter      |  |  Custom       |
    |  (subprocess)     |  |  (LLM + tools)    |  |  Adapters     |
    +------------------+  +--------+----------+  +---------------+
                                   |
                    +--------------v-----------------------+
                    |         LLM Layer                     |
                    |  ProviderRegistry . ModelRouter        |
                    |  BudgetController . Tool Loop          |
                    +--------------+-----------------------+
                                   |
              +--------------------+-------------------+
              v                    v                   v
    +---------------+    +---------------+    +---------------+
    |  Anthropic     |    |  OpenAI        |    |  Ollama        |
    +---------------+    +---------------+    +---------------+
```

Cross-cutting concerns -- **HookBus** (events), **DataStore** (persistence), **Security** (sanitization + audit) -- connect all layers.

## Core Concepts

**HookBus** is the central event bus. Handlers subscribe to named events with optional priority ordering and payload filters. Errors in one handler never block others. Use it to decouple layers -- the task queue emits `task.created`, the run manager emits `run.completed`, channels emit `message.inbound`, and your application code listens to whichever events it needs.

**DataStore** wraps [latticesql](https://github.com/automated-industries/lattice) to provide schema-driven SQLite persistence. You call `db.define()` to register table schemas, then `db.init()` to create them. It supports insert, update, upsert, get, query, delete, and migrations. WAL mode is enabled by default for concurrent read access.

**AgentRegistry** manages the lifecycle of agents -- registration, status transitions (idle/running/paused/terminated), configuration revisions, and activity logging. Each agent has a slug, name, adapter type, role, and optional budget. Agents are stored in the database and can be seeded from config on startup.

**TaskQueue** is a priority-ordered work queue backed by SQLite. Tasks have a title, description, assignee, priority (1-10), and support retry policies and followup chains. Chain depth is enforced to prevent infinite recursion. The queue emits `task.created` on the HookBus and supports polling for stale tasks.

**RunManager** handles task execution lifecycle. It acquires a per-agent lock, creates a run record, delegates to an execution adapter (API or CLI), and records the result including exit code, cost, and token usage. Failed runs trigger retry logic with exponential backoff.

**ChannelRegistry** manages channel adapter connections. Register adapters (Slack, Discord, webhook) with their config, then call `start()` to connect them all. Supports hot reconfiguration, health checks, and graceful shutdown.

**MessagePipeline** routes inbound messages from channels to the task queue. It resolves the sender to a user identity, picks the right agent based on channel bindings, applies policy checks (allowlists, mention gates), and creates a task for the assigned agent.

**Scheduler** provides database-backed job scheduling with cron expressions. Register recurring or one-time schedules that emit hook events when they fire. The scheduler polls for due jobs and emits the schedule's `action` as a hook event with its configured payload.

## Documentation

- [Getting Started](docs/getting-started.md) -- Installation, project setup, first bot
- [Configuration](docs/configuration.md) -- Full config reference
- [Architecture](docs/architecture.md) -- System design and patterns
- [Providers](docs/providers.md) -- LLM provider setup and custom providers
- [Channels](docs/channels.md) -- Channel adapter setup and custom adapters
- [Orchestration](docs/orchestration.md) -- Agents, tasks, workflows, and budget controls
- [API Reference](docs/api-reference.md) -- Complete API documentation

## License

MIT
