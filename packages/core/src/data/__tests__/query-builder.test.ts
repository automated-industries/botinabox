import { describe, expect, it } from 'vitest';
import { buildWhere, buildOrderBy, buildLimitOffset } from '../query-builder.js';

describe('buildWhere', () => {
  it('returns empty string for empty opts', () => {
    const result = buildWhere({});
    expect(result.sql).toBe('');
    expect(result.params).toEqual([]);
  });

  it('handles where equality', () => {
    const result = buildWhere({ where: { name: 'Alice', age: 30 } });
    expect(result.sql).toContain('name = ?');
    expect(result.sql).toContain('age = ?');
    expect(result.params).toContain('Alice');
    expect(result.params).toContain(30);
  });

  it('handles filter gt', () => {
    const result = buildWhere({ filters: [{ col: 'age', op: 'gt', val: 18 }] });
    expect(result.sql).toBe('WHERE age > ?');
    expect(result.params).toEqual([18]);
  });

  it('handles filter lt', () => {
    const result = buildWhere({ filters: [{ col: 'score', op: 'lt', val: 100 }] });
    expect(result.sql).toBe('WHERE score < ?');
    expect(result.params).toEqual([100]);
  });

  it('handles filter like', () => {
    const result = buildWhere({ filters: [{ col: 'name', op: 'like', val: '%Ali%' }] });
    expect(result.sql).toBe('WHERE name LIKE ?');
    expect(result.params).toEqual(['%Ali%']);
  });

  it('handles filter in', () => {
    const result = buildWhere({ filters: [{ col: 'id', op: 'in', val: [1, 2, 3] }] });
    expect(result.sql).toBe('WHERE id IN (?,?,?)');
    expect(result.params).toEqual([1, 2, 3]);
  });

  it('handles filter isNull (no placeholder)', () => {
    const result = buildWhere({ filters: [{ col: 'deleted_at', op: 'isNull' }] });
    expect(result.sql).toBe('WHERE deleted_at IS NULL');
    expect(result.params).toEqual([]);
  });

  it('handles filter isNotNull', () => {
    const result = buildWhere({ filters: [{ col: 'deleted_at', op: 'isNotNull' }] });
    expect(result.sql).toBe('WHERE deleted_at IS NOT NULL');
    expect(result.params).toEqual([]);
  });

  it('combines where + filters with AND', () => {
    const result = buildWhere({
      where: { status: 'active' },
      filters: [{ col: 'age', op: 'gt', val: 18 }],
    });
    expect(result.sql).toContain('WHERE');
    expect(result.sql).toContain('AND');
    expect(result.sql).toContain('status = ?');
    expect(result.sql).toContain('age > ?');
    expect(result.params).toContain('active');
    expect(result.params).toContain(18);
  });

  it('multiple filters use AND', () => {
    const result = buildWhere({
      filters: [
        { col: 'age', op: 'gt', val: 18 },
        { col: 'age', op: 'lt', val: 65 },
      ],
    });
    expect(result.sql).toBe('WHERE age > ? AND age < ?');
    expect(result.params).toEqual([18, 65]);
  });
});

describe('buildOrderBy', () => {
  it('returns empty string with no orderBy', () => {
    expect(buildOrderBy({})).toBe('');
  });

  it('handles string orderBy', () => {
    expect(buildOrderBy({ orderBy: 'name' })).toBe('ORDER BY name ASC');
  });

  it('handles string orderBy with orderDir', () => {
    expect(buildOrderBy({ orderBy: 'created_at', orderDir: 'desc' })).toBe('ORDER BY created_at DESC');
  });

  it('handles array orderBy', () => {
    const result = buildOrderBy({
      orderBy: [
        { col: 'name', dir: 'asc' },
        { col: 'age', dir: 'desc' },
      ],
    });
    expect(result).toBe('ORDER BY name ASC, age DESC');
  });
});

describe('buildLimitOffset', () => {
  it('returns empty for no limit/offset', () => {
    expect(buildLimitOffset({})).toBe('');
  });

  it('handles limit only', () => {
    expect(buildLimitOffset({ limit: 10 })).toBe('LIMIT 10');
  });

  it('handles limit + offset', () => {
    expect(buildLimitOffset({ limit: 10, offset: 20 })).toBe('LIMIT 10 OFFSET 20');
  });
});
