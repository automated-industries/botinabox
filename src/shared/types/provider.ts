/** LLM provider types — Story 1.5 / 2.1 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string | ContentBlock[];
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

export interface ChatParams {
  messages: ChatMessage[];
  system?: string;
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  model: string;
  abortSignal?: AbortSignal;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface ChatResult {
  content: string;
  toolUses?: ToolUse[];
  usage: TokenUsage;
  model: string;
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
}

export interface ToolUse {
  id: string;
  name: string;
  input: unknown;
}

export interface ModelInfo {
  id: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: Array<"chat" | "tools" | "vision" | "streaming">;
  /** Cost in micro-cents per 1M tokens */
  inputCostPerMToken?: number;
  outputCostPerMToken?: number;
}

export interface ResolvedModel {
  provider: string;
  model: string;
}

export interface LLMProvider {
  id: string;
  displayName: string;
  models: ModelInfo[];

  chat(params: ChatParams): Promise<ChatResult>;
  chatStream(params: ChatParams): AsyncGenerator<string, ChatResult, unknown>;

  /** Convert ToolDefinition[] to provider-native format */
  serializeTools(tools: ToolDefinition[]): unknown;
}
