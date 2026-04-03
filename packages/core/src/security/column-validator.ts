import type { SqliteAdapter } from '../data/sqlite-adapter.js';

export interface ColumnValidator {
  validateWrite(table: string, row: Record<string, unknown>): Record<string, unknown>;
  validateRead(table: string, columns: string[]): void;
  invalidateCache(table: string): void;
}

/**
 * Validates column names against the live SQLite schema.
 *
 * - validateWrite: strips unknown columns silently
 * - validateRead: throws on unknown columns
 * - invalidateCache: clears the per-table cache
 */
export class ColumnValidatorImpl implements ColumnValidator {
  private readonly adapter: SqliteAdapter;

  constructor(adapter: SqliteAdapter) {
    this.adapter = adapter;
  }

  private getValidColumns(table: string): Set<string> {
    const rows = this.adapter.tableInfo(table);
    return new Set(rows.map(r => r.name));
  }

  validateWrite(table: string, row: Record<string, unknown>): Record<string, unknown> {
    const valid = this.getValidColumns(table);
    const result: Record<string, unknown> = {};
    for (const [col, val] of Object.entries(row)) {
      if (valid.has(col)) {
        result[col] = val;
      }
      // Unknown columns are silently dropped
    }
    return result;
  }

  validateRead(table: string, columns: string[]): void {
    const valid = this.getValidColumns(table);
    for (const col of columns) {
      if (!valid.has(col)) {
        throw new Error(`Unknown column: ${col} in table ${table}`);
      }
    }
  }

  invalidateCache(table: string): void {
    this.adapter.invalidateTableCache(table);
  }
}
