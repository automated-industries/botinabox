# Orchestration

The orchestration layer manages agents, tasks, runs, workflows, budgets, schedules, sessions, users, and secrets. Every component takes a `DataStore` and `HookBus` as constructor dependencies and communicates through hook events.

## 1. AgentRegistry

Manages agent lifecycle: registration, lookup, status transitions, and permissions.

### Registration

```typescript
import { AgentRegistry } from 'botinabox';

const agents = new AgentRegistry(db, hooks);

// Register a new agent
const agentId = await agents.register({
  slug: 'researcher',
  name: 'Research Agent',
  adapter: 'api',
  role: 'research',
  model: 'smart',
});
// Emits: 'agent.created' { agentId, slug }
```

Required fields: `slug`, `name`, `adapter`. All other fields are optional.

### Lookup and Listing

```typescript
// By ID
const agent = await agents.getById(agentId);

// By slug
const agent = await agents.getBySlug('researcher');

// List all agents
const all = await agents.list();

// Filter by status and/or role
const idle = await agents.list({ status: 'idle' });
const devs = await agents.list({ role: 'engineering' });
```

### Status Transitions

Agents follow a state machine with validated transitions:

```
        ┌──────────┐
        │   idle    │◄────────────┐
        └────┬──┬──┘             │
             │  │                │
   ┌─────────┘  └────────┐      │
   │ (run starts)        │      │ (run completes / resume)
   ▼                     ▼      │
┌──────────┐       ┌──────────┐ │
│ running   │──────►│  paused   │─┘
└────┬─────┘       └────┬─────┘
     │                  │
     ▼                  ▼
┌──────────────────────────┐
│       terminated          │  (terminal -- no transitions out)
└──────────────────────────┘
```

Valid transitions:

| From | Allowed To |
|------|-----------|
| `idle` | `running`, `paused` |
| `running` | `idle`, `paused`, `terminated` |
| `paused` | `idle`, `terminated` |
| `terminated` | (none) |

```typescript
// Transition status (validates against the state machine)
await agents.setStatus(agentId, 'running');
await agents.setStatus(agentId, 'paused');
// Emits 'agent.paused' for paused/terminated transitions

// Terminate (shortcut -- works from any non-terminal state)
await agents.terminate(agentId);
// Sets status='terminated', deleted_at=now
```

Invalid transitions throw an error:

```typescript
await agents.setStatus(agentId, 'running');
await agents.setStatus(agentId, 'idle');    // OK
await agents.setStatus(agentId, 'terminated');
await agents.setStatus(agentId, 'running'); // Error: Invalid status transition
```

### Agent-Created Agents (Permissions)

Agents with `canCreateAgents: true` in their config can register new agents at runtime. The creating agent's ID is recorded in the activity log.

```typescript
// Parent agent must have canCreateAgents: true in adapter_config
const childId = await agents.register(
  {
    slug: 'sub-researcher',
    name: 'Sub-Research Agent',
    adapter: 'api',
    model: 'fast',
  },
  { actorAgentId: parentAgentId },
);
// Activity log records: agent_created_by_agent event
```

If the actor does not have permission, the call throws:

```typescript
// Throws: "Agent {id} does not have permission to create agents"
```

### Seeding from Config

On startup, seed agents from the YAML config. Existing agents (by slug) are skipped -- database values take precedence.

```typescript
await agents.seedFromConfig([
  { slug: 'researcher', name: 'Research Agent', adapter: 'api' },
  { slug: 'builder', name: 'Build Agent', adapter: 'cli' },
]);
```

### Update and Config Revisions

```typescript
// Update agent fields (creates a config revision for audit)
await agents.update(agentId, { model: 'balanced', role: 'senior-research' });
```

## 2. TaskQueue

Creates and manages tasks. Polls for eligible work and emits wakeup events.

### Creating Tasks

```typescript
import { TaskQueue } from 'botinabox';

const tasks = new TaskQueue(db, hooks, {
  pollIntervalMs: 30_000,       // How often to check for eligible tasks
  staleThresholdMs: 300_000,    // 5 minutes
});

// Create a task
const taskId = await tasks.create({
  title: 'Research market trends',
  description: 'Analyze Q1 data and summarize findings',
  assignee_id: agentId,
  priority: 30,                  // Lower = higher priority (default 5)
});
// Emits: 'task.created' { taskId, title }
```

### Task Statuses and Transitions

