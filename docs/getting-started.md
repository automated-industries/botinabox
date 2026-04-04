# Getting Started

This guide walks you through installing botinabox, setting up a project from scratch, and building a working bot.

## Prerequisites

- **Node.js** 18 or later
- **npm** (or pnpm/yarn)

## Installation

```bash
npm install botinabox
```

Install peer dependencies for the providers and connectors you plan to use:

```bash
# Anthropic Claude
npm install @anthropic-ai/sdk

# OpenAI
npm install openai

# Google connectors (Gmail, Calendar)
npm install googleapis
```

## Project Setup

Create a new directory and initialize it:

```bash
mkdir my-bot && cd my-bot
npm init -y
npm install botinabox @anthropic-ai/sdk typescript
npx tsc --init --target ES2022 --module NodeNext --moduleResolution NodeNext --outDir dist
```

Add a start script to your `package.json`:

```json
{
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

Create the data directory:

```bash
mkdir -p data
```

Your project structure:

```
my-bot/
├── data/              # SQLite database (gitignore this)
├── src/
│   └── index.ts       # Entry point
├── package.json
└── tsconfig.json
```

## Database Setup

botinabox uses SQLite for persistence via the `DataStore` class. You define table schemas, then call `init()` to create them.

```typescript
// src/index.ts
import {
  HookBus,
  DataStore,
  defineCoreTables,
  defineDomainTables,
  CORE_MIGRATIONS,
} from 'botinabox';

// Create the event bus (used throughout the system)
const hooks = new HookBus();

// Create the data store
const db = new DataStore({
  dbPath: './data/bot.db',
  wal: true,    // WAL mode for concurrent reads
  hooks,
});

// Register the core tables (agents, tasks, runs, sessions, etc.)
defineCoreTables(db);

// Optionally register domain tables (orgs, projects, channels, etc.)
// You can selectively disable tables you don't need:
defineDomainTables(db, {
  clients: false,     // skip client/invoice tables
  repositories: true, // include repository table
});

// Initialize -- creates tables and runs migrations
await db.init({ migrations: CORE_MIGRATIONS });

console.log('Database initialized');
```

The `defineCoreTables()` function registers 18 tables including `agents`, `tasks`, `runs`, `sessions`, `activity_log`, `users`, `secrets`, and more. The `defineDomainTables()` function adds optional business-domain tables like `org`, `project`, `channel`, `file`, and `rule`.

You can also define your own tables:

```typescript
db.define('notes', {
  columns: {
    id: 'TEXT PRIMARY KEY',
    agent_id: 'TEXT NOT NULL',
    content: 'TEXT NOT NULL',
    created_at: 'TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP',
  },
});
```

Call all `define()` calls before `db.init()`.

## Registering Agents

Agents are registered in the database via the `AgentRegistry`. Each agent has a slug (unique identifier), name, adapter type, and role.

```typescript
import {
  HookBus,
  DataStore,
  defineCoreTables,
  CORE_MIGRATIONS,
  AgentRegistry,
} from 'botinabox';

const hooks = new HookBus();
const db = new DataStore({ dbPath: './data/bot.db', wal: true, hooks });
defineCoreTables(db);
await db.init({ migrations: CORE_MIGRATIONS });

const agents = new AgentRegistry(db, hooks);

// Register an agent
const agentId = await agents.register({
  slug: 'assistant',
  name: 'Assistant',
  adapter: 'api',     // 'api' for LLM calls, 'cli' for subprocess
  role: 'general',
});

console.log(`Registered agent: ${agentId}`);

// Look up agents
const agent = await agents.getBySlug('assistant');
console.log(agent);

// List all active agents
const allAgents = await agents.list({ status: 'idle' });
console.log(`${allAgents.length} idle agents`);
```

You can also seed agents from a config file on startup. `seedFromConfig` skips agents whose slug already exists in the database:

```typescript
await agents.seedFromConfig([
  { slug: 'assistant', name: 'Assistant', adapter: 'api' },
  { slug: 'reviewer', name: 'Code Reviewer', adapter: 'api', role: 'review' },
]);
```

## Creating Tasks

The `TaskQueue` manages prioritized work items assigned to agents.

```typescript
import {
  HookBus,
  DataStore,
  defineCoreTables,
  CORE_MIGRATIONS,
  AgentRegistry,
  TaskQueue,
} from 'botinabox';

const hooks = new HookBus();
const db = new DataStore({ dbPath: './data/bot.db', wal: true, hooks });
defineCoreTables(db);
await db.init({ migrations: CORE_MIGRATIONS });

