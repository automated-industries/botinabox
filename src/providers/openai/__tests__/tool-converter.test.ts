import { describe, it, expect } from 'vitest';
import { convertTools } from '../tool-converter.js';
import type { ToolDefinition } from "../../../shared/index.js";

describe('convertTools (OpenAI)', () => {
  it('converts ToolDefinition to correct OpenAI format', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'get_weather',
        description: 'Get the current weather in a city',
        parameters: {
          type: 'object',
          properties: {
            city: { type: 'string', description: 'City name' },
          },
          required: ['city'],
        },
      },
    ];

    const result = convertTools(tools);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get the current weather in a city',
        parameters: {
          type: 'object',
          properties: {
            city: { type: 'string', description: 'City name' },
          },
          required: ['city'],
        },
      },
    });
  });

  it('preserves properties and required fields', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'search',
        description: 'Search for information',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['query'],
        },
      },
    ];

    const result = convertTools(tools);
    const params = result[0]?.function.parameters;

    expect(params?.['required']).toEqual(['query']);
    expect((params?.['properties'] as Record<string, unknown>)?.['query']).toEqual({ type: 'string' });
  });

  it('sets type to "function" for all tools', () => {
    const tools: ToolDefinition[] = [
      { name: 'tool1', description: 'First', parameters: {} },
      { name: 'tool2', description: 'Second', parameters: {} },
    ];

    const result = convertTools(tools);
    expect(result.every((t) => t.type === 'function')).toBe(true);
  });

  it('returns empty array for no tools', () => {
    expect(convertTools([])).toEqual([]);
  });
});
