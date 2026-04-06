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
export * from "./core/orchestrator/scheduler.js";
export * from "./core/orchestrator/config-revisions.js";
export * from "./core/orchestrator/dependency-resolver.js";
export * from "./core/orchestrator/template-interpolate.js";
export * from "./core/orchestrator/adapters/api-adapter.js";
export * from "./core/orchestrator/adapters/cli-adapter.js";
export * from "./core/orchestrator/adapters/deterministic-adapter.js";
export * from "./core/orchestrator/loop-detector.js";
export * from "./core/orchestrator/circuit-breaker.js";
export * from "./core/orchestrator/learning-pipeline.js";
export * from "./core/orchestrator/permission-relay.js";
export * from "./core/orchestrator/governance-gate.js";
export { registerExecutionEngine } from "./core/orchestrator/execution-engine.js";
export type { ExecutionEngineConfig, ToolDefinition, ToolHandler } from "./core/orchestrator/execution-engine.js";
export { sendFileTool, readFileTool } from "./core/orchestrator/tools/index.js";
export * from "./core/orchestrator/user-registry.js";
export * from "./core/orchestrator/secret-store.js";
export * from "./core/orchestrator/claude-stream-parser.js";
