import Database from 'better-sqlite3';
import type { Database as DatabaseType, RunResult, Statement } from 'better-sqlite3';
import type { TableInfoRow } from './types.js';

export class SqliteAdapter {
  private _db: DatabaseType | null = null;
  private readonly dbPath: string;
  private readonly walMode: boolean;
  private readonly tableCache = new Map<string, TableInfoRow[]>();

  constructor(dbPath: string, opts?: { wal?: boolean }) {
    this.dbPath = dbPath;
    this.walMode = opts?.wal ?? false;
  }

  open(): void {
    this._db = new Database(this.dbPath);
    this._db.pragma('foreign_keys = ON');
    this._db.pragma('journal_mode = WAL');
    this._db.pragma('synchronous = NORMAL');
    this._db.pragma('cache_size = -64000');
    this._db.pragma('temp_store = MEMORY');
  }

  get db(): DatabaseType {
    if (!this._db) throw new Error('Database not open — call open() first');
    return this._db;
  }

  run(sql: string, params?: unknown[]): RunResult {
    return this.db.prepare(sql).run(...(params ?? []));
  }

  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined {
    return this.db.prepare(sql).get(...(params ?? [])) as T | undefined;
  }

  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] {
    return this.db.prepare(sql).all(...(params ?? [])) as T[];
  }

  prepare(sql: string): Statement {
    return this.db.prepare(sql);
  }

  pragma(name: string): unknown {
    return this.db.pragma(name);
  }

  close(): void {
    this._db?.close();
    this._db = null;
    this.tableCache.clear();
  }

  tableInfo(table: string): TableInfoRow[] {
    if (this.tableCache.has(table)) {
      return this.tableCache.get(table)!;
    }
    const rows = this.all<TableInfoRow>(`PRAGMA table_info(${table})`);
    this.tableCache.set(table, rows);
    return rows;
  }

  invalidateTableCache(table: string): void {
    this.tableCache.delete(table);
  }
}
