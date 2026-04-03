import { describe, it, expect } from 'vitest';
import { parseVersion, compareVersions, classifyUpdate } from '../version-utils.js';

describe('parseVersion', () => {
  it('parses standard semver', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
  });

  it('strips leading v', () => {
    expect(parseVersion('v2.0.0')).toEqual([2, 0, 0]);
  });

  it('handles missing parts', () => {
    expect(parseVersion('1.0')).toEqual([1, 0, 0]);
  });

  it('strips pre-release suffix', () => {
    expect(parseVersion('1.2.3-alpha.1')).toEqual([1, 2, 3]);
  });
});

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('returns 1 when a > b (patch)', () => {
    expect(compareVersions('1.0.2', '1.0.1')).toBe(1);
  });

  it('returns -1 when a < b (minor)', () => {
    expect(compareVersions('1.0.0', '1.1.0')).toBe(-1);
  });

  it('returns 1 when major a > b', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
  });
});

describe('classifyUpdate', () => {
  it('1.0.0 → 1.0.1 = patch', () => {
    expect(classifyUpdate('1.0.0', '1.0.1')).toBe('patch');
  });

  it('1.0.0 → 1.1.0 = minor', () => {
    expect(classifyUpdate('1.0.0', '1.1.0')).toBe('minor');
  });

  it('1.0.0 → 2.0.0 = major', () => {
    expect(classifyUpdate('1.0.0', '2.0.0')).toBe('major');
  });

  it('1.0.0 → 1.0.0 = none', () => {
    expect(classifyUpdate('1.0.0', '1.0.0')).toBe('none');
  });

  it('1.2.3 → 1.2.5 = patch', () => {
    expect(classifyUpdate('1.2.3', '1.2.5')).toBe('patch');
  });

  it('1.5.0 → 2.0.0 = major', () => {
    expect(classifyUpdate('1.5.0', '2.0.0')).toBe('major');
  });
});
