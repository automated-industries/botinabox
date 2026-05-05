import type { DataStore } from '../data/data-store.js';

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
 */
export class ColumnValidatorImpl implements ColumnValidator {
  private readonly db: DataStore;

  constructor(db: DataStore) {
    this.db = db;
  }

  private getValidColumns(table: string): Set<string> {
    const rows = this.db.tableInfo(table);
    return new Set(rows.map(r => r.name));
  }

  validateWrite(table: string, row: Record<string, unknown>): Record<string, unknown> {
    const valid = this.getValidColumns(table);
    const result: Record<string, unknown> = {};
    for (const [col, val] of Object.entries(row)) {
      if (valid.has(col)) {
        result[col] = val;
      }
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

  invalidateCache(_table: string): void {
    // No-op: DataStore.tableInfo() reads from a column cache that
    // DataStore.migrate() refreshes after every ALTER TABLE / migration.
  }
}
