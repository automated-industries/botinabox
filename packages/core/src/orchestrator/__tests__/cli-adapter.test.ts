import { describe, it, expect } from 'vitest';
import { filterEnv } from '../adapters/env-whitelist.js';
import { extractOutput, MAX_OUTPUT_BYTES } from '../adapters/output-extractor.js';

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
