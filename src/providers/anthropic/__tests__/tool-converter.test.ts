import { describe, it, expect } from 'vitest';
import { convertTools } from '../tool-converter.js';
import type { ToolDefinition } from "../../../shared/index.js";

describe('convertTools (Anthropic)', () => {
  it('converts ToolDefinition to correct Anthropic format', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'get_weather',
        description: 'Get the current weather in a city',
        parameters: {
          type: 'object',
          properties: {
            city: { type: 'string', description: 'City name' },
            units: { type: 'string', enum: ['celsius', 'fahrenheit'] },
          },
          required: ['city'],
        },
      },
    ];

    const result = convertTools(tools);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'get_weather',
      description: 'Get the current weather in a city',
      input_schema: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
          units: { type: 'string', enum: ['celsius', 'fahrenheit'] },
        },
        required: ['city'],
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
    const schema = result[0]?.input_schema as Record<string, unknown>;

    expect(schema['required']).toEqual(['query']);
    expect((schema['properties'] as Record<string, unknown>)['query']).toEqual({ type: 'string' });
    expect((schema['properties'] as Record<string, unknown>)['limit']).toEqual({ type: 'number' });
  });

  it('converts multiple tools', () => {
    const tools: ToolDefinition[] = [
      { name: 'tool1', description: 'First tool', parameters: { type: 'object', properties: {} } },
      { name: 'tool2', description: 'Second tool', parameters: { type: 'object', properties: {} } },
    ];

    const result = convertTools(tools);
    expect(result).toHaveLength(2);
    expect(result[0]?.name).toBe('tool1');
    expect(result[1]?.name).toBe('tool2');
  });

  it('returns empty array for no tools', () => {
    expect(convertTools([])).toEqual([]);
  });
});
