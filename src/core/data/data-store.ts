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

    this.lattice.define(name, {
      columns: def.columns,
      primaryKey: def.primaryKey,
      tableConstraints: inlineConstraints.length ? inlineConstraints : undefined,
      relations: def.relations as Record<string, import('latticesql').Relation> | undefined,
      filter: def.filter,
      render: def.render as import('latticesql').RenderSpec | undefined,
      outputFile: def.outputFile,
    });
  }

  /**
   * Register an entity context definition for per-entity file rendering.
   */
  defineEntityContext(name: string, def: EntityContextDef): void {
    this.lattice.defineEntityContext(name, {
      slug: (row: Row) => {
        const val = row[def.slugColumn];
        if (val == null) return String(row.id ?? row.name ?? 'unknown');
        return String(val);
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
              const title = def.directory.charAt(0).toUpperCase() + def.directory.slice(1);
              if (!active.length) return `# ${title}\n\nNone.\n`;
              const lines = active.map((r) => {
                const name = String(r.name ?? r[def.slugColumn] ?? r.id ?? 'unknown');
                const status = r.status ? ` (${r.status})` : '';
                return `- **${name}**${status}`;
              });
              return `# ${title}\n\n${lines.join('\n')}\n`;
            }),
          }
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
    return this.lattice.db.pragma(`table_info(${table})`) as TableInfoRow[];
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
