import type { CrudOps } from './crud.js';
import type { SqliteAdapter } from './sqlite-adapter.js';
import { link } from './junction.js';
import type { Row, SeedItem } from './types.js';

export async function seed(ops: CrudOps, junctionAdapter: SqliteAdapter, items: SeedItem[]): Promise<void> {
  for (const item of items) {
    const { table, rows, naturalKey, junctions, softDeleteMissing } = item;

    const insertedIds: unknown[] = [];

    for (const row of rows) {
      let inserted: Row;

      if (naturalKey) {
        // Build pk lookup from naturalKey
        const keys = Array.isArray(naturalKey) ? naturalKey : [naturalKey];
        const pkLookup: Row = {};
        for (const k of keys) {
          pkLookup[k] = row[k];
        }

        // Check if exists
        const existing = ops.query(table, { where: pkLookup });
        if (existing.length > 0) {
          // Update existing
          inserted = ops.update(table, pkLookup, row);
        } else {
          inserted = ops.insert(table, row);
        }
      } else {
        inserted = ops.insert(table, row);
      }

      if (inserted['id'] !== undefined) {
        insertedIds.push(inserted['id']);
      }
    }

    // Handle softDeleteMissing
    if (softDeleteMissing) {
      // Check if deleted_at column exists
      const info = junctionAdapter.tableInfo(table);
      const hasDeletedAt = info.some(c => c.name === 'deleted_at');

      if (hasDeletedAt) {
        // Get all rows not in seed
        const allRows = ops.query(table);
        const seedIds = new Set(insertedIds.map(String));

        for (const existingRow of allRows) {
          const rowId = String(existingRow['id']);
          if (!seedIds.has(rowId) && existingRow['deleted_at'] == null) {
            ops.update(table, rowId, { deleted_at: Date.now() });
          }
        }
      }
    }

    // Handle junctions
    if (junctions) {
      for (const junction of junctions) {
        for (const jRow of junction.items) {
          link(junctionAdapter, junction.table, jRow);
        }
      }
    }
  }
}
