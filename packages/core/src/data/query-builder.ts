import type { Filter, QueryOptions } from './types.js';

export function buildWhere(opts: QueryOptions): { sql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  // Handle where (equality)
  if (opts.where) {
    for (const [col, val] of Object.entries(opts.where)) {
      conditions.push(`${col} = ?`);
      params.push(val);
    }
  }

  // Handle filters
  if (opts.filters) {
    for (const filter of opts.filters) {
      const { col, op, val } = filter;
      switch (op) {
        case 'eq':
          conditions.push(`${col} = ?`);
          params.push(val);
          break;
        case 'ne':
          conditions.push(`${col} != ?`);
          params.push(val);
          break;
        case 'gt':
          conditions.push(`${col} > ?`);
          params.push(val);
          break;
        case 'gte':
          conditions.push(`${col} >= ?`);
          params.push(val);
          break;
        case 'lt':
          conditions.push(`${col} < ?`);
          params.push(val);
          break;
        case 'lte':
          conditions.push(`${col} <= ?`);
          params.push(val);
          break;
        case 'like':
          conditions.push(`${col} LIKE ?`);
          params.push(val);
          break;
        case 'in': {
          const arr = val as unknown[];
          const placeholders = arr.map(() => '?').join(',');
          conditions.push(`${col} IN (${placeholders})`);
          params.push(...arr);
          break;
        }
        case 'isNull':
          conditions.push(`${col} IS NULL`);
          break;
        case 'isNotNull':
          conditions.push(`${col} IS NOT NULL`);
          break;
      }
    }
  }

  if (conditions.length === 0) {
    return { sql: '', params: [] };
  }

  return { sql: `WHERE ${conditions.join(' AND ')}`, params };
}

export function buildOrderBy(opts: QueryOptions): string {
  if (!opts.orderBy) return '';

  if (typeof opts.orderBy === 'string') {
    const dir = opts.orderDir ?? 'asc';
    return `ORDER BY ${opts.orderBy} ${dir.toUpperCase()}`;
  }

  const parts = opts.orderBy.map(({ col, dir }) => `${col} ${dir.toUpperCase()}`);
  return `ORDER BY ${parts.join(', ')}`;
}

export function buildLimitOffset(opts: QueryOptions): string {
  const parts: string[] = [];
  if (opts.limit !== undefined) parts.push(`LIMIT ${opts.limit}`);
  if (opts.offset !== undefined) parts.push(`OFFSET ${opts.offset}`);
  return parts.join(' ');
}

export function buildFiltersWhere(filters: Filter[]): { sql: string; params: unknown[] } {
  return buildWhere({ filters });
}
