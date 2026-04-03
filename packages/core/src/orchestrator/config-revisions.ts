import type { DataStore } from '../data/data-store.js';

/**
 * Creates a config revision record with before/after snapshots.
 * Note: uses config_revisions table with config_yaml storing JSON of {agentId, before, after}.
 */
export async function createConfigRevision(
  db: DataStore,
  agentId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Promise<void> {
  // Get the current max version for this agent and increment
  const existing = db.query('config_revisions', {
    where: { notes: agentId },
  });
  const version = existing.length + 1;

  db.insert('config_revisions', {
    version,
    config_yaml: JSON.stringify({ agentId, before, after }),
    applied_by: agentId,
    notes: agentId,
  });
}
