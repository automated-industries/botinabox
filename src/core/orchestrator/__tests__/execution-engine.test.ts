import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { formatContextFilesBlock, type ContextFile, registerExecutionEngine } from '../execution-engine.js';
import { DataStore } from '../../data/data-store.js';
import { HookBus } from '../../hooks/hook-bus.js';
import { defineCoreTables } from '../../data/core-schema.js';
import { RunManager } from '../run-manager.js';

describe('formatContextFilesBlock', () => {
  it('returns empty string for undefined input', () => {
    expect(formatContextFilesBlock(undefined as unknown as ContextFile[])).toBe('');
  });

  it('returns empty string for an empty array', () => {
    expect(formatContextFilesBlock([])).toBe('');
  });

  it('wraps a single file in <file> XML tags', () => {
    const out = formatContextFilesBlock([
      { path: '/a/b.md', content: 'hello' },
    ]);
    expect(out).toBe('<file path="/a/b.md">\nhello\n</file>');
  });

  it('joins multiple files with blank lines between them', () => {
    const out = formatContextFilesBlock([
      { path: '/a.md', content: 'first' },
      { path: '/b.md', content: 'second' },
    ]);
    expect(out).toBe(
      '<file path="/a.md">\nfirst\n</file>\n\n<file path="/b.md">\nsecond\n</file>',
    );
  });

  it('preserves the order of the input', () => {
    const out = formatContextFilesBlock([
      { path: '/z.md', content: 'z' },
      { path: '/a.md', content: 'a' },
      { path: '/m.md', content: 'm' },
    ]);
    expect(out.indexOf('/z.md')).toBeLessThan(out.indexOf('/a.md'));
    expect(out.indexOf('/a.md')).toBeLessThan(out.indexOf('/m.md'));
  });

  it('preserves multi-line content verbatim', () => {
    const out = formatContextFilesBlock([
      { path: '/rules.md', content: '## Rule 1\nBe nice.\n\n## Rule 2\nBe terse.' },
    ]);
    expect(out).toContain('## Rule 1\nBe nice.\n\n## Rule 2\nBe terse.');
  });

  it('does not escape or transform content', () => {
    // Angle brackets and quotes in content pass through as-is. Callers are
    // responsible for any escaping their prompt format requires.
    const out = formatContextFilesBlock([
      { path: '/x.md', content: '<script>alert("hi")</script>' },
    ]);
    expect(out).toContain('<script>alert("hi")</script>');
  });

  it('does not trim whitespace from content', () => {
    const out = formatContextFilesBlock([
      { path: '/x.md', content: '  spaced  ' },
    ]);
    expect(out).toBe('<file path="/x.md">\n  spaced  \n</file>');
  });
});

