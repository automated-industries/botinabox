import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SqliteAdapter } from '../sqlite-adapter.js';
import { SchemaManager } from '../schema-manager.js';
import { CrudOps } from '../crud.js';
import { EntityContextRenderer } from '../render/entity-context.js';

function makeSetup(tmpDir: string) {
  const adapter = new SqliteAdapter(':memory:');
  adapter.open();
  const schema = new SchemaManager(adapter);
  schema.define('users', {
    columns: {
      id: 'TEXT PRIMARY KEY',
      slug: 'TEXT NOT NULL',
      name: 'TEXT',
    },
  });
  schema.define('posts', {
    columns: {
      id: 'TEXT PRIMARY KEY',
      user_id: 'TEXT NOT NULL',
      title: 'TEXT NOT NULL',
    },
  });
  schema.define('tags', {
    columns: {
      id: 'TEXT PRIMARY KEY',
      name: 'TEXT NOT NULL',
    },
  });
  schema.define('user_tags', {
    columns: {
      user_id: 'TEXT NOT NULL',
      tag_id: 'TEXT NOT NULL',
    },
  });
  schema.init();
  const ops = new CrudOps(adapter, schema);
  const renderer = new EntityContextRenderer(adapter, schema, { outputDir: tmpDir });
  return { adapter, schema, ops, renderer };
}

describe('EntityContextRenderer', () => {
  let tmpDir: string;
  let adapter: SqliteAdapter;
  let ops: CrudOps;
  let renderer: EntityContextRenderer;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-context-test-'));
    ({ adapter, ops, renderer } = makeSetup(tmpDir));
  });

  afterEach(() => {
    adapter.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates subdirectory per entity row', () => {
    ops.insert('users', { id: 'u1', slug: 'alice', name: 'Alice' });
    ops.insert('users', { id: 'u2', slug: 'bob', name: 'Bob' });

    renderer.define('users', {
      table: 'users',
      directory: 'users',
      slugColumn: 'slug',
      files: {
        'PROFILE.md': {
          source: { type: 'self' },
          render: (rows) => `# ${rows[0]?.['name'] ?? 'Unknown'}\n`,
        },
      },
    });

    renderer.render();

    expect(fs.existsSync(path.join(tmpDir, 'users', 'alice', 'PROFILE.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'users', 'bob', 'PROFILE.md'))).toBe(true);

    const aliceProfile = fs.readFileSync(path.join(tmpDir, 'users', 'alice', 'PROFILE.md'), 'utf-8');
    expect(aliceProfile).toContain('Alice');
  });

  it('renders hasMany source', () => {
    ops.insert('users', { id: 'u1', slug: 'alice', name: 'Alice' });
    ops.insert('posts', { id: 'p1', user_id: 'u1', title: 'Post One' });
    ops.insert('posts', { id: 'p2', user_id: 'u1', title: 'Post Two' });

    renderer.define('users', {
      table: 'users',
      directory: 'users',
      slugColumn: 'slug',
      files: {
        'POSTS.md': {
          source: { type: 'hasMany', table: 'posts', foreignKey: 'user_id' },
          render: (rows) => rows.map(r => `- ${r['title']}`).join('\n') + '\n',
        },
      },
    });

    renderer.render();

    const postsFile = fs.readFileSync(path.join(tmpDir, 'users', 'alice', 'POSTS.md'), 'utf-8');
    expect(postsFile).toContain('Post One');
    expect(postsFile).toContain('Post Two');
  });

  it('renders manyToMany source', () => {
    ops.insert('users', { id: 'u1', slug: 'alice', name: 'Alice' });
    adapter.run("INSERT INTO tags (id, name) VALUES ('t1', 'developer')");
    adapter.run("INSERT INTO tags (id, name) VALUES ('t2', 'writer')");
    adapter.run("INSERT INTO user_tags (user_id, tag_id) VALUES ('u1', 't1')");
    adapter.run("INSERT INTO user_tags (user_id, tag_id) VALUES ('u1', 't2')");

    renderer.define('users', {
      table: 'users',
      directory: 'users',
      slugColumn: 'slug',
      files: {
        'TAGS.md': {
          source: {
            type: 'manyToMany',
            junctionTable: 'user_tags',
            localKey: 'user_id',
            remoteKey: 'tag_id',
            remoteTable: 'tags',
          },
          render: 'default-list',
        },
      },
    });

    renderer.render();

    const tagsFile = fs.readFileSync(path.join(tmpDir, 'users', 'alice', 'TAGS.md'), 'utf-8');
    expect(tagsFile).toContain('developer');
    expect(tagsFile).toContain('writer');
  });

  it('renders index file when indexFile is defined', () => {
    ops.insert('users', { id: 'u1', slug: 'alice', name: 'Alice' });
    ops.insert('users', { id: 'u2', slug: 'bob', name: 'Bob' });

    renderer.define('users', {
      table: 'users',
      directory: 'users',
      slugColumn: 'slug',
      files: {},
      indexFile: 'INDEX.md',
    });

    renderer.render();

    const indexFile = fs.readFileSync(path.join(tmpDir, 'users', 'INDEX.md'), 'utf-8');
    expect(indexFile).toContain('alice');
    expect(indexFile).toContain('bob');
  });
});