| Status | Meaning |
|--------|---------|
| `backlog` | Created but not ready for work |
| `todo` | Ready to be picked up by an agent |
| `in_progress` | Currently executing in a run |
| `in_review` | Awaiting review |
| `done` | Completed successfully |
| `blocked` | Waiting on a dependency |
| `cancelled` | Manually cancelled |
| `failed` | Retries exhausted |

The typical lifecycle:

```
backlog ──► todo ──► in_progress ──► done
                         │
                         ├──► failed (retries exhausted)
                         │
                         └──► todo (retry scheduled)
```

### Priority

Priority is numeric. Lower values run first. Default is 5.

```typescript
await tasks.create({ title: 'Critical', priority: 1 });   // Runs first
await tasks.create({ title: 'Normal', priority: 5 });     // Default
await tasks.create({ title: 'Low', priority: 90 });       // Runs last
```

### Update and Query

```typescript
// Update any fields
await tasks.update(taskId, { status: 'in_progress' });
await tasks.update(taskId, { priority: 1 });

// Get by ID
const task = await tasks.get(taskId);

// List with filters
const pending = await tasks.list({ status: 'todo' });
const myTasks = await tasks.list({ assignee_id: agentId });
const all = await tasks.list();
```

### Polling

When polling is active, the TaskQueue periodically scans for `todo` tasks with an `assignee_id` that have no active run, and emits `agent.wakeup` for each.

```typescript
// Start polling (checks every pollIntervalMs)
tasks.startPolling();

// Stop polling
tasks.stopPolling();
```

### Chain Depth

Tasks track chain depth to prevent infinite followup loops. The `MAX_CHAIN_DEPTH` (default 5) is enforced on creation.

```typescript
await tasks.create({
  title: 'Step in a chain',
  chain_depth: 3,
  chain_origin_id: 'root-task-uuid',
});
// Throws if chain_depth > MAX_CHAIN_DEPTH
```

## 3. RunManager

Manages execution runs: locking, starting, finishing, retry logic, followup chain creation, and orphan reaping.

### Starting and Finishing Runs

```typescript
import { RunManager } from 'botinabox';

const runs = new RunManager(db, hooks, {
  staleThresholdMs: 30 * 60 * 1000,  // 30 minutes
  maxBackoffMs: 5 * 60 * 1000,       // 5 minutes max retry backoff
});

// Check if agent is locked (one run at a time per agent)
const busy = runs.isLocked(agentId);  // boolean

// Start a run (acquires lock)
const runId = await runs.startRun(agentId, taskId, 'api');
// Throws if agent already has an active run

// Finish a run (releases lock, processes result)
await runs.finishRun(runId, {
  exitCode: 0,                  // 0 = success, non-zero = failure
  output: 'Analysis complete. Key findings: ...',
  costCents: 12,
  usage: { inputTokens: 5000, outputTokens: 2000 },
});
// Emits: 'run.completed' { runId, agentId, taskId, status, exitCode }
```

### Retry with Exponential Backoff

When a run fails (exitCode !== 0), RunManager checks the task's retry policy:

```
Backoff = min(BASE_BACKOFF_MS * 2^retryCount, maxBackoffMs)

Retry 0: 5 seconds
Retry 1: 10 seconds
Retry 2: 20 seconds
Retry 3: 40 seconds
...capped at maxBackoffMs (default 5 minutes)
```

```typescript
// Create a task with retry policy
await tasks.create({
  title: 'Flaky API call',
  assignee_id: agentId,
  max_retries: 3,
});

// When the run fails, RunManager automatically:
// 1. Increments retry_count
// 2. Computes next_retry_at with exponential backoff
// 3. Resets task status to 'todo'
// 4. Clears execution_run_id

// After max_retries exhausted:
// Task status set to 'failed'
```

### Followup Chains

When a run succeeds and the task has a `followup_agent_id`, RunManager automatically creates a followup task for the next agent.

```typescript
// Create a task with followup
await tasks.create({
  title: 'Write draft report',
  assignee_id: writerAgentId,
  followup_agent_id: reviewerAgentId,
  followup_template: 'Review this draft: {{output}}',
});

// When the writer's run succeeds:
// 1. Task marked 'done' with result
// 2. New task created for reviewer:
//    - title: "Review this draft: <writer's output>"
//    - chain_depth: parentDepth + 1
//    - chain_origin_id: original task ID (or parent's chain_origin_id)
// 3. Emits 'task.followup.created'
```

The `{{output}}` placeholder in `followup_template` is replaced with the completing run's output. If no template is set, the default is `'Followup: {{output}}'`.

