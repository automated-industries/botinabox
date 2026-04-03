# API Reference

Complete API documentation for all public modules.

## `@botinabox/shared`

Zero-dependency package with types, interfaces, and constants.

### Constants

#### `EVENTS`

```typescript
import { EVENTS } from '@botinabox/shared';

EVENTS.COST_RECORDED          // "cost.recorded"
EVENTS.AGENT_CREATED          // "agent.created"
EVENTS.AGENT_STATUS_CHANGED   // "agent.status_changed"
EVENTS.BUDGET_EXCEEDED         // "budget.exceeded"
EVENTS.TASK_CREATED            // "task.created"
EVENTS.TASK_COMPLETED          // "task.completed"
EVENTS.TASK_FAILED             // "task.failed"
EVENTS.TASK_CANCELLED          // "task.cancelled"
EVENTS.RUN_STARTED             // "run.started"
EVENTS.RUN_COMPLETED           // "run.completed"
EVENTS.RUN_FAILED              // "run.failed"
EVENTS.MESSAGE_INBOUND         // "message.inbound"
EVENTS.MESSAGE_ROUTED          // "message.routed"
EVENTS.MESSAGE_PROCESSED       // "message.processed"
EVENTS.MESSAGE_OUTBOUND        // "message.outbound"
EVENTS.MESSAGE_SENT            // "message.sent"
EVENTS.UPDATE_AVAILABLE        // "update.available"
EVENTS.UPDATE_STARTED          // "update.started"
EVENTS.UPDATE_COMPLETED        // "update.completed"
EVENTS.UPDATE_FAILED           // "update.failed"
EVENTS.WORKFLOW_STARTED        // "workflow.started"
EVENTS.WORKFLOW_STEP_COMPLETED // "workflow.step_completed"
EVENTS.WORKFLOW_COMPLETED      // "workflow.completed"
EVENTS.WORKFLOW_FAILED         // "workflow.failed"
```

#### `DEFAULTS`

```typescript
import { DEFAULTS } from '@botinabox/shared';

DEFAULTS.TASK_POLL_INTERVAL_MS       // 30,000
DEFAULTS.NOTIFICATION_POLL_INTERVAL_MS // 5,000
DEFAULTS.HEARTBEAT_INTERVAL_MS       // 300,000
DEFAULTS.ORPHAN_REAP_INTERVAL_MS     // 300,000
DEFAULTS.STALE_RUN_THRESHOLD_MS      // 1,800,000
DEFAULTS.STALE_TASK_AGE_MS           // 7,200,000
DEFAULTS.MAX_CHAIN_DEPTH             // 5
DEFAULTS.MAX_NOTIFICATION_RETRIES    // 3
DEFAULTS.UPDATE_CHECK_INTERVAL_MS    // 86,400,000
DEFAULTS.RENDER_WATCH_INTERVAL_MS    // 30,000
DEFAULTS.DATA_PATH                   // "./data/bot.db"
DEFAULTS.RENDER_OUTPUT_DIR           // "./context"
DEFAULTS.LOG_PATH_TEMPLATE           // "./data/runs/{runId}.ndjson"
DEFAULTS.BUDGET_WARN_PERCENT         // 80
```

#### Status Enums

```typescript
import { TASK_STATUSES, AGENT_STATUSES, RUN_STATUSES } from '@botinabox/shared';

TASK_STATUSES   // "backlog" | "todo" | "in_progress" | "in_review" | "done" | "blocked" | "cancelled"
AGENT_STATUSES  // "idle" | "running" | "paused" | "terminated" | "error"
RUN_STATUSES    // "queued" | "running" | "succeeded" | "failed" | "cancelled"
```

### Types

#### Configuration

```typescript
interface BotConfig {
  data: DataConfig;
  channels: Record<string, ChannelEntry>;
  agents: AgentConfig[];
  providers: Record<string, ProviderEntry>;
  models: ModelConfig;
  entities: Record<string, EntityConfig>;
  security: SecurityConfig;
  render: RenderConfig;
  updates: UpdateConfig;
  budget: BudgetConfig;
  workflows?: Record<string, WorkflowConfigEntry>;
}

interface DataConfig {
  path: string;
  walMode: boolean;
  backupDir?: string;
}

interface ModelConfig {
  aliases: Record<string, string>;
  default: string;
  routing: Record<string, string>;
  fallbackChain: string[];
  costLimit?: { perRunCents?: number };
}

interface SecurityConfig {
  fieldLengthLimits?: Record<string, number>;
  allowedFilePrefixes?: string[];
}

interface RenderConfig {
  outputDir: string;
  watchIntervalMs: number;
}

interface UpdateConfig {
  policy: "auto-all" | "auto-compatible" | "auto-patch" | "notify" | "manual";
  checkIntervalMs: number;
  maintenanceWindow?: {
    utcHourStart: number;
    utcHourEnd: number;
    days?: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun">;
  };
}

interface BudgetConfig {
  globalMonthlyCents?: number;
  warnPercent: number;
}
```

