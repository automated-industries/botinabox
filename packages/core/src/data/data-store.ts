import { Lattice } from 'latticesql';
import type { HookBus } from '../hooks/hook-bus.js';
import type { EntityContextDef, PkLookup, QueryOptions, Row, SeedItem, TableDefinition, TableInfoRow } from './types.js';

export class DataStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataStoreError';
  }
}

/**
 * Thin wrapper around Lattice that provides the botinabox DataStore API.
 *
 * Delegates all data operations to the latticesql package. Application-level
 * events (task.created, run.completed, etc.) remain on the HookBus — they are
 * emitted by orchestrator modules, not the data layer.
 */
export class DataStore {
  private lattice: Lattice;
  private readonly hooks: HookBus | undefined;
  private readonly outputDir: string | undefined;
  private _initialized = false;
  private readonly deferredStatements: string[] = [];

  constructor(opts: {
    dbPath: string;
    outputDir?: string;
    wal?: boolean;
    hooks?: HookBus;
  }) {
    this.lattice = new Lattice(opts.dbPath, {
      wal: opts.wal ?? true,
    });
    this.outputDir = opts.outputDir;
    this.hooks = opts.hooks;
  }

  /**
   * Register a table definition. Must be called before init().
   *
   * tableConstraints may contain both inline constraints (FOREIGN KEY, UNIQUE)
   * and standalone SQL statements (CREATE INDEX). Standalone statements are
   * deferred and executed after init() creates the tables.
   */
  define(name: string, def: TableDefinition): void {
    if (this._initialized) {
      throw new DataStoreError('Cannot define tables after init()');
    }
    const inlineConstraints: string[] = [];
    for (const stmt of def.tableConstraints ?? []) {
      const upper = stmt.trimStart().toUpperCase();
      if (upper.startsWith('CREATE ') || upper.startsWith('DROP ') || upper.startsWith('ALTER ')) {
        this.deferredStatements.push(stmt);
      } else {
        inlineConstraints.push(stmt);
      }
    }

    // Lattice doesn't support composite primaryKey arrays — convert to table constraint
    let primaryKey = def.primaryKey;
    if (Array.isArray(primaryKey)) {
      inlineConstraints.unshift(`PRIMARY KEY (${primaryKey.join(', ')})`);
      primaryKey = undefined;
    }

    this.lattice.define(name, {
      columns: def.columns,
      primaryKey: primaryKey as string | undefined,
      tableConstraints: inlineConstraints.length ? inlineConstraints : undefined,
      relations: def.relations as Record<string, import('latticesql').Relation> | undefined,
      render: def.render ?? (() => ''),
      outputFile: def.outputFile ?? `.internal/${name}.md`,
      filter: def.filter,
    });
  }

  /**
   * Register an entity context definition for per-entity file rendering.
   */
  defineEntityContext(name: string, def: EntityContextDef): void {
    this.lattice.defineEntityContext(name, {
      slug: (row: Row) => row[def.slugColumn] as string,
      directoryRoot: def.directory,
      files: def.files as Record<string, import('latticesql').EntityFileSpec>,
      protectedFiles: def.protectedFiles,
      index: def.indexFile
        ? { outputFile: def.indexFile, render: (rows: Row[]) => '' }
        : undefined,
    });
  }

  async init(opts?: { migrations?: Array<{ version: string; sql: string }> }): Promise<void> {
    await this.lattice.init({ migrations: opts?.migrations });
    // Run deferred statements (CREATE INDEX, etc.) after tables exist
    for (const stmt of this.deferredStatements) {
      this.lattice.db.exec(stmt);
    }
    this._initialized = true;
  }

  private assertInitialized(): void {
    if (!this._initialized) {
      throw new DataStoreError('DataStore not initialized — call init() first');
    }
  }

  // --- CRUD -----------------------------------------------------------

  /**
   * Insert a row. Returns the full inserted row (including auto-generated id).
   *
   * NOTE: Lattice returns only the pk string. We do a follow-up get() to return
   * the full row. This is flagged as a Lattice gap (insertReturning).
   */
  async insert(table: string, row: Row): Promise<Row> {
    this.assertInitialized();
    const id = await this.lattice.insert(table, row);
    const inserted = await this.lattice.get(table, id);
    return inserted ?? { ...row, id };
  }

  async upsert(table: string, row: Row): Promise<Row> {
    this.assertInitialized();
    const id = await this.lattice.upsert(table, row);
    const result = await this.lattice.get(table, id);
    return result ?? { ...row, id };
  }

