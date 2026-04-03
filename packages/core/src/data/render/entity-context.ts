import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { SqliteAdapter } from '../sqlite-adapter.js';
import type { SchemaManager } from '../schema-manager.js';
import type { EntityContextDef, EntitySource, Filter, Row } from '../types.js';
import { renderTemplate } from './templates.js';

export class EntityContextRenderer {
  private readonly definitions = new Map<string, EntityContextDef>();

  constructor(
    private readonly adapter: SqliteAdapter,
    private readonly schema: SchemaManager,
    private readonly opts: { outputDir: string },
  ) {}

  define(name: string, def: EntityContextDef): void {
    this.definitions.set(name, def);
  }

  render(): void {
    for (const [, def] of this.definitions) {
      this._renderEntityContext(def);
    }
  }

  private _renderEntityContext(def: EntityContextDef): void {
    const rows = this.adapter.all<Row>(`SELECT * FROM ${def.table}`);

    const slugs: string[] = [];

    for (const row of rows) {
      const slug = String(row[def.slugColumn] ?? '');
      if (!slug) continue;

      slugs.push(slug);

      const entityDir = path.join(this.opts.outputDir, def.directory, slug);
      fs.mkdirSync(entityDir, { recursive: true });

      for (const [fileName, fileSpec] of Object.entries(def.files)) {
        const fileRows = this.resolveSource(fileSpec.source, row);

        if (fileSpec.omitIfEmpty && fileRows.length === 0) continue;

        const content = renderTemplate(fileSpec.render, fileRows);
        const filePath = path.join(entityDir, fileName);

        // Hash-skip
        const existingHash = this._hashFile(filePath);
        const newHash = this._hashContent(content);
        if (existingHash !== newHash) {
          const tmpPath = `${filePath}.tmp`;
          fs.writeFileSync(tmpPath, content, 'utf-8');
          fs.renameSync(tmpPath, filePath);
        }
      }
    }

    // Write index file if defined
    if (def.indexFile) {
      const indexPath = path.join(this.opts.outputDir, def.directory, def.indexFile);
      const content = slugs.map(s => `- ${s}`).join('\n') + (slugs.length > 0 ? '\n' : '');
      const existingHash = this._hashFile(indexPath);
      const newHash = this._hashContent(content);
      if (existingHash !== newHash) {
        const tmpPath = `${indexPath}.tmp`;
        fs.writeFileSync(tmpPath, content, 'utf-8');
        fs.renameSync(tmpPath, indexPath);
      }
    }
  }

  resolveSource(source: EntitySource, row: Row): Row[] {
    switch (source.type) {
      case 'self':
        return [row];

      case 'hasMany': {
        const { table, foreignKey, filters, orderBy, limit, softDelete } = source;
        let sql = `SELECT * FROM ${table} WHERE ${foreignKey} = ?`;
        const params: unknown[] = [row['id']];

        if (softDelete) {
          sql += ` AND deleted_at IS NULL`;
        }

        if (filters && filters.length > 0) {
          for (const f of filters) {
            sql += ` AND ${this._filterClause(f)}`;
            if (f.op !== 'isNull' && f.op !== 'isNotNull') {
              if (f.op === 'in') {
                params.push(...(f.val as unknown[]));
              } else {
                params.push(f.val);
              }
            }
          }
        }

        if (orderBy) sql += ` ORDER BY ${orderBy}`;
        if (limit !== undefined) sql += ` LIMIT ${limit}`;

        return this.adapter.all<Row>(sql, params);
      }

      case 'manyToMany': {
        const { junctionTable, localKey, remoteKey, remoteTable, filters, orderBy, limit } = source;
        let sql = `SELECT r.* FROM ${remoteTable} r
          INNER JOIN ${junctionTable} j ON j.${remoteKey} = r.id
          WHERE j.${localKey} = ?`;
        const params: unknown[] = [row['id']];

        if (filters && filters.length > 0) {
          for (const f of filters) {
            sql += ` AND r.${this._filterClause(f)}`;
            if (f.op !== 'isNull' && f.op !== 'isNotNull') {
              if (f.op === 'in') {
                params.push(...(f.val as unknown[]));
              } else {
                params.push(f.val);
              }
            }
          }
        }

        if (orderBy) sql += ` ORDER BY r.${orderBy}`;
        if (limit !== undefined) sql += ` LIMIT ${limit}`;

        return this.adapter.all<Row>(sql, params);
      }

      case 'belongsTo': {
        const { table, foreignKey } = source;
        const fkVal = row[foreignKey];
        if (fkVal == null) return [];
        const related = this.adapter.get<Row>(`SELECT * FROM ${table} WHERE id = ?`, [fkVal]);
        return related ? [related] : [];
      }

      case 'enriched': {
        const result: Row = { ...row };
        for (const [key, subSource] of Object.entries(source.include)) {
          result[key] = this.resolveSource(subSource, row);
        }
        return [result];
      }

      case 'custom':
        return source.resolve(row, this.adapter as unknown as import('../types.js').SqliteAdapter);
    }
  }

  private _filterClause(f: Filter): string {
    switch (f.op) {
      case 'eq': return `${f.col} = ?`;
      case 'ne': return `${f.col} != ?`;
      case 'gt': return `${f.col} > ?`;
      case 'gte': return `${f.col} >= ?`;
      case 'lt': return `${f.col} < ?`;
      case 'lte': return `${f.col} <= ?`;
      case 'like': return `${f.col} LIKE ?`;
      case 'in': return `${f.col} IN (${(f.val as unknown[]).map(() => '?').join(',')})`;
      case 'isNull': return `${f.col} IS NULL`;
      case 'isNotNull': return `${f.col} IS NOT NULL`;
    }
  }

  private _hashFile(filePath: string): string | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return this._hashContent(content);
    } catch {
      return null;
    }
  }

  private _hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }
}