Chain depth is incremented on each followup. If it exceeds `MAX_CHAIN_DEPTH` (5), the chain is halted with an error.

### Orphan Reaping

Runs that have been in `running` status for longer than `staleThresholdMs` are reaped as failed orphans.

```typescript
// Manually trigger orphan reaping
await runs.reapOrphans();

// Start automatic reaping on an interval
runs.startOrphanReaper(60_000);  // Check every minute

// Stop
runs.stopOrphanReaper();
```

### Run Statuses

| Status | Meaning |
|--------|---------|
| `queued` | Created, waiting to start |
| `running` | Currently executing |
| `succeeded` | Completed with exitCode 0 |
| `failed` | Completed with non-zero exitCode or reaped |
| `cancelled` | Manually cancelled |

## 4. WorkflowEngine

Defines and executes multi-step workflows as directed acyclic graphs (DAGs). Steps can run sequentially or in parallel based on dependency declarations.

### Defining a Workflow

```typescript
import { WorkflowEngine } from 'botinabox';

const workflows = new WorkflowEngine(db, hooks, tasks);

await workflows.define('deploy-pipeline', {
  name: 'Deploy Pipeline',
  description: 'Build, test, and deploy an application',
  steps: [
    {
      id: 'build',
      name: 'Build',
      agentSlug: 'builder',
      taskTemplate: {
        title: 'Build project',
        description: 'Run the build process for {{branch}}',
      },
    },
    {
      id: 'test',
      name: 'Test',
      agentSlug: 'tester',
      dependsOn: ['build'],
      taskTemplate: {
        title: 'Run tests',
        description: 'Execute test suite against build output',
      },
    },
    {
      id: 'security-scan',
      name: 'Security Scan',
      agentSlug: 'scanner',
      dependsOn: ['build'],
      taskTemplate: {
        title: 'Security scan',
        description: 'Scan for vulnerabilities',
      },
    },
    {
      id: 'deploy',
      name: 'Deploy',
      agentSlug: 'deployer',
      dependsOn: ['test', 'security-scan'],
      taskTemplate: {
        title: 'Deploy to production',
        description: 'Deploy using output from {{steps.build.output}}',
      },
      onFail: 'abort',
    },
  ],
});
```

### Dependency Resolution and Parallel Execution

Steps with no `dependsOn` (or empty array) run first. Steps run as soon as all their dependencies are satisfied, enabling parallel execution.

```
build ──► test ──────────► deploy
     └──► security-scan ──┘
```

In this DAG, `build` runs first. Then `test` and `security-scan` run in parallel. `deploy` runs only after both complete.

### Validation

The engine validates definitions before accepting them:

- **No duplicate step IDs** -- throws if two steps share the same `id`.
- **No undefined dependencies** -- throws if `dependsOn` references a step that does not exist.
- **No cycles** -- uses DFS cycle detection to reject circular dependencies.

```typescript
// This throws: "Workflow has cyclic step dependencies"
await workflows.define('bad', {
  name: 'Bad',
  steps: [
    { id: 'a', name: 'A', dependsOn: ['b'], taskTemplate: { title: 'A', description: '' } },
    { id: 'b', name: 'B', dependsOn: ['a'], taskTemplate: { title: 'B', description: '' } },
  ],
});
```

### Starting a Workflow

```typescript
const workflowRunId = await workflows.start('deploy-pipeline', {
  branch: 'main',
  commit: 'abc123',
});
// Creates workflow_run record with status='running'
// Dispatches initial steps (no dependencies) as tasks
```

The `context` object is available in task templates via `{{key}}` interpolation.

### Step Completion and Advancement

The engine listens for `task.completed` events. When a task with a `workflow_run_id` completes:

1. The step result is recorded in `step_results`.
2. The engine finds steps whose dependencies are now all satisfied.
3. Newly eligible steps are dispatched as tasks.
4. If all steps are complete, the workflow run is marked `completed`.

Previous step outputs are available in subsequent step templates as `{{steps.stepId.output}}`.

### Failure Handling

Each step has an `onFail` policy:

| Policy | Behavior |
|--------|----------|
| `abort` | Mark the entire workflow run as `failed` (default) |
| `skip` | Continue to the next eligible steps |
| `retry` | Use the step's retry policy via RunManager |

```typescript
{
  id: 'deploy',
  name: 'Deploy',
  onFail: 'abort',  // Abort entire workflow if deploy fails
  // ...
}
```

