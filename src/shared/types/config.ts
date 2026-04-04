/** Bot configuration types — Story 1.2 / 1.5 */

export interface DataConfig {
  path: string;
  walMode: boolean;
  backupDir?: string;
}

export interface ModelConfig {
  aliases: Record<string, string>;
  default: string;
  routing: Record<string, string>;
  fallbackChain: string[];
  costLimit?: { perRunCents?: number };
}

export interface SecurityConfig {
  fieldLengthLimits?: Record<string, number>;
  allowedFilePrefixes?: string[];
}

export interface RenderConfig {
  outputDir: string;
  watchIntervalMs: number;
}

export interface UpdateConfig {
  policy: "auto-all" | "auto-compatible" | "auto-patch" | "notify" | "manual";
  checkIntervalMs: number;
  maintenanceWindow?: {
    utcHourStart: number;
    utcHourEnd: number;
    days?: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun">;
  };
}

export interface BudgetConfig {
  globalMonthlyCents?: number;
  warnPercent: number;
}

export interface EntityColumnDef {
  type: "uuid" | "text" | "integer" | "boolean" | "datetime" | "real";
  required?: boolean;
  default?: string | number | boolean;
  references?: string;
}

export interface EntityConfig {
  columns: Record<string, EntityColumnDef>;
  relations?: Array<{
    type: "hasMany" | "manyToMany" | "belongsTo";
    table: string;
    through?: string;
    localKey?: string;
    remoteKey?: string;
  }>;
}

export interface AgentConfig {
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

export interface BotConfig {
  data: DataConfig;
  channels: Record<string, { enabled: boolean; accounts?: Record<string, unknown> } & Record<string, unknown>>;
  connectors?: Record<string, {
    enabled: boolean;
    provider: string;
    accounts?: Record<string, import("./connector.js").ConnectorConfig>;
  } & Record<string, unknown>>;
  agents: AgentConfig[];
  providers: Record<string, { enabled: boolean } & Record<string, unknown>>;
  models: ModelConfig;
  entities: Record<string, EntityConfig>;
  security: SecurityConfig;
  render: RenderConfig;
  updates: UpdateConfig;
  budget: BudgetConfig;
  workflows?: Record<string, WorkflowConfigEntry>;
}

export interface WorkflowConfigEntry {
  name: string;
  description?: string;
  steps: WorkflowStepConfig[];
  trigger?: {
    type: "task_completed" | "event" | "schedule" | "manual";
    filter?: Record<string, unknown>;
  };
}

export interface WorkflowStepConfig {
  id: string;
  name: string;
  agentSlug?: string;
  taskTemplate: { title: string; description: string };
  dependsOn?: string[];
  onComplete?: "next" | "parallel" | "end";
  onFail?: "abort" | "skip" | "retry";
  retryPolicy?: import("./task.js").RetryPolicy;
}