#### Agent Types

```typescript
interface AgentConfig {
  slug: string;
  name: string;
  role?: string;
  adapter: string;
  model?: string;
  workdir?: string;
  instructionsFile?: string;
  maxConcurrentRuns?: number;
  budgetMonthlyCents?: number;
  canCreateAgents?: boolean;
  skipPermissions?: boolean;
  config?: Record<string, unknown>;
}

interface AgentRecord extends AgentConfig {
  id: string;
  status: "idle" | "running" | "paused" | "terminated" | "error";
  spentMonthlyCents: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

interface BudgetCheck {
  allowed: boolean;
  status: "ok" | "warning" | "hard_stop";
  spentCents: number;
  limitCents?: number;
  message?: string;
}
```

#### LLM Types

```typescript
interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string | ContentBlock[];
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
}

interface ChatParams {
  messages: ChatMessage[];
  system?: string;
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  model: string;
  abortSignal?: AbortSignal;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

interface ChatResult {
  content: string;
  toolUses?: ToolUse[];
  usage: TokenUsage;
  model: string;
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
}

interface ModelInfo {
  id: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: Array<"chat" | "tools" | "vision" | "streaming">;
  inputCostPerMToken?: number;
  outputCostPerMToken?: number;
}

interface LLMProvider {
  id: string;
  displayName: string;
  models: ModelInfo[];
  chat(params: ChatParams): Promise<ChatResult>;
  chatStream(params: ChatParams): AsyncGenerator<string, ChatResult>;
  serializeTools(tools: ToolDefinition[]): unknown;
}
```

#### Channel Types

```typescript
type ChatType = "direct" | "group" | "channel";
type FormattingMode = "markdown" | "mrkdwn" | "html" | "plain";

interface ChannelCapabilities {
  chatTypes: ChatType[];
  threads: boolean;
  reactions: boolean;
  editing: boolean;
  media: boolean;
  polls: boolean;
  maxTextLength: number;
  formattingMode: FormattingMode;
}

interface InboundMessage {
  id: string;
  channel: string;
  account?: string;
  from: string;
  body: string;
  threadId?: string;
  replyToId?: string;
  attachments?: Attachment[];
  receivedAt: string;
  raw?: unknown;
}

interface OutboundPayload {
  text: string;
  threadId?: string;
  replyToId?: string;
  attachments?: Attachment[];
}

interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface ChannelAdapter {
  id: string;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;
  connect(config: ChannelConfig): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<HealthStatus>;
  send(target: { peerId: string; threadId?: string }, payload: OutboundPayload): Promise<SendResult>;
  onMessage?: (message: InboundMessage) => Promise<void>;
}
```

#### Task Types

```typescript
type TaskStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "blocked" | "cancelled";

interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
}

interface TaskDefinition {
  title: string;
  description?: string;
  assigneeId?: string;
  priority?: number;
  parentId?: string;
  dependsOn?: string[];
  followupAgentId?: string;
  followupTemplate?: string;
  chainOriginId?: string;
  chainDepth?: number;
  retryPolicy?: RetryPolicy;
  metadata?: Record<string, unknown>;
}

interface TaskRecord extends TaskDefinition {
  id: string;
  status: TaskStatus;
  priority: number;
  chainDepth: number;
  retryCount: number;
  maxRetries: number;
  nextRetryAt?: string;
  executionRunId?: string;
  result?: string;
  completedOutput?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  deletedAt?: string;
}
```

#### Execution Types

```typescript
type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

interface RunContext {
  runId: string;
  agentId: string;
  agentSlug: string;
  taskId?: string;
  taskTitle?: string;
  taskDescription?: string;
  model: string;
  workdir: string;
  sessionParams?: unknown;
  abortSignal?: AbortSignal;
  onLog?: (line: string) => void;
}

interface RunResult {
  status: "succeeded" | "failed";
  output?: string;
  error?: string;
  usage?: TokenUsage;
  costCents?: number;
  sessionParams?: unknown;
  clearSession?: boolean;
  durationMs: number;
}

interface ExecutionAdapter {
  id: string;
  execute(ctx: RunContext): Promise<RunResult>;
}
```

