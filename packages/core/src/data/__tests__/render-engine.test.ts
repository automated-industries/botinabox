import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SqliteAdapter } from '../sqlite-adapter.js';
import { SchemaManager } from '../schema-manager.js';
import { CrudOps } from '../crud.js';
import { RenderEngine } from '../render/engine.js';

function makeSetup(tmpDir: string) {
  const adapter = new SqliteAdapter(':memory:');
  adapter.open();
  const schema = new SchemaManager(adapter);
  schema.define('items', {
    columns: {
      id: 'TEXT PRIMARY KEY',
      name: 'TEXT NOT NULL',
    },
    outputFile: 'items.md',
    render: 'default-list',
  });
  schema.init();
  const ops = new CrudOps(adapter, schema);
  const engine = new RenderEngine(adapter, schema, { outputDir: tmpDir });
  return { adapter, schema, ops, engine };
}

describe('RenderEngine', () => {
  let tmpDir: string;
  let adapter: SqliteAdapter;
  let ops: CrudOps;
  let engine: RenderEngine;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-engine-test-'));
    ({ adapter, ops, engine } = makeSetup(tmpDir));
  });

  afterEach(() => {
    adapter.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('renders markdown to file', () => {
    ops.insert('items', { id: 'i1', name: 'Alpha' });
    ops.insert('items', { id: 'i2', name: 'Beta' });
    engine.render();

    const content = fs.readFileSync(path.join(tmpDir, 'items.md'), 'utf-8');
    expect(content).toContain('- Alpha');
    expect(content).toContain('- Beta');
  });

  it('hash-skip: file not rewritten if content unchanged (mtime stability)', () => {
    ops.insert('items', { id: 'i1', name: 'Alpha' });
    engine.render();

    const filePath = path.join(tmpDir, 'items.md');
    const mtime1 = fs.statSync(filePath).mtimeMs;

    // Wait a tiny bit then render again with same data
    // Use a sync sleep to ensure time passes
    const start = Date.now();
    while (Date.now() - start < 50) { /* busy wait */ }

    engine.render();
    const mtime2 = fs.statSync(filePath).mtimeMs;

    expect(mtime1).toBe(mtime2);
  });

  it('renders with custom template function', () => {
    const customAdapter = new SqliteAdapter(':memory:');
    customAdapter.open();
    const customSchema = new SchemaManager(customAdapter);
    customSchema.define('products', {
      columns: {
        id: 'TEXT PRIMARY KEY',
        name: 'TEXT NOT NULL',
        price: 'INTEGER',
      },
      outputFile: 'products.md',
      render: (rows) => rows.map(r => `## ${r['name']} — $${r['price']}\n`).join(''),
    });
    customSchema.init();
    const customOps = new CrudOps(customAdapter, customSchema);
    const customEngine = new RenderEngine(customAdapter, customSchema, { outputDir: tmpDir });

    customOps.insert('products', { name: 'Widget', price: 9 });
    customOps.insert('products', { name: 'Gadget', price: 19 });
    customEngine.render();

    const content = fs.readFileSync(path.join(tmpDir, 'products.md'), 'utf-8');
    expect(content).toContain('## Widget — $9');
    expect(content).toContain('## Gadget — $19');

    customAdapter.close();
  });

  it('hashFile returns null for non-existent file', () => {
    const hash = engine.hashFile(path.join(tmpDir, 'nonexistent.md'));
    expect(hash).toBeNull();
  });

  it('hashFile returns consistent hash for existing file', () => {
    const filePath = path.join(tmpDir, 'test.md');
    fs.writeFileSync(filePath, 'hello world', 'utf-8');
    const hash1 = engine.hashFile(filePath);
    const hash2 = engine.hashFile(filePath);
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBeNull();
  });
});
