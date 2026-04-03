import type { HookBus } from '../hooks/hook-bus.js';
import { SqliteAdapter } from './sqlite-adapter.js';
import { SchemaManager } from './schema-manager.js';
import { CrudOps } from './crud.js';
import { MigrationRunner } from './migration.js';
import { seed } from './seed.js';
import { link, unlink } from './junction.js';
import { RenderEngine } from './render/engine.js';
import { EntityContextRenderer } from './render/entity-context.js';
import type { EntityContextDef, PkLookup, QueryOptions, Row, SeedItem, TableDefinition } from './types.js';

export class DataStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataStoreError';
  }
}

export class DataStore {
  private adapter: SqliteAdapter;
  private schemaManager: SchemaManager;
  private crudOps: CrudOps | null = null;
  private renderEngine: RenderEngine | null = null;
  private entityContextRenderer: EntityContextRenderer | null = null;
  private migrationRunner: MigrationRunner | null = null;
  private _initialized = false;
  private readonly outputDir: string | undefined;
  private readonly hooks: HookBus | undefined;
  private readonly entityContextDefs = new Map<string, EntityContextDef>();

  constructor(opts: {
    dbPath: string;
    outputDir?: string;
    wal?: boolean;
    hooks?: HookBus;
  }) {
    this.adapter = new SqliteAdapter(opts.dbPath, { wal: opts.wal });
    this.schemaManager = new SchemaManager(this.adapter);
    this.outputDir = opts.outputDir;
    this.hooks = opts.hooks;
  }

  define(name: string, def: TableDefinition): void {
    if (this._initialized) {
      throw new DataStoreError('Cannot define tables after init()');
    }
    this.schemaManager.define(name, def);
  }

  defineEntityContext(name: string, def: EntityContextDef): void {
    this.entityContextDefs.set(name, def);
  }

  init(): void {
    this.adapter.open();
    this.schemaManager.init();
    this.crudOps = new CrudOps(this.adapter, this.schemaManager);
    this.migrationRunner = new MigrationRunner(this.adapter);

    if (this.outputDir) {
      this.renderEngine = new RenderEngine(this.adapter, this.schemaManager, {
        outputDir: this.outputDir,
      });
      this.entityContextRenderer = new EntityContextRenderer(this.adapter, this.schemaManager, {
        outputDir: this.outputDir,
      });
      for (const [name, def] of this.entityContextDefs) {
        this.entityContextRenderer.define(name, def);
      }
    }

    this._initialized = true;
  }

  private assertInitialized(): void {
    if (!this._initialized || !this.crudOps) {
      throw new DataStoreError('DataStore not initialized — call init() first');
    }
  }

  insert(table: string, row: Row): Row {
    this.assertInitialized();
    return this.crudOps!.insert(table, row);
  }

  upsert(table: string, row: Row): Row {
    this.assertInitialized();
    return this.crudOps!.upsert(table, row);
  }

  update(table: string, pk: PkLookup, changes: Row): Row {
    this.assertInitialized();
    return this.crudOps!.update(table, pk, changes);
  }

  delete(table: string, pk: PkLookup): void {
    this.assertInitialized();
    this.crudOps!.delete(table, pk);
  }

  get(table: string, pk: PkLookup): Row | undefined {
    this.assertInitialized();
    return this.crudOps!.get(table, pk);
  }

  query(table: string, opts?: QueryOptions): Row[] {
    this.assertInitialized();
    return this.crudOps!.query(table, opts);
  }

  count(table: string, opts?: QueryOptions): number {
    this.assertInitialized();
    return this.crudOps!.count(table, opts);
  }

  link(junctionTable: string, row: Row): void {
    this.assertInitialized();
    link(this.adapter, junctionTable, row);
  }

  unlink(junctionTable: string, row: Row): void {
    this.assertInitialized();
    unlink(this.adapter, junctionTable, row);
  }

  migrate(migrations: Array<{ version: string; sql: string }>): void {
    this.assertInitialized();
    this.migrationRunner!.run(migrations);
  }

  async seed(items: SeedItem[]): Promise<void> {
    this.assertInitialized();
    await seed(this.crudOps!, this.adapter, items);
  }

  render(): void {
    this.assertInitialized();
    this.renderEngine?.render();
  }

  reconcile(): void {
    this.assertInitialized();
    this.renderEngine?.render();
    this.entityContextRenderer?.render();
  }

  close(): void {
    this.adapter.close();
  }

  on(event: string, handler: (context: Record<string, unknown>) => void): void {
    this.hooks?.register(event, handler);
  }
}