describe('registerExecutionEngine — resolveModel', () => {
  let db: DataStore;
  let hooks: HookBus;
  let runs: RunManager;

  beforeEach(async () => {
    db = new DataStore({ dbPath: ':memory:' });
    defineCoreTables(db);
    await db.init();
    hooks = new HookBus();
    runs = new RunManager(db, hooks);
  });

  afterEach(() => {
    db.close();
  });

  it('uses resolveModel return value as the model for the LLM call', async () => {
    // Seed agent and task
    await db.insert('agents', { id: 'a1', slug: 'search-agent', name: 'Search', role: 'search', adapter: 'api' });
    await db.insert('tasks', { id: 't1', title: 'Find files', assignee_id: 'a1', status: 'todo' });

    let capturedModel: string | undefined;
    const mockClient = {
      messages: {
        create: async (params: Record<string, unknown>) => {
          capturedModel = params.model as string;
          return {
            content: [{ type: 'text', text: 'Found 3 files' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        },
      },
    };

    await registerExecutionEngine({
      db, hooks, runs,
      config: {
        client: mockClient,
        model: 'claude-sonnet-4-20250514',
        includeSystemContext: false,
        resolveModel: ({ agent }) => {
          if (agent.role === 'search') return 'claude-haiku-4-5-20251001';
          return undefined; // fall back to global
        },
      },
    });

    // Emit task.created to trigger execution
    await hooks.emit('task.created', { id: 't1' });

    // Wait for async execution
    await new Promise(r => setTimeout(r, 50));

    expect(capturedModel).toBe('claude-haiku-4-5-20251001');

    // Verify the model was recorded in the run
    const completedRuns = await db.query('runs', { where: { task_id: 't1' } });
    expect(completedRuns[0]?.['model']).toBe('claude-haiku-4-5-20251001');
  });

  it('falls back to global model when resolveModel returns undefined', async () => {
    await db.insert('agents', { id: 'a2', slug: 'engineer', name: 'Engineer', role: 'engineer', adapter: 'api' });
    await db.insert('tasks', { id: 't2', title: 'Build feature', assignee_id: 'a2', status: 'todo' });

    let capturedModel: string | undefined;
    const mockClient = {
      messages: {
        create: async (params: Record<string, unknown>) => {
          capturedModel = params.model as string;
          return {
            content: [{ type: 'text', text: 'Done' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        },
      },
    };

    await registerExecutionEngine({
      db, hooks, runs,
      config: {
        client: mockClient,
        model: 'claude-sonnet-4-20250514',
        includeSystemContext: false,
        resolveModel: () => undefined,
      },
    });

    await hooks.emit('task.created', { id: 't2' });
    await new Promise(r => setTimeout(r, 50));

    expect(capturedModel).toBe('claude-sonnet-4-20250514');
  });
});

describe('registerExecutionEngine — cacheSystemPrompt', () => {
  let db: DataStore;
  let hooks: HookBus;
  let runs: RunManager;

  beforeEach(async () => {
    db = new DataStore({ dbPath: ':memory:' });
    defineCoreTables(db);
    await db.init();
    hooks = new HookBus();
    runs = new RunManager(db, hooks);
  });

  afterEach(() => {
    db.close();
  });

  it('sends system as a plain string by default', async () => {
    await db.insert('agents', { id: 'a1', slug: 'plain', name: 'Plain', role: 'engineer', adapter: 'api' });
    await db.insert('tasks', { id: 't1', title: 'Do it', assignee_id: 'a1', status: 'todo' });

    let capturedSystem: unknown;
    const mockClient = {
      messages: {
        create: async (params: Record<string, unknown>) => {
          capturedSystem = params.system;
          return {
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      },
    };

    await registerExecutionEngine({
      db, hooks, runs,
      config: {
        client: mockClient,
        model: 'claude-sonnet-4-20250514',
        includeSystemContext: false,
      },
    });

    await hooks.emit('task.created', { id: 't1' });
    await new Promise(r => setTimeout(r, 50));

    expect(typeof capturedSystem).toBe('string');
    expect(capturedSystem as string).toContain('You are Plain');
  });

  it('sends system as a single ephemeral cache block when cacheSystemPrompt is true', async () => {
    await db.insert('agents', { id: 'a2', slug: 'cached', name: 'Cached', role: 'engineer', adapter: 'api' });
    await db.insert('tasks', { id: 't2', title: 'Do it', assignee_id: 'a2', status: 'todo' });

    let capturedSystem: unknown;
    const mockClient = {
      messages: {
        create: async (params: Record<string, unknown>) => {
          capturedSystem = params.system;
          return {
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      },
    };

    await registerExecutionEngine({
      db, hooks, runs,
      config: {
        client: mockClient,
        model: 'claude-sonnet-4-20250514',
        includeSystemContext: false,
        cacheSystemPrompt: true,
      },
    });

    await hooks.emit('task.created', { id: 't2' });
    await new Promise(r => setTimeout(r, 50));

    expect(Array.isArray(capturedSystem)).toBe(true);
    const blocks = capturedSystem as Array<{ type: string; text: string; cache_control: { type: string } }>;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('text');
    expect(blocks[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(blocks[0]!.text).toContain('You are Cached');
  });

  it('sends system as a plain string when cacheSystemPrompt is explicitly false', async () => {
    await db.insert('agents', { id: 'a3', slug: 'opt-out', name: 'OptOut', role: 'engineer', adapter: 'api' });
    await db.insert('tasks', { id: 't3', title: 'Do it', assignee_id: 'a3', status: 'todo' });

    let capturedSystem: unknown;
    const mockClient = {
      messages: {
        create: async (params: Record<string, unknown>) => {
          capturedSystem = params.system;
          return {
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      },
    };

    await registerExecutionEngine({
      db, hooks, runs,
      config: {
        client: mockClient,
        model: 'claude-sonnet-4-20250514',
        includeSystemContext: false,
        cacheSystemPrompt: false,
      },
    });

    await hooks.emit('task.created', { id: 't3' });
    await new Promise(r => setTimeout(r, 50));

    expect(typeof capturedSystem).toBe('string');
  });
});
