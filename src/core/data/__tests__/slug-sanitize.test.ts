/**
 * Entity-context slugs are rendered as filesystem path segments. A slug derived
 * from user/synced data (e.g. a contact or deal name) can contain "/" or "..".
 * The slug function must SANITIZE those characters, not throw — one bad row
 * must not fail the entire render. Clean slugs (UUIDs, slug columns) are
 * returned unchanged.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataStore } from '../data-store.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeOut(): string {
  const d = mkdtempSync(join(tmpdir(), 'bib-slug-'));
  dirs.push(d);
  return d;
}

async function setup(out: string): Promise<DataStore> {
  const db = new DataStore({ dbPath: ':memory:', outputDir: out });
  db.define('deals', { columns: { id: 'TEXT PRIMARY KEY', name: 'TEXT' } });
  db.defineEntityContext('deals', {
    table: 'deals',
    directory: 'deals',
    slugColumn: 'name',
    files: {
      'DEAL.md': {
        source: { type: 'self' },
        render: (rows: Array<Record<string, unknown>>) => `# ${String(rows[0]?.name ?? '')}`,
      },
    },
  });
  await db.init();
  return db;
}

describe('entity-context slug sanitization', () => {
  it('sanitizes "/" instead of throwing, and renders every row', async () => {
    const out = makeOut();
    const db = await setup(out);
    await db.insert('deals', { id: 'd1', name: 'Acme Corp / West Division' });
    await db.insert('deals', { id: 'd2', name: 'Clean Deal Name' });

    await db.render(); // must NOT throw on the "/" row

    const slugDirs = readdirSync(join(out, 'deals'));
    expect(slugDirs).toContain('Acme Corp - West Division'); // "/" → "-"
    expect(slugDirs).toContain('Clean Deal Name'); // clean slug unchanged
    db.close();
  });

  it('neutralizes "\\" and ".." parent-dir sequences', async () => {
    const out = makeOut();
    const db = await setup(out);
    await db.insert('deals', { id: 'd1', name: '..\\..\\etc\\passwd' });

    await db.render();

    const slugDirs = readdirSync(join(out, 'deals'));
    expect(
      slugDirs.every((d) => !d.includes('/') && !d.includes('\\') && !d.includes('..')),
    ).toBe(true);
    db.close();
  });
});
