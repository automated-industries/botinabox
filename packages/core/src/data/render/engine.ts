import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { SqliteAdapter } from '../sqlite-adapter.js';
import type { SchemaManager } from '../schema-manager.js';
import { renderTemplate } from './templates.js';

export class RenderEngine {
  private readonly outputDir: string;
  private readonly manifestPath: string;

  constructor(
    private readonly adapter: SqliteAdapter,
    private readonly schema: SchemaManager,
    opts: { outputDir: string; manifestPath?: string },
  ) {
    this.outputDir = opts.outputDir;
    this.manifestPath = opts.manifestPath ?? path.join(opts.outputDir, '.lattice', 'manifest.json');
  }

  render(): void {
    fs.mkdirSync(this.outputDir, { recursive: true });

    for (const [tableName, def] of this.schema.getDefinitions()) {
      if (!def.outputFile) continue;

      // Query all rows
      let rows = this.adapter.all(`SELECT * FROM ${tableName}`);

      // Apply filter if defined
      if (def.filter) {
        rows = def.filter(rows);
      }

      // Render content
      const template = def.render ?? 'default-list';
      const content = renderTemplate(template, rows);

      // Determine output path
      const outputPath = path.isAbsolute(def.outputFile)
        ? def.outputFile
        : path.join(this.outputDir, def.outputFile);

      // Hash-skip: only write if content changed
      const existingHash = this.hashFile(outputPath);
      const newHash = this.hashContent(content);

      if (existingHash !== newHash) {
        const tmpPath = `${outputPath}.tmp`;
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(tmpPath, content, 'utf-8');
        fs.renameSync(tmpPath, outputPath);
      }
    }
  }

  hashFile(filePath: string): string | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return this.hashContent(content);
    } catch {
      return null;
    }
  }

  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }
}