#### Workflow Types

```typescript
type WorkflowRunStatus = "running" | "completed" | "failed" | "cancelled";

interface WorkflowStep {
  id: string;
  name: string;
  agentSlug?: string;
  agentResolver?: string;
  taskTemplate: { title: string; description: string };
  dependsOn?: string[];
  onComplete?: "next" | "parallel" | "end";
  onFail?: "abort" | "skip" | "retry";
  retryPolicy?: RetryPolicy;
  condition?: string;
}

interface WorkflowDefinition {
  slug: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  trigger?: WorkflowTrigger;
}

interface WorkflowTrigger {
  type: "task_completed" | "event" | "schedule" | "manual";
  filter?: Record<string, unknown>;
}
```

---

## `@botinabox/core`

### HookBus

```typescript
import { HookBus } from '@botinabox/core';

class HookBus {
  register(event: string, handler: HookHandler, opts?: HookOptions): Unsubscribe;
  emit(event: string, context: Record<string, unknown>): Promise<void>;
  emitSync(event: string, context: Record<string, unknown>): void;
  hasListeners(event: string): boolean;
  listRegistered(): string[];
  clear(event?: string): void;
}

type HookHandler = (context: Record<string, unknown>) => Promise<void> | void;
type Unsubscribe = () => void;

interface HookOptions {
  priority?: number;              // 0-100, default 50, lower runs first
  once?: boolean;                 // Auto-remove after first call
  filter?: Record<string, unknown>; // Only fire if context matches
}
```

### Config

```typescript
import { loadConfig, initConfig, getConfig, interpolateEnv } from '@botinabox/core';

function loadConfig(opts?: {
  configPath?: string;
  overrides?: Partial<BotConfig>;
  env?: Record<string, string | undefined>;
}): { config: BotConfig; errors: ConfigLoadError[] };

function initConfig(opts?: Parameters<typeof loadConfig>[0]): ConfigLoadError[];
function getConfig(): BotConfig;  // Frozen singleton
function interpolateEnv(obj: unknown, env: Record<string, string | undefined>): unknown;
```

### DataStore

```typescript
import { DataStore, defineCoreTables } from '@botinabox/core';

class DataStore {
  constructor(opts: { dbPath: string; outputDir?: string; wal?: boolean; hooks?: HookBus });

  define(name: string, def: TableDefinition): void;
  defineEntityContext(name: string, def: EntityContextDef): void;
  init(): void;

  insert(table: string, row: Row): Row;
  upsert(table: string, row: Row): Row;
  update(table: string, pk: string | Record<string, unknown>, changes: Row): Row;
  delete(table: string, pk: string | Record<string, unknown>): void;
  get(table: string, pk: string | Record<string, unknown>): Row | undefined;
  query(table: string, opts?: QueryOptions): Row[];
  count(table: string, opts?: QueryOptions): number;

  link(junctionTable: string, row: Row): void;
  unlink(junctionTable: string, row: Row): void;

  seed(items: SeedItem[]): void;
  render(manifest: RenderManifest): void;
}

function defineCoreTables(db: DataStore): void;

interface TableDefinition {
  columns: Record<string, string>;
  primaryKey?: string | string[];
  tableConstraints?: string[];
  relations?: Record<string, RelationDef>;
  render?: string | ((rows: Row[]) => string);
  outputFile?: string;
  filter?: (rows: Row[]) => Row[];
}

interface QueryOptions {
  where?: Record<string, unknown>;
  filters?: Filter[];
  orderBy?: string | Array<{ col: string; dir: 'asc' | 'desc' }>;
  orderDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}
```

### ProviderRegistry & ModelRouter

```typescript
import { ProviderRegistry, ModelRouter, discoverProviders, setupCostTracker } from '@botinabox/core';

class ProviderRegistry {
  register(provider: LLMProvider): void;
  unregister(id: string): void;
  get(id: string): LLMProvider | undefined;
  list(): LLMProvider[];
  listModels(): ModelInfo[];
}

class ModelRouter {
  constructor(registry: ProviderRegistry, config: ModelConfig);
  resolve(modelIdOrAlias: string): ResolvedModel | undefined;
  resolveWithFallback(modelIdOrAlias: string): ResolvedModel;
  resolveForPurpose(purpose: string): ResolvedModel;
  listAvailable(): ModelInfo[];
}

interface ResolvedModel {
  provider: string;
  model: string;
}

function discoverProviders(nodeModulesPath: string, importer?: Function): Promise<LLMProvider[]>;
function setupCostTracker(hooks: HookBus, db: DataStore, opts?: { modelCatalog?: ModelInfo[] }): void;
```

