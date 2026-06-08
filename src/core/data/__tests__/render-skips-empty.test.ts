/**
 * Pass-through test for the `renderSkipsEmpty` DataStore option. botinabox's
 * DataStore is a thin wrapper; this verifies the flag reaches latticesql's
 * `renderSkipsEmpty`, so a spec-less table (no render → empty
 * `.schema-only/<table>.md`) is neither scanned nor written when the option is
 * on, and the original behavior (empty file written) is preserved when off.
 * The runtime skip behavior itself is owned by latticesql's own tests.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataStore } from '../data-store.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeOut(): string {
  const d = mkdtempSync(join(tmpdir(), 'bib-rse-'));
  dirs.push(d);
  return d;
}

function define(db: DataStore): void {
  // Table WITH a render spec → renders normally.
  db.define('notes', {
    columns: { id: 'TEXT PRIMARY KEY', body: 'TEXT' },
    render: (rows) => rows.map((r) => `- ${String(r.body)}`).join('\n'),
    outputFile: 'NOTES.md',
  });
  // Spec-less table → no-op render → empty .schema-only/note_tags.md.
  db.define('note_tags', { columns: { note_id: 'TEXT', tag: 'TEXT' } });
}

describe('renderSkipsEmpty pass-through', () => {
  it('renderSkipsEmpty: true → spec-less table is not written; real render unaffected', async () => {
    const out = makeOut();
    const db = new DataStore({ dbPath: ':memory:', outputDir: out, renderSkipsEmpty: true });
    define(db);
    await db.init();
    await db.insert('notes', { id: 'n1', body: 'hi' });

    await db.render();

    expect(existsSync(join(out, 'NOTES.md'))).toBe(true);
    expect(existsSync(join(out, '.schema-only', 'note_tags.md'))).toBe(false);
    db.close();
  });

  it('default (omitted) → spec-less table still writes its empty schema-only file', async () => {
    const out = makeOut();
    const db = new DataStore({ dbPath: ':memory:', outputDir: out });
    define(db);
    await db.init();
    await db.insert('notes', { id: 'n1', body: 'hi' });

    await db.render();

    expect(existsSync(join(out, 'NOTES.md'))).toBe(true);
    expect(existsSync(join(out, '.schema-only', 'note_tags.md'))).toBe(true);
    db.close();
  });
});