### Step Options Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | `string` | required | Unique step identifier |
| `name` | `string` | required | Display name |
| `agentSlug` | `string` | -- | Agent to execute this step |
| `taskTemplate` | `object` | required | `{ title, description }` with `{{var}}` interpolation |
| `dependsOn` | `string[]` | `[]` | Step IDs that must complete first |
| `onComplete` | `string` | `"next"` | `"next"`, `"parallel"`, or `"end"` |
| `onFail` | `string` | `"abort"` | `"abort"`, `"skip"`, or `"retry"` |
| `retryPolicy` | `object` | -- | `{ maxRetries, backoffMs, backoffMultiplier, maxBackoffMs }` |

### Workflow Triggers

Workflows can declare a trigger in their definition:

```typescript
await workflows.define('on-pr-merge', {
  name: 'Post-Merge Pipeline',
  trigger: {
    type: 'event',
    filter: { event: 'pull_request.merged' },
  },
  steps: [/* ... */],
});
```

Trigger types: `task_completed`, `event`, `schedule`, `manual`.

## 5. BudgetController

Enforces per-agent and global cost limits with warning thresholds and hard stops.

### Per-Agent Budget Check

```typescript
import { BudgetController } from 'botinabox';

const budgets = new BudgetController(db, hooks);

const check = await budgets.checkBudget(agentId);
// Returns:
// {
//   allowed: true,
//   currentSpendCents: 2300,
//   limitCents: 5000,
// }

// When spend exceeds warnPercent (default 80%):
// Emits 'budget.exceeded' with { agentId, currentSpendCents, limitCents, warnPercent }
// Still returns allowed: true

// When spend >= limitCents:
// Returns:
// {
//   allowed: false,
//   reason: 'Monthly budget exceeded',
//   currentSpendCents: 5200,
//   limitCents: 5000,
// }
```

### Budget Behavior Table

| Spend Level | `allowed` | Hook Emitted |
|-------------|-----------|--------------|
| Below warn threshold | `true` | none |
| At or above warn threshold | `true` | `budget.exceeded` |
| At or above limit | `false` | none (caller should block) |
| No limit set (0 or unset) | `true` | never |

### Global Budget Check

```typescript
const global = await budgets.globalCheck();
// {
//   allowed: true,
//   totalSpentCents: 15200,    // Sum across all agents
//   limitCents: 100000,        // From global budget_policies
// }
```

### Reset Monthly Spend

```typescript
// Call on month boundary (e.g., via Scheduler)
await budgets.resetMonthlySpend(agentId);
// Sets spent_monthly_cents = 0
```

### Listening for Budget Warnings

```typescript
hooks.register('budget.exceeded', async (ctx) => {
  console.warn(ctx.message);
  // "Budget warning: 4200 of 5000 cents used (80% threshold)"

  // Take action: alert admin, pause agent, etc.
  await agents.setStatus(ctx.agentId, 'paused');
});
```

## 6. WakeupQueue

Signals agents to wake up and check for work. Supports coalescing to avoid duplicate wakeups.

### Enqueue a Wakeup

```typescript
import { WakeupQueue } from 'botinabox';

const wakeups = new WakeupQueue(db);

// Queue a wakeup with source and optional context
const wakeupId = await wakeups.enqueue(agentId, 'task-completed', {
  taskId: 'abc-123',
  reason: 'New work available',
});
```

### Coalesce Wakeups

If an agent already has a pending (unfired) wakeup, coalesce merges the new context into the existing one instead of creating a duplicate.

```typescript
// If a pending wakeup exists, merge context into it
await wakeups.coalesce(agentId, { reason: 'additional-messages' });
// Existing wakeup context: { source: 'poll' }
// After coalesce: { source: 'poll', reason: 'additional-messages' }

// If no pending wakeup exists, this is a no-op
```

### Get Next and Mark Fired

```typescript
// Get the oldest pending wakeup for an agent
const next = await wakeups.getNext(agentId);
// Returns the wakeup row or undefined if none pending

if (next) {
  // Start a run, then mark the wakeup as fired
  const runId = await runs.startRun(agentId, taskId);
  await wakeups.markFired(next.id as string, runId);
  // Sets fired_at and run_id on the wakeup record
}
```

## 7. Scheduler

Database-backed job scheduling with cron expressions. Supports both recurring and one-time schedules with timezone support.

### Register a Recurring Schedule

