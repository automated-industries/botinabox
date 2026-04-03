# Orchestration

The orchestration layer manages agents, tasks, runs, workflows, and budget controls.

## Agents

### Agent Registry

```typescript
import { AgentRegistry } from '@botinabox/core';

const agents = new AgentRegistry(db, hooks);

// Register a new agent
const agentId = await agents.register({
  slug: 'researcher',
  name: 'Research Agent',
  adapter: 'api',
  model: 'smart',
  role: 'general',
  budgetMonthlyCents: 5000,
});

// Lookup
const agent = await agents.getById(agentId);
const agent = await agents.getBySlug('researcher');

// List with filters
const active = await agents.list({ status: 'idle' });
const admins = await agents.list({ role: 'admin' });

// Update
await agents.update(agentId, { status: 'paused' });
```

### Agent State Machine

```
        ┌──────────┐
        │   idle    │◄──────────────┐
        └────┬─────┘               │
             │ task assigned        │ run completes
             ▼                     │
        ┌──────────┐          ┌────┴─────┐
        │ running   │─────────►│  idle     │
        └────┬─────┘          └──────────┘
             │ pause
             ▼
        ┌──────────┐
        │  paused   │
        └────┬─────┘
             │ terminate
             ▼
        ┌──────────┐
        │terminated │  (terminal)
        └──────────┘
```

Valid transitions: `idle→running`, `idle→paused`, `running→idle`, `running→paused`, `running→terminated`, `paused→idle`, `paused→terminated`.

### Agent-Created Agents

Agents with `canCreateAgents: true` can register new agents at runtime:

```typescript
await agents.register(
  { slug: 'sub-agent', name: 'Sub Agent', adapter: 'api' },
  { actorAgentId: parentAgentId }
);
```

The `actorAgentId` is recorded in the audit log.

## Tasks

### Task Queue

```typescript
import { TaskQueue } from '@botinabox/core';

const tasks = new TaskQueue(db, hooks, {
  pollIntervalMs: 30000,       // How often to check for eligible tasks
  staleThresholdMs: 7200000,   // Mark tasks stale after 2 hours
});

// Create a task
const taskId = await tasks.create({
  title: 'Research market trends',
  description: 'Analyze Q1 2026 market data and summarize findings',
  assignee_id: agentId,
  priority: 30,                // Lower = higher priority (default 50)
});

// Update
await tasks.update(taskId, { status: 'in_progress' });

// Get
const task = await tasks.get(taskId);

// List with filters
const pending = await tasks.list({ status: 'todo' });
const myTasks = await tasks.list({ assignee_id: agentId });

// Start/stop polling
tasks.startPolling();
tasks.stopPolling();
```

### Task Statuses

| Status | Description |
|--------|-------------|
| `backlog` | Created but not ready |
| `todo` | Ready to be picked up |
| `in_progress` | Currently executing |
| `in_review` | Awaiting review |
| `done` | Completed successfully |
| `blocked` | Waiting on dependency |
| `cancelled` | Cancelled |

### Priority

Priority is numeric, lower = higher priority. Default is 50.

```typescript
await tasks.create({ title: 'Urgent', priority: 10 });   // Runs first
await tasks.create({ title: 'Normal', priority: 50 });   // Default
await tasks.create({ title: 'Low', priority: 90 });      // Runs last
```

### Retry Policies

Tasks can define retry behavior for failed runs:

```typescript
await tasks.create({
  title: 'Flaky operation',
  retryPolicy: {
    maxRetries: 3,
    backoffMs: 1000,           // Initial backoff
    backoffMultiplier: 2,      // Exponential: 1s, 2s, 4s
    maxBackoffMs: 300000,      // Cap at 5 minutes
  },
});
```

The `RunManager` handles retries automatically — failed runs reschedule the task with exponential backoff.

### Followup Chains

Tasks can trigger follow-up tasks on completion, creating multi-agent workflows:

```typescript
await tasks.create({
  title: 'Write draft',
  assignee_id: writerAgentId,
  followupAgentId: reviewerAgentId,
  followupTemplate: 'Review the draft: {{completedOutput}}',
});
```

When the writer finishes, a new task is automatically created for the reviewer with the writer's output embedded in the description.

**Chain depth limits** prevent infinite chains (default max: 5):

```typescript
// Chain metadata is tracked automatically
{
  chainOriginId: 'original-task-id',  // Root task
  chainDepth: 2,                       // Current depth
}
```

