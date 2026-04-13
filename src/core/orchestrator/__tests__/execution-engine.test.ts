import { describe, it, expect } from 'vitest';
import { formatContextFilesBlock, type ContextFile } from '../execution-engine.js';

describe('formatContextFilesBlock', () => {
  it('returns empty string for undefined input', () => {
    expect(formatContextFilesBlock(undefined as unknown as ContextFile[])).toBe('');
  });

  it('returns empty string for an empty array', () => {
    expect(formatContextFilesBlock([])).toBe('');
  });

  it('wraps a single file in <file> XML tags', () => {
    const out = formatContextFilesBlock([
      { path: '/a/b.md', content: 'hello' },
    ]);
    expect(out).toBe('<file path="/a/b.md">\nhello\n</file>');
  });

  it('joins multiple files with blank lines between them', () => {
    const out = formatContextFilesBlock([
      { path: '/a.md', content: 'first' },
      { path: '/b.md', content: 'second' },
    ]);
    expect(out).toBe(
      '<file path="/a.md">\nfirst\n</file>\n\n<file path="/b.md">\nsecond\n</file>',
    );
  });

  it('preserves the order of the input', () => {
    const out = formatContextFilesBlock([
      { path: '/z.md', content: 'z' },
      { path: '/a.md', content: 'a' },
      { path: '/m.md', content: 'm' },
    ]);
    expect(out.indexOf('/z.md')).toBeLessThan(out.indexOf('/a.md'));
    expect(out.indexOf('/a.md')).toBeLessThan(out.indexOf('/m.md'));
  });

  it('preserves multi-line content verbatim', () => {
    const out = formatContextFilesBlock([
      { path: '/rules.md', content: '## Rule 1\nBe nice.\n\n## Rule 2\nBe terse.' },
    ]);
    expect(out).toContain('## Rule 1\nBe nice.\n\n## Rule 2\nBe terse.');
  });

  it('does not escape or transform content', () => {
    // Angle brackets and quotes in content pass through as-is. Callers are
    // responsible for any escaping their prompt format requires.
    const out = formatContextFilesBlock([
      { path: '/x.md', content: '<script>alert("hi")</script>' },
    ]);
    expect(out).toContain('<script>alert("hi")</script>');
  });

  it('does not trim whitespace from content', () => {
    const out = formatContextFilesBlock([
      { path: '/x.md', content: '  spaced  ' },
    ]);
    expect(out).toBe('<file path="/x.md">\n  spaced  \n</file>');
  });
});
