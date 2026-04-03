/** Shared constants — event names, default values, status enums */

/** Hook/event name constants */
export const EVENTS = {
  // Cost
  COST_RECORDED: "cost.recorded",

  // Agent
  AGENT_CREATED: "agent.created",
  AGENT_STATUS_CHANGED: "agent.status_changed",
  BUDGET_EXCEEDED: "budget.exceeded",

  // Task
  TASK_CREATED: "task.created",
  TASK_COMPLETED: "task.completed",
  TASK_FAILED: "task.failed",
  TASK_CANCELLED: "task.cancelled",

  // Run
  RUN_STARTED: "run.started",
  RUN_COMPLETED: "run.completed",
  RUN_FAILED: "run.failed",

  // Message pipeline
  MESSAGE_INBOUND: "message.inbound",
  MESSAGE_ROUTED: "message.routed",
  MESSAGE_PROCESSED: "message.processed",
  MESSAGE_OUTBOUND: "message.outbound",
  MESSAGE_SENT: "message.sent",

  // Updates
  UPDATE_AVAILABLE: "update.available",
  UPDATE_STARTED: "update.started",
  UPDATE_COMPLETED: "update.completed",
  UPDATE_FAILED: "update.failed",

  // Workflow
  WORKFLOW_STARTED: "workflow.started",
  WORKFLOW_STEP_COMPLETED: "workflow.step_completed",
  WORKFLOW_COMPLETED: "workflow.completed",
  WORKFLOW_FAILED: "workflow.failed",
} as const;

/** Default config values */
export const DEFAULTS = {
  TASK_POLL_INTERVAL_MS: 30_000,
  NOTIFICATION_POLL_INTERVAL_MS: 5_000,
  HEARTBEAT_INTERVAL_MS: 300_000,   // 5 minutes
  ORPHAN_REAP_INTERVAL_MS: 300_000, // 5 minutes
  STALE_RUN_THRESHOLD_MS: 1_800_000, // 30 minutes
  STALE_TASK_AGE_MS: 7_200_000,     // 2 hours
  MAX_CHAIN_DEPTH: 5,
  MAX_NOTIFICATION_RETRIES: 3,
  UPDATE_CHECK_INTERVAL_MS: 86_400_000, // 24 hours
  RENDER_WATCH_INTERVAL_MS: 30_000,
  DATA_PATH: "./data/bot.db",
  RENDER_OUTPUT_DIR: "./context",
  LOG_PATH_TEMPLATE: "./data/runs/{runId}.ndjson",
  BUDGET_WARN_PERCENT: 80,
} as const;

/** Task status values */
export const TASK_STATUSES = [
  "backlog", "todo", "in_progress", "in_review",
  "done", "blocked", "cancelled",
] as const;

/** Agent status values */
export const AGENT_STATUSES = [
  "idle", "running", "paused", "terminated", "error",
] as const;

/** Run status values */
export const RUN_STATUSES = [
  "queued", "running", "succeeded", "failed", "cancelled",
] as const;
