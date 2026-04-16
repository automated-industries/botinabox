# API Reference

Complete reference for all public exports from the `botinabox` package.

## Import Paths

| Path | Contents |
|------|----------|
| `botinabox` | Core framework — all classes, types, constants, utilities |
| `botinabox/anthropic` | Anthropic Claude provider |
| `botinabox/openai` | OpenAI GPT provider |
| `botinabox/ollama` | Ollama local model provider |
| `botinabox/slack` | Slack channel adapter |
| `botinabox/discord` | Discord channel adapter |
| `botinabox/webhook` | Webhook channel adapter |
| `botinabox/google` | Google Gmail + Calendar connectors |

---

## Core Classes

### HookBus

Event bus for decoupled communication between layers. Handlers run in priority order (lower number = runs first).

```typescript
import { HookBus } from 'botinabox';
const hooks = new HookBus();
```

| Method | Returns | Description |
|--------|---------|-------------|
| `register(event, handler, opts?)` | `() => void` | Register handler; returns unsubscribe function |
| `emit(event, context)` | `Promise<void>` | Emit event to all matching handlers (async) |
| `emitSync(event, context)` | `void` | Emit event synchronously |
| `hasListeners(event)` | `boolean` | Check if event has registered handlers |
| `listRegistered()` | `string[]` | List all registered event names |
| `clear(event?)` | `void` | Clear handlers for one or all events |

**Options:** `{ priority?: number; once?: boolean; filter?: Record<string, unknown> }`

---

### DataStore

