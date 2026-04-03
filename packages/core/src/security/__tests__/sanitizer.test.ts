import { describe, it, expect } from 'vitest';
import { sanitize } from '../sanitizer.js';

describe('sanitize', () => {
  it('strips null bytes from string values', () => {
    const result = sanitize({ name: 'hel\x00lo' });
    expect(result['name']).toBe('hello');
  });

  it('strips control characters but preserves \\n, \\r, \\t', () => {
    const result = sanitize({ msg: 'line1\nline2\r\ttab\x01\x07\x1f' });
    expect(result['msg']).toBe('line1\nline2\r\ttab');
  });

  it('truncates fields exceeding length limit and appends [truncated]', () => {
    const longStr = 'a'.repeat(200);
    const result = sanitize({ body: longStr }, { fieldLengthLimits: { body: 100 } });
    const val = result['body'] as string;
    expect(val.endsWith('[truncated]')).toBe(true);
    expect(Buffer.byteLength(val)).toBeLessThanOrEqual(100);
  });

  it('passes non-string values through unchanged', () => {
    const row = { count: 42, active: true, data: null, arr: [1, 2] };
    const result = sanitize(row);
    expect(result['count']).toBe(42);
    expect(result['active']).toBe(true);
    expect(result['data']).toBeNull();
    expect(result['arr']).toEqual([1, 2]);
  });

  it('returns a new object and does not mutate the input', () => {
    const input = { name: 'te\x00st' };
    const result = sanitize(input);
    expect(result).not.toBe(input);
    expect(input['name']).toBe('te\x00st');
    expect(result['name']).toBe('test');
  });

  it('honors per-column limits over the default limit', () => {
    const shortStr = 'hello world'; // 11 bytes
    // Set a very small limit for 'title' (5 bytes), but leave default for others
    const result = sanitize(
      { title: shortStr, body: shortStr },
      { fieldLengthLimits: { title: 5 } },
    );
    const title = result['title'] as string;
    expect(title.endsWith('[truncated]')).toBe(true);
    // body uses default (65535) — should be unchanged
    expect(result['body']).toBe(shortStr);
  });

  it('does not truncate when byte length is exactly at the limit', () => {
    const str = 'abc'; // 3 bytes
    const result = sanitize({ val: str }, { fieldLengthLimits: { val: 3 } });
    expect(result['val']).toBe('abc');
  });

  it('handles custom truncate suffix', () => {
    const longStr = 'x'.repeat(50);
    const result = sanitize({ col: longStr }, { fieldLengthLimits: { col: 20 }, truncateSuffix: '...' });
    const val = result['col'] as string;
    expect(val.endsWith('...')).toBe(true);
    expect(Buffer.byteLength(val)).toBeLessThanOrEqual(20);
  });
});
