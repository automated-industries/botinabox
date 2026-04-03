/** Agent types — Story 1.5 / 3.1 */

export type AgentStatus = "idle" | "running" | "paused" | "terminated" | "error";

export interface AgentDefinition {
  slug: string;
  name: string;
  role?: string;
  adapter: string;          // Execution adapter ID
  model?: string;           // Model ID or alias
  workdir?: string;
  instructionsFile?: string;
  maxConcurrentRuns?: number;
  budgetMonthlyCents?: number;
  canCreateAgents?: boolean;
  skipPermissions?: boolean;
  config?: Record<string, unknown>;
}

export interface AgentRecord extends AgentDefinition {
  id: string;
  status: AgentStatus;
  spentMonthlyCents: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface AgentFilter {
  status?: AgentStatus | AgentStatus[];
  role?: string;
  adapter?: string;
}

export interface BudgetCheck {
  allowed: boolean;
  status: "ok" | "warning" | "hard_stop";
  spentCents: number;
  limitCents?: number;
  message?: string;
}