### Chat

```typescript
import {
  ChannelRegistry,
  MessagePipeline,
  ChatSessionManager,
  SessionKey,
  NotificationQueue,
  discoverChannels,
  buildAgentBindings,
  checkAllowlist,
  checkMentionGate,
} from '@botinabox/core';

class ChannelRegistry {
  register(adapter: ChannelAdapter, config?: unknown): void;
  unregister(id: string): Promise<void>;
  reconfigure(id: string, config: unknown): Promise<void>;
  get(id: string): ChannelAdapter | undefined;
  healthCheck(): Promise<Record<string, HealthStatus>>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

class MessagePipeline {
  constructor(hooks: HookBus, agentRegistry: AgentRegistry, taskQueue: TaskQueue, config: BotConfig);
  processInbound(msg: InboundMessage): Promise<void>;
  resolveAgent(msg: InboundMessage): string | undefined;
  evaluatePolicy(msg: InboundMessage, agentId: string): boolean;
}

class ChatSessionManager {
  save(agentId: string, channelId: string, peerId: string, params: Record<string, unknown>): Promise<string>;
  load(agentId: string, channelId: string, peerId: string): Promise<Record<string, unknown> | undefined>;
  clear(agentId: string, channelId: string, peerId: string): Promise<void>;
  shouldClear(session: Record<string, unknown>, opts: { maxRuns?: number; maxAgeHours?: number }): Promise<boolean>;
}

class SessionKey {
  constructor(agentId: string, channel: string, scope: string);
  toString(): string;
  toJSON(): { agentId: string; channel: string; scope: string };
  static fromString(key: string): SessionKey;
  static build(agentId: string, channel: string, chatType: string, peerId: string, dmScope: string): SessionKey;
}

class NotificationQueue {
  constructor(db: DataStore, hooks: HookBus, channelRegistry: ChannelRegistry, opts?: NotificationQueueOpts);
  enqueue(channel: string, recipient: string, payload: OutboundPayload): Promise<string>;
  startWorker(): void;
  stopWorker(): void;
}

function discoverChannels(nodeModulesPath: string, importer?: Function): Promise<ChannelAdapter[]>;
function buildAgentBindings(agents: AgentConfig[]): Map<string, string>;
function checkAllowlist(allowFrom: string[], senderId: string): boolean;
function checkMentionGate(msg: InboundMessage, botId: string): boolean;
```

### Orchestrator

