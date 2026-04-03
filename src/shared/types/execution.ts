/** Execution adapter types — Story 1.5 / 3.4 / 3.5 */

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface RunContext {
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

export interface RunResult {
  status: "succeeded" | "failed";
  output?: string;
  error?: string;
  usage?: import("./provider.js").TokenUsage;
  costCents?: number;
  sessionParams?: unknown;        // Opaque — stored in sessions table
  clearSession?: boolean;         // True if session should be invalidated
  durationMs: number;
}

export interface ExecutionAdapter {
  id: string;
  execute(ctx: RunContext): Promise<RunResult>;
}
