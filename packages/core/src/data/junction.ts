import type { SqliteAdapter } from './sqlite-adapter.js';
import type { Row } from './types.js';

export function link(adapter: SqliteAdapter, table: string, row: Row): void {
  const cols = Object.keys(row);
  const placeholders = cols.map(() => '?').join(', ');
  const sql = `INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
  adapter.run(sql, Object.values(row));
}

export function unlink(adapter: SqliteAdapter, table: string, row: Row): void {
  const conditions = Object.keys(row).map(col => `${col} = ?`).join(' AND ');
  const sql = `DELETE FROM ${table} WHERE ${conditions}`;
  adapter.run(sql, Object.values(row));
}
