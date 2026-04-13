import { describe, it, expect } from 'vitest';
import { buildCliArgs } from '../adapters/cli-adapter.js';
import { filterEnv } from '../adapters/env-whitelist.js';
import { extractOutput, MAX_OUTPUT_BYTES } from '../adapters/output-extractor.js';

describe('buildCliArgs', () => {
  it('defaults to just --print + prompt', () => {
    expect(buildCliArgs({ prompt: 'hello' })).toEqual(['--print', 'hello']);
  });

  it('prepends --dangerously-skip-permissions when requested', () => {
    expect(buildCliArgs({ prompt: 'hi', skipPermissions: true })).toEqual([
      '--dangerously-skip-permissions',
      '--print',
      'hi',
    ]);
  });

  it('includes --session-id when provided', () => {
    const args = buildCliArgs({
      prompt: 'hi',
      sessionId: '11111111-2222-3333-4444-555555555555',
    });
    expect(args).toEqual([
      '--session-id',
      '11111111-2222-3333-4444-555555555555',
      '--print',
      'hi',
    ]);
  });

  it('includes --settings when provided', () => {
    expect(
      buildCliArgs({ prompt: 'hi', settings: '{"autoMemoryDirectory":null}' }),
    ).toEqual(['--settings', '{"autoMemoryDirectory":null}', '--print', 'hi']);
  });

  it('includes --append-system-prompt when provided', () => {
    expect(
      buildCliArgs({ prompt: 'hi', appendSystemPrompt: 'be terse' }),
    ).toEqual(['--append-system-prompt', 'be terse', '--print', 'hi']);
  });

  it('includes --add-dir when non-empty', () => {
    expect(
      buildCliArgs({ prompt: 'hi', addDirs: ['/a', '/b'] }),
    ).toEqual(['--add-dir', '/a', '/b', '--print', 'hi']);
  });

  it('skips --add-dir when array is empty', () => {
    expect(buildCliArgs({ prompt: 'hi', addDirs: [] })).toEqual(['--print', 'hi']);
  });

  it('appends extraArgs before the positional prompt', () => {
    expect(
      buildCliArgs({ prompt: 'hi', extraArgs: ['--model', 'sonnet'] }),
    ).toEqual(['--model', 'sonnet', '--print', 'hi']);
  });

  it('combines all options in the documented order', () => {
    const args = buildCliArgs({
      prompt: 'go',
      skipPermissions: true,
      sessionId: 'abc',
      settings: '{}',
      appendSystemPrompt: 'extra',
      addDirs: ['/x'],
      extraArgs: ['--verbose'],
    });
    expect(args).toEqual([
      '--dangerously-skip-permissions',
      '--session-id',
      'abc',
      '--settings',
      '{}',
      '--append-system-prompt',
      'extra',
      '--add-dir',
      '/x',
      '--verbose',
      '--print',
      'go',
    ]);
  });

  it('always puts --print + prompt last', () => {
    const args = buildCliArgs({
      prompt: 'final',
      extraArgs: ['--foo', 'bar'],
    });
    expect(args[args.length - 2]).toBe('--print');
    expect(args[args.length - 1]).toBe('final');
  });
});

describe('CLI Adapter helpers — Story 3.5', () => {
  describe('filterEnv', () => {
    it('returns only allowed env vars', () => {
      const result = filterEnv(['PATH', 'HOME']);
      const keys = Object.keys(result);
      expect(keys.every((k) => ['PATH', 'HOME'].includes(k))).toBe(true);
    });

    it('includes extra env vars', () => {
      const result = filterEnv(['PATH'], { MY_VAR: 'value123' });
      expect(result['MY_VAR']).toBe('value123');
    });

    it('uses defaults when no allowed list provided', () => {
      const result = filterEnv();
      // Should have some subset of default keys that exist in the current env
      expect(typeof result).toBe('object');
    });

    it('extra env overrides base env', () => {
      const result = filterEnv(['PATH'], { PATH: '/custom/path' });
      expect(result['PATH']).toBe('/custom/path');
    });
  });

  describe('extractOutput', () => {
    it('extracts output from result type NDJSON', () => {
      const ndjson = JSON.stringify({ type: 'result', result: 'Task complete' });
      expect(extractOutput(ndjson)).toBe('Task complete');
    });

    it('extracts output from assistant role NDJSON', () => {
      const ndjson = JSON.stringify({ role: 'assistant', content: 'My answer' });
      expect(extractOutput(ndjson)).toBe('My answer');
    });

    it('returns raw content if no structured output', () => {
      const raw = 'just some raw output text';
      expect(extractOutput(raw)).toBe(raw);
    });

    it('returns last result when multiple result lines', () => {
      const lines = [
        JSON.stringify({ type: 'result', result: 'First' }),
        JSON.stringify({ type: 'result', result: 'Last' }),
      ].join('\n');
      expect(extractOutput(lines)).toBe('Last');
    });

    it('caps output at MAX_OUTPUT_BYTES', () => {
      // Create content larger than 4MB
      const bigContent = 'x'.repeat(MAX_OUTPUT_BYTES + 1000);
      const result = extractOutput(bigContent);
      expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
    });

    it('skips non-JSON lines', () => {
      const mixed = [
        'not json',
        JSON.stringify({ type: 'result', result: 'Valid' }),
        'also not json',
      ].join('\n');
      expect(extractOutput(mixed)).toBe('Valid');
    });
  });
});