```typescript
import { Scheduler } from 'botinabox';

const scheduler = new Scheduler(db, hooks);

// Register a recurring schedule with a cron expression
const scheduleId = await scheduler.register({
  name: 'daily-sync',
  description: 'Sync external data every morning',
  cron: '0 9 * * *',            // Every day at 9:00 AM
  timezone: 'America/New_York',  // Default: 'UTC'
  action: 'connector.sync',     // Hook event name to emit when fired
  actionConfig: {                // Payload passed to the hook
    connector: 'gmail',
    account: 'main',
  },
});
```

### Register a One-Time Schedule

```typescript
const scheduleId = await scheduler.register({
  name: 'deploy-friday',
  description: 'Deploy on Friday at 5pm',
  runAt: '2026-04-10T17:00:00Z',   // ISO 8601 datetime
  action: 'workflow.start',
  actionConfig: {
    workflowSlug: 'deploy-pipeline',
    branch: 'main',
  },
});
// One-time schedules are auto-disabled after firing
```

### Cron Syntax

Standard 5-field cron expressions:

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-7, 0 and 7 = Sunday)
│ │ │ │ │
* * * * *
```

Examples:
- `0 9 * * *` -- every day at 9:00 AM
- `*/15 * * * *` -- every 15 minutes
- `0 0 1 * *` -- first day of every month at midnight
- `0 9 * * 1-5` -- weekdays at 9:00 AM

### Starting and Stopping the Scheduler

```typescript
// Start polling for due schedules (default: every 30 seconds)
await scheduler.start(30_000);

// Stop
scheduler.stop();
```

When started, the scheduler:
1. Computes `next_fire_at` for schedules missing it.
2. Polls on interval for schedules where `next_fire_at <= now`.
3. Emits the schedule's `action` as a hook event with `actionConfig` as payload.
4. For recurring: computes the next fire time from the cron expression.
5. For one-time: disables the schedule after firing.

### Update and Unregister

```typescript
// Update schedule
await scheduler.update(scheduleId, {
  cron: '0 8 * * *',           // Change to 8 AM
  timezone: 'Europe/London',
  enabled: false,               // Disable without deleting
});

// Soft-delete
await scheduler.unregister(scheduleId);
```

### Listing Schedules

```typescript
// List all active schedules
const active = await scheduler.list({ enabled: true });

// Filter by action
const syncs = await scheduler.list({ action: 'connector.sync' });
```

### Schedule Hook Events

| Event | Payload | When |
|-------|---------|------|
| `{action}` | `{ schedule_id, schedule_name, ...actionConfig }` | Schedule fires |
| `schedule.fired` | `{ schedule_id, schedule_name, action, fired_at }` | After any schedule fires |
| `schedule.error` | `{ schedule_id, schedule_name, error }` | Schedule handler throws |

## 8. SessionManager

Manages per-agent/channel/peer session state for maintaining conversation context.

### Save Session

```typescript
import { SessionManager } from 'botinabox';

const sessions = new SessionManager(db);

// Save or update session (creates if not exists, increments message_count)
const sessionId = await sessions.save(
  agentId,
  'slack',           // channel
  'U12345',          // peer ID (e.g., Slack user ID)
  {                  // context params (serialized as JSON)
    history: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ],
    topic: 'onboarding',
  },
);
```

### Load Session

```typescript
const session = await sessions.load(agentId, 'slack', 'U12345');
// Returns the session row merged with parsed context, or undefined if not found
// {
//   id: 'session-uuid',
//   agent_id: 'agent-uuid',
//   channel: 'slack',
//   peer_id: 'U12345',
//   message_count: 5,
//   last_message_at: '2026-04-03T12:00:00.000Z',
//   history: [...],
//   topic: 'onboarding',
// }
```

### Clear Session

```typescript
await sessions.clear(agentId, 'slack', 'U12345');
// Deletes the session record
```

### Session Expiry

Check if a session should be cleared based on age or message count:

```typescript
const session = await sessions.load(agentId, 'slack', 'U12345');
if (session) {
  const shouldClear = await sessions.shouldClear(session, {
    maxRuns: 50,        // Clear after 50 messages
    maxAgeHours: 24,    // Clear after 24 hours
  });
  if (shouldClear) {
    await sessions.clear(agentId, 'slack', 'U12345');
  }
}
```

## 9. UserRegistry

Cross-channel user identity management. Users can have multiple identities across different channels (Slack, Discord, etc.) that all resolve to the same user record.

### Register a User

```typescript
import { UserRegistry } from 'botinabox';

const users = new UserRegistry(db, hooks);

