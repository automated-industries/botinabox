import { describe, it, expect } from 'vitest';
import { detectCycle, topologicalSort, areDependenciesMet } from '../dependency-resolver.js';

describe('detectCycle', () => {
  it('returns false for steps with no deps', () => {
    expect(detectCycle([{ id: 'a' }, { id: 'b' }])).toBe(false);
  });

  it('returns false for linear chain', () => {
    expect(detectCycle([
      { id: 'a' },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: ['b'] },
    ])).toBe(false);
  });

  it('returns true for direct cycle', () => {
    expect(detectCycle([
      { id: 'a', dependsOn: ['b'] },
      { id: 'b', dependsOn: ['a'] },
    ])).toBe(true);
  });

  it('returns true for indirect cycle', () => {
    expect(detectCycle([
      { id: 'a', dependsOn: ['c'] },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: ['b'] },
    ])).toBe(true);
  });

  it('returns false for diamond (convergent) shape', () => {
    expect(detectCycle([
      { id: 'a' },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: ['a'] },
      { id: 'd', dependsOn: ['b', 'c'] },
    ])).toBe(false);
  });
});

describe('topologicalSort', () => {
  it('sorts linear chain in order', () => {
    const result = topologicalSort([
      { id: 'b', dependsOn: ['a'] },
      { id: 'a' },
    ]);
    expect(result.indexOf('a')).toBeLessThan(result.indexOf('b'));
  });

  it('handles parallel steps', () => {
    const result = topologicalSort([
      { id: 'a' },
      { id: 'b' },
      { id: 'c', dependsOn: ['a', 'b'] },
    ]);
    expect(result.indexOf('a')).toBeLessThan(result.indexOf('c'));
    expect(result.indexOf('b')).toBeLessThan(result.indexOf('c'));
  });

  it('throws on cycle', () => {
    expect(() => topologicalSort([
      { id: 'a', dependsOn: ['b'] },
      { id: 'b', dependsOn: ['a'] },
    ])).toThrow('Cycle detected');
  });

  it('returns all steps', () => {
    const steps = [{ id: 'a' }, { id: 'b', dependsOn: ['a'] }, { id: 'c', dependsOn: ['b'] }];
    const result = topologicalSort(steps);
    expect(result).toHaveLength(3);
    expect(result).toContain('a');
    expect(result).toContain('b');
    expect(result).toContain('c');
  });
});

describe('areDependenciesMet', () => {
  it('returns true when taskDepsJson is undefined', () => {
    expect(areDependenciesMet(undefined, new Set())).toBe(true);
  });

  it('returns true when deps array is empty', () => {
    expect(areDependenciesMet('[]', new Set())).toBe(true);
  });

  it('returns true when all deps are satisfied', () => {
    expect(areDependenciesMet('["task-1","task-2"]', new Set(['task-1', 'task-2', 'task-3']))).toBe(true);
  });

  it('returns false when some deps are not satisfied', () => {
    expect(areDependenciesMet('["task-1","task-2"]', new Set(['task-1']))).toBe(false);
  });

  it('returns false when no deps are satisfied', () => {
    expect(areDependenciesMet('["task-1"]', new Set())).toBe(false);
  });

  it('handles invalid JSON gracefully', () => {
    expect(areDependenciesMet('not-json', new Set())).toBe(true);
  });
});
