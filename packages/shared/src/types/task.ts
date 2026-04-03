/** Task types — Story 1.5 / 3.2 */

export type TaskStatus =
  | "backlog" | "todo" | "in_progress" | "in_review"
  | "done" | "blocked" | "cancelled";

export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
}

export interface TaskDefinition {
  title: string;
  description?: string;
  assigneeId?: string;
  priority?: number;       // Lower = higher priority (default 50)
  parentId?: string;
  dependsOn?: string[];
  followupAgentId?: string;
  followupTemplate?: string;
  chainOriginId?: string;
  chainDepth?: number;
  retryPolicy?: RetryPolicy;
  metadata?: Record<string, unknown>;
}

export interface TaskRecord extends Required<Pick<TaskDefinition, "title" | "priority">> {
  id: string;
  description: string;
  assigneeId?: string;
  status: TaskStatus;
  priority: number;
  parentId?: string;
  dependsOn: string[];
  followupAgentId?: string;
  followupTemplate?: string;
  chainOriginId?: string;
  chainDepth: number;
  retryPolicy?: RetryPolicy;
  retryCount: number;
  maxRetries: number;
  nextRetryAt?: string;
  executionRunId?: string;
  result?: string;
  completedOutput?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  deletedAt?: string;
}