const user = await users.register({
  name: 'Jane Smith',
  email: 'jane@example.com',
  role: 'admin',
  timezone: 'America/New_York',
});
// Emits: 'user.created' { user }
// Returns: User { id, name, email, role, timezone, ... }
```

### Lookup

```typescript
// By ID
const user = await users.getById(userId);

// By email
const user = await users.getByEmail('jane@example.com');

// List with filters
const admins = await users.list({ role: 'admin' });
const orgUsers = await users.list({ org_id: 'org-uuid' });
```

### Resolve or Create (Cross-Channel Identity)

The most common pattern: given a channel-specific external ID, find the existing user or create a new one.

```typescript
// First call: creates user + identity
const user = await users.resolveOrCreate('U12345', 'slack', {
  name: 'Jane Smith',
  email: 'jane@example.com',
});

// Second call with same externalId + channel: returns existing user
const sameUser = await users.resolveOrCreate('U12345', 'slack');
// sameUser.id === user.id
```

### Add Identity (Link Accounts)

Link additional channel identities to an existing user:

```typescript
// User has a Slack identity, now add Discord
await users.addIdentity(user.id, 'discord', '987654321', 'Jane#1234');

// Now resolving by Discord ID returns the same user
const resolved = await users.resolveByIdentity('discord', '987654321');
// resolved.id === user.id
```

### Update

```typescript
await users.update(user.id, {
  role: 'superadmin',
  timezone: 'Europe/London',
});
```

### User Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID |
| `org_id` | `string?` | Organization ID |
| `name` | `string` | Display name |
| `email` | `string?` | Email address (unique per non-deleted user) |
| `role` | `string?` | Role label |
| `title` | `string?` | Job title |
| `external_id` | `string?` | Primary external identifier |
| `channel` | `string?` | Primary channel |
| `timezone` | `string?` | IANA timezone |
| `preferences` | `string` | JSON preferences object |
| `notes` | `string?` | Freeform notes |

## 10. SecretStore

Manages secrets with environment scoping, rotation, and audit trail.

### Set a Secret

```typescript
import { SecretStore } from 'botinabox';

const secrets = new SecretStore(db, hooks);

const meta = await secrets.set({
  name: 'GITHUB_TOKEN',
  type: 'api_key',
  environment: 'production',
  value: 'ghp_xxxxxxxxxxxx',
  description: 'GitHub personal access token',
  rotation_schedule: '90d',
  expires_at: '2026-07-01T00:00:00Z',
});
// Emits: 'secret.created' { name: 'GITHUB_TOKEN' }
// Returns: SecretMeta (without value field)
```

### Get a Secret

```typescript
// Get the value (emits 'secret.accessed' for audit)
const value = await secrets.get('GITHUB_TOKEN', 'production');
// Returns the value string, or null if not found

// Get metadata only (no value, no audit event)
const meta = await secrets.getMeta('GITHUB_TOKEN', 'production');
// Returns: SecretMeta { id, name, type, environment, description, ... }
```

### Rotate a Secret

```typescript
await secrets.rotate('GITHUB_TOKEN', 'ghp_new_value', 'production');
// Updates the value and emits 'secret.rotated'
```

### Delete a Secret

```typescript
await secrets.delete('GITHUB_TOKEN', 'production');
// Soft-deletes (sets deleted_at) and emits 'secret.deleted'
```

### List All Secrets

```typescript
const all = await secrets.list();
// Returns SecretMeta[] (values are never included in list results)
```

### Environment Scoping

Secrets are scoped by environment. You can have the same secret name in different environments:

```typescript
await secrets.set({ name: 'API_KEY', environment: 'production', value: 'prod-key' });
await secrets.set({ name: 'API_KEY', environment: 'staging', value: 'staging-key' });

await secrets.get('API_KEY', 'production');  // 'prod-key'
await secrets.get('API_KEY', 'staging');     // 'staging-key'
```

### Audit Trail

Every `get`, `rotate`, and `delete` operation emits a hook event for audit:

| Event | Payload |
|-------|---------|
| `secret.created` | `{ name }` |
| `secret.accessed` | `{ name, environment }` |
| `secret.rotated` | `{ name, environment }` |
| `secret.deleted` | `{ name, environment }` |

## 11. Chain Guards

Prevent infinite followup chains between agents.

### MAX_CHAIN_DEPTH

The default maximum chain depth is 5. This means a task can trigger at most 5 levels of followup tasks before the chain is halted.

```typescript
import { MAX_CHAIN_DEPTH, checkChainDepth, buildChainOrigin } from 'botinabox';

