# Lattice Gaps — Features Needed for Bot in a Box

Features that `latticesql` does not currently provide that Bot in a Box needs. These are worked around in the `DataStore` wrapper but should be built into Lattice natively.

## 1. `insertReturning(table, row): Row`

**Current behavior:** `insert()` returns the primary key string.
**Needed:** Return the full inserted row (including auto-generated id, default values, etc.).
**Workaround:** DataStore calls `insert()` then `get()` — two queries instead of one.
**Impact:** Every insert in the orchestrator does a redundant read.

## 2. `updateReturning(table, pk, changes): Row`

**Current behavior:** `update()` returns void.
**Needed:** Return the full updated row after applying changes.
**Workaround:** DataStore calls `update()` then `get()` — two queries instead of one.
**Impact:** Same as above — redundant reads on every update.

## 3. Post-init `migrate()` method

**Current behavior:** Migrations can only be passed to `init({ migrations })`.
**Needed:** A `migrate(migrations)` method callable after `init()`, for package-level schema changes applied at runtime (e.g., update hooks that add columns).
**Workaround:** DataStore uses `lattice.db` (raw escape hatch) to run migrations against the `__lattice_migrations` table directly.
**Impact:** Bypasses Lattice's migration tracking; fragile if Lattice changes its internal migration table format.

## 4. Schema-only table definitions (optional `render`/`outputFile`)

**Current behavior:** `define()` requires `render` and `outputFile` in its TypeScript interface.
**Needed:** Support table definitions that only create schema (columns, constraints) without any file rendering. Many tables (tasks, runs, cost_events, etc.) are purely data — they don't need markdown output.
**Workaround:** DataStore passes a no-op render function and a dummy outputFile path.
**Impact:** Minor — dummy files would only be created if `render()` is called. But the TypeScript types are misleading.

## 5. Composite primary key support in `define()`

**Current behavior:** `primaryKey: ['col_a', 'col_b']` (array) is silently dropped — no PRIMARY KEY constraint is created on the table.
**Needed:** Composite primary keys should generate `PRIMARY KEY (col_a, col_b)` in the CREATE TABLE statement.
**Workaround:** DataStore detects array `primaryKey` and converts it to a `tableConstraints` entry.
**Impact:** Junction tables like `agent_skills` need composite PKs for correct uniqueness.

## 6. String-based migration versions

**Current behavior:** `__lattice_migrations` uses `version INTEGER PRIMARY KEY`.
**Needed:** Support string versions (e.g., `"@botinabox/core:1.1.0"`) for package-level migration tracking.
**Workaround:** DataStore uses a separate `__botinabox_migrations` table with `version TEXT PRIMARY KEY`.
**Impact:** Two migration tables in the same database; fragile if Lattice changes its migration internals.

## 7. `get()` returning `undefined` instead of `null`

**Current behavior:** `get()` returns `Row | null`.
**Needed:** `Row | undefined` is idiomatic TypeScript for "not found".
**Workaround:** DataStore maps `null` → `undefined`.
**Impact:** Trivial — one-line mapping. But worth considering for Lattice's API consistency.

---

## Non-gaps (already handled)

These features were duplicated in botinabox but Lattice already provides them:

- Schema definition via `define()` with columns, primaryKey, tableConstraints
- Full CRUD: insert, upsert, update, delete, get, query, count
- Query options: where, filters (eq/ne/gt/gte/lt/lte/like/in/isNull/isNotNull), orderBy, limit, offset
- Junction tables: link(), unlink()
- Entity context rendering: defineEntityContext() with self/hasMany/manyToMany/belongsTo/enriched/custom sources
- Seed with natural key upsert and soft-delete-missing
- Migration tracking via `__lattice_migrations`
- Security: sanitization, field length limits, audit events
- Markdown rendering: templates, manifest tracking
