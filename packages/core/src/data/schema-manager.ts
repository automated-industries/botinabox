import type { SqliteAdapter } from './sqlite-adapter.js';
import type { TableDefinition } from './types.js';

export class SchemaManager {
  private readonly definitions = new Map<string, TableDefinition>();
  _initialized = false;

  constructor(private readonly adapter: SqliteAdapter) {}

  define(name: string, def: TableDefinition): void {
    if (this._initialized) {
      throw new Error(`Cannot define tables after init()`);
    }
    this.definitions.set(name, def);
  }

  init(): void {
    for (const [name, def] of this.definitions) {
      this._createTable(name, def);
      this._addMissingColumns(name, def);
    }
    this._initialized = true;
  }

  private _createTable(name: string, def: TableDefinition): void {
    const cols = Object.entries(def.columns).map(([col, type]) => `  ${col} ${type}`);

    // Separate inline constraints (FOREIGN KEY, CHECK, UNIQUE) from DDL statements (CREATE INDEX)
    const inlineConstraints: string[] = [];
    const ddlStatements: string[] = [];
    for (const c of def.tableConstraints ?? []) {
      if (/^\s*CREATE\s+/i.test(c)) {
        ddlStatements.push(c);
      } else {
        inlineConstraints.push(`  ${c}`);
      }
    }

    // Add composite primary key constraint
    if (Array.isArray(def.primaryKey)) {
      inlineConstraints.push(`  PRIMARY KEY (${def.primaryKey.join(', ')})`);
    }

    const allCols = [...cols, ...inlineConstraints];
    const sql = `CREATE TABLE IF NOT EXISTS ${name} (\n${allCols.join(',\n')}\n)`;
    this.adapter.run(sql);

    // Run post-table DDL (CREATE INDEX, etc.)
    for (const stmt of ddlStatements) {
      this.adapter.run(stmt);
    }
  }

  private _addMissingColumns(name: string, def: TableDefinition): void {
    this.adapter.invalidateTableCache(name);
    const existing = this.adapter.tableInfo(name);
    const existingNames = new Set(existing.map(r => r.name));

    for (const [col, type] of Object.entries(def.columns)) {
      if (!existingNames.has(col)) {
        this.adapter.run(`ALTER TABLE ${name} ADD COLUMN ${col} ${type}`);
        this.adapter.invalidateTableCache(name);
      }
    }
  }

  addMissingColumns(table: string): void {
    const def = this.definitions.get(table);
    if (!def) return;
    this._addMissingColumns(table, def);
  }

  getDefinition(name: string): TableDefinition | undefined {
    return this.definitions.get(name);
  }

  getDefinitions(): Map<string, TableDefinition> {
    return this.definitions;
  }
}