// MAX_CHAIN_DEPTH = 5

// Check depth (throws if exceeded)
checkChainDepth(3, MAX_CHAIN_DEPTH);  // OK
checkChainDepth(6, MAX_CHAIN_DEPTH);  // Error: Chain depth limit exceeded (max 5)

// Custom max
checkChainDepth(3, 10);  // OK with higher limit
```

### buildChainOrigin

Build chain metadata for child tasks. Tracks the original root task and increments depth.

```typescript
// No parent (root task)
const root = buildChainOrigin();
// { chain_depth: 0 }

// Child of a root task
const child = buildChainOrigin('task-123');
// { chain_origin_id: 'task-123', chain_depth: 1 }

// Grandchild (preserves original chain origin)
const grandchild = buildChainOrigin('task-456', 'task-123', 1);
// { chain_origin_id: 'task-123', chain_depth: 2 }
```

## 12. LoopDetector

Scans agent routing history for patterns that indicate stuck loops. Complements the chain depth guard with active pattern detection.

### Loop Types

| Type | Pattern | Example |
|------|---------|---------|
| `SELF_LOOP` | Agent routes to itself | Triage → Triage |
| `PING_PONG` | Two agents bounce tasks | A → B → A → B |
| `BLOCKED_REENTRY` | Task re-enters after being blocked | Agent B blocked, new task routes to B again |

### Usage

```typescript
import { LoopDetector, LoopType } from 'botinabox';

const detector = new LoopDetector(db, {
  windowSize: 10,        // Recent tasks to scan
  pingPongThreshold: 2,  // Repetitions to confirm ping-pong
});

// Check before creating a followup task
const loop = await detector.check(sourceAgentId, targetAgentId, taskId, chainOriginId);
if (loop) {
  console.warn(loop.message);
  // "Ping-pong detected: agents A and B are bouncing tasks in chain origin-1"
}
```

## 13. CircuitBreaker

Prevents runaway agent failures with automatic human escalation.

### States

```
CLOSED ──(failures >= threshold)──► OPEN ──(timeout elapsed)──► HALF_OPEN
  ▲                                                                 │
  └──────────────────(success)──────────────────────────────────────┘
```

### Usage

```typescript
import { CircuitBreaker, BreakerState } from 'botinabox';

const breaker = new CircuitBreaker(db, hooks, {
  failureThreshold: 3,       // Failures before tripping
  resetTimeoutMs: 300_000,   // 5 min before half-open probe
});

// Attach to RunManager for automatic tracking
runs.setCircuitBreaker(breaker);

// Or use manually
if (breaker.canExecute(agentId)) {
  // ... execute ...
  await breaker.recordSuccess(agentId);
} else {
  // Circuit is OPEN — agent is broken, escalated to human
}

// Manual reset (after human review)
await breaker.reset(agentId);
```

### Hook Events

| Event | Payload | When |
|-------|---------|------|
| `circuit_breaker.tripped` | `{ agentId, reason, failureCount, action }` | Breaker opens |
| `circuit_breaker.recovered` | `{ agentId, previousState }` | Success in half-open |
| `circuit_breaker.reset` | `{ agentId }` | Manual reset |

## 14. LearningPipeline

Turns execution experience into durable knowledge via a promotion ladder: feedback → playbook → skill.

### Feedback Capture

```typescript
import { LearningPipeline } from 'botinabox';

const learning = new LearningPipeline(db, hooks, {
  playbookThreshold: 3,  // Similar feedbacks to auto-promote
  skillThreshold: 3,     // Agents using playbook to promote to skill
  autoPromote: true,     // Auto-promote when thresholds met
});

await learning.captureFeedback({
  agentId,
  issue: 'Rate limit hit on external API',
  rootCause: 'Missing retry backoff',
  severity: 'medium',
  repeatable: true,
  accuracyScore: 0.8,
  efficiencyScore: 0.3,
});
```

### Promotion Flow

```
Feedback (3+ similar) → Playbook (generalized rule)
Playbook (3+ agents) → Skill (reusable behavior)
Skill → agent_skills junction → rendered in SKILLS.md
```

### Metrics

```typescript
const metrics = await learning.getMetrics(agentId);
// { feedbackCount, avgAccuracy, avgEfficiency, playbookCount, skillCount }
```

## 15. GovernanceGates

Independent validation gates that check agent output from different dimensions. Gates report to the human operator, not to each other.

### Built-in Gates

| Gate | Dimension | Use Case |
|------|-----------|----------|
| `QAGate` | Data correctness | Schema validation, row counts |
| `QualityGate` | Code quality | Lint, test coverage |
| `DriftGate` | Architecture | Unintended dependencies, scope creep |

### Usage

```typescript
import { QAGate, QualityGate, GateRunner } from 'botinabox';

