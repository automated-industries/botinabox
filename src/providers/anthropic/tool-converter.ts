import type { ToolDefinition } from "../../shared/index.js";

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: { type: 'object'; [key: string]: unknown };
}

export function convertTools(tools: ToolDefinition[]): AnthropicTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: { type: 'object' as const, ...tool.parameters },
  }));
}
