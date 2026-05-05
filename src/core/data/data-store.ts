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
  private readonly definedTables: string[] = [];
  private readonly columnCache = new Map<string, string[]>();

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
        // Prevent multi-statement injection via semicolons
        if (stmt.includes(';')) {
          throw new DataStoreError(`Deferred DDL statement must not contain semicolons: ${stmt}`);
        }
        this.deferredStatements.push(stmt);
      } else {
        inlineConstraints.push(stmt);
      }
    }

    this.lattice.define(name, {
      columns: def.columns,
      primaryKey: def.primaryKey,
      tableConstraints: inlineConstraints.length ? inlineConstraints : undefined,
      relations: def.relations as Record<string, import('latticesql').Relation> | undefined,
      filter: def.filter,
      render: def.render as import('latticesql').RenderSpec | undefined,
      outputFile: def.outputFile,
    });
    this.definedTables.push(name);
  }

  /**
   * Register an entity context definition for per-entity file rendering.
   */
  defineEntityContext(name: string, def: EntityContextDef): void {
    this.lattice.defineEntityContext(name, {
      slug: (row: Row) => {
        const val = row[def.slugColumn];
        const raw = val == null ? String(row.id ?? row.name ?? 'unknown') : String(val);
        // Validate: no path traversal characters
        if (raw.includes('/') || raw.includes('\\') || raw.includes('..')) {
          throw new Error(`Invalid slug "${raw}": contains path traversal characters`);
        }
        return raw;
      },
      directoryRoot: def.directory,
      files: def.files as Record<string, import('latticesql').EntityFileSpec>,
      protectedFiles: def.protectedFiles,
      protected: def.protected,
      encrypted: def.encrypted,
      // Note: sourceDefaults.softDelete NOT set here because junction tables
      // (agent_project, rule_agent, etc.) don't have deleted_at columns.
      // Entity context render functions should add softDelete per-source when targeting
      // tables that support it.
      index: def.indexFile
        ? {
            outputFile: def.indexFile,
            render: def.indexRender ?? ((rows: Row[]) => {
              const active = rows.filter((r) => r.deleted_at == null);
              const dir = def.directory;
              const title = dir.charAt(0).toUpperCase() + dir.slice(1);
              if (!active.length) return `# ${title}\n\nNone.\n`;
              const lines = active.map((r) => {
                const slug = String(r[def.slugColumn] ?? r.name ?? r.id ?? 'unknown');
                const name = String(r.name ?? slug);
                const status = r.status ? ` (${r.status})` : '';
                return `- [${name}](${dir}/${slug}/)${status}`;
              });
              return `# ${title}\n\n${lines.join('\n')}\n`;
            }),
          }
        : undefined,
    });
  }

  async init(opts?: { migrations?: Array<{ version: string; sql: string }> }): Promise<void> {
    await this.lattice.init({ migrations: opts?.migrations });
    const adapter = this.lattice.adapter;
    if (!adapter.runAsync || !adapter.introspectColumnsAsync) {
      throw new DataStoreError(
        'StorageAdapter must implement runAsync and introspectColumnsAsync (latticesql 1.10.0+)',
      );
    }
    // Run deferred statements (CREATE INDEX, etc.) after tables exist.
    // Use the async adapter surface — sync run() throws on Postgres as of
    // latticesql 1.10.0. Deferred statements are validated to be
    // single-statement (no semicolons) above.
    for (const stmt of this.deferredStatements) {
      await adapter.runAsync(stmt);
    }
    await this._refreshColumnCache();
    this._initialized = true;
  }

  // Pre-populate column cache so synchronous tableInfo() works on Postgres,
  // where introspectColumns sync throws as of latticesql 1.10.0. Refreshed
  // from init() and migrate() — both are the only entry points that can
  // alter table schemas.
  private async _refreshColumnCache(): Promise<void> {
    const adapter = this.lattice.adapter;
    if (!adapter.introspectColumnsAsync) {
      throw new DataStoreError(
        'StorageAdapter must implement introspectColumnsAsync (latticesql 1.10.0+)',
      );
    }
    for (const table of this.definedTables) {
      const cols = await adapter.introspectColumnsAsync(table);
      this.columnCache.set(table, cols);
    }
  }

  private assertInitialized(): void {
    if (!this._initialized) {
      throw new DataStoreError('DataStore not initialized — call init() first');
    }
  }

  // --- CRUD -----------------------------------------------------------

  async insert(table: string, row: Row): Promise<Row> {
    this.assertInitialized();
    return this.lattice.insertReturning(table, row);
  }

  async upsert(table: string, row: Row): Promise<Row> {
    this.assertInitialized();
    const id = await this.lattice.upsert(table, row);
    const result = await this.lattice.get(table, id);
    return result ?? { ...row, id };
  }

  async update(table: string, pk: PkLookup, changes: Row): Promise<Row> {
    this.assertInitialized();
    return this.lattice.updateReturning(table, pk, changes);
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

  async migrate(migrations: Array<{ version: string; sql: string }>): Promise<void> {
    this.assertInitialized();
    await this.lattice.migrate(migrations);
    // Migrations may add/drop columns — refresh the synchronous column cache
    // that tableInfo() reads from, including any tables whose schema just
    // changed. Also clears stale entries cached for unknown (non-define()d)
    // tables on first tableInfo() lookup.
    this.columnCache.clear();
    await this._refreshColumnCache();
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

  tableInfo(table: string): TableInfoRow[] {
    this.assertInitialized();
    // Reads from the column cache populated during init(). For define()d
    // tables this is always a hit. For tables touched only via the raw
    // .lattice.adapter escape hatch (not registered through DataStore.define),
    // fall back to sync introspectColumns — works on SQLite, throws with
    // SYNC_NOT_SUPPORTED_MSG on Postgres (latticesql 1.10.0+), which is the
    // right behavior: a Postgres caller reading an unregistered table should
    // know to await introspectColumnsAsync directly. Returns name-only rows
    // (cid/type/notnull/dflt_value/pk zeroed); current consumers only read
    // `.name`, so the reduced shape is a compatible projection of the legacy
    // SQLite PRAGMA shape.
    let names = this.columnCache.get(table);
    if (!names) {
      names = this.lattice.adapter.introspectColumns(table);
      this.columnCache.set(table, names);
    }
    return names.map((name, cid) => ({
      cid,
      name,
      type: '',
      notnull: 0,
      dflt_value: null,
      pk: 0,
    }));
  }

  // --- Lifecycle ------------------------------------------------------

  close(): void {
    this.lattice.close();
    this._initialized = false;
  }

  on(event: string, handler: (context: Record<string, unknown>) => void): void {
    this.hooks?.register(event, handler);
  }
}
