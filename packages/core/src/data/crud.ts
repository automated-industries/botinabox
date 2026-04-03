import { randomUUID } from 'node:crypto';
import type { SqliteAdapter } from './sqlite-adapter.js';
import type { SchemaManager } from './schema-manager.js';
import type { PkLookup, QueryOptions, Row } from './types.js';
import { buildLimitOffset, buildOrderBy, buildWhere } from './query-builder.js';

export class CrudOps {
  constructor(
    private readonly adapter: SqliteAdapter,
    private readonly schema: SchemaManager,
  ) {}

  private stripUnknownColumns(table: string, row: Row): Row {
    const info = this.adapter.tableInfo(table);
    if (info.length === 0) return row;
    const knownCols = new Set(info.map(c => c.name));
    const stripped: Row = {};
    for (const [k, v] of Object.entries(row)) {
      if (knownCols.has(k)) stripped[k] = v;
    }
    return stripped;
  }

  private buildPkWhere(table: string, pk: PkLookup): { sql: string; params: unknown[] } {
    if (typeof pk === 'string') {
      return { sql: 'id = ?', params: [pk] };
    }
    const conditions = Object.entries(pk).map(([col]) => `${col} = ?`);
    const params = Object.values(pk);
    return { sql: conditions.join(' AND '), params };
  }

  private hasIdColumn(table: string): boolean {
    const info = this.adapter.tableInfo(table);
    return info.some(c => c.name === 'id');
  }

  insert(table: string, row: Row): Row {
    let data = { ...row };

    // Auto-generate UUID if id column exists and not provided
    if (this.hasIdColumn(table) && data['id'] === undefined) {
      data['id'] = randomUUID();
    }

    data = this.stripUnknownColumns(table, data);

    const cols = Object.keys(data);
    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
    this.adapter.run(sql, Object.values(data));
    this.adapter.invalidateTableCache(table);

    // Return the inserted row
    if (data['id'] !== undefined) {
      return this.get(table, data['id'] as string) ?? data;
    }
    return data;
  }

  upsert(table: string, row: Row): Row {
    let data = { ...row };

    if (this.hasIdColumn(table) && data['id'] === undefined) {
      data['id'] = randomUUID();
    }

    data = this.stripUnknownColumns(table, data);

    const cols = Object.keys(data);
    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
    this.adapter.run(sql, Object.values(data));
    this.adapter.invalidateTableCache(table);

    if (data['id'] !== undefined) {
      return this.get(table, data['id'] as string) ?? data;
    }
    return data;
  }

  update(table: string, pk: PkLookup, changes: Row): Row {
    const data = this.stripUnknownColumns(table, changes);
    const setClauses = Object.keys(data).map(col => `${col} = ?`).join(', ');
    const { sql: pkSql, params: pkParams } = this.buildPkWhere(table, pk);
    const sql = `UPDATE ${table} SET ${setClauses} WHERE ${pkSql}`;
    this.adapter.run(sql, [...Object.values(data), ...pkParams]);
    this.adapter.invalidateTableCache(table);

    return this.get(table, pk) ?? {};
  }

  delete(table: string, pk: PkLookup): void {
    const { sql: pkSql, params: pkParams } = this.buildPkWhere(table, pk);
    const sql = `DELETE FROM ${table} WHERE ${pkSql}`;
    this.adapter.run(sql, pkParams);
    this.adapter.invalidateTableCache(table);
  }

  get(table: string, pk: PkLookup): Row | undefined {
    const { sql: pkSql, params: pkParams } = this.buildPkWhere(table, pk);
    return this.adapter.get<Row>(`SELECT * FROM ${table} WHERE ${pkSql}`, pkParams);
  }

  query(table: string, opts?: QueryOptions): Row[] {
    const o = opts ?? {};
    const { sql: whereSql, params } = buildWhere(o);
    const orderSql = buildOrderBy(o);
    const limitSql = buildLimitOffset(o);

    const parts = [`SELECT * FROM ${table}`];
    if (whereSql) parts.push(whereSql);
    if (orderSql) parts.push(orderSql);
    if (limitSql) parts.push(limitSql);

    return this.adapter.all<Row>(parts.join(' '), params);
  }

  count(table: string, opts?: QueryOptions): number {
    const o = opts ?? {};
    const { sql: whereSql, params } = buildWhere(o);

    const parts = [`SELECT COUNT(*) as cnt FROM ${table}`];
    if (whereSql) parts.push(whereSql);

    const row = this.adapter.get<{ cnt: number }>(parts.join(' '), params);
    return row?.cnt ?? 0;
  }
}
