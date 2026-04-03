export interface TableDefinition {
  columns: Record<string, string>;
  primaryKey?: string | string[];
  tableConstraints?: string[];
  relations?: Record<string, RelationDef>;
  render?: string | ((rows: Row[]) => string);
  outputFile?: string;
  filter?: (rows: Row[]) => Row[];
}

export interface RelationDef {
  type: 'belongsTo' | 'hasMany';
  table: string;
  foreignKey: string;
  references?: string;
}

export interface EntityContextDef {
  table: string;
  directory: string;
  slugColumn: string;
  files: Record<string, EntityFileSpec>;
  indexFile?: string;
  protectedFiles?: string[];
  /** When true, this entity's data is never rendered into other entities' context files. */
  protected?: boolean;
  /** Enable at-rest encryption. Requires encryptionKey in Lattice options. */
  encrypted?: boolean | { columns: string[] };
}

export interface EntityFileSpec {
  source: EntitySource;
  render: string | ((rows: Row[]) => string);
  junctionColumns?: string[];
  omitIfEmpty?: boolean;
}

export type EntitySource =
  | { type: 'self' }
  | { type: 'hasMany'; table: string; foreignKey: string; filters?: Filter[]; softDelete?: boolean; orderBy?: string; limit?: number }
  | { type: 'manyToMany'; junctionTable: string; localKey: string; remoteKey: string; remoteTable: string; filters?: Filter[]; orderBy?: string; limit?: number }
  | { type: 'belongsTo'; table: string; foreignKey: string }
  | { type: 'enriched'; include: Record<string, EntitySource> }
  | { type: 'custom'; resolve: (row: Row, adapter: SqliteAdapter) => Row[] };

export interface Filter {
  col: string;
  op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in' | 'isNull' | 'isNotNull';
  val?: unknown;
}

export interface QueryOptions {
  where?: Record<string, unknown>;
  filters?: Filter[];
  orderBy?: string | Array<{ col: string; dir: 'asc' | 'desc' }>;
  orderDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export type Row = Record<string, unknown>;
export type PkLookup = string | Record<string, unknown>;

// Forward declaration for use in EntitySource
export interface SqliteAdapter {
  run(sql: string, params?: unknown[]): import('better-sqlite3').RunResult;
  get<T = Row>(sql: string, params?: unknown[]): T | undefined;
  all<T = Row>(sql: string, params?: unknown[]): T[];
  tableInfo(table: string): TableInfoRow[];
  invalidateTableCache(table: string): void;
}

export interface TableInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

export interface SeedItem {
  table: string;
  rows: Row[];
  naturalKey?: string | string[];
  junctions?: Array<{ table: string; items: Array<Row> }>;
  softDeleteMissing?: boolean;
}
