/**
 * botinabox — framework for building multi-agent bots.
 * Re-exports everything from shared types and core modules.
 */

// Shared types and constants
export * from "./shared/index.js";

// Core modules
export * from "./core/hooks/index.js";
export * from "./core/config/index.js";
export * from "./core/llm/index.js";
export * from "./core/chat/index.js";
export * from "./core/data/index.js";
export * from "./core/security/index.js";
export * from "./core/update/index.js";

// Orchestrator (no barrel — export each module directly)
export * from "./core/orchestrator/agent-registry.js";
export * from "./core/orchestrator/task-queue.js";
export * from "./core/orchestrator/run-manager.js";
export * from "./core/orchestrator/budget-controller.js";
export { WorkflowEngine } from "./core/orchestrator/workflow-engine.js";
export * from "./core/orchestrator/wakeup-queue.js";
export * from "./core/orchestrator/session-manager.js";
export * from "./core/orchestrator/chain-guard.js";
export * from "./core/orchestrator/ndjson-logger.js";
export * from "./core/orchestrator/heartbeat-scheduler.js";
export * from "./core/orchestrator/config-revisions.js";
export * from "./core/orchestrator/dependency-resolver.js";
export * from "./core/orchestrator/template-interpolate.js";
export * from "./core/orchestrator/adapters/api-adapter.js";
export * from "./core/orchestrator/adapters/cli-adapter.js";