const agents = new AgentRegistry(db, hooks);
const tasks = new TaskQueue(db, hooks);

// Ensure agent exists
const agentId = await agents.register({
  slug: 'assistant',
  name: 'Assistant',
  adapter: 'api',
});

// Create a task
const taskId = await tasks.create({
  title: 'Write release notes',
  description: 'Summarize the changes in v2.0 for the changelog.',
  assignee_id: agentId,
  priority: 3,           // 1 = highest, 10 = lowest
});

console.log(`Created task: ${taskId}`);

// Listen for task creation events
hooks.register('task.created', async (ctx) => {
  console.log(`Task created: ${ctx.taskId} -- ${ctx.title}`);
});

// Query tasks
const todoTasks = await tasks.list({ status: 'todo' });
console.log(`${todoTasks.length} tasks in queue`);
```

Tasks support followup chains -- when a task completes, a followup task can be automatically created for another agent:

```typescript
await tasks.create({
  title: 'Draft blog post',
  assignee_id: writerAgentId,
  priority: 3,
  followup_agent_id: reviewerAgentId,
  followup_template: 'Review the blog post draft and suggest edits.',
});
```

## Execution

The `RunManager` coordinates task execution. It acquires a per-agent lock, creates a run record, and delegates to an execution adapter.

There are two built-in execution adapters:

- **ApiExecutionAdapter** -- Calls an LLM provider via the ModelRouter. Use this for tasks that need AI reasoning.
- **CliExecutionAdapter** -- Spawns a CLI subprocess (e.g., `claude --print`). Use this for tasks that need tool access.

```typescript
import {
  HookBus,
  DataStore,
  defineCoreTables,
  CORE_MIGRATIONS,
  AgentRegistry,
  TaskQueue,
  RunManager,
  ProviderRegistry,
  ModelRouter,
  ApiExecutionAdapter,
} from 'botinabox';
import createAnthropicProvider from 'botinabox/anthropic';

const hooks = new HookBus();
const db = new DataStore({ dbPath: './data/bot.db', wal: true, hooks });
defineCoreTables(db);
await db.init({ migrations: CORE_MIGRATIONS });

// Set up LLM provider
const providers = new ProviderRegistry();
providers.register(
  createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! })
);

const router = new ModelRouter(providers, {
  default: 'claude-sonnet-4-6',
  aliases: {
    fast: 'claude-haiku-4-5',
    smart: 'claude-sonnet-4-6',
  },
  routing: {},
  fallbackChain: [],
});

// Set up orchestration
const agents = new AgentRegistry(db, hooks);
const tasks = new TaskQueue(db, hooks);
const runs = new RunManager(db, hooks);
const apiAdapter = new ApiExecutionAdapter(router);

// Register agent
const agentId = await agents.register({
  slug: 'assistant',
  name: 'Assistant',
  adapter: 'api',
});

// Create a task
const taskId = await tasks.create({
  title: 'Explain async/await in TypeScript',
  assignee_id: agentId,
});

// Execute the task
const runId = await runs.startRun(agentId, taskId, 'api');

const result = await apiAdapter.execute({
  agent: { id: agentId, model: 'smart' },
  task: { description: 'Explain async/await in TypeScript in 3 paragraphs.' },
});

await runs.finishRun(runId, {
  exitCode: result.exitCode,
  output: result.output,
  usage: result.usage,
});

console.log('Output:', result.output);
```

## Adding a Channel

Channels connect your bot to messaging platforms. This example adds Slack.

```bash
npm install botinabox @anthropic-ai/sdk
```

```typescript
import {
  HookBus,
  DataStore,
  defineCoreTables,
  CORE_MIGRATIONS,
  loadConfig,
  AgentRegistry,
  TaskQueue,
  RunManager,
  ChannelRegistry,
  MessagePipeline,
  ProviderRegistry,
  ModelRouter,
} from 'botinabox';
import createAnthropicProvider from 'botinabox/anthropic';
import { SlackAdapter } from 'botinabox/slack';

async function main() {
  // Load config from YAML
  const { config } = loadConfig({ configPath: 'botinabox.config.yml' });

  const hooks = new HookBus();
  const db = new DataStore({ dbPath: config.data.path, wal: true, hooks });
  defineCoreTables(db);
  await db.init({ migrations: CORE_MIGRATIONS });

  // LLM
  const providers = new ProviderRegistry();
  providers.register(
    createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! })
  );
  const router = new ModelRouter(providers, config.models);

  // Orchestration
  const agents = new AgentRegistry(db, hooks);
  const tasks = new TaskQueue(db, hooks);
  const runs = new RunManager(db, hooks);

  await agents.seedFromConfig(config.agents);

  // Channel setup
  const channels = new ChannelRegistry();
  const slack = new SlackAdapter();
  channels.register(slack, {
    botToken: process.env.SLACK_BOT_TOKEN!,
  });

  // Message pipeline: routes inbound messages to tasks
  const pipeline = new MessagePipeline(hooks, agents, tasks, config);

  // Wire inbound messages from Slack to the pipeline
  slack.onMessage = async (msg) => {
    await pipeline.processInbound(msg);
  };

  // Start everything
  tasks.startPolling();
  await channels.start();

  console.log('Bot is running on Slack');
}