### Task Dependencies

Tasks can depend on other tasks:

```typescript
const taskA = await tasks.create({ title: 'Step A' });
const taskB = await tasks.create({
  title: 'Step B',
  dependsOn: [taskA],  // Won't execute until A completes
});
```

## Runs

### Run Manager

```typescript
import { RunManager } from '@botinabox/core';

const runs = new RunManager(db, hooks, {
  staleThresholdMs: 1800000,  // 30 minutes
  maxBackoffMs: 300000,       // 5 minutes max retry backoff
});

// Check if agent is locked (already running)
const busy = runs.isLocked(agentId);

// Start a run
const runId = await runs.startRun(agentId, taskId, 'api');

// Finish a run
await runs.finishRun(runId, {
  exitCode: 0,                // 0 = success, non-zero = failure
  output: 'Analysis complete',
  costCents: 12,
  usage: { inputTokens: 5000, outputTokens: 2000 },
});
```

Run statuses: `queued`, `running`, `succeeded`, `failed`, `cancelled`.

### Execution Adapters

Two built-in execution adapters:

**API Adapter** — Runs tasks via LLM API calls with tool loop:

```typescript
const apiAdapter = new ApiExecutionAdapter(modelRouter);

const result = await apiAdapter.execute({
  agent: { id: agentId, model: 'smart' },
  task: { description: 'Analyze this data...' },
  sessionParams: { history: previousMessages },
  contextFiles: ['./context/agents/researcher/AGENT.md'],
});

// result.output — LLM response text
// result.usage — Token counts
// result.sessionParams — Updated session state
```

**CLI Adapter** — Runs tasks as subprocesses:

```typescript
const cliAdapter = new CliExecutionAdapter();

const result = await cliAdapter.execute({
  agent: { id: agentId, cwd: './projects/my-app', skip_permissions: true },
  task: { title: 'Run tests', description: 'Execute the test suite' },
  logPath: './data/runs/run-123.ndjson',
});

// result.output — Process stdout
// result.exitCode — Process exit code
```

### Run Logging

Runs are logged in NDJSON format:

```typescript
import { NdjsonLogger } from '@botinabox/core';

const logger = new NdjsonLogger('./data/runs/run-123.ndjson');
logger.log('stdout', 'Processing...\n');
logger.log('stderr', 'Warning: low memory\n');
logger.close();
```

Each line is a JSON object:

```json
{"timestamp":"2026-04-03T12:00:00.000Z","stream":"stdout","chunk":"Processing...\n"}
```

## Workflows

Workflows define multi-step processes as directed acyclic graphs (DAGs).

### Defining a Workflow

```typescript
import { WorkflowEngine } from '@botinabox/core';

const workflows = new WorkflowEngine(db, hooks, taskQueue);

await workflows.define('deploy-pipeline', {
  slug: 'deploy-pipeline',
  name: 'Deploy Pipeline',
  description: 'Build, test, and deploy',
  steps: [
    {
      id: 'build',
      name: 'Build',
      agentSlug: 'builder',
      taskTemplate: {
        title: 'Build project',
        description: 'Run the build process',
      },
    },
    {
      id: 'test',
      name: 'Test',
      agentSlug: 'tester',
      dependsOn: ['build'],         // Runs after build
      taskTemplate: {
        title: 'Run tests',
        description: 'Execute test suite',
      },
    },
    {
      id: 'security-scan',
      name: 'Security Scan',
      agentSlug: 'scanner',
      dependsOn: ['build'],         // Also runs after build (parallel with test)
      taskTemplate: {
        title: 'Security scan',
        description: 'Scan for vulnerabilities',
      },
    },
    {
      id: 'deploy',
      name: 'Deploy',
      agentSlug: 'deployer',
      dependsOn: ['test', 'security-scan'],  // Runs after both complete
      taskTemplate: {
        title: 'Deploy to production',
        description: 'Deploy the built artifact',
      },
      onFail: 'abort',
    },
  ],
});
```

### Running a Workflow

```typescript
// Start a workflow run
const workflowRunId = await workflows.start('deploy-pipeline', {
  branch: 'main',
  commit: 'abc123',
});

// advance() is called automatically when tasks complete
// You can also call it manually:
await workflows.advance(workflowRunId);
```

