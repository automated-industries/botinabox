/**
 * End-to-end test for the rewardTracking + reward() pass-through to
 * latticesql. botinabox's DataStore is a thin wrapper; this test verifies
 * that:
 *
 *  - `rewardTracking: true` on a TableDefinition reaches latticesql, which
 *    auto-adds the `_reward_total` / `_reward_count` columns.
 *  - `pruneBelow` is also forwarded (verified at the wrapper level — the
 *    runtime pruning behavior is owned by latticesql's own tests).
 *  - `DataStore.reward(table, id, scores)` delegates to `Lattice.reward()`
 *    and the running average + count update as documented.
 *  - Calling `reward()` on a table without `rewardTracking` throws the
 *    expected error from latticesql.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataStore } from '../data-store.js';

let db: DataStore;

beforeEach(() => {
  db = new DataStore({ dbPath: ':memory:' });
});

afterEach(() => {
  db.close();
});

describe('rewardTracking pass-through', () => {
  it('adds _reward_total + _reward_count columns when rewardTracking is true', async () => {
    db.define('memos', {
      columns: { id: 'TEXT PRIMARY KEY', content: 'TEXT' },
      rewardTracking: true,
    });
    await db.init();
    const cols = db.tableInfo('memos').map((c) => c.name);
    expect(cols).toContain('_reward_total');
    expect(cols).toContain('_reward_count');
  });

  it('does NOT add reward columns when rewardTracking is omitted', async () => {
    db.define('plain', {
      columns: { id: 'TEXT PRIMARY KEY', content: 'TEXT' },
    });
    await db.init();
    const cols = db.tableInfo('plain').map((c) => c.name);
    expect(cols).not.toContain('_reward_total');
    expect(cols).not.toContain('_reward_count');
  });

  it('accepts pruneBelow without TS error (forwarding verified at compile time)', async () => {
    // If pruneBelow weren't on the wrapper TableDefinition, this would fail
    // tsc. The runtime pruning semantics are covered by latticesql's own
    // tests; here we just pin the wrapper passes the field through.
    db.define('memos', {
      columns: { id: 'TEXT PRIMARY KEY', content: 'TEXT', deleted_at: 'TEXT' },
      rewardTracking: true,
      pruneBelow: 0.3,
    });
    await db.init();
    expect(db.tableInfo('memos').map((c) => c.name)).toContain('_reward_total');
  });
});

describe('DataStore.reward()', () => {
  it('updates the running average across successive calls', async () => {
    db.define('memos', {
      columns: { id: 'TEXT PRIMARY KEY', content: 'TEXT' },
      rewardTracking: true,
    });
    await db.init();
    await db.insert('memos', { id: 'm1', content: 'hello' });

    await db.reward('memos', 'm1', { accuracy: 1.0 });
    let row = await db.get('memos', { id: 'm1' });
    expect(row?._reward_count).toBe(1);
    expect(row?._reward_total as number).toBeCloseTo(1.0, 5);

    await db.reward('memos', 'm1', { accuracy: 0.5 });
    row = await db.get('memos', { id: 'm1' });
    expect(row?._reward_count).toBe(2);
    // Running average of 1.0 and 0.5.
    expect(row?._reward_total as number).toBeCloseTo(0.75, 5);
  });

  it('averages multiple dimensions within a single call (latticesql semantic)', async () => {
    db.define('memos', {
      columns: { id: 'TEXT PRIMARY KEY', content: 'TEXT' },
      rewardTracking: true,
    });
    await db.init();
    await db.insert('memos', { id: 'm1', content: 'hello' });

    // Per latticesql docs: within one call the dimensions are averaged
    // (0.9 + 1.0) / 2 = 0.95; that becomes the value for this call.
    await db.reward('memos', 'm1', { relevance: 0.9, accuracy: 1.0 });
    const row = await db.get('memos', { id: 'm1' });
    expect(row?._reward_count).toBe(1);
    expect(row?._reward_total as number).toBeCloseTo(0.95, 5);
  });

  it('throws when called on a table without rewardTracking', async () => {
    db.define('plain', {
      columns: { id: 'TEXT PRIMARY KEY', content: 'TEXT' },
    });
    await db.init();
    await db.insert('plain', { id: 'p1', content: 'x' });
    await expect(
      db.reward('plain', 'p1', { accuracy: 1.0 }),
    ).rejects.toThrow(/rewardTracking/);
  });
});