  /**
   * Update a row by primary key. Returns the updated row.
   *
   * NOTE: Lattice returns void. We do a follow-up get() to return the full
   * row. This is flagged as a Lattice gap (updateReturning).
   */
  async update(table: string, pk: PkLookup, changes: Row): Promise<Row> {
    this.assertInitialized();
    await this.lattice.update(table, pk, changes);
    const result = await this.lattice.get(table, pk);
    return result ?? changes;
  }

  async delete(table: string, pk: PkLookup): Promise<void> {
    this.assertInitialized();
    await this.lattice.delete(table, pk);
  }

  /**
   * Get a single row by primary key.
   * Returns undefined if not found (Lattice returns null).
   */
  async get(table: string, pk: PkLookup): Promise<Row | undefined> {
    this.assertInitialized();
    const result = await this.lattice.get(table, pk);
    return result ?? undefined;
  }

  async query(table: string, opts?: QueryOptions): Promise<Row[]> {
    this.assertInitialized();
    return this.lattice.query(table, opts as import('latticesql').QueryOptions);
  }

  async count(table: string, opts?: QueryOptions): Promise<number> {
    this.assertInitialized();
    return this.lattice.count(table, opts as import('latticesql').CountOptions);
  }

  // --- Junctions ------------------------------------------------------

  async link(junctionTable: string, row: Row): Promise<void> {
    this.assertInitialized();
    await this.lattice.link(junctionTable, row);
  }

  async unlink(junctionTable: string, row: Row): Promise<void> {
    this.assertInitialized();
    await this.lattice.unlink(junctionTable, row);
  }

  // --- Migrations -----------------------------------------------------

  /**
   * Run versioned migrations after init().
   *
   * NOTE: Lattice handles migrations via init({ migrations }). This method
   * uses raw DB access as a workaround for post-init migrations (e.g.,
   * package-level schema changes). Flagged as a Lattice gap.
   */
  /**
   * Run versioned migrations after init().
   *
   * Uses a separate tracking table (__botinabox_migrations) because Lattice's
   * __lattice_migrations uses INTEGER primary keys while botinabox uses string
   * versions like "package:semver". Flagged as a Lattice gap.
   */
  async migrate(migrations: Array<{ version: string; sql: string }>): Promise<void> {
    this.assertInitialized();
    const db = this.lattice.db;

    db.exec(
      `CREATE TABLE IF NOT EXISTS __botinabox_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`
    );

    const applied = new Set(
      (db.prepare('SELECT version FROM __botinabox_migrations').all() as Array<{ version: string }>)
        .map(r => r.version)
    );

    for (const m of migrations) {
      if (applied.has(m.version)) continue;
      db.exec(m.sql);
      db.prepare('INSERT INTO __botinabox_migrations (version, applied_at) VALUES (?, ?)').run(
        m.version,
        new Date().toISOString()
      );
    }
  }

  // --- Seed -----------------------------------------------------------

  async seed(items: SeedItem[]): Promise<void> {
    this.assertInitialized();
    for (const item of items) {
      const naturalKey = Array.isArray(item.naturalKey)
        ? item.naturalKey[0]
        : (item.naturalKey ?? 'id');
      await this.lattice.seed({
        table: item.table,
        data: item.rows,
        naturalKey,
        softDeleteMissing: item.softDeleteMissing,
      });
      if (item.junctions) {
        for (const junc of item.junctions) {
          for (const linkRow of junc.items) {
            await this.lattice.link(junc.table, linkRow);
          }
        }
      }
    }
  }

  // --- Rendering ------------------------------------------------------

  async render(): Promise<void> {
    this.assertInitialized();
    if (this.outputDir) {
      await this.lattice.render(this.outputDir);
    }
  }

  async reconcile(): Promise<void> {
    this.assertInitialized();
    if (this.outputDir) {
      await this.lattice.reconcile(this.outputDir);
    }
  }

  // --- Schema introspection ------------------------------------------

  /**
   * Get column info for a table (for ColumnValidator).
   * Delegates to Lattice's raw SQLite connection.
   */
  tableInfo(table: string): TableInfoRow[] {
    this.assertInitialized();
    return this.lattice.db.pragma(`table_info(${table})`) as TableInfoRow[];
  }

  // --- Lifecycle ------------------------------------------------------

  close(): void {
    this.lattice.close();
    this._initialized = false;
  }

  /**
   * Register an application-level event handler on the HookBus.
   * These events are emitted by orchestrator modules, not the data layer.
   */
  on(event: string, handler: (context: Record<string, unknown>) => void): void {
    this.hooks?.register(event, handler);
  }
}