### Step Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | `string` | required | Unique step identifier |
| `name` | `string` | required | Display name |
| `agentSlug` | `string` | — | Agent to execute this step |
| `agentResolver` | `string` | — | Dynamic agent selection expression |
| `taskTemplate` | `object` | required | Task title + description template |
| `dependsOn` | `string[]` | `[]` | Step IDs that must complete first |
| `onComplete` | `string` | `"next"` | `"next"`, `"parallel"`, or `"end"` |
| `onFail` | `string` | `"abort"` | `"abort"`, `"skip"`, or `"retry"` |
| `retryPolicy` | `object` | — | Retry config for this step |
| `condition` | `string` | — | Condition expression to evaluate |

### Validation

The workflow engine validates definitions before accepting them:

- No duplicate step IDs
- No references to undefined steps in `dependsOn`
- No cyclic dependencies (topologically sorted)

### Execution Order

Steps with no dependencies run first. Steps run in parallel when their dependencies are all satisfied. The engine uses topological sorting to determine valid execution order.

```
build ──► test ──────────► deploy
     └──► security-scan ──┘
```

In this DAG, `build` runs first, then `test` and `security-scan` run in parallel, then `deploy` runs after both complete.

## Budget Controls

### Per-Agent Budgets

Set a monthly cost cap per agent:

```yaml
agents:
  - slug: researcher
    budgetMonthlyCents: 5000   # $50/month cap
```

### Budget Controller

```typescript
import { BudgetController } from '@botinabox/core';

const budgets = new BudgetController(db, hooks);

// Check if an agent can run
const check = await budgets.checkBudget(agentId);
// → { allowed: true, currentSpendCents: 2300, limitCents: 5000 }
// → { allowed: false, reason: 'Monthly budget exceeded', ... }

// Global check (across all agents)
const global = await budgets.globalCheck();

// Reset monthly spend (e.g., on month boundary)
await budgets.resetMonthlySpend(agentId);
```

### Budget Behavior

| Spend Level | Behavior |
|-------------|----------|
| Below `warnPercent` | `allowed: true`, status `ok` |
| At `warnPercent` threshold | `allowed: true`, status `warning`, emits `budget.exceeded` hook |
| At or above limit | `allowed: false`, status `hard_stop` |
| No limit set (≤0) | Always allowed |

Listen for budget warnings:

```typescript
hooks.register('budget.exceeded', async (ctx) => {
  console.warn(`Agent ${ctx.agentId} at ${ctx.spentCents}/${ctx.limitCents} cents`);
  // Send alert, pause agent, etc.
});
```

## Wakeups and Heartbeats

### Wakeup Queue

Agents can be woken up by external events or scheduled heartbeats:

```typescript
import { WakeupQueue } from '@botinabox/core';

const wakeups = new WakeupQueue(db);

// Queue a wakeup
await wakeups.enqueue(agentId, 'task-completed', { taskId: '...' });

// Coalesce: merge with existing pending wakeup (avoid duplicates)
await wakeups.coalesce(agentId, { reason: 'new-messages' });

// Get next pending wakeup
const next = await wakeups.getNext(agentId);

// Mark as fired
await wakeups.markFired(next.id, runId);
```

### Heartbeat Scheduler

Periodically wake agents to check for work:

```typescript
import { HeartbeatScheduler } from '@botinabox/core';

const heartbeats = new HeartbeatScheduler(wakeupQueue, hooks);

heartbeats.start([
  {
    id: agentId,
    heartbeat_config: JSON.stringify({
      enabled: true,
      intervalSec: 300,  // Every 5 minutes
    }),
  },
]);

// Stop all heartbeats
heartbeats.stop();
```

## Dependency Resolution

Utility functions for validating workflow step dependencies:

```typescript
import { detectCycle, topologicalSort } from '@botinabox/core';

const steps = [
  { id: 'a', dependsOn: [] },
  { id: 'b', dependsOn: ['a'] },
  { id: 'c', dependsOn: ['b'] },
];

// Check for cycles
const hasCycle = detectCycle(steps); // false

// Get execution order
const order = topologicalSort(steps); // ['a', 'b', 'c']
```

## Chain Guard

Prevents infinite followup chains:

```typescript
import { checkChainDepth, buildChainOrigin } from '@botinabox/core';

// Throws if depth > max (default 5)
checkChainDepth(currentDepth, maxDepth);

// Build chain metadata for child tasks
const chain = buildChainOrigin(parentTaskId, parentOriginId, parentDepth);
// → { chain_origin_id: 'root-task-id', chain_depth: 3 }
```