SQLite persistence layer built on [LatticeSQL](https://www.npmjs.com/package/latticesql). Manages schema, migrations, queries, and entity context rendering.

```typescript
import { DataStore, defineCoreTables, defineDomainTables } from 'botinabox';
const db = new DataStore({ dbPath: './data/bot.db', outputDir: '.', wal: true, hooks });
defineCoreTables(db);
defineDomainTables(db, { clients: true, repositories: true });
await db.init();
```

**Constructor options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dbPath` | `string` | — | Path to SQLite database file |
| `outputDir` | `string` | `'.'` | Root directory for entity context rendering |
| `wal` | `boolean` | `false` | Enable WAL mode for concurrent reads |
| `hooks` | `HookBus` | — | Optional hook bus for observability |

**CRUD Methods:**

| Method | Returns | Description |
|--------|---------|-------------|
| `insert(table, row)` | `Promise<Row>` | Insert row; returns with generated ID |
| `upsert(table, row)` | `Promise<Row>` | Insert or update existing |
| `update(table, pk, changes)` | `Promise<Row>` | Update by primary key |
| `delete(table, pk)` | `Promise<void>` | Soft-delete (sets `deleted_at`) |
| `get(table, pk)` | `Promise<Row \| undefined>` | Get by primary key |
| `query(table, opts?)` | `Promise<Row[]>` | Query with filters, ordering, pagination |
| `count(table, opts?)` | `Promise<number>` | Count matching rows |
| `link(table, row)` | `Promise<Row>` | Insert into junction table (idempotent) |

**Schema Methods:**

| Method | Description |
|--------|-------------|
| `define(table, def)` | Register table definition (before `init()`) |
| `defineEntityContext(table, def)` | Register entity context rendering |
| `init()` | Initialize database, create tables |
| `migrate(migrations)` | Run versioned migrations |
| `render()` | Render all entity contexts to files |
| `reconcile()` | Render + cleanup orphan directories |
| `tableInfo(table)` | Get column metadata |

---

### AgentRegistry

Manages agent lifecycle — registration, lookup, status transitions.

```typescript
import { AgentRegistry } from 'botinabox';
const agents = new AgentRegistry(db, hooks);
```

| Method | Returns | Description |
|--------|---------|-------------|
| `register(def, opts?)` | `Promise<string>` | Register agent; returns ID. `opts.actorAgentId` for agent-created agents |
| `getById(id)` | `Promise<Row \| undefined>` | Get agent by ID |
| `getBySlug(slug)` | `Promise<Row \| undefined>` | Get agent by slug |
| `list(filter?)` | `Promise<Row[]>` | List agents. Filter: `{ status?, role?, adapter? }` |
| `update(id, changes)` | `Promise<void>` | Update agent fields |
| `setStatus(id, status)` | `Promise<void>` | Validated status transition; emits `agent.status_changed` |

**Agent statuses:** `idle` → `running` → `idle` | `paused` | `terminated` | `error`

---

### TaskQueue

Priority-based task queue with polling, retry policies, and followup chains.

```typescript
import { TaskQueue } from 'botinabox';
const tasks = new TaskQueue(db, hooks, { pollIntervalMs: 30_000 });
```

| Method | Returns | Description |
|--------|---------|-------------|
| `create(def)` | `Promise<string>` | Create task; emits `task.created`; returns ID |
| `update(id, changes)` | `Promise<void>` | Update task fields |
| `get(id)` | `Promise<Row \| undefined>` | Get task by ID |
| `list(filter?)` | `Promise<Row[]>` | List tasks. Filter: `{ status?, assignee_id? }` |
| `startPolling()` | `void` | Start background polling for eligible tasks |
| `stopPolling()` | `void` | Stop polling |

**Task statuses:** `backlog` | `todo` | `in_progress` | `in_review` | `done` | `blocked` | `cancelled`

**TaskDefinition fields:** `title`, `description?`, `assigneeId?`, `priority?` (lower = higher), `followupAgentId?`, `followupTemplate?`, `retryPolicy?`, `metadata?`

---

### RunManager

Manages execution runs with agent locking, retries, and followup chains.

```typescript
import { RunManager } from 'botinabox';
const runs = new RunManager(db, hooks);
```

| Method | Returns | Description |
|--------|---------|-------------|
| `isLocked(agentId)` | `boolean` | Check if agent has an active run |
| `startRun(agentId, taskId, adapter?)` | `Promise<string>` | Create run, acquire lock; returns run ID |
| `finishRun(runId, result)` | `Promise<void>` | Complete run — handles success, failure, retry, followup |
| `getStaleRuns(thresholdMs?)` | `Promise<Row[]>` | Find runs exceeding threshold |
| `reapOrphanRuns(thresholdMs?)` | `Promise<number>` | Fail orphaned runs; returns count |

**finishRun result:** `{ exitCode: number; output?: string; costCents?: number; usage?: { inputTokens, outputTokens }; model?: string; provider?: string }`

On success (`exitCode: 0`): marks task `done`, creates followup task if `followupAgentId` set.
On failure with retries remaining: schedules retry with exponential backoff.

---

### WorkflowEngine

Multi-step workflows with dependency resolution and parallel execution.

```typescript
import { WorkflowEngine } from 'botinabox';
const workflows = new WorkflowEngine(db, hooks, tasks);
```

| Method | Returns | Description |
|--------|---------|-------------|
| `define(slug, def)` | `Promise<void>` | Register workflow; validates deps and cycles |
| `start(slug, context)` | `Promise<string>` | Start workflow run; returns run ID |
| `onStepCompleted(taskId, output)` | `Promise<void>` | Advance workflow when a step completes |
| `list()` | `Promise<Row[]>` | List all defined workflows |
| `get(slug)` | `Promise<Row \| undefined>` | Get workflow by slug |

Steps with no `dependsOn` run in parallel. Steps wait for all dependencies to complete before starting.

---

### Scheduler

Database-backed job scheduling with cron expressions.

```typescript
import { Scheduler } from 'botinabox';
const scheduler = new Scheduler(db, hooks);
```

| Method | Returns | Description |
|--------|---------|-------------|
| `register(def)` | `Promise<string>` | Register schedule; returns ID |
| `update(id, changes)` | `Promise<void>` | Update schedule |
| `unregister(id)` | `Promise<void>` | Remove schedule |
| `list(filter?)` | `Promise<Schedule[]>` | List schedules. Filter: `{ enabled? }` |
| `start(pollIntervalMs?)` | `Promise<void>` | Start polling for due schedules |
| `stop()` | `void` | Stop polling |
| `tick()` | `Promise<void>` | Manually check and fire due schedules |
| `setCircuitBreaker(cb)` | `void` | Wire a CircuitBreaker for `connector.sync` actions |

**ScheduleDef:** `{ name, cron?, runAt?, action, actionConfig?, timezone?, description? }`

When a schedule fires, the scheduler emits `hooks.emit(schedule.action, schedule.actionConfig)`.

---

### mergeTools

Safely combine tool arrays with deduplication. Later tool sets override earlier ones.

```typescript
import { nativeTools, mergeTools } from 'botinabox';
const tools = mergeTools(nativeTools, gmailSkills, pdfSkills);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `...toolSets` | `ReadonlyArray<Tool>[]` | Tool arrays to merge (last wins on name collision) |

Returns `Tool[]`. Logs a warning on each override.

---

### ChannelRegistry

Manages channel adapter lifecycle.

| Method | Returns | Description |
|--------|---------|-------------|
| `register(adapter, config?)` | `void` | Register adapter |
| `unregister(id)` | `Promise<void>` | Disconnect and remove |
| `start()` | `Promise<void>` | Connect all adapters |
| `stop()` | `Promise<void>` | Disconnect all |
| `healthCheck()` | `Promise<Record<string, HealthStatus>>` | Health check all |
| `has(id)` / `get(id)` / `list()` | — | Lookup adapters |

---

### MessagePipeline

Routes inbound messages to tasks.

```typescript
import { MessagePipeline } from 'botinabox';
const pipeline = new MessagePipeline(hooks, agents, tasks, config, userRegistry);
slackAdapter.onMessage = (msg) => pipeline.processInbound(msg);
```

**Flow:** `message.inbound` → resolve user → resolve agent → evaluate policy → create task → `message.processed`

---

### NotificationQueue

Queues and delivers outbound messages with retry.

```typescript
import { NotificationQueue } from 'botinabox';
const notifications = new NotificationQueue(db, hooks, channels);
notifications.startWorker();
await notifications.enqueue('slack', channelId, { text: 'Done!', threadId });
```

---

### BudgetController

Per-agent and global cost tracking.

| Method | Returns | Description |
|--------|---------|-------------|
| `checkBudget(agentId)` | `Promise<BudgetCheck>` | Check agent budget; emits warning at threshold |
| `resetMonthlySpend(agentId)` | `Promise<void>` | Reset monthly spend counter |
| `globalCheck()` | `Promise<{ allowed, totalSpentCents, limitCents }>` | Check global budget |

---

### UserRegistry

User management with cross-channel identity resolution.

| Method | Returns | Description |
|--------|---------|-------------|
| `register(input)` | `Promise<User>` | Create user |
| `getById(id)` / `getByEmail(email)` | `Promise<User \| null>` | Lookup |
| `resolveByIdentity(channel, externalId)` | `Promise<User \| null>` | Find by channel identity |
| `resolveOrCreate(externalId, channel, defaults?)` | `Promise<User>` | Find or create user |
| `addIdentity(userId, channel, externalId)` | `Promise<void>` | Link additional identity |
| `list(filter?)` | `Promise<User[]>` | List users |

---

### SecretStore

Encrypted credential storage.

| Method | Returns | Description |
|--------|---------|-------------|
| `set(input)` | `Promise<SecretMeta>` | Store secret |
| `get(name, environment?)` | `Promise<string \| null>` | Retrieve value |
| `getMeta(name, environment?)` | `Promise<SecretMeta \| null>` | Get metadata only |
| `list()` | `Promise<SecretMeta[]>` | List all metadata |
| `rotate(name, newValue, environment?)` | `Promise<void>` | Update value |
| `delete(name, environment?)` | `Promise<void>` | Remove secret |
| `loadCursor(key)` | `Promise<string \| undefined>` | Load a sync cursor by key |
| `saveCursor(key, value)` | `Promise<void>` | Persist a sync cursor |

**Cursor methods** are convenience wrappers for storing incremental sync state (e.g. Gmail `historyId`, Calendar `syncToken`):

```typescript
import { SecretStore } from 'botinabox';
const secrets = new SecretStore(db);

// Save a sync cursor after pulling new records
await secrets.saveCursor('gmail:user@example.com', result.cursor!);

// Load it on the next sync
const cursor = await secrets.loadCursor('gmail:user@example.com');
const result = await gmail.sync({ cursor });
```

---

## Schema Functions

### defineCoreTables(db)

Creates 18 core tables: `agents`, `tasks`, `runs`, `sessions`, `messages`, `wakeups`, `notifications`, `skills`, `agent_skills`, `cost_events`, `budget_policies`, `activity_log`, `config_revisions`, `workflows`, `workflow_runs`, `users`, `user_identities`, `secrets`, `schedules`, `update_history`

### defineDomainTables(db, options?)

Creates optional domain tables: `org`, `project`, `agent_project`, `client`, `invoice`, `repository`, `file`, `channel`, `rule`, `rule_agent`, `rule_project`, `event`

Options: `{ clients?: boolean; repositories?: boolean; files?: boolean; channels?: boolean; rules?: boolean }`

### defineCoreEntityContexts(db)

Registers entity context rendering for core tables (agents, users, skills, messages).

### defineDomainEntityContexts(db, options?)

Registers entity context rendering for domain tables (org, project, client, file, channel, rule, event).

---

## Entity Context Source Types

| Type | Description | Key Fields |
|------|-------------|------------|
| `self` | The entity's own row | — |
| `hasMany` | Rows in another table with FK to this entity | `table`, `foreignKey`, `orderBy?`, `limit?` |
| `manyToMany` | Rows via junction table | `junctionTable`, `localKey`, `remoteKey`, `remoteTable` |
| `belongsTo` | Single parent row via FK on this entity | `table`, `foreignKey` |
| `custom` | Custom query function | `query: (row, adapter) => Row[]` |
| `enriched` | Self row with embedded lookups | `include: Record<string, Source>` |

---

## Providers

### AnthropicProvider

```typescript
import { AnthropicProvider } from 'botinabox/anthropic';
const provider = new AnthropicProvider({ apiKey: '...' });
```

### OpenAIProvider

```typescript
import { OpenAIProvider } from 'botinabox/openai';
const provider = new OpenAIProvider({ apiKey: '...' });
```

### OllamaProvider

```typescript
import { OllamaProvider } from 'botinabox/ollama';
const provider = new OllamaProvider({ baseUrl: 'http://localhost:11434' });
```

All providers implement `LLMProvider`: `chat(params)`, `chatStream(params)`, `serializeTools(tools)`.

---

## Channel Adapters

All adapters implement `ChannelAdapter`: `connect()`, `disconnect()`, `healthCheck()`, `send(target, payload)`, `onMessage`.

| Adapter | Import | Setup |
|---------|--------|-------|
| Slack | `botinabox/slack` | `new SlackAdapter({ botToken })` |
| Discord | `botinabox/discord` | `new DiscordAdapter({ botToken })` |
| Webhook | `botinabox/webhook` | `new WebhookAdapter()` + `new WebhookServer({ port, secret })` |

### Voice Transcription (`botinabox/slack`)

| Export | Description |
|--------|-------------|
| `transcribeAudio(buffer, filename, opts?)` | Transcribe audio buffer via whisper-node. Returns `string \| null`. |
| `downloadAudio(url, token)` | Download audio from Slack `url_private`. Returns `Buffer \| null`. |
| `enrichVoiceMessage(msg, botToken)` | Enrich a parsed message with local transcription. Returns `InboundMessage`. |
| `extractVoiceTranscript(file)` | Extract Slack's built-in transcript from a file object. Returns `string \| null`. |

Requires optional dependency `whisper-node` and `ffmpeg` on the system PATH. See [Voice Message Transcription](channels.md#voice-message-transcription).

---

## Google Connectors

Both connectors implement `Connector<T>`: `connect(config)`, `sync(options?)`, `healthCheck()`.

| Connector | Import | Record Type |
|-----------|--------|-------------|
| Gmail | `botinabox/google` | `EmailRecord` |
| Calendar | `botinabox/google` | `CalendarEventRecord` |

**Auth options:** OAuth2 (`oauth: { clientId, clientSecret, redirectUri }`) or service account (`serviceAccount: { keyFile, subject? }`).

---

## Utilities

| Export | Description |
|--------|-------------|
| `autoUpdate(packages?, opts?)` | Check npm for newer versions and install at startup |
| `truncateAtWord(text, maxLen)` | Truncate text at the nearest word boundary |
| `parseClaudeStream(stdout)` | Parse Claude CLI NDJSON output |
| `buildProcessEnv(allowedKeys?, inject?)` | Clean subprocess env (strips secrets) |
| `interpolate(template, context)` | `{{key}}` template interpolation |
| `formatText(text, mode)` | Convert markdown to channel format |
| `chunkText(text, maxSize)` | Split text at newline boundaries |
| `sanitize(row, opts?)` | Strip control characters, enforce length limits |
| `detectCycle(steps)` | DFS cycle detection for workflow steps |
| `topologicalSort(steps)` | Topological sort for dependency resolution |
| `checkChainDepth(depth)` | Throws if depth > `MAX_CHAIN_DEPTH` (5) |

### autoUpdate(packages?, opts?)

Checks npm for newer versions of the specified packages and installs them. Designed to run at startup so your bot always uses the latest framework release.

```typescript
import { autoUpdate } from 'botinabox';

// Update botinabox itself (default)
await autoUpdate();

// Update specific packages
await autoUpdate(['botinabox', 'latticesql']);

// With options
await autoUpdate(['botinabox'], { silent: true });
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `packages` | `string[]` | `['botinabox']` | Package names to check and update |
| `opts.silent` | `boolean` | `false` | Suppress console output |

Returns `Promise<void>`.

### truncateAtWord(text, maxLen)

Truncates text to `maxLen` characters, cutting at the nearest word boundary so words are never split mid-way. Appends an ellipsis if the text was truncated.

```typescript
import { truncateAtWord } from 'botinabox';

truncateAtWord('Hello world, this is a long sentence.', 20);
// => 'Hello world, this...'
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `text` | `string` | The input text to truncate |
| `maxLen` | `number` | Maximum character length of the result |

Returns `string`.

---

## Constants

```typescript
import { EVENTS, DEFAULTS, TASK_STATUSES, AGENT_STATUSES, RUN_STATUSES } from 'botinabox';
```

**EVENTS:** `TASK_CREATED`, `TASK_COMPLETED`, `TASK_FAILED`, `RUN_STARTED`, `RUN_COMPLETED`, `RUN_FAILED`, `MESSAGE_INBOUND`, `MESSAGE_ROUTED`, `MESSAGE_PROCESSED`, `MESSAGE_OUTBOUND`, `AGENT_CREATED`, `AGENT_STATUS_CHANGED`, `BUDGET_EXCEEDED`, `COST_RECORDED`, `WORKFLOW_STARTED`, `WORKFLOW_COMPLETED`, `UPDATE_AVAILABLE`

**DEFAULTS:** `TASK_POLL_INTERVAL_MS` (30s), `NOTIFICATION_POLL_INTERVAL_MS` (5s), `HEARTBEAT_INTERVAL_MS` (5m), `STALE_RUN_THRESHOLD_MS` (30m), `MAX_CHAIN_DEPTH` (5), `MAX_NOTIFICATION_RETRIES` (3)
