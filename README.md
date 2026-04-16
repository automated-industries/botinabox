# Bot in a Box

A modular TypeScript framework for building multi-agent bots with LLM orchestration, multi-channel messaging, and task automation.

## Features

- **Execution engine** -- Generic task executor with 22 built-in tools and a tool loop (up to 5 iterations). Agents can read files, send documents, dispatch tasks, search conversations, and more. Apps register tools declaratively.
- **22 built-in tools** -- File ops (send, read, list, register), task ops (dispatch, cancel, reassign), system status (task, agent, system, active tasks), entity lookup (agents, projects, agent detail), messaging (send message, task comment, read/search conversation), management (create agent, create project). All channel-agnostic.
- **Chat pipeline** -- Configurable 6-layer chat orchestration: dedup, storage, fast ack (<2s via Haiku), async interpretation, task dispatch, and completion response. Apps provide system prompt and routing rules; framework handles everything else.
- **Slack integration** -- `SlackBoltAdapter` handles Bolt Socket Mode, message parsing, response delivery, and file uploads. One import, one `start()` call.
- **Unified config** -- All settings in one `botinabox.config.yml`: models, execution, chat, routing, safety, budget. YAML with env var interpolation. Auto-initializes with sensible defaults.
- **Message store** -- Store-before-respond guarantee. Inbound messages and attachments stored before any bot response. Channel history for conversation context.
- **Message interpretation** -- Async structured extraction from messages into tasks, memories, files, and user context. Pluggable extractors for custom data types. Programmatic task creation (no LLM dependency).
- **Triage routing** -- Content-aware message routing with keyword/regex matching, priority rules, and LLM fallback. Ownership chain logging for every routing decision.
- **Multi-agent orchestration** -- Define agents with different models, roles, and execution adapters. Task queue with priority scheduling, retry policies, and followup chains.
- **Loop detection and circuit breakers** -- Pattern-based loop detection (self-loops, ping-pong, blocked re-entry) plus circuit breakers with automatic human escalation. Scheduler connector syncs are circuit-broken per key — persistent connector failures trip the breaker instead of retrying endlessly.
- **Safe tool merging** -- `mergeTools(nativeTools, localSkills)` deduplicates tool arrays with last-wins semantics. Prevents Anthropic API 400 errors from duplicate tool names when combining built-in and custom tools.
- **Learning pipeline** -- Structured feedback capture with auto-promotion: 3+ similar records become a playbook, 3+ agents become a reusable skill.
- **Governance gates** -- Independent QA, quality, and drift gates that validate agent output and report to the human operator.
- **Permission relay** -- Remote approval via messaging platforms (Slack, Discord, Telegram). Dual approval: local + remote, first wins.
- **LLM provider abstraction** -- Swap between Anthropic, OpenAI, and Ollama. Model aliasing, purpose-based routing, fallback chains. Default LLM call wrapper included.
- **Channel adapters** -- Slack (Bolt Socket Mode), Discord, and webhooks. Auto-discovery, session management, notification queuing.
- **Workflow engine** -- Multi-step workflows with dependency resolution, parallel execution, and conditional branching.
- **SQLite data layer** -- 27 core tables, migrations, entity context rendering via [latticesql](https://github.com/automated-industries/lattice). WAL mode.
- **Event-driven hooks** -- Priority-ordered, filter-based event bus for decoupled communication.
- **Budget controls** -- Per-agent and global cost tracking with warning thresholds and hard stops.
- **Scheduling** -- Database-backed cron and one-time schedules.
- **Connectors** -- Google Gmail, Calendar, and Drive via OAuth2 and service account.
- **Security** -- Input sanitization, field length enforcement, audit logging, HMAC webhook verification.

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
  HookBus, DataStore, defineCoreTables, initConfig,
  TaskQueue, RunManager, WakeupQueue, ChatPipeline,
  registerExecutionEngine, createDefaultLLMCall,
  sendFileTool, readFileTool, listAgentsTool, getTaskStatusTool,
} from 'botinabox';
import { SlackBoltAdapter } from 'botinabox/slack';
import Anthropic from '@anthropic-ai/sdk';

// 1. Config (auto-loads botinabox.config.yml or uses defaults)
initConfig({});
const hooks = new HookBus();
const db = new DataStore({ dbPath: './data/bot.db', wal: true, hooks });
defineCoreTables(db);
await db.init();

// 2. Orchestration
const tasks = new TaskQueue(db, hooks);
const runs = new RunManager(db, hooks);
const wakeups = new WakeupQueue(db);

// 3. Execution engine with built-in tools
const client = new Anthropic();
await registerExecutionEngine({
  db, hooks, runs,
  config: {
    client,
    tools: [sendFileTool, readFileTool, listAgentsTool, getTaskStatusTool],
  },
});

// 4. Chat pipeline (6-layer: dedup → ack → interpret → dispatch → execute → respond)
const llmCall = createDefaultLLMCall(client);
const pipeline = new ChatPipeline(db, hooks, {
  llmCall, tasks, wakeups,
  systemPrompt: 'You are a helpful AI assistant.',
  routingRules: [{ agentSlug: 'assistant', keywords: ['help'] }],
  fallbackAgent: 'assistant',
});

// 5. Slack (one import, one start)
const slack = new SlackBoltAdapter({
  botToken: process.env.SLACK_BOT_TOKEN!,
  appToken: process.env.SLACK_APP_TOKEN!,
  hooks, pipeline,
});
await slack.start();
tasks.startPolling();
```

## Subpath Exports

| Import path | Description |
|---|---|
| `botinabox` | Core framework -- HookBus, DataStore, ChatPipeline, ExecutionEngine, 22 built-in tools, config (loadConfig/getConfig), AgentRegistry, TaskQueue, RunManager, Scheduler, MessageStore, ChatResponder, MessageInterpreter, TriageRouter, createDefaultLLMCall, buildSystemContext, and all shared types |
| `botinabox/anthropic` | Anthropic Claude provider (`createAnthropicProvider`) |
| `botinabox/openai` | OpenAI GPT provider (`createOpenAIProvider`) |
| `botinabox/ollama` | Ollama local model provider (`createOllamaProvider`) |
| `botinabox/slack` | Slack channel adapter (`SlackAdapter`) |
| `botinabox/discord` | Discord channel adapter (`DiscordAdapter`) |
| `botinabox/webhook` | Webhook channel adapter with HMAC verification (`WebhookAdapter`) |
| `botinabox/google` | Google connectors -- Gmail, Calendar, and Drive via OAuth2 |

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
    +------------------+  +------------------+  +------------------+
    |  CLI Adapter      |  |  API Adapter      |  |  Deterministic   |
    |  (subprocess)     |  |  (LLM + tools)    |  |  (no LLM)        |
    +------------------+  +--------+----------+  +------------------+
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
