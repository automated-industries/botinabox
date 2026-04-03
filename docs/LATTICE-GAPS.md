# Lattice Gaps — Resolved in v0.17.0

All gaps identified during the botinabox lattice integration have been resolved in `latticesql@0.17.0`.

## Resolved

| Gap | Resolution |
|-----|-----------|
| `insertReturning(table, row)` | Added to Lattice v0.17.0. DataStore delegates directly. |
| `updateReturning(table, id, changes)` | Added to Lattice v0.17.0. DataStore delegates directly. |
| Post-init `migrate()` method | Added to Lattice v0.17.0. DataStore delegates directly. |
| Schema-only tables (optional render/outputFile) | `render` and `outputFile` now optional in `TableDefinition`. |
| Composite primary key auto-constraint | `primaryKey: ['a', 'b']` now auto-generates `PRIMARY KEY(...)`. |
| String-based migration versions | `Migration.version` now accepts `number \| string`. |
| `get()` returning null vs undefined | Minor — DataStore maps `null → undefined` (one-liner). |

## Remaining Workarounds

| Area | Workaround | Why |
|------|-----------|-----|
| Deferred CREATE INDEX | `tableConstraints` with `CREATE INDEX` statements are run after `init()` via raw DB access | Lattice treats all `tableConstraints` as inline table constraints; standalone SQL statements would cause syntax errors |
| `get()` null → undefined | DataStore maps `null` to `undefined` | Lattice returns `null` for not-found; botinabox convention is `undefined` |
| `upsert()` returning Row | Uses `upsert()` + `get()` (two queries) | Lattice has no `upsertReturning()` yet |
