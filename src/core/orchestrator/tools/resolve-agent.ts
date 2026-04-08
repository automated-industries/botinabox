/**
 * Shared agent resolution: slug → role → name (case-insensitive).
 *
 * LLMs see list_agents output like "AgentName (role)" and naturally use
 * the role as the identifier. All agent-resolving tools must accept
 * slug, role, OR name — not just slug.
 */
import type { DataStore } from '../../data/data-store.js';

export async function resolveAgent(
  db: DataStore,
  ref: string,
): Promise<Record<string, unknown> | null> {
  // 1. Exact slug match (fastest, most specific)
  const bySlug = await db.query('agents', { where: { slug: ref } });
  if (bySlug[0] && !bySlug[0].deleted_at) return bySlug[0];

  // 2. Exact role match
  const byRole = await db.query('agents', { where: { role: ref } });
  const activeByRole = byRole.find(a => !a.deleted_at);
  if (activeByRole) return activeByRole;

  // 3. Exact name match
  const byName = await db.query('agents', { where: { name: ref } });
  const activeByName = byName.find(a => !a.deleted_at);
  if (activeByName) return activeByName;

  // 4. Case-insensitive fallback (handles "Engineer" vs "engineer")
  const lower = ref.toLowerCase();
  const all = await db.query('agents');
  return all.find(a =>
    !a.deleted_at && (
      (a.slug as string)?.toLowerCase() === lower ||
      (a.role as string)?.toLowerCase() === lower ||
      (a.name as string)?.toLowerCase() === lower
    ),
  ) ?? null;
}
