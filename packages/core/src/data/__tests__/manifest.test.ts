import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Manifest } from '../render/manifest.js';

describe('Manifest', () => {
  let tmpDir: string;
  let manifestPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-test-'));
    manifestPath = path.join(tmpDir, '.lattice', 'manifest.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('load returns empty object when file missing', () => {
    const manifest = new Manifest(manifestPath);
    const data = manifest.load();
    expect(data).toEqual({});
  });

  it('save + load round trip', () => {
    const manifest = new Manifest(manifestPath);
    manifest.load();
    const data = {
      users: ['/path/to/alice.md', '/path/to/bob.md'],
      posts: ['/path/to/post1.md'],
    };
    manifest.save(data);

    const manifest2 = new Manifest(manifestPath);
    const loaded = manifest2.load();
    expect(loaded).toEqual(data);
  });

  it('getFiles returns empty array for unknown key', () => {
    const manifest = new Manifest(manifestPath);
    manifest.load();
    expect(manifest.getFiles('unknown')).toEqual([]);
  });

  it('setFiles updates key in manifest', () => {
    const manifest = new Manifest(manifestPath);
    manifest.load();
    manifest.setFiles('items', ['a.md', 'b.md']);
    expect(manifest.getFiles('items')).toEqual(['a.md', 'b.md']);
  });

  it('cleanup removes orphaned files not in currentFiles and not protected', () => {
    const manifest = new Manifest(manifestPath);
    manifest.load();

    // Create some actual files to delete
    const fileA = path.join(tmpDir, 'a.md');
    const fileB = path.join(tmpDir, 'b.md');
    const fileC = path.join(tmpDir, 'c.md');
    fs.writeFileSync(fileA, 'a', 'utf-8');
    fs.writeFileSync(fileB, 'b', 'utf-8');
    fs.writeFileSync(fileC, 'c', 'utf-8');

    // Set initial manifest
    manifest.setFiles('items', [fileA, fileB, fileC]);
    manifest.save({ items: [fileA, fileB, fileC] });

    // Reload and cleanup: only fileA is current, fileC is protected, fileB should be deleted
    const manifest2 = new Manifest(manifestPath);
    manifest2.load();
    manifest2.cleanup('items', [fileA], [fileC]);

    expect(fs.existsSync(fileA)).toBe(true);  // current — kept
    expect(fs.existsSync(fileB)).toBe(false); // not current, not protected — deleted
    expect(fs.existsSync(fileC)).toBe(true);  // protected — kept
  });

  it('cleanup does not throw when file already missing', () => {
    const manifest = new Manifest(manifestPath);
    manifest.load();
    manifest.setFiles('items', ['/nonexistent/path/file.md']);
    expect(() => {
      manifest.cleanup('items', [], []);
    }).not.toThrow();
  });
});
