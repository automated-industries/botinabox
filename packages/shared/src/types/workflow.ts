/** Workflow types — Story 1.5 / 5.1 */

export type WorkflowRunStatus = "running" | "completed" | "failed" | "cancelled";

export interface WorkflowStep {
  id: string;
  name: string;
  agentSlug?: string;
  agentResolver?: string;
  taskTemplate: {
    title: string;
    description: string;
  };
  dependsOn?: string[];
  onComplete?: "next" | "parallel" | "end";
  onFail?: "abort" | "skip" | "retry";
  retryPolicy?: import("./task.js").RetryPolicy;
  condition?: string;
}

export interface WorkflowDefinition {
  slug: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  trigger?: WorkflowTrigger;
}

export interface WorkflowTrigger {
  type: "task_completed" | "event" | "schedule" | "manual";
  filter?: Record<string, unknown>;
}

export interface WorkflowRunRecord {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  currentStep: number;
  context: Record<string, unknown>;
  originTaskId?: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}