```typescript
import {
  AgentRegistry,
  TaskQueue,
  RunManager,
  WorkflowEngine,
  BudgetController,
  WakeupQueue,
  HeartbeatScheduler,
  NdjsonLogger,
  checkChainDepth,
  buildChainOrigin,
  detectCycle,
  topologicalSort,
  toolLoop,
} from '@botinabox/core';

class AgentRegistry {
  constructor(db: DataStore, hooks: HookBus);
  register(agent: object, opts?: { actorAgentId?: string }): Promise<string>;
  getById(id: string): Promise<Record<string, unknown> | undefined>;
  getBySlug(slug: string): Promise<Record<string, unknown> | undefined>;
  list(filter?: { status?: string; role?: string }): Promise<Record<string, unknown>[]>;
  update(id: string, changes: Record<string, unknown>): Promise<void>;
}

class TaskQueue {
  constructor(db: DataStore, hooks: HookBus, config?: { pollIntervalMs?: number; staleThresholdMs?: number });
  create(task: object): Promise<string>;
  update(id: string, changes: Record<string, unknown>): Promise<void>;
  get(id: string): Promise<Record<string, unknown> | undefined>;
  list(filter?: { status?: string; assignee_id?: string }): Promise<Record<string, unknown>[]>;
  startPolling(): void;
  stopPolling(): void;
}

class RunManager {
  constructor(db: DataStore, hooks: HookBus, config?: { staleThresholdMs?: number; maxBackoffMs?: number });
  isLocked(agentId: string): boolean;
  startRun(agentId: string, taskId: string, adapter?: string): Promise<string>;
  finishRun(runId: string, result: object): Promise<void>;
}

class WorkflowEngine {
  constructor(db: DataStore, hooks: HookBus, taskQueue: TaskQueue);
  define(slug: string, def: WorkflowDefinition): Promise<void>;
  start(workflowSlug: string, context: Record<string, unknown>): Promise<string>;
  advance(workflowRunId: string): Promise<void>;
}

class BudgetController {
  constructor(db: DataStore, hooks: HookBus);
  checkBudget(agentId: string): Promise<BudgetCheck>;
  resetMonthlySpend(agentId: string): Promise<void>;
  globalCheck(): Promise<object>;
}

class WakeupQueue {
  enqueue(agentId: string, source: string, context?: Record<string, unknown>): Promise<string>;
  coalesce(agentId: string, context?: Record<string, unknown>): Promise<void>;
  getNext(agentId: string): Promise<Record<string, unknown> | undefined>;
  markFired(wakeupId: string, runId: string): Promise<void>;
}

class HeartbeatScheduler {
  constructor(wakeupQueue: WakeupQueue, hooks: HookBus);
  start(agents: Array<{ id: string; heartbeat_config: string }>): void;
  stop(): void;
}

class NdjsonLogger {
  constructor(logPath: string);
  log(stream: 'stdout' | 'stderr', chunk: string): void;
  close(): void;
}

function checkChainDepth(depth: number, max?: number): void;
function buildChainOrigin(parentTaskId?: string, parentOriginId?: string, parentDepth?: number): object;
function detectCycle(steps: Array<{ id: string; dependsOn?: string[] }>): boolean;
function topologicalSort(steps: Array<{ id: string; dependsOn?: string[] }>): string[];

function toolLoop(
  params: { model: string; messages: ChatMessage[]; systemPrompt?: string; tools?: ToolDefinition[]; maxIterations?: number; signal?: AbortSignal },
  callLLM: (params: ChatParams) => Promise<ChatResult>,
  executeTool?: (name: string, input: unknown) => Promise<string>
): AsyncGenerator<{ type: 'text'; content: string } | { type: 'tool_use'; name: string; input: unknown } | { type: 'done'; result: ChatResult }>;
```

### UserRegistry (v0.2.0+)

```typescript
import { UserRegistry } from 'botinabox';

class UserRegistry {
  constructor(db: DataStore, hooks: HookBus);
  register(input: UserInput): Promise<User>;
  getById(id: string): Promise<User | null>;
  getByEmail(email: string): Promise<User | null>;
  resolveByIdentity(channel: string, externalId: string): Promise<User | null>;
  resolveOrCreate(externalId: string, channel: string, defaults?: Partial<UserInput>): Promise<User>;
  list(filter?: { role?: string; org_id?: string }): Promise<User[]>;
  update(id: string, changes: Partial<UserInput>): Promise<void>;
  addIdentity(userId: string, channel: string, externalId: string, displayName?: string): Promise<void>;
}
```

Users are **protected objects** — their context is never auto-rendered into other entities' files. Use `resolveOrCreate()` in the message pipeline to auto-create users from channel peer IDs.

### SecretStore (v0.2.0+)

```typescript
import { SecretStore } from 'botinabox';

class SecretStore {
  constructor(db: DataStore, hooks: HookBus);
  set(input: SecretInput): Promise<SecretMeta>;
  get(name: string, environment?: string): Promise<string | null>;  // decrypted value
  getMeta(name: string, environment?: string): Promise<SecretMeta | null>;
  list(): Promise<SecretMeta[]>;  // metadata only, no values
  rotate(name: string, newValue: string, environment?: string): Promise<void>;
  delete(name: string, environment?: string): Promise<void>;
}
```

Secrets are **protected objects** with optional at-rest encryption. When Lattice's `encryptionKey` is configured, secret values are transparently encrypted on write and decrypted on read. Use `get()` for the decrypted value, `getMeta()` for metadata only.

### Security

```typescript
import { sanitize } from '@botinabox/core';

function sanitize(
  row: Record<string, unknown>,
  opts?: {
    fieldLengthLimits?: Record<string, number>;
    truncateSuffix?: string;
  }
): Record<string, unknown>;
```

### Update

```typescript
import { UpdateManager, UpdateChecker, BackupManager } from '@botinabox/core';

class UpdateManager {
  constructor(checker: UpdateChecker, db: DataStore, hooks: HookBus, opts?: object);
  checkAndNotify(): Promise<UpdateManifest>;
  applyUpdates(updates: PackageUpdate[]): Promise<void>;
  isInMaintenanceWindow(): boolean;
}

class BackupManager {
  backup(): Promise<string>;
  restore(backupPath: string): Promise<void>;
  cleanup(backupPath: string): Promise<void>;
}
```
