# Getting Started

## Prerequisites

- **Node.js** 20 or later
- **pnpm** 9 or later

## Installation

### From Source

```bash
git clone https://github.com/automated-industries/botinabox.git
cd botinabox
pnpm install
pnpm build
```

### As a Dependency

```bash
pnpm add @botinabox/core @botinabox/shared
```

Add providers and channels as needed:

```bash
pnpm add @botinabox/provider-anthropic @botinabox/channel-slack
```

## Scaffold a New Project

The CLI generates a project skeleton with config, environment template, and entry point:

```bash
npx botinabox init my-bot
cd my-bot
```

Generated files:

```
my-bot/
├── botinabox.config.yml   # Bot configuration
├── .env                   # Environment variables (gitignored)
├── package.json           # Node project with dependencies
└── src/
    └── index.ts           # Entry point
```

## Configuration

Create `botinabox.config.yml` in your project root:

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
  fallbackChain: []
```

Environment variables referenced with `${VAR_NAME}` are interpolated at load time.

See [Configuration Reference](configuration.md) for all options.

## Your First Bot

```typescript
import {
  HookBus,
  DataStore,
  defineCoreTables,
  loadConfig,
  ProviderRegistry,
  ModelRouter,
  AgentRegistry,
  TaskQueue,
  RunManager,
  ChannelRegistry,
  MessagePipeline,
  setupCostTracker,
} from '@botinabox/core';
import createAnthropicProvider from '@botinabox/provider-anthropic';
import createSlackAdapter from '@botinabox/channel-slack';

async function main() {
  // 1. Load configuration
  const { config, errors } = loadConfig({ configPath: 'botinabox.config.yml' });
  if (errors.length) {
    console.error('Config errors:', errors);
    process.exit(1);
  }

  // 2. Initialize event bus
  const hooks = new HookBus();

  // 3. Initialize data layer
  const db = new DataStore({
    dbPath: config.data.path,
    wal: config.data.walMode,
    hooks,
  });
  defineCoreTables(db);
  db.init();

  // 4. Register LLM providers
  const providers = new ProviderRegistry();
  providers.register(
    createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! })
  );
  const router = new ModelRouter(providers, config.models);

  // 5. Set up cost tracking
  setupCostTracker(hooks, db, { modelCatalog: providers.listModels() });

  // 6. Register channels
  const channels = new ChannelRegistry();
  const slack = createSlackAdapter();
  channels.register(slack, config.channels.slack);

  // 7. Initialize orchestration
  const agents = new AgentRegistry(db, hooks);
  const tasks = new TaskQueue(db, hooks);
  const runs = new RunManager(db, hooks);
  const pipeline = new MessagePipeline(hooks, agents, tasks, config);

  // 8. Register an agent
  await agents.register({
    slug: 'assistant',
    name: 'Assistant',
    adapter: 'api',
    model: 'smart',
  });

  // 9. Listen for events
  hooks.register('task.created', async (ctx) => {
    console.log(`New task: ${ctx.title}`);
  });

  hooks.register('run.completed', async (ctx) => {
    console.log(`Run ${ctx.runId} finished: ${ctx.status}`);
  });

  // 10. Start
  tasks.startPolling();
  await channels.start();
  console.log('Bot is running');
}

main().catch(console.error);
```

## Next Steps

- [Configuration Reference](configuration.md) — All config options
- [Providers](providers.md) — Add OpenAI, Ollama, or custom providers
- [Channels](channels.md) — Add Discord, webhooks, or custom channels
- [Orchestration](orchestration.md) — Multi-agent tasks, workflows, and budget controls
- [Architecture](architecture.md) — How the system fits together