const runner = new GateRunner([
  new QAGate([{
    name: 'non-empty',
    validate: (output) => output.trim() ? [] : [{ severity: 'error', message: 'Empty output' }],
  }]),
  new QualityGate([{
    name: 'no-todos',
    check: async (output) => /TODO/i.test(output)
      ? [{ severity: 'warning', message: 'Contains TODO' }]
      : [],
  }]),
], hooks);

const { passed, results } = await runner.runAll({
  agentId, taskId, output: agentOutput,
});
// passed: true if no gate returned 'fail'
```

## 16. PermissionRelay

Remote approval for unattended agent execution via messaging platforms.

### Provider Interface

```typescript
import { PermissionRelay, PermissionProvider } from 'botinabox';

// Implement a provider for your platform
class SlackPermissionProvider implements PermissionProvider {
  readonly id = 'slack';
  async sendPrompt(prompt) { /* post to Slack */ }
  async pollResponse(handle) { /* check for reaction */ }
  async cancelPrompt(handle) { /* delete message */ }
}

const relay = new PermissionRelay(hooks, {
  providers: [new SlackPermissionProvider()],
  pollIntervalMs: 5_000,
  timeoutMs: 300_000,
});
```

### Dual Approval

```typescript
// Request approval from all providers — first response wins
const response = await relay.requestApproval({
  id: 'perm-1',
  agentId,
  action: 'Run bash command: rm -rf /tmp/cache',
  requestedAt: new Date().toISOString(),
});
// response.status: 'approved' | 'denied'
// response.respondedBy: 'local' | 'slack:U12345'

// Or approve locally (cancels remote providers)
await relay.approveLocally('perm-1', true);
```

## Task Lifecycle: End-to-End

Here is the complete lifecycle of a task from creation to completion:

```
1. TaskQueue.create()
   ├── Status: 'todo'
   ├── Validates chain depth
   ├── Inserts into tasks table
   └── Emits 'task.created'

2. TaskQueue.poll() (or manual wakeup)
   ├── Finds 'todo' tasks with assignee_id and no active run
   └── Emits 'agent.wakeup' for each

3. RunManager.startRun()
   ├── Acquires agent lock (one run per agent)
   ├── Inserts run record with status='running'
   └── Returns runId

4. Execution (ApiExecutionAdapter or CliExecutionAdapter)
   ├── API: sends prompt to LLM, runs tool loop
   └── CLI: spawns subprocess, captures output

5. RunManager.finishRun()
   ├── Updates run record (status, cost, tokens)
   ├── Releases agent lock
   │
   ├── On SUCCESS (exitCode 0):
   │   ├── Task status → 'done'
   │   ├── Task result = run output
   │   ├── If followup_agent_id set:
   │   │   ├── chain_depth + 1 (checked against MAX_CHAIN_DEPTH)
   │   │   ├── Create followup task for next agent
   │   │   └── Emit 'task.followup.created'
   │   └── Emit 'run.completed' { status: 'succeeded' }
   │
   └── On FAILURE (exitCode != 0):
       ├── If retry_count < max_retries:
       │   ├── Compute backoff: 5s * 2^retryCount (capped at maxBackoffMs)
       │   ├── Task status → 'todo', retry_count++, next_retry_at set
       │   └── Task will be picked up again on next poll after backoff
       ├── If retries exhausted:
       │   └── Task status → 'failed'
       └── Emit 'run.completed' { status: 'failed' }
```

## Dependency Resolution Utilities

Standalone functions for working with step/task dependency graphs:

```typescript
import { detectCycle, topologicalSort, areDependenciesMet } from 'botinabox';

const steps = [
  { id: 'a', dependsOn: [] },
  { id: 'b', dependsOn: ['a'] },
  { id: 'c', dependsOn: ['a', 'b'] },
];

// Check for cycles (DFS-based)
detectCycle(steps);  // false

// Get execution order (topological sort)
topologicalSort(steps);  // ['a', 'b', 'c']

// Check if all dependencies are satisfied
const completed = new Set(['a', 'b']);
areDependenciesMet('["a","b"]', completed);  // true
areDependenciesMet('["a","c"]', completed);  // false
```
