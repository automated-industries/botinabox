import { describe, it, expect, vi } from 'vitest';
import { mergeTools } from '../tools/index.js';
import type { ToolDefinition, ToolHandler } from '../execution-engine.js';

function makeTool(name: string, tag = 'default') {
  return {
    definition: {
      name,
      description: `${name} (${tag})`,
      input_schema: { type: 'object' as const },
    } as ToolDefinition,
    handler: (async () => `${name}:${tag}`) as unknown as ToolHandler,
  };
}

describe('mergeTools', () => {
  it('concatenates disjoint tool sets', () => {
    const a = makeTool('alpha');
    const b = makeTool('beta');
    const c = makeTool('gamma');
    const d = makeTool('delta');

    const result = mergeTools([a, b], [c, d]);
    expect(result).toHaveLength(4);
    expect(result.map((t) => t.definition.name)).toEqual([
      'alpha', 'beta', 'gamma', 'delta',
    ]);
  });

  it('last-wins on duplicate names', () => {
    const v1 = makeTool('read_file', 'builtin');
    const v2 = makeTool('read_file', 'custom');

    const result = mergeTools([v1], [v2]);
    expect(result).toHaveLength(1);
    expect(result[0]!.definition.description).toBe('read_file (custom)');
  });

  it('override preserves original position', () => {
    const a = makeTool('alpha');
    const b = makeTool('beta');
    const c = makeTool('gamma');
    const bOverride = makeTool('beta', 'v2');

    const result = mergeTools([a, b, c], [bOverride]);
    expect(result.map((t) => t.definition.name)).toEqual([
      'alpha', 'beta', 'gamma',
    ]);
    expect(result[1]!.definition.description).toBe('beta (v2)');
  });

  it('three tool sets each with same name — final one wins', () => {
    const v1 = makeTool('read_file', 'set1');
    const v2 = makeTool('read_file', 'set2');
    const v3 = makeTool('read_file', 'set3');

    const result = mergeTools([v1], [v2], [v3]);
    expect(result).toHaveLength(1);
    expect(result[0]!.definition.description).toBe('read_file (set3)');
  });

  it('handles empty tool sets', () => {
    const a = makeTool('alpha');
    const b = makeTool('beta');

    const result = mergeTools([], [a, b], []);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.definition.name)).toEqual(['alpha', 'beta']);
  });

  it('single tool set returns a copy', () => {
    const tools = [makeTool('alpha'), makeTool('beta')];
    const result = mergeTools(tools);
    expect(result).toHaveLength(2);
    expect(result).not.toBe(tools); // new array, not same reference
    expect(result.map((t) => t.definition.name)).toEqual(['alpha', 'beta']);
  });

  it('logs a warning on override', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const v1 = makeTool('read_file', 'builtin');
    const v2 = makeTool('read_file', 'custom');
    mergeTools([v1], [v2]);

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]![0]).toContain("'read_file'");
    expect(warnSpy.mock.calls[0]![0]).toContain('overridden');

    warnSpy.mockRestore();
  });

  it('does not mutate input arrays', () => {
    const builtins = [makeTool('alpha'), makeTool('beta')];
    const customs = [makeTool('beta', 'override')];

    const origLen = builtins.length;
    const origFirst = builtins[0];

    mergeTools(builtins, customs);

    expect(builtins).toHaveLength(origLen);
    expect(builtins[0]).toBe(origFirst);
  });
});
