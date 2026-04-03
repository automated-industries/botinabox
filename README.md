# Bot in a Box

A modular TypeScript framework for building multi-agent bots with LLM orchestration, multi-channel messaging, and task automation.

## Features

- **Multi-agent orchestration** — Define agents with different models, roles, and execution adapters. Task queue with priority scheduling, retry policies, and followup chains.
- **LLM provider abstraction** — Swap between Anthropic, OpenAI, and Ollama with a unified interface. Model aliasing, purpose-based routing, and fallback chains.
- **Channel adapters** — Connect to Slack, Discord, and webhooks. Auto-discovery, session management, and notification queuing.
- **Workflow engine** — Define multi-step workflows with dependency resolution, parallel execution, and conditional branching.
- **SQLite data layer** — Schema-driven tables, migrations, entity context rendering, and query builder. WAL mode for concurrent reads.
- **Event-driven hooks** — Priority-ordered, filter-based event bus for decoupled inter-layer communication.
- **Budget controls** — Per-agent and global cost tracking with warning thresholds and hard stops.
- **Security** — Input sanitization, field length enforcement, audit logging, and HMAC webhook verification.
- **Self-updating** — Built-in update checker with configurable policies and maintenance windows.

## Packages

| Package | Description |
|---------|-------------|
| [`@botinabox/core`](packages/core) | Core framework — config, data, hooks, LLM, orchestration, chat, security |
| [`@botinabox/shared`](packages/shared) | Shared types, interfaces, and constants (zero dependencies) |
| [`@botinabox/cli`](packages/cli) | CLI tool for scaffolding new projects |
| [`@botinabox/provider-anthropic`](packages/providers/anthropic) | Anthropic Claude provider |
| [`@botinabox/provider-openai`](packages/providers/openai) | OpenAI GPT provider |
| [`@botinabox/provider-ollama`](packages/providers/ollama) | Ollama local model provider |
| [`@botinabox/channel-slack`](packages/channels/slack) | Slack channel adapter |
| [`@botinabox/channel-discord`](packages/channels/discord) | Discord channel adapter |
| [`@botinabox/channel-webhook`](packages/channels/webhook) | Webhook channel adapter with HMAC verification |

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+

### Install

```bash
git clone https://github.com/automated-industries/botinabox.git
cd botinabox
pnpm install
pnpm build
```

### Create a Project

```bash
npx botinabox init my-bot
cd my-bot
```

This generates a project with a config file, environment template, and entry point.

### Configure

Edit `botinabox.config.yml`:

```yaml
data:
  path: ./data/bot.db
  walMode: true

channels:
  slack:
    enabled: true
    botToken: ${SLACK_BOT_TOKEN}

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
  default: claude-sonnet-4-6
  aliases:
    fast: claude-haiku-4-5
    smart: claude-opus-4-6
    balanced: claude-sonnet-4-6
  routing:
    conversation: fast
    task_execution: smart
    classification: fast
  fallbackChain: []
```

Set environment variables in `.env`:

```bash
ANTHROPIC_API_KEY=your_key_here
SLACK_BOT_TOKEN=xoxb-your-token
```

### Run

```typescript
import { HookBus } from '@botinabox/core';
import { loadConfig } from '@botinabox/core';
import { DataStore, defineCoreTables } from '@botinabox/core';
import { ProviderRegistry, ModelRouter } from '@botinabox/core';
import { AgentRegistry, TaskQueue, RunManager } from '@botinabox/core';
import { ChannelRegistry, MessagePipeline } from '@botinabox/core';
import createAnthropicProvider from '@botinabox/provider-anthropic';
import createSlackAdapter from '@botinabox/channel-slack';

// Load config
const { config } = loadConfig({ configPath: 'botinabox.config.yml' });

// Initialize systems
const hooks = new HookBus();
const db = new DataStore({ dbPath: config.data.path, wal: config.data.walMode, hooks });
defineCoreTables(db);
db.init();

// LLM providers
const providers = new ProviderRegistry();
providers.register(createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }));
const router = new ModelRouter(providers, config.models);

// Channels
const channels = new ChannelRegistry();
channels.register(createSlackAdapter(), config.channels.slack);

// Orchestration
const agents = new AgentRegistry(db, hooks);
const tasks = new TaskQueue(db, hooks);
const runs = new RunManager(db, hooks);
const pipeline = new MessagePipeline(hooks, agents, tasks, config);

// Start
tasks.startPolling();
await channels.start();
```

## Architecture

```
                    ┌─────────────────────────────────────┐
                    │           Channel Adapters           │
                    │     Slack  ·  Discord  ·  Webhook    │
                    └──────────────┬──────────────────────┘
                                   │ InboundMessage
                    ┌──────────────▼──────────────────────┐
                    │         Message Pipeline             │
                    │   routing · policies · sessions      │
                    └──────────────┬──────────────────────┘
                                   │ Task
                    ┌──────────────▼──────────────────────┐
                    │          Task Queue                  │
                    │  priority · retry · followup chains  │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │          Run Manager                 │
                    │    locking · retries · cost tracking │
                    └──────────────┬──────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
    ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐
    │  CLI Adapter     │  │  API Adapter     │  │  Custom       │
    │  (subprocess)    │  │  (LLM + tools)   │  │  Adapters     │
    └─────────────────┘  └────────┬─────────┘  └──────────────┘
                                  │
                    ┌─────────────▼───────────────────────┐
                    │         LLM Layer                    │
                    │  ProviderRegistry · ModelRouter       │
                    │  CostTracker · Tool Loop              │
                    └─────────────┬───────────────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
    │  Anthropic    │    │  OpenAI       │    │  Ollama       │
    └──────────────┘    └──────────────┘    └──────────────┘
```

Cross-cutting concerns — **HookBus** (events), **DataStore** (persistence), **Security** (sanitization + audit) — connect all layers.

## Documentation

- [Getting Started](docs/getting-started.md) — Installation, project setup, first bot
- [Configuration](docs/configuration.md) — Full config reference
- [Architecture](docs/architecture.md) — System design and patterns
- [Providers](docs/providers.md) — LLM provider setup and custom providers
- [Channels](docs/channels.md) — Channel adapter setup and custom adapters
- [Orchestration](docs/orchestration.md) — Agents, tasks, workflows, and budget controls
- [API Reference](docs/api-reference.md) — Complete API documentation

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run all tests
pnpm test:run

# Type-check
pnpm typecheck
```

### Project Structure

```
botinabox/
├── packages/
│   ├── core/              # Core framework
│   │   └── src/
│   │       ├── config/    # YAML config loader + validation
│   │       ├── data/      # SQLite ORM, migrations, entity rendering
│   │       ├── hooks/     # Event bus
│   │       ├── llm/       # Provider registry, model router, cost tracking
│   │       ├── chat/      # Channel registry, message pipeline, sessions
│   │       ├── orchestrator/  # Agents, tasks, runs, workflows, adapters
│   │       ├── security/  # Sanitizer, audit, column validation
│   │       └── update/    # Self-update system
│   ├── shared/            # Types and constants (zero deps)
│   ├── cli/               # CLI scaffolding tool
│   ├── providers/
│   │   ├── anthropic/     # Claude models
│   │   ├── openai/        # GPT models
│   │   └── ollama/        # Local models
│   └── channels/
│       ├── slack/         # Slack adapter
│       ├── discord/       # Discord adapter
│       └── webhook/       # Webhook adapter + HMAC
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.json
```

## License

MIT