main().catch(console.error);
```

Create `botinabox.config.yml`:

```yaml
data:
  path: ./data/bot.db
  walMode: true

agents:
  - slug: assistant
    name: Assistant
    adapter: api
    model: smart

models:
  default: claude-sonnet-4-6
  aliases:
    fast: claude-haiku-4-5
    smart: claude-sonnet-4-6
  routing:
    conversation: fast
    task_execution: smart
  fallbackChain: []
```

## Message Pipeline

The `MessagePipeline` is the bridge between channels and the task queue. When an inbound message arrives, the pipeline:

1. Emits `message.inbound` on the HookBus
2. Resolves the sender to a user identity (if `UserRegistry` is provided)
3. Picks the right agent based on channel-to-agent bindings in config
4. Applies policy checks (allowlists, mention gates)
5. Creates a task assigned to the resolved agent
6. Emits `message.processed`

You can listen to these events for logging, analytics, or custom routing:

```typescript
hooks.register('message.inbound', async (ctx) => {
  console.log(`Message from ${ctx.message.from} on ${ctx.channel}`);
});

hooks.register('message.processed', async (ctx) => {
  console.log(`Routed to agent: ${ctx.agentId}`);
});
```

Agent-to-channel bindings are configured in `botinabox.config.yml`:

```yaml
agents:
  - slug: support
    name: Support Bot
    adapter: api
    channels: ['slack']

  - slug: devbot
    name: Dev Bot
    adapter: cli
    channels: ['discord']
```

## Scheduling

The `Scheduler` class provides database-backed cron and one-time scheduling. When a schedule fires, it emits a hook event that your application handles.

```typescript
import {
  HookBus,
  DataStore,
  defineCoreTables,
  CORE_MIGRATIONS,
  Scheduler,
  TaskQueue,
  AgentRegistry,
} from 'botinabox';

const hooks = new HookBus();
const db = new DataStore({ dbPath: './data/bot.db', wal: true, hooks });
defineCoreTables(db);
await db.init({ migrations: CORE_MIGRATIONS });

const agents = new AgentRegistry(db, hooks);
const tasks = new TaskQueue(db, hooks);
const scheduler = new Scheduler(db, hooks);

const agentId = await agents.register({
  slug: 'reporter',
  name: 'Daily Reporter',
  adapter: 'api',
});

// Register a recurring schedule (every day at 9:00 AM UTC)
await scheduler.register({
  name: 'daily-report',
  cron: '0 9 * * *',
  timezone: 'UTC',
  action: 'schedule.daily-report',
  actionConfig: { agentId },
});

// Register a one-time schedule
await scheduler.register({
  name: 'launch-announcement',
  runAt: '2025-03-01T12:00:00Z',
  action: 'schedule.announcement',
  actionConfig: { message: 'We have launched!' },
});

// Handle the scheduled events
hooks.register('schedule.daily-report', async (ctx) => {
  await tasks.create({
    title: 'Generate daily report',
    assignee_id: ctx.agentId as string,
    priority: 5,
  });
});

hooks.register('schedule.announcement', async (ctx) => {
  console.log(ctx.message);
});

// Start the scheduler (polls every 30 seconds by default)
await scheduler.start();

console.log('Scheduler running');
```

You can manage schedules at runtime:

```typescript
// List active schedules
const active = await scheduler.list({ enabled: true });

// Update a schedule
await scheduler.update(scheduleId, { cron: '0 10 * * *' });

// Disable a schedule
await scheduler.unregister(scheduleId);
```

## Next Steps

- [Configuration](configuration.md) -- Full config reference with all options
- [Providers](providers.md) -- Add OpenAI, Ollama, or build custom LLM providers
- [Channels](channels.md) -- Add Discord, webhooks, or build custom channel adapters
- [Orchestration](orchestration.md) -- Workflows, budget controls, and multi-agent patterns
- [Architecture](architecture.md) -- How the system fits together
- [API Reference](api-reference.md) -- Complete API documentation
