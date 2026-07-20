# Changelog

All notable changes to `botinabox` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

---

## [2.16.56] — 2026-07-20

### Fixed

- Slack plain-text uploads (filetype `text`) were never enriched because the filetype
  was missing from the media-type map; now maps `text` to `doc` alongside `txt`, `md`,
  `docx`, and other document types.
- Attachment breadcrumbs in message bodies now distinguish three outcomes so LLMs can
  tell whether content was extracted: `[Attachment content — name]` for extracted text,
  `[Attachment could not be read: name]` for unreadable/failed-extraction attachments,
  and `[Attached (content not extracted): name]` for types with no registered enricher.
  Enricher failures are logged with the `[botinabox]` prefix instead of silently swallowed.

## [2.16.55] — 2026-06-25

### Changed

- Bump `latticesql` to `^4.3.8` — fault-isolates the open-time data-upgrade pass so a
  3.x-created cloud whose schema has drifted from 4.x always opens (the `files`
  reference-model backfill is now self-sufficient — adds its missing target columns
  before the backfill — and each sentinel-gated data-upgrade step is warned + skipped
  on failure instead of aborting the open). Additive for `botinabox` — verified
  (tests, typecheck, build).

## [2.16.54] — 2026-06-25

### Changed

- Bump `latticesql` to `^4.3.7` (the real Postgres-cloud upgrade-blocker fix: the
  legacy `deleted_at = '' -> NULL` open-time migration is now type-aware, so a cloud
  whose `deleted_at` is a `timestamptz` column no longer aborts the open on
  `''::timestamptz`; plus per-table fault isolation). Additive for `botinabox` —
  verified (tests, typecheck, build).

## [2.16.53] — 2026-06-25

### Changed

- Bump `latticesql` to `^4.3.6` (Postgres diagnostics: a failing query now appends
  `[lattice-sql] failing statement: <sql>` to its error, so a bare cast error names
  the query that produced it). Additive for `botinabox` — verified (tests,
  typecheck, build).

## [2.16.52] — 2026-06-25

### Changed

- Bump `latticesql` to `^4.3.5` (a desktop-only patch — the downloadable app now
  opens on Windows by falling back to the system browser when the embedded webview
  host can't start). No library API change vs 4.3.3; `botinabox` is unaffected at
  runtime. Verified (tests, typecheck, build).

## [2.16.51] — 2026-06-25

### Changed

- Bump `latticesql` to `^4.3.3` (patch: opening a 3.x-created Postgres cloud
  workspace on 4.x no longer aborts with `invalid input syntax for type timestamp
  with time zone: ""` — the SQLite-compat `strftime` polyfill now returns NULL for
  empty/invalid time strings instead of casting and throwing). Additive for
  `botinabox` — no API change; verified (tests, typecheck, build).

## [2.16.50] — 2026-06-25

### Changed

- Bump `latticesql` to `^4.3.2` (patch: the GUI Files sidebar's source roots are
  now scoped per-workspace instead of a single machine-global registry, fixing
  roots leaking across workspaces). Additive for `botinabox` — no API change
  here; verified (tests, typecheck, build) against the new patch.

## [2.16.49] — 2026-06-25

### Changed

- Bump `latticesql` to `^4.3.1` (patch: on-device voice-dictation backend fix,
  form-element rendering, Files-tree folder-expand persistence, Brain-Graph tab
  retitle guard, and a macOS `.pkg` download). Additive for `botinabox` — no API
  change here; the dependency is updated and verified (tests, typecheck, build)
  against the new patch.

## [2.16.48] — 2026-06-25

### Changed

- Bump `latticesql` to `^4.3.0` (the connectors + inline-HTML-files minor). Additive
  for `botinabox` — no API change here; the dependency is updated and verified
  (tests, typecheck, build) against the new minor.

## [2.16.47] — 2026-06-23

### Changed

- Bump `latticesql` to 4.2.2 — render-logic changes now force a one-time full
  re-render on first open after upgrade (via a render template-version bump), so
  the 4.2 symmetric many-to-many junction rendering auto-applies to workspaces
  rendered by an older version. Additive — no botinabox API changes.

## [2.16.46] — 2026-06-23

### Changed

- Bump `latticesql` to 4.2.1 — the local SQLite engine now self-heals a native
  `better-sqlite3` ABI mismatch (rebuilds for the current Node runtime and retries,
  silently) instead of crashing on a Node-runtime change. Additive — no botinabox
  API changes.

## [2.16.45] — 2026-06-22

### Changed

- Bump `latticesql` to 4.2.0 — the structured-source importer (drop a JSON/`.xlsx`
  into the assistant chat → schema inference, point-in-time snapshots, read-only
  views) plus retrieval/egress hardening (bounded reads, a failable retrieval-eval
  gate, an advisory SLO gate), per-recipient realtime delete-event scoping, and
  symmetric many-to-many rendering. Additive — no botinabox API changes.

## [2.16.44] — 2026-06-22

### Changed

- Bump `latticesql` to 4.1.0 — the retrieval & data substrate release (retrieval
  eval/health/benchmark, indexed + hybrid + graph search, governance, declarative
  computed columns, a fuller query surface, keyless cloud file-byte access) plus
  GUI render/reverse-sync fixes. Additive — no botinabox API changes.

## [2.16.43] — 2026-06-19

### Changed

- **Bump `latticesql` to ^4.0.0** (major). 4.0 keeps the `Lattice` data-layer API
  botinabox uses stable, and existing databases/configs are migrated forward silently
  on open, so this is a transparent dependency refresh: typecheck, build, and the full
  test suite (740 tests) are green against 4.0.0. 4.0 brings module decomposition, a
  much faster cloud workspace open, and silent backwards-compat auto-upgrade of 3.0+
  configs/data — none of which changes the surface botinabox depends on.

## [2.16.42] — 2026-06-19

### Changed

- **Bump `latticesql` to ^3.4.7.** Picks up the GUI fix that makes `lattice gui` a
  singleton (relaunching reuses the running instance instead of starting a duplicate
  on a fallback port) plus a backstop against an update-driven reload loop. No change
  to the data-layer API botinabox depends on — a dependency refresh (typecheck,
  build, and the full test suite are green against 3.4.7).

## [2.16.41] — 2026-06-19

### Changed

- **Bump `latticesql` to ^3.4.6.** A GUI-assistant fix: the assistant can now store
  a secret/credential via a new write-only `create_secret` tool (encrypted at rest,
  never able to read existing secret values). No change to the data-layer API
  botinabox depends on — a dependency refresh (typecheck, build, and the full test
  suite are green against 3.4.6).

## [2.16.40] — 2026-06-19

### Changed

- **Bump `latticesql` to ^3.4.5.** A GUI release: a manual "Update available —
  Upgrade" link next to the version indicator (force-update fallback to the
  auto-updater), a workspace with no active database can now be deleted (revert to
  the welcome screen), and the one-to-many `ref:` deprecation warnings were removed.
  No change to the data-layer API botinabox depends on — a dependency refresh
  (typecheck, build, and the full test suite are green against 3.4.5).

## [2.16.39] — 2026-06-18

### Changed

- **Bump `latticesql` to ^3.4.4.** A cloud + GUI fix release: members can add/edit/
  delete through the assistant, private uploads stay private end-to-end, OAuth wins
  over an API key (and Clear is authoritative), the open-time render no longer
  re-renders the whole tree, "share with specific people" batches into one save, and
  background auto-upgrade activates for real installs. No change to the data-layer API
  botinabox depends on — a dependency refresh (typecheck, build, and the full test
  suite are green against 3.4.4).

## [2.16.38] — 2026-06-18

### Changed

- **Bump `latticesql` to ^3.4.2.** A Lattice cloud hotfix: the GUI audit log
  (undo/redo + version history) is now scoped by row visibility (a member sees only
  the history of rows they can see), and a joined member now hydrates the owner's
  entity/render layout from the cloud so its context tree renders fully instead of
  empty. No change to the data-layer API botinabox depends on — a dependency
  refresh (typecheck, build, and the full test suite are green against 3.4.2).

## [2.16.37] — 2026-06-18

### Changed

- **Bump `latticesql` to ^3.4.1.** A security/availability hotfix in Lattice:
  assistant chats are now strictly per-author on a cloud (could previously leak to
  other members), the SQLite-compat polyfills no longer abort a member's render,
  and the background render is per-entity incremental. No change to the data-layer
  API botinabox depends on — a dependency refresh (typecheck, build, and the full
  test suite are green against 3.4.1).

## [2.16.36] — 2026-06-17

### Changed

- **Bump `latticesql` to ^3.4.0.** A feature release in Lattice: a self-updating
  GUI, file loopback (rendered-file edits flow back into the DB), per-viewer
  rendered cloud context, a fault-isolated cloud converge, full-text search on
  migrated clouds, and a concurrency-safe machine-local credential store. No
  change to the data-layer API botinabox depends on — a dependency refresh
  (typecheck, build, and the full test suite are green against 3.4.0).

## [2.16.35] — 2026-06-16

### Changed

- **Bump `latticesql` to ^3.3.3.** A cloud-provisioning hotfix in Lattice: an
  invited member's GUI no longer silently degrades to read-only — the member
  group now receives the GUI/identity bookkeeping grants + polyfill EXECUTE it
  needs, and migrated clouds get a `deleted_at` backfill, all on the converge
  path so existing clouds self-heal. No change to the data-layer API botinabox
  depends on — a dependency refresh.

## [2.16.34] — 2026-06-16

### Changed

- **Bump `latticesql` to ^3.3.2.** A GUI-layer patch in Lattice: the three
  per-tab Server-Sent-Event streams are multiplexed onto one WebSocket so a
  browser tab no longer exhausts the per-host connection limit (the GUI froze
  with more than one tab open); a cloud member no longer sees junction/link
  tables listed as objects; and a row shared with nobody reads as private. No
  change to the data-layer API botinabox depends on — a dependency refresh.

## [2.16.33] — 2026-06-16

### Changed

- **Bump `latticesql` to ^3.3.1.** A GUI-layer patch in Lattice (frame-first
  rendering so the workspace UI never freezes while loading data, a non-blocking
  workspace switch, and a bounded realtime-broker teardown). No change to the
  data-layer API botinabox depends on — a dependency refresh.

## [2.16.32] — 2026-06-16

### Changed

- **Bump `latticesql` to ^3.3.0.** Lattice 3.3 is a backward-compatible minor:
  assistant Markdown artifacts, self-describing schema (auto column/table
  definitions + tooltips), seamless de-duplication, workspace branding,
  first-run onboarding, a unified structured cloud-connection form, a realtime
  liveness watchdog, an optional per-row payload cap (`maxRowBytes`), and a
  durable source-key store — with no change to the stable Lattice core
  `botinabox` depends on (`new Lattice`, `init`, `upsert`, `get`, `delete`,
  `query`, `migrate`, `render`). Dependency refresh with no behavior change.
  Full test suite (740) passes against 3.3.0; build + typecheck clean.

## [2.16.31] — 2026-06-14

### Changed

- **Bump `latticesql` to ^3.2.0.** Lattice 3.2 is a backward-compatible minor:
  cloud invite/join/RLS/realtime hardening and GUI improvements, with no change to
  the stable Lattice core `botinabox` depends on (`new Lattice`, `init`, `upsert`,
  `get`, `delete`, `query`, `migrate`, `render`). Dependency refresh with no
  behavior change. Full test suite (740) passes against 3.2.0; build + typecheck
  clean.

## [2.16.30] — 2026-06-14

### Changed

- **Bump `latticesql` to ^3.0.0.** Lattice 3.0 is a breaking major: a cloud is now
  a shared Postgres database secured by real Row-Level Security — each member
  connects directly as their own scoped, non-superuser role and the previous
  server / replica / sync model is removed. `botinabox` uses only the stable
  Lattice core (`new Lattice`, `init`, `upsert`, `get`, `delete`, `query`,
  `migrate`, `render`), none of the removed surface, so this is a dependency
  refresh with no behavior change. Full test suite (740) passes against 3.0.0;
  build + typecheck clean.

## [2.16.29] — 2026-06-11

### Changed

- **Bump `latticesql` to 2.3.0.** Lattice 2.3.0 makes the native document parsers
  (`mammoth`, `unpdf`, `word-extractor`, `fflate`), the `file-type` sniffer, and
  `@anthropic-ai/sdk` regular dependencies instead of optional ones, so document
  ingest works on every install instead of silently extracting nothing when an
  install omits optional dependencies. `botinabox` uses the stable Lattice core
  (none of the affected ingest/parser paths), so this is a dependency refresh with
  no behavior change. Full test suite (740) passes.

## [2.16.28] — 2026-06-11

### Fixed

- **`ChatPipelineV2.buildHistory` now applies its character budget newest-first.** Previously, when a thread's history exceeded the 16,000-char budget, the builder walked the chronological list from the start and stopped at the budget — keeping the OLDEST messages and silently dropping the NEWEST ones, including the context the model needs for the current turn. The budget is now applied by walking backwards from the newest message (matching `ChatResponder.buildContextWindow`), so truncation drops the oldest messages instead. Regression test: a thread whose total length exceeds the budget retains the newest message and drops the oldest.

## [2.16.27] — 2026-06-10

### Changed

- **Bump `latticesql` to 2.2.3.** Lattice 2.2.3 ships a security/breaking change
  (a cloud is reachable only through a user-authenticated server — a GUI pointed
  at a raw `postgres://` cloud is refused), native in-process document parsing
  (PDF / Office / OpenDocument / EPUB / RTF, dropping the external `markitdown`
  CLI), and an ingest `name`/`title` NOT NULL fix. `botinabox` uses the stable
  Lattice core (none of the affected GUI / teams / ingest paths), so this is a
  dependency refresh with no behavior change. Full test suite (739) passes
  against 2.2.3; build + typecheck clean.

## [2.16.26] — 2026-06-10

### Changed

- **Bump `latticesql` to 2.2.2.** Lattice 2.2.2 is a team-cloud GUI hotfix:
  unowned tables no longer leak to other members, drag-and-drop ingest
  auto-generates a `files.slug` (fixing a Postgres NOT NULL failure), the
  share indicator recolours without a refresh, the assistant gets the
  operator's name, and the direct-`postgres://` deprecation warning is now
  silent. `botinabox` uses the stable Lattice core (none of the affected
  team-cloud/GUI paths), so this is a dependency refresh with no behavior
  change. Full test suite passes against 2.2.2.

---

## [2.16.25] — 2026-06-10

### Changed

- **Bump `latticesql` to 2.2.1.** Lattice 2.2.1 is a hotfix for two 2.2.0
  team-cloud regressions: composite/`id`-less primary keys no longer crash the
  row-permission query path, and assistant chats are now isolated per member.
  `botinabox` uses the stable Lattice core (query/CRUD/render) and none of the
  affected team-cloud paths, so this is a dependency refresh with no behavior
  change. Full test suite passes against 2.2.1.

---

## [2.16.24] — 2026-06-09

### Changed

- **Bump `latticesql` to 2.2.0.** Lattice 2.2 adds row-level permissions for
  shared team clouds (per-row owner + private/everyone/custom visibility,
  enforced across the REST API, AI assistant, and hosted sync) and deprecates
  direct `postgres://` team-cloud connections in favour of the hosted Teams
  server. `botinabox` uses the stable Lattice core (query/CRUD/render), which
  is unchanged — this is a dependency refresh with no behavior change in
  `botinabox`. Note for apps that also use `latticesql`'s Teams API directly:
  `TeamsClient.upgradeToTeamCloud` is renamed to
  `TeamsClient.registerCloudOwner` in 2.2. The full test suite passes against
  2.2.0.

---

## [2.16.23] — 2026-06-09

### Changed

- **Bump `latticesql` to 2.1.1.** Lattice 2.1.1 is a GUI-only refinement of the
  assistant rail (unified activity cards, inline object-link pills) plus a round
  of GUI fixes; its library API is unchanged and fully backwards-compatible, so
  this is a dependency refresh with no behavior change in `botinabox`. The full
  test suite passes against 2.1.1.

---

## [2.16.22] — 2026-06-08

### Changed

- **Bump `latticesql` to 2.1.0.** Lattice 2.1 adds assistant-routed search and a
  guarded, reversible table-delete tool in the GUI; its library API is unchanged
  and fully backwards-compatible, so this is a dependency refresh with no
  behavior change in `botinabox`. The full test suite passes against 2.1.0.

---

## [2.16.21] — 2026-06-08

### Changed

- **Bump `latticesql` to 2.0.0.** Lattice 2.0 adds the GUI AI assistant +
  Context Constructor; its library API is unchanged and fully
  backwards-compatible, so this is a dependency refresh with no behavior change
  in `botinabox`. The full test suite passes against 2.0.0.

---

## [2.16.20] — 2026-06-08

### Fixed

- **Entity-context slug sanitization.** `defineEntityContext`'s slug function now
  sanitizes path-traversal characters (`/`, `\`, `..`, leading dots) into `-`
  instead of **throwing**. A slug becomes a filesystem path segment, and slugs
  derived from synced/user data (a contact or record name containing `/`) could
  contain such characters — previously one bad row threw and failed the *entire*
  `render()`. Slugs already free of these characters (UUIDs, clean slug columns)
  are returned unchanged.

## [2.16.19] — 2026-06-08

### Added

- **`renderSkipsEmpty` DataStore option** (default `false`), forwarded to
  latticesql `1.16.5`'s option of the same name. When enabled, `render()` skips
  both the full-table read and the file write for tables registered without a
  `render` spec (those compile to a no-op that would only emit an empty
  `.schema-only/<table>.md`). Default-off preserves the prior behavior. Useful
  when the database has large tables that aren't rendered to context files.

### Changed

- Bump `latticesql` dependency to `^1.16.5`.

## [2.16.18] — 2026-06-06

### Fixed

- **`SecretStore.set` now upserts instead of always inserting.** Previously every `set()` inserted a new row with a fresh id, so a caller that re-saves the same key on a cycle — e.g. the OAuth token refresh writing `google_tokens:<account>` every rotation — accumulated unbounded duplicate live rows (observed: 90 live rows for one key). `set()` now updates the existing live row for `(name, environment)` when present and only inserts when absent, keeping exactly one live row per key. (Consistent with the existing `saveCursor` upsert pattern.)
- **`SecretStore.get` / `getMeta` are now deterministic.** They previously used `LIMIT 1` with no ordering, so when duplicate live rows existed they returned an arbitrary one. They now select the most recently created live row (sorted in JS for cross-dialect/version stability — same rationale as other newest-wins reads), so legacy pre-upsert duplicates still resolve to the latest secret.

## [2.16.17] — 2026-06-06

### Added

- **`resolveToolContext` hook on `ChatPipelineV2Config`** — an optional per-turn resolver, called once per inbound message with the same coordinates as `resolveContextFiles` (`{ channelId, threadId, userId?, messageText, channel }`). The fields it returns are merged into the `ToolContext` passed to every tool handler for that turn, letting an app thread per-turn identity (e.g. which user the primary agent is acting on behalf of, resolved from `userId`) into tool execution — something the static config could not express, since the primary agent always runs under `agentId: 'primary'`. Base context fields (`taskId`, `agentId`, `hooks`, `db`, `resolveFilePath`) are applied after the resolver's output and cannot be overridden; colliding keys are ignored. A thrown resolver propagates to the turn's try/catch and surfaces via `pipeline.error` (no silent fallback). Omitting the hook leaves the `ToolContext` byte-identical to before — fully backward-compatible.

## [2.16.16] — 2026-06-05

### Added

- **`slack.message.outbound` hook event** — emitted by `SlackBoltAdapter` after each chunk the bot posts in the `response.ready` handler, carrying the posted message's Slack `ts`. Payload: `{ channel, ts, threadTs, body }` (`threadTs` is `null` for a top-level reply). On the Socket Mode transport the outbound `ts` was previously discarded, so consumers had no way to resolve a later reaction or edit back to the message the bot sent. This completes the trio alongside `slack.message.changed` / `slack.message.deleted`. No emission when `chat.postMessage` returns no `ts`.

## [2.16.15] — 2026-06-02

### Changed

- **Bumped `latticesql` from `^1.16.3` to `^1.16.4`.** Passthrough: latticesql 1.16.4 is a GUI patch — one unified workspace model (a workspace _is_ a Lattice DB; single header switcher; the `.lattice` root is universal for the GUI and the no-root "database mode" is gone), cloud-path fixes ("New cloud (Postgres)" works via direct Postgres registration; the standalone "connect to an existing cloud" path is removed in favor of migrate-to-cloud or join-via-invite; owner-only cloud-workspace delete), and two sharing fixes — shared tables are now visible to members (a shared table that already physically exists is registered locally) and inviting a member again offers per-table share checkboxes (all checked by default). No library API changes — a bare `new Lattice(path)` consumer (how `botinabox` uses it) is unaffected. Dependency-sync release; no `botinabox` API changes.

## [2.16.14] — 2026-06-02

### Changed

- **Bumped `latticesql` from `^1.16.2` to `^1.16.3`.** Passthrough: latticesql 1.16.3 is a GUI patch that reframes a cloud database as a cloud workspace with members (the separate "upgrade to team" step is retired and the member/share machinery now initializes automatically), fixes a long-form inline-editor data-corruption bug (long-form fields open a `<textarea>` so newlines round-trip and a no-op click+blur no longer rewrites the value), adds data-model graph share-status coloring + a legend and pending invitees in the member list, makes cloud sharing actually persist, renames "Database" → "Workspace" in the UI, and ships assorted settings/empty-state polish. No library API changes — a bare `new Lattice(path)` consumer (how `botinabox` uses it) is unaffected. Dependency-sync release; no `botinabox` API changes.

## [2.16.13] — 2026-06-02

### Changed

- **Bumped `latticesql` from `^1.16.1` to `^1.16.2`.** Passthrough: latticesql 1.16.2 is a GUI bug-fix + cloud-settings patch (Version History no longer shows "Invalid Date"; an already-joined cloud member is no longer shown the "needs invite" panel; owner invite shows a password-redacted connection string; member-exit actions moved to a Danger Zone with Disconnect/Leave; the simple view gained an in-place create form; clicking a database row switches to it; the dashboard "Recent Activity" section was removed). No library API changes — a bare `new Lattice(path)` consumer (how `botinabox` uses it) is unaffected. Dependency-sync release; no `botinabox` API changes.

## [2.16.12] — 2026-06-02

### Changed

- **Bumped `latticesql` from `^1.16.0` to `^1.16.1`.** Passthrough: latticesql 1.16.1 is a GUI bug-fix + polish patch (redo gate counts session-scoped; built-in-entity column edits no longer corrupt the schema; failed writes surface instead of phantom success; the "+ New workspace…" button opens its input; one-to-many links labeled legacy with a `ref:` deprecation warning; the standalone Activity rail removed). No library API changes — a bare `new Lattice(path)` consumer (how `botinabox` uses it) is unaffected. Dependency-sync release; no `botinabox` API changes.

## [2.16.11] — 2026-06-01

### Changed

- **Bumped `latticesql` from `^1.15.0` to `^1.16.0`.** Passthrough: latticesql 1.16.0 backports the non-AI 2.0 feature set onto the stable 1.x line — the `.lattice` workspace model + auto-render, full-text search (`fullTextSearch`, SQLite FTS5 / Postgres `tsvector` with a LIKE fallback), changelog/version history, sources/references, a workspace dashboard, and a multiplayer cloud-editing experience (live share/de-share, "last edited by", change-flash + counts, offline edit queue) — all with no AI dependency, plus a much richer GUI Data Model editor (force-directed schema graph, bidirectional many-to-many links, and a soft-delete model where every schema change is tracked in version history and reversible, with session-scoped undo/redo). A bare `new Lattice(path)` library consumer (which is how `botinabox` uses it) keeps a zero-overhead `^1.x` contract — all new surface is opt-in or GUI-cloud-gated. No `botinabox` API changes — dependency-sync release.

---

## [2.16.10] — 2026-06-01

### Fixed — `run.completed` event now carries `output` + `durationMs`, restoring observability for failed runs

`RunManager.finishRun` emitted the `run.completed` event without `output` or `durationMs` on its payload — so every downstream hook reading `ctx.output` got `undefined`, and consumers that wanted the agent's final text (e.g. observation pipelines, metrics with task duration) had to re-fetch from the `runs` row themselves. The error text was correctly persisted to `runs.error_message` via the `db.update` in `finishRun`, but it never reached the event consumers.

Symptom in a real deployment: every dispatched-agent failure produced an empty observation row (`raw_text=''`) and the actual error string was effectively invisible to operators — the agent loop fired Anthropic calls, the CLI/API adapter caught its exception and called `finishRun({ exitCode: 1, output: 'Execution error: …' })`, but the error text dropped out of the event and the observation pipeline persisted nothing useful. Dispatch failures were operationally undiagnosable.

This release:

- **`run.completed` payload now includes `output`** (the agent's final text on success, or the error string from the execution adapter's catch path on failure) **and `durationMs`** (computed from `runs.started_at` → now). The shape is additive — downstream consumers that previously ignored these fields are unaffected.
- **Adds a stderr warning line on any non-zero exit code** (`[run-manager] finishRun failure runId=… agentId=… taskId=… exitCode=… model=… output=…`). Belt-and-suspenders so future observation-pipeline bugs can't silently hide a failed dispatch — the line is greppable in container logs even when downstream consumers swallow.
- New regression tests in `src/core/orchestrator/__tests__/run-manager.test.ts` pin both invariants: `output` and `durationMs` are forwarded on the event; the warning fires on `exitCode !== 0` and does not fire on success.

No API changes; this is strictly additive event payload + a log line. Downstream consumers that want the new fields can opt in by reading `ctx.output` / `ctx.durationMs` on their `run.completed` hook.

---

## [2.16.9] — 2026-05-29

### Changed

- **Bumped `latticesql` from `^1.14.0` to `^1.15.0`.** Passthrough: latticesql 1.15.0 ships Teams data-integrity fixes — `seed()` surfaces unresolved junction links instead of silently dropping them; the team dead-letter queue is now inspectable/retryable/purgeable via `teams dlq`; non-owner local edits are captured as divergence entries instead of being silently overwritten on pull — plus a GUI delete-database flow, bounded `/api/entities` row counts (no more connection-pool exhaustion on large cloud schemas), and Windows fixes for `postgres://` databases + portable `db:` paths. No `botinabox` API changes — dependency-sync release.

---

## [2.16.8] — 2026-05-28

### Changed

- **Bumped `latticesql` from `^1.13.10` to `^1.14.0`.** Passthrough: latticesql 1.14.0 ships the team-cloud per-table ownership model (each table records its creator; members see only tables they own plus tables explicitly shared to the team, with native `files`/`secrets` private to the database creator by default), membership-driven team-cloud state, owner-only member admin, and the consolidated browser GUI (Data Model inside Database Settings). It also restores the `@scarf/scarf` install-analytics dependency. No `botinabox` API changes — this is a dependency-sync release.

---

## [2.16.7] — 2026-05-28

### Changed

- **Bumped `latticesql` from `^1.13.9` to `^1.13.10`.** Passthrough: latticesql 1.13.10 removes the `@scarf/scarf` install-analytics dependency (it was structurally unable to report direct `npm install` events — Scarf's postinstall reads `scarfSettings.allowTopLevel` from the *consumer's* root manifest, not the dependency's) and replaces it with a passive README tracking pixel + public npm download stats. Net effect for `botinabox`: one fewer transitive dependency and a quieter install (no swallowed Scarf postinstall error). No `botinabox` API changes. (`package.json` was previously left at `2.16.5` on `main` while `2.16.6` shipped to npm via #31; this release reconciles the manifest forward to `2.16.7`.)

---

## [2.16.6] — 2026-05-27

### Added

- **`resolveContextFiles` hook on `ChatPipelineV2Config`.** `ChatPipelineV2` can now inject host-resolved context files into the chat agent's system prompt per conversation turn, mirroring the existing `resolveContextFiles` option on `ExecutionEngineConfig`. When configured, the pipeline calls the resolver once per inbound message with `{ channelId, threadId, userId?, messageText, channel }`, wraps each returned `ContextFile` in `<file path="...">...</file>` tags via the shared `formatContextFilesBlock()` helper, and appends the non-empty block to the system prompt **after** the `buildSystemContext` block. The resolver owns all I/O — the pipeline never touches the filesystem — and a thrown resolver propagates into the Phase-1 try/catch (logs loudly, emits `pipeline.error`); there is no silent empty-context fallback. Omitting the option leaves `ChatPipelineV2` behavior byte-identical. Typical use: injecting per-conversation rendered context (e.g. reward-ranked entity/memory files) that `buildSystemContext` does not already cover.

---

## [2.16.5] — 2026-05-27

### Changed

- **Bumped `latticesql` from `^1.13.8` to `^1.13.9`.** Hotfix to v1.13.8: the new `RealtimeBroker` in `latticesql/src/gui/realtime.ts` used a top-level `import pg from 'pg'`, and the CLI tsup build did not list `pg` in `external`. tsup inlined pg's CommonJS internals (a `require('events')` shim + native-binding glue) into the ESM CLI bundle, crashing every `lattice gui` boot with `Dynamic require of 'events' is not supported` — even for SQLite-only configs that never construct a broker. v1.13.9 switches realtime.ts to a type-only `import type pg` plus a runtime `createRequire(import.meta.url)('pg')` lazy-load matching the existing pattern in `src/db/postgres.ts`, and adds `pg` to the CLI tsup `external` array as belt-and-suspenders. New regression test guards both the static source and the build config. No `botinabox` API changes.

---

## [2.16.4] — 2026-05-27

### Changed

- **Bumped `latticesql` from `^1.13.7` to `^1.13.8`.** Minor release adds three GUI-side feature groups plus a documentation refresh. `botinabox` has no API surface that touches them directly — the bump is a passthrough so downstream consumers picking up `botinabox@2.16.4` also pick up the new GUI.
  - **Realtime cloud subscriptions.** Cloud Postgres-backed lattices now stream changes to every connected GUI in realtime via a Postgres trigger on `__lattice_change_log` (`pg_notify('lattice_changes', …)`) and a Server-Sent Events endpoint at `GET /api/realtime/stream`. The browser invalidates the entity cache on every change; a green/yellow/red dot in the topbar reports cloud connection health. No-op on SQLite (LISTEN/NOTIFY is Postgres-only).
  - **Cloud Database information-architecture refactor.** The GUI now treats every database as either Local (single-user SQLite) or Cloud (Postgres, one or more invited team members), with the database itself as the first-class concept. New three-step Create Database wizard, editable database name (collapses what was "team name"), header dropdown with friendly name + Local|Cloud kind chip + connectivity dot per row, settings sidebar reorganized into Lattice Settings + Database Settings + User Settings, per-table share checkboxes on the Migrate-to-Cloud modal, and a pre-checked "Share with cloud" box on the new-entity flow when cloud-connected. "Lattice Teams" remains the product/brand name; team verbiage stays for member management (Invite Team, Join Team, Team Members).
  - **System tables toggle.** Internal `__lattice_*` / `_lattice_gui_*` tables are hidden from the sidebar by default. A new checkbox in User Settings → Preferences (persisted to `~/.lattice/preferences.json`) re-enables them. New endpoint `GET`/`POST /api/userconfig/preferences`.
  - **Modal contrast + password redaction fixes.** Field labels and inputs in Join / Migrate / Create modals are now coherently styled regardless of browser theme. Password redaction in cloud URLs renders as ASCII `****` instead of percent-encoded bullets.
  - Also picks up `@scarf/scarf` install analytics (opt-out) — anonymous npm-install metrics only; no runtime telemetry added.

---

## [2.16.3] — 2026-05-27

### Changed

- **Bumped `latticesql` from `^1.13.6` to `^1.13.7`.** Patch release: joining a team via the GUI is now seamless end-to-end. After invite redeem, the team's cloud URL is automatically saved as a switchable database credential, a sibling YAML config is written to the project directory, and the team's shared tables auto-register on `openConfig` via `syncSharedSchemas`. The user sees the new entry in the database dropdown as `<team-name>.config`, clicks it, and the SPA opens with the team's shared tables already populated — no YAML editing, no `db.define()` calls, no "No entities yet" message. No API changes affecting `botinabox` itself.

---

## [2.16.2] — 2026-05-27

### Changed

- **Bumped `latticesql` from `^1.13.5` to `^1.13.6`.** Patch release fixes the credential-URL crashes in Lattice Teams: `shareObject` / `unshareObject` / `listSharedObjects` / `me` / `linkRow` / `unlinkRow` / `drainOutbox` / `pullChanges` no longer fail with `Request cannot be constructed from a URL that includes credentials` when the operator's team cloud URL is a `postgres://user:password@host/db` connection string (the default after Migrate-to-cloud or Connect-to-existing-cloud). Also includes the joined-team dropdown integration: `saveDbCredentialForTeam` + a sibling YAML config are written on every successful invite redemption so the team's cloud DB shows up in the GUI's database switcher without manual config edits. No API changes affecting `botinabox` itself.

---

## [2.16.1] — 2026-05-26

### Changed

- **Bumped `latticesql` from `^1.13.4` to `^1.13.5`.** Patch release: `redeemInvite` now works against Postgres cloud URLs via the new `redeemInviteDirect()` path (fixes the "Join via invite" HTTP 404 on direct-Postgres clouds), and the Create-team / Join-team modals' cloud-URL placeholders now show a Postgres pooler URL example with autocapitalize-off. No API changes affecting `botinabox` itself.

---

## [2.16.0] — 2026-05-26

### Added

- **`org.address` column** (nullable `TEXT`). Additive schema change mirroring the existing `client.address` convention in `defineDomainTables`. The `ORG.md` entity-context renderer now emits an `**Address:** ...` line when the column is populated and omits it when null. No migration required for existing tables on engines that allow additive nullable columns; consumers that already render organisations get the new line automatically once the data is set.

---

## [2.15.4] — 2026-05-26

### Changed

- **Bumped `latticesql` from `^1.13.3` to `^1.13.4`.** GUI-focused release: system-tables listing now works on Postgres, team-cloud upgrade persists the local connection row, password redacted in cloud-URL displays, role pill three-state (no more "UNKNOWN"), team operations work against direct-Postgres URLs (new `direct-ops.ts`), and the manual Sync button is removed from team cards (Lattice is realtime against its canonical store). No API changes affecting `botinabox` itself.

---

## [2.15.3] — 2026-05-26

### Changed

- **Bumped `latticesql` from `^1.13.2` to `^1.13.3`.** Patch release with Postgres init crash fix (`DEFAULT ""` → `DEFAULT ''` on `__lattice_user_identity`), Postgres-direct register path for "Upgrade to team cloud", dashboard renders every entity (not just hardcoded list), structured DB switch errors with SQLSTATE, plus Migrate validate-on-save with Supabase URL pattern hints. No API changes affecting `botinabox` itself.

---

## [2.15.2] — 2026-05-26

### Changed

- **Bumped `latticesql` from `^1.13.1` to `^1.13.2`.** Patch release with GUI fixes for the Postgres wizard form: autocapitalize/autocorrect/spellcheck disabled on text inputs, every text field trimmed on read, "Connect to existing cloud" copy rewritten to reflect switch-not-discard behavior, and `probeCloud` now surfaces SQLSTATE + driver routine in `result.error`. No API changes affecting `botinabox` itself.

---

## [2.15.1] — 2026-05-26

### Changed

- **Bumped `latticesql` from `^1.13.0` to `^1.13.1`.** Patch release with GUI fixes for entity-context discovery (manifest fallback when contexts are registered programmatically), output-directory auto-detection, table-cell truncation, and a new public `Lattice.entityContexts()` accessor. No API changes affecting `botinabox` itself.

---

## [2.15.0] — 2026-05-26

### Changed

- **Bumped `latticesql` from `^1.11.0` to `^1.13.0`.** The v1.13 release adds Lattice Teams (multi-user shared cloud DBs on BYO Postgres), native `secrets` + `files` entities with at-rest encryption, machine-local user config at `~/.lattice/`, and a Local → Cloud → Team-Cloud state-machine GUI. New public exports include `migrateLatticeData`, `archiveLocalSqlite`, `openTargetLatticeForMigration`, `probeCloud`, plus `TeamsClient.connectToExistingCloud` + `TeamsClient.upgradeToTeamCloud`.

### Why

Routine dependency bump to keep `botinabox` aligned with the latest latticesql release. No public API changes in botinabox itself; consumers picking up `botinabox@2.15.0` automatically get the v1.13 latticesql primitives.

---

## [2.14.0] — 2026-05-25

### Added

- **`slack.message.changed` hook event** — emitted by `SlackBoltAdapter` when Slack delivers a `message` event with `subtype: 'message_changed'` (a user edited a message). Payload: `{ channel, ts, newBody, previousBody, editorUser, raw }`. Lets consumers mirror Slack-side edits into their own stores without running a second Bolt connection.
- **`slack.message.deleted` hook event** — emitted by `SlackBoltAdapter` when Slack delivers a `message` event with `subtype: 'message_deleted'`. Payload: `{ channel, ts, previousBody, raw }`. Lets consumers soft-delete or remove mirrored rows when a user deletes a message in Slack.

### Why

`SlackBoltAdapter` previously dropped `message_changed` and `message_deleted` at the subtype filter (`if (subtype && subtype !== 'file_share') return;`), leaving consumers with no way to track edit/delete state. The intuitive workaround — open a second Bolt Socket Mode connection that subscribes to `message` events — doesn't work in practice, because Slack Socket Mode delivers any given `message` event to exactly one socket per app (per event type). The second-connection listener silently misses every event. Routing the subtypes through the existing `HookBus` is the only architecture that delivers events deterministically.

### Notes for upgraders

- Additive minor release. Existing `message.inbound` semantics are unchanged — `message_changed` / `message_deleted` events were already being dropped, so previous consumers see no behavior change. The two new hook events are opt-in.
- Pattern:
  ```typescript
  hooks.register('slack.message.changed', async (ctx) => {
    const { channel, ts, newBody } = ctx as { channel: string; ts: string; newBody: string };
    // mirror the edit into your store
  });
  hooks.register('slack.message.deleted', async (ctx) => {
    const { channel, ts } = ctx as { channel: string; ts: string };
    // soft-delete the row keyed by (channel, ts)
  });
  ```
- The hook bus is the same instance passed in `SlackBoltAdapterConfig.hooks`, so no new wiring is needed beyond `hooks.register`.

---

## [2.13.1] — 2026-05-25

### Changed

- **Bump `latticesql` dep to `^1.11.0`.** Picks up the new `lattice gui` CLI command (local-only browser app for exploring Lattice data). No botinabox API change — this is a transparent dependency refresh. `lattice gui` is available to any project that has botinabox or latticesql installed.

---

## [2.13.0] — 2026-05-22

### Added

- **`DataStore.reward(table, id, scores)`** — thin pass-through to the underlying engine's reward-tracking. Update arbitrary dimension scores (values in `[0, 1]`) on a row; the engine maintains a running average across calls in `_reward_total` / `_reward_count`, and `db.render()` sorts rows by that average so high-reward rows surface first to any consumer of the rendered output. Requires `rewardTracking: true` on the `TableDefinition` (otherwise the engine throws).
- **`TableDefinition.rewardTracking?: boolean`** — opt a table into reward tracking at `define()` time. Auto-adds the `_reward_total` (`REAL`) and `_reward_count` (`INTEGER`) columns; sorts rows by reward during render.
- **`TableDefinition.pruneBelow?: number`** — soft-delete rows whose reward total falls below this threshold during the next render. Requires a `deleted_at` column. Use with care: a positive threshold also prunes brand-new rows that have not accumulated any reward yet.

### Why

The underlying engine (LatticeSQL 1.3+) has shipped reward tracking for a while, but `DataStore.define()` filtered the forwarded `TableDefinition` to a fixed set of fields — `rewardTracking` and `pruneBelow` were silently dropped at the wrapper boundary, and no `reward()` method was exposed on `DataStore`. This release plumbs both fields through and adds the matching `reward()` delegate. The pure-mechanical wrapper change unlocks usefulness-weighted render ordering for any `botinabox` consumer that wants to wire it.

### Notes for upgraders

- Additive minor release. Existing tables and call sites are unaffected — both new `TableDefinition` fields are optional and default to off, and `DataStore.reward()` is a new method on the surface. No migrations required for tables you don't opt in.
- Opt-in pattern:
  ```typescript
  db.define('memos', {
    columns: { id: 'TEXT PRIMARY KEY', content: 'TEXT' },
    rewardTracking: true,
    // pruneBelow: 0.3,  // optional — leave off until you've observed the score distribution
  });
  // ...later, from any code path that has a usefulness signal:
  await db.reward('memos', id, { relevance: 0.9, accuracy: 1.0 });
  ```
- `pruneBelow` is intentionally off by default. Setting it above `0` on a freshly-opted-in table will soft-delete every row that has not yet been rewarded.

---

## [2.12.1] — 2026-05-06

### Fixed

- **`parseSlackEvent` now uses `event.ts` as `InboundMessage.id` instead of `event.client_msg_id`.** The previous fallback chain (`client_msg_id ?? ts ?? event_ts ?? generated`) preferred Slack's client-generated UUID over the canonical message timestamp. `client_msg_id` is set by official Slack clients (desktop, mobile) and identifies the user-typed message, but `ts` is what Slack uses everywhere else: `chat.update`/`chat.delete` reference it, permalinks are built from it, `reactions.add`/`reactions.remove` require it as their `timestamp` parameter, and `conversations.history` returns it. Using a UUID as `msg.id` meant downstream consumers (audit logs, dedup keys, retro queries) could not join routing decisions back to specific Slack messages without an extra Slack API call. Bot messages and edits often lack `client_msg_id` entirely, so the previous behavior already silently fell through to `ts` for those — this PR makes that the consistent behavior for every message. The new order is `ts ?? event_ts ?? client_msg_id ?? generated`, preserving the existing fallbacks for events that genuinely lack a server-side timestamp.

### Notes for upgraders

- Patch bump. `InboundMessage.id` shape is unchanged (still a string); only the source field changes. Consumers that hash, dedupe, or persist `msg.id` should re-evaluate any cached state after upgrading — old rows will have UUIDs, new rows will have Slack timestamps. Both formats remain unique per message; the change is forward-compatible.

---

## [2.12.0] — 2026-05-05

### Fixed

- **`GoogleCalendarConnector.syncFull` now mints `nextSyncToken`.** The full-sync path previously sent `timeMin` and `orderBy: 'startTime'` to `events.list`, which the Google Calendar API documents as preventing the response from including `nextSyncToken`. Combined with an inner records-cap (`maxResults` default 250) that exited the pagination loop early, `syncFull` returned `{ cursor: undefined, hasMore: true }` on any non-trivial calendar — `syncIncremental` could never be bootstrapped, so every consumer effectively did a full pull every time. The fix removes `timeMin`, `orderBy`, and the records-cap loop exit, and drains pagination to completion regardless of `options.limit`. The 410 expired-token fallback path inherits the same fix automatically. `singleEvents: true` is preserved (does not block `nextSyncToken`).

### Changed (behavior shift, type-compatible)

- **`options.limit` and `options.since` are now ignored on the calendar full-sync path.** A partial first sync cannot mint a usable cursor, so honoring those options would defeat the purpose of the fix. `syncIncremental` (via `options.cursor`) still respects `options.limit` for bounded follow-up syncs — that is the intended way to cap work after the first sync. Consumers who relied on the implicit 30-day window will now receive every event on the calendar on first sync, which is the correct semantic for "build a fresh index, then track deltas." No type-signature change; existing call sites continue to compile.

### Added

- **Regression test for `ExecutionEngineConfig.resolveContextFiles` reaching the system prompt.** Asserts the resolver's output is concatenated into the assembled `system` field for both the plain-string and `cacheSystemPrompt: true` (ephemeral cache block) paths, that the resolver receives the resolved agent and task rows, that the contextFiles XML block is omitted entirely when no resolver is configured, and that a thrown resolver error fails the run loudly with no silent fallback. No production code change — purely a guard against future regressions in the engine's prompt assembly.

### Notes for upgraders

- Minor bump. The calendar full-sync behavior shift is patch-level in spirit (the previous behavior was a bug — no usable cursor was ever minted), but the on-the-wire request shape and the first-sync record set both change, so a minor bump is the conservative choice. If your app capped full-sync work via `limit` or `since`, switch to a one-shot full sync followed by `cursor`-driven incremental syncs to bound the workload.

## [2.11.0] — 2026-05-05

### Added

- **`ExecutionEngineConfig.cacheSystemPrompt?: boolean`.** Optional flag that marks the assembled system prompt as ephemerally cacheable. When `true`, the engine sends `system` as a single-element content block array with `cache_control: { type: 'ephemeral' }` instead of a plain string, letting Anthropic's prompt-cache layer serve hits across calls within the 5-minute ephemeral TTL. When `false` or omitted, the engine emits `system: '<string>'` as before — fully backward-compatible. See `docs/architecture.md` for usage details.

### Notes for upgraders

- Minor bump. Additive config field — no behavioral change unless you opt in by passing `cacheSystemPrompt: true`.

## [2.10.1] — 2026-05-04

### Fixed

- **`DataStore.init()` and `DataStore.tableInfo()` no longer call the synchronous adapter surface.** 2.10.0 inherited the BREAKING latticesql 1.10.0 change (sync `run`/`introspectColumns` etc. throw on Postgres), but two of botinabox's own call sites still routed through sync: (1) `init()` flushed `deferredStatements` (CREATE INDEX) via `lattice.adapter.run(stmt)`, and (2) `tableInfo()` called `lattice.adapter.introspectColumns(table)` on every read (used by `ColumnValidator` on every CRUD insert/update). On Postgres these crashed every container at boot with `PostgresAdapter: synchronous adapter methods … are no longer supported`.
  - `init()` now flushes `deferredStatements` via `adapter.runAsync()` and pre-populates a per-DataStore column cache via `adapter.introspectColumnsAsync()` for every `define()`d table.
  - `tableInfo()` now reads from that cache (sync API preserved). Consumers do NOT need to migrate to an async signature.
  - `migrate()` clears + refreshes the cache after applying migrations so ALTER TABLE / column additions are visible to subsequent `tableInfo()` reads.
  - For tables touched only via the raw `db.lattice.adapter` escape hatch (not `define()`d), `tableInfo()` falls back to sync `introspectColumns` — works on SQLite, throws on Postgres with the latticesql 1.10.0 message (which is the right behavior: Postgres callers reading unregistered tables should call `introspectColumnsAsync` directly).

### Notes for upgraders

- Patch bump. Pure bug fix. Public API unchanged. Restores the contract that `botinabox` 2.10.0 was supposed to deliver against `latticesql` 1.10.0+.

## [2.10.0] — 2026-05-04

### Changed

- **Bumps `latticesql` to `^1.10.0`** (was `^1.9.0`). Inherits a BREAKING change from latticesql: the `PostgresAdapter` synchronous methods (`run`/`get`/`all`/`prepare`/`introspectColumns`/`addColumn`) now throw on Postgres — only the async surface (`runAsync`/`getAsync`/`allAsync`/`prepareAsync`/`introspectColumnsAsync`/`addColumnAsync`/`withClient`) does work. Lattice core has routed through async since 1.9.0, so botinabox itself sees zero impact (no botinabox `src/` calls into the sync adapter surface). Consumers of botinabox who escape into `(db as unknown).lattice.adapter` for raw SQL may need to migrate. `synckit` is no longer an `optionalDependency` of `latticesql` — drop it from any consumer install lists. Full notes in the latticesql 1.10.0 CHANGELOG.

### Notes for upgraders

- Minor bump (not patch) because the inherited BREAKING affects downstream installs (synckit drop) — even though botinabox's own code is unchanged.

## [2.9.9] — 2026-05-04

### Changed

- **Bumps `latticesql` to `^1.9.0`** (was `^1.8.1`). 1.9.0 flips lattice core to prefer the adapter's async surface over the sync surface at every internal call site — `Lattice.{insert,upsert,update,delete,query,count,render,...}` all route through `pg.Pool` now on Postgres consumers, with a sync fallback for adapters that don't implement the async methods. The Node event loop is no longer blocked on `Atomics.wait` during request-path DB calls. SQLite consumers see no behavioral change. 1.9.0 also fixes a latent Postgres bug where `softDeleteMissing` and `countActive` returned the raw `cnt` field — Postgres ships `COUNT(*)` as a string, silently violating the `Promise<number>` contract; both now coerce with `Number()`. Public API of `Lattice` is unchanged. Full notes in the latticesql 1.9.0 CHANGELOG.

## [2.9.8] — 2026-05-04

### Changed

- **Bumps `latticesql` to `^1.8.1`** (was `^1.8.0`). 1.8.1 fixes a function-name typo in the migration runner — `pg_xact_advisory_lock` (which doesn't exist) was changed to the real `pg_advisory_xact_lock(bigint)`. Postgres consumers that boot through `Lattice.init({ migrations })` were crash-looping on `Fatal: error: function pg_xact_advisory_lock(unknown) does not exist`. 1.8.1 also adds a Postgres integration test (`tests/integration/apply-migrations-async-postgres.test.ts`) plus a `postgres:16` service container in CI so future Postgres-side regressions are caught before publish. Full notes in the latticesql 1.8.1 CHANGELOG.

## [2.9.7] — 2026-05-02

### Changed

- **Bumps `latticesql` to `^1.8.0`** (was `^1.6.10`). 1.8.0 adds an optional async surface to `StorageAdapter` (`runAsync`/`getAsync`/`allAsync`/`prepareAsync` + `withClient(fn)` + `dialect: 'sqlite' | 'postgres'`). Botinabox's `DataStore` already returns Promises from its CRUD methods, so consumers get the new async path through their existing `await db.query(...)` calls without code changes on the read/write hot path. Sync surface is still authoritative for SQLite consumers and for any caller that hasn't migrated. The Postgres adapter gains a native `pg.Pool`-backed async surface alongside its existing synckit-bridged sync surface — workloads that issue many sequential queries on the request path no longer block the Node main thread on `Atomics.wait`. Full notes in the latticesql 1.8.0 CHANGELOG.

## [2.9.6] — 2026-04-16

### Added

- **`resolveModel` callback in `ExecutionEngineConfig`.** Optional per-dispatch model resolver that receives the agent and task rows and returns a model ID string. When provided, overrides `config.model` for that specific task dispatch. Enables per-agent, per-task-type, or per-command model routing — e.g. route search tasks to Haiku and code tasks to Sonnet — without modifying the engine's core loop.

## [2.9.5] — 2026-04-16

### Added

- **Model tracking in `finishRun()`.** `RunManager.finishRun()` now accepts optional `model` and `provider` fields. When provided, `model` is written to the `runs` table row and both `model`, `provider`, and `usage` are forwarded in the `run.completed` hook payload. This unblocks the cost tracker (`setupCostTracker`) which previously returned early because model/provider were never present in the hook event.

- **Execution engine passes model to `finishRun()`.** The built-in API execution engine (`registerExecutionEngine`) now includes the resolved model name and `provider: 'anthropic'` in every `finishRun()` call, so `runs.model` and `cost_events` are populated automatically for all API-adapter agents.

## [2.9.4] — 2026-04-16

### Fixed

- **Channel threads have no conversation context** — `parseSlackEvent` only set `threadId` when `thread_ts` was present (thread replies), leaving it `undefined` for top-level channel messages. The pipeline then stored top-level messages under the channel ID (`C_XXXXX`) as `thread_id`, but thread replies stored under the actual thread timestamp. Result: `buildHistory` for a thread reply found zero prior messages because the IDs didn't match. Fix: for top-level channel messages (C/G prefix), set `threadId = event.ts` (the message's own timestamp) — this is the value Slack will use as `thread_ts` for future replies, so all messages in a thread now share the same `thread_id`. DM behavior unchanged (top-level DMs leave `threadId` undefined so the pipeline groups by channel ID).

## [2.9.3] — 2026-04-15

### Fixed

- **Channel thread replies post at channel top instead of threaded** — `ChatPipelineV2` resolved `threadTs` as `channelId || msg.threadId || msg.id`, so `msg.threadId` (the real thread timestamp) was never reached for channel messages because `channelId` (the `C_XXXXX` channel ID) is always truthy. Fixed priority to `msg.threadId || channelId || msg.id`. DM behavior is preserved since top-level DMs have no `threadId`.
- **`buildHistory` pulled messages from all threads** — The history query filtered by `channel: 'slack'` (the pipeline channel name), returning messages from every thread indiscriminately. Changed to query by `thread_id` so each thread gets its own isolated conversation history.

## [2.9.2] — 2026-04-15

### Fixed

- **DTS build no longer OOMs on Windows.** Switched from tsup's built-in DTS worker (which runs in a memory-limited worker thread) to `tsc --emitDeclarationOnly` in the main process. ESM bundling still uses tsup.

### Added

- **`mergeTools()` utility** — safely combines multiple tool arrays with deduplication. Later tool sets override earlier ones (last-wins), logging a warning on each override. Prevents the Anthropic API 400 "Tool names must be unique" error that occurred when consumers concatenated `nativeTools` with local tools sharing a name. Import from `'botinabox'` alongside `nativeTools`.

- **`Scheduler.setCircuitBreaker()`** — wires the existing `CircuitBreaker` into the scheduler's `connector.sync` path. After 3 consecutive failures for a connector key (e.g., `gmail:alice@example.com`), the circuit opens and skips all syncs for that key until the cooldown expires. Prevents retry storms from saturating the event loop when a connector is persistently broken.

- **`HookBus.emitCollectingErrors()`** — variant of `emit()` that returns handler errors instead of swallowing them. Handlers still run in priority order with error isolation. Used internally by the Scheduler to detect connector sync failures without changing `emit()` semantics.

## [2.9.1] — 2026-04-14

### Fixed

- **Slack `thread_ts` now validated before forwarding.** The `response.ready` and `file.deliver` hook handlers in `SlackBoltAdapter` previously forwarded any truthy `ctx.threadId` as Slack's `thread_ts` field. Upstream callers sometimes populate `threadId` from a conversation identifier that can be a channel id, a `client_msg_id` UUID, or another non-`ts` value — in which case Slack's Web API rejects `chat.postMessage` with `invalid_thread_ts` and the response never reaches the user. A regex guard (`/^\d+\.\d+$/`) now ensures only values matching a real Slack thread timestamp are forwarded; anything else is omitted so the reply posts at the top of the channel.

## [2.9.0] — 2026-04-14

### Changed (breaking)

- **`AttachmentEnricher` signature changed** from `(att, botToken) => Promise<string | null>` to `(att, ctx: EnrichmentContext) => Promise<ContentBlock[]>`. Enrichers now return Claude content blocks and throw on failure. `EnrichmentContext` is extensible — wire new transport clients (drive, gmail, etc.) without changing the signature again.
- **`InboundMessage.attachmentBlocks?: ContentBlock[]`** — new optional field that carries image/document blocks from enrichers through to the LLM provider. `ChatPipelineV2.think()` builds a multimodal user message when this field is populated.
- **`createImageEnricher` renamed to `createSlackImageEnricher`** — takes no config arguments. Returns a single `image` ContentBlock; no intermediate vision API call. The downstream Anthropic provider consumes the raw image natively.
- **`createPdfEnricher` renamed to `createSlackPdfEnricher`** — same pattern, returns a `document` ContentBlock.

### Migration from 2.8.x

Consumers calling `createImageEnricher({ apiKey: ... })` must switch to `createSlackImageEnricher()` (no args) and remove the Anthropic API key from enricher config — the downstream provider already has it. Any custom enrichers built against the old signature must rewrite to return `ContentBlock[]` and accept `EnrichmentContext`.

Only botinabox itself shipped enrichers in 2.8.x — no known public consumers have custom enrichers yet.

## [2.8.1] — 2026-04-14

### Added

- **Drive file read primitives** in the Google connector. Three new exports: `downloadDriveFile` (binary files), `exportGoogleDoc` (Google-native → Office formats), and `readDriveFile` (auto-dispatching). All return a uniform `DriveFileBytes` shape — `{ buffer, mimeType, filename, size }`. The `GoogleDocExportAs` type enumerates valid export targets (`docx | xlsx | pptx | png | pdf | txt | csv | html`).
- These primitives are signature-agnostic — they produce raw bytes + MIME type and can be wrapped into any future attachment enricher shape.

## [2.8.0] — 2026-04-14

### Added

- **Slack attachment enrichment pipeline.** `SlackBoltAdapter` now accepts an `attachmentEnrichers` config that runs per-type extractors over inbound file attachments. Extracted content is appended to the message body so downstream agents can read PDFs, images, spreadsheets, and other formats as if they were text.
- **`Attachment.type` extended to 10 categories** — `"image" | "video" | "audio" | "pdf" | "doc" | "excel" | "presentation" | "html" | "link" | "misc"` — aligned with broader observation media types. Also exports a new `AttachmentMediaType` type alias.
- **`parseSlackEvent` now populates `InboundMessage.attachments[]`** from non-audio file uploads and scans message text for URLs (surfaced as `"link"` attachments).
- **`ContentBlock` gains `image` and `document` variants** matching the Claude multimodal API shapes (`{ type: "image", source: { type: "base64", media_type, data } }` and `{ type: "document", ... }`).
- **Built-in image and PDF enricher factories** — `createImageEnricher({ apiKey })` and `createPdfEnricher({ apiKey })` use the Claude vision / document API directly. Consumers wire them into the adapter via `attachmentEnrichers: { image: createImageEnricher(...), pdf: createPdfEnricher(...) }`.
- **New `slackFiletypeToMediaType` and `extractUrls` helpers** exported from the Slack channel module — extensible via a filetype registry.

### Notes

- The audio / voice-message path (`enrichVoiceMessage`) is unchanged. Audio files are not duplicated into `attachments[]`.
- Consumers that extract docx / xlsx / pptx / html install their own extraction libs and register enrichers — botinabox ships no new document parsing dependencies in this release.

## [2.7.11] — 2026-04-14

### Fixed

- **`SlackBoltAdapter` now forwards `thread_ts` in `response.ready` and `file.deliver` handlers** — replies and file uploads are correctly posted in-thread when the hook context includes a `threadId`. Previously, `threadId` was read but never forwarded to `chat.postMessage` or `filesUploadV2`, causing all outbound messages to appear at the top of the channel.

## [2.7.10] — 2026-04-14

### Changed
- **`latticesql` bumped to `^1.6.10`** — picks up strftime polyfill.

## [2.7.9] — 2026-04-14

### Changed
- **`latticesql` bumped to `^1.6.9`** — picks up json_extract polyfill.

## [2.7.8] — 2026-04-14

### Changed
- **`latticesql` bumped to `^1.6.8`** — picks up datetime('now') translation.

## [2.7.7] — 2026-04-14

### Changed
- **`latticesql` bumped to `^1.6.7`** — picks up CREATE VIEW IF NOT EXISTS translation.

## [2.7.6] — 2026-04-14

### Changed

- **`latticesql` bumped to `^1.6.6`** — picks up the INSERT OR IGNORE + SELECT-with-string-literals translation fix. No botinabox source changes.

## [2.7.5] — 2026-04-13

### Fixed

- **`DataStore.init()` and `DataStore.tableInfo()` now use the portable `lattice.adapter` API** instead of the SQLite-only `lattice.db` getter. Two call sites that previously broke on a Postgres-backed Lattice:
  - `init()` ran deferred `CREATE INDEX` / etc. statements via `lattice.db.exec(stmt)`. Now uses `lattice.adapter.run(stmt)` (still single-statement; the existing semicolon-rejection guard above ensures one DDL per call).
  - `tableInfo(table)` returned `lattice.db.pragma('table_info(...)')` rows. Now returns `lattice.adapter.introspectColumns(table)` mapped to the same `TableInfoRow` shape, with `cid` synthesized from index and `type` / `notnull` / `dflt_value` / `pk` zeroed under Postgres (current consumers — `column-validator`, schema tests — only read `.name`, so this is a compatible reduction).

### Note

botinabox now works against both SQLite and Postgres-backed Lattice instances. Combined with `latticesql@^1.6.5`, `new DataStore({ dbPath: 'postgres://...' })` boots cleanly end-to-end.

## [2.7.4] — 2026-04-13

### Changed

- **`latticesql` bumped to `^1.6.3`** — picks up the worker `.cjs` extension fix. The Postgres backend can now actually run under Node 18+ (1.6.0–1.6.2 silently failed to load the worker due to ESM/CJS mismatch). No botinabox source changes.

## [2.7.3] — 2026-04-13

### Changed

- **`latticesql` bumped to `^1.6.2`** — picks up the worker-file packaging fix. Apps that pass a `postgres://` connection string can now actually `init()` the Lattice (1.6.0 + 1.6.1 had a misleading "requires pg and synckit" error because `dist/postgres-worker.js` wasn't shipped). No botinabox source changes.

## [2.7.2] — 2026-04-13

### Changed

- **`latticesql` bumped to `^1.6.1`** — picks up `PostgresAdapter`'s extra SQLite → Postgres translations (`INSERT OR IGNORE`, `randomblob`, `hex`, plus auto-enable of `pgcrypto`). Apps that pass a `postgres://` connection string to their latticesql `Lattice` get more existing migration code working unchanged. SQLite users see no behavior change. No botinabox source changes.

## [2.7.1] — 2026-04-13

### Changed

- **`latticesql` bumped to `^1.6.0`** — picks up the new pluggable database backend. Apps that pass a `postgres://` connection string to their latticesql `Lattice` now get a Postgres-backed DataStore for free; SQLite users see no behavior change. Triggered by the standard "republish botinabox after every latticesql release" rule. No botinabox source changes.

## [2.7.0] — 2026-04-13

### Added

- **`ExecutionEngineConfig.resolveContextFiles` hook** — `registerExecutionEngine()` accepts a new optional `resolveContextFiles` resolver on its config. The resolver receives the dispatched `{ agent, task }` rows and returns an array of `ContextFile` objects (`{ path, content }`). Returned files are wrapped in `<file path="...">...</file>` XML tags and inserted into the system prompt between the static `buildSystemContext` block and the tool listing. This lets apps inject per-agent or per-project rendered context (rules, playbooks, agent definitions, project-specific instructions) that is not already covered by the default system context. The resolver owns all filesystem and database lookups — the engine does no I/O of its own — and thrown errors propagate up to fail the task loudly with no silent fallback. All existing `registerExecutionEngine` callers are unaffected because the option is opt-in.
- **`formatContextFilesBlock` exported pure function** — Formats a `ContextFile[]` as the XML-tagged block used by the resolver hook. Returns an empty string for empty input so callers can concatenate unconditionally. Pure, no I/O, covered by new tests in `execution-engine.test.ts`.
- **`ContextFile` exported type** — `{ path: string; content: string }`. Exported alongside the hook so consumers can write typed resolvers.

## [2.6.0] — 2026-04-13

### Added

- **`CliExecutionAdapter` session and settings pass-through** — `execute()` now accepts `sessionId`, `settings`, `appendSystemPrompt`, `addDirs`, and `extraArgs` on the `ctx` parameter. These map to the corresponding `claude` CLI flags (`--session-id`, `--settings`, `--append-system-prompt`, `--add-dir`, plus arbitrary passthrough). Passing a stable `sessionId` across calls lets multi-turn conversations resume the same Claude Code session instead of each dispatch starting fresh. `settings` accepts either a JSON string or a file path and lets callers override values like `autoMemoryDirectory` without mutating the operator's global config. All new parameters are optional — existing callers are unaffected.
- **`buildCliArgs` exported helper** — Pure function that builds the `claude` argv array from a structured input. Extracted from `CliExecutionAdapter.execute()` so consumers can unit-test CLI invocation without spawning a subprocess. Covered by new tests in `cli-adapter.test.ts`.

## [2.5.3] — 2026-04-13

### Added

- **Gmail attachments on `EmailRecord`** — `GoogleGmailConnector.sync()` now populates an `attachments` array on every returned `EmailRecord`. Each entry exposes `attachmentId`, `filename`, `mimeType`, and `size`. Callers can use `attachmentId` with `users.messages.attachments.get` to download the bytes on demand.
- **`EmailAttachment` type** — New exported type from `botinabox/google`.
- **Inline-part filtering** — Parts with a `Content-Disposition: inline` header (e.g. inline signature images) are excluded from `attachments` so the list reflects what a human would call an attachment.

### Changed

- **`EmailRecord.attachments` is required** — The field is non-optional; payloads with no attachments return an empty array. Consumers constructing `EmailRecord` literals (e.g. for `push()`) must include `attachments: []`.

## [2.5.2] — 2026-04-08

### Fixed

- **Agent lookup by role in built-in tools** — `dispatch_task`, `get_agent_status`, `get_agent_detail`, and `reassign_task` now resolve agents by slug, role, or name (case-insensitive). Previously these tools only matched on `slug`, but their descriptions suggested using role names (e.g. "engineer"), causing lookups to fail when the LLM followed the tool description.

### Added

- **`resolveAgent` helper** — Shared agent resolution function exported from `botinabox`. Lookup order: exact slug → exact role → exact name → case-insensitive fallback.
- **Tool agent lookup regression tests** — 11 tests covering slug, role, name, and case-insensitive agent resolution across all agent-resolving tools.

## [2.5.0] — 2026-04-07

### Added

- **GoogleDriveConnector** — New connector that pulls file metadata from Google Drive. Supports full sync (`files.list` with folder, MIME type, and date filters) and incremental sync via the Drive Changes API (`changes.list` with `startPageToken`). Deleted files appear as `trashed: true`. Falls back to full sync on expired tokens (HTTP 403/404). Same auth patterns as Gmail and Calendar (OAuth2 or service account).
- **DriveFileRecord type** — Typed record with `driveFileId`, `name`, `mimeType`, `webViewLink`, `webContentLink`, `modifiedTime`, `createdTime`, `size`, `parents`, `description`, `owners`, `lastModifyingUser`, `starred`, `trashed`.
- **DriveOwner type** — `{ displayName, emailAddress }` for file owners and last modifying user.

## [2.4.3] — 2026-04-06

### Added

- **slugColumn overrides** in `DomainEntityContextOptions` — consumers can now set `projectSlugColumn`, `clientSlugColumn`, `orgSlugColumn`, `fileSlugColumn`, `channelSlugColumn` to control directory naming (default remains `'id'` for backwards compatibility).

## [2.4.0] — 2026-04-06

### Added

- **ChatPipelineV2** — Primary agent architecture replacing the 6-layer "dumb ack + headless execution" pattern. One agent is the conversational hub with full conversation history and tools. Answers simple questions directly, delegates complex work via `dispatch_task`. One response per message instead of separate ack + result.
- **coordinatorTools** — Curated 16-tool set for multi-agent coordinator: task management, agent management, communication, and awareness tools. Excludes "work" tools (read_file, register_file) which are for specialist agents.
- **Typing indicators** — `typing.start` and `typing.stop` events emitted during primary agent processing. Channel adapters can translate to platform-specific indicators.

## [2.3.2] — 2026-04-06

### Fixed

- **Agent output bypasses LLM filter** — Layer 6 (task execution response) now sends agent output with `skipFilter: true`. Previously, agent output was passed through `filterResponse()` which sometimes added meta-commentary like "That's already pretty conversational!" instead of returning the original text.
- **filterResponse prompt hardened** — The LLM rewrite prompt now explicitly forbids meta-commentary about the text, preventing responses like "No rewrite needed" from being sent to users.
- **Ack layer context excludes bot messages** — `ChatResponder.buildContextWindow()` now only includes inbound (user) messages. Previously, verbose prior bot responses were fed back into the ack LLM, causing it to mimic the verbosity and hallucinate system state and actions it cannot perform.

## [2.3.1] — 2026-04-06

### Fixed

- **Forced tool use on first iteration** — ExecutionEngine now sets `tool_choice: { type: 'any' }` on the first LLM call, forcing agents to call at least one tool before responding with text. Previously agents could narrate their intentions without taking action, resulting in tasks that "completed" with no actual work done. Subsequent iterations use `auto` so agents can finish with a text summary after acting.

## [2.3.0] — 2026-04-06

### Fixed

- **Task execution retry** — ExecutionEngine now registers `agent.wakeup` handler so poll-discovered tasks actually execute. Previously, tasks stuck in 'todo' when the assigned agent was locked at creation time because only `task.created` was handled and `agent.wakeup` was emitted but never consumed.
- **Immediate task pickup after run completes** — New `run.completed` handler checks for pending tasks on the freed agent, eliminating up to 30s poll delay between sequential tasks.
- **Retry backoff respected** — `tryExecuteTask` checks `next_retry_at` before executing, preventing premature retries.
- **Race condition guard** — `startRun` failure (agent locked between check and start) is caught gracefully instead of propagating.

### Changed

- **Suppress interpretation noise** — ChatPipeline no longer sends "Noted X things to remember" messages. Memories are still stored by the interpreter; the user just doesn't get a separate notification message for each one. Reduces messages-per-input from 2-3 to 1-2.

### Added

- **`nativeTools` export** — All 20 built-in tools bundled in a single array. Apps can now use `tools: nativeTools` instead of enumerating each tool individually.

## [2.2.1] — 2026-04-06

### Changed

- **Dependency upgrade** — Updated `latticesql` from 1.3.1 to 1.4.0. Includes prepared statement caching, batch entity query resolution, render change detection, and migration validation. No API changes to botinabox.

## [2.1.1] — 2026-04-06

### Fixed

- **Config auto-initialization** — `getConfig()` no longer throws when called before `loadConfig()`. Auto-initializes with defaults. Prevents crashes on Railway when YAML config file is missing from the Docker container.

### Added

- Regression test: "getConfig never crashes even without prior loadConfig/initConfig"

## [2.1.0] — 2026-04-06

### Added

- **Unified config types** — `BotConfig` now includes `ExecutionConfig`, `ChatConfig`, `RoutingConfig`, `SafetyConfig`. All settings in one `botinabox.config.yml` file.

## [2.0.1] — 2026-04-06

### Fixed

- **Auto-generated tool listing** — ExecutionEngine system prompt auto-lists registered tools from their definitions. No manual prompt engineering needed.

## [2.0.0] — 2026-04-06

### Added

- **22 built-in tools across 6 modules** — file ops (send, read, list, register), task ops (dispatch, cancel, reassign), status (task, agent, system, active tasks), roster (list agents, list projects, agent detail), messaging (send message, task comment, read conversation, search conversation), management (create agent, create project). All channel-agnostic. All with LLM-friendly descriptions.
- **`ToolContext`** — tools receive `db`, `hooks`, `resolveFilePath` in their context.
- Recovered 16 previously-removed tools as framework primitives.

## [1.9.3] — 2026-04-05

### Fixed

- **Channel-based context** — ChatResponder uses `getChannelHistory()` (all messages in DM) instead of `getThreadHistory()` (single thread). Thread IDs in DMs are unreliable.

## [1.9.2] — 2026-04-05

### Fixed

- **DM thread stability** — Always use channel ID as thread anchor. Slack auto-threads fragment context.

## [1.9.1] — 2026-04-05

### Fixed

- **latticesql 1.3.1** — EXDEV cross-device rename fix for Docker volume mounts.

## [1.9.0] — 2026-04-05

### Added

- **ExecutionEngine** — generic task executor with pluggable tools and tool loop.
- **SlackBoltAdapter** — real Bolt Socket Mode with auto-registered response/file hooks.
- **`buildSystemContext()`** — shared utility for LLM system prompts.
- **`createDefaultLLMCall()`** — ready-to-use Anthropic SDK wrapper.

## [1.8.5] — 2026-04-05

### Fixed

- **DM conversation context** — use channel ID as stable thread_id for non-threaded DMs.

## [1.8.4] — 2026-04-05

### Fixed

- **Programmatic task creation** — every message creates a task by code, not LLM dependent.
- **JSON markdown fence stripping** — Haiku wraps JSON in fences; strip before parse.
- **Task result delivery** — skip redundancy check on task results.

## [1.8.3] — 2026-04-05

### Fixed

- **Always create tasks** — default to action, execution layer decides.
- **Resilience tests** — LLM failure, invalid JSON, redundancy crash tests.

## [1.8.2] — 2026-04-05

### Added

- **additionalContext** — ChatResponder accepts user history for context.
- **getUserHistory()** — MessageStore queries by user + channel.

## [1.8.1] — 2026-04-05

### Fixed

- **Entity context slug validation** — Switched all domain entity contexts (`org`, `project`, `client`, `channel`, `file`) and `users` from `name`-based slugs to `id`-based slugs. Names with spaces, unicode, or special characters caused "path traversal detected" errors during `db.render()` in cloud environments.

## [1.8.0] — 2026-04-05

### Added

- **Chat pipeline** — `ChatPipeline` class provides a configurable 6-layer chat orchestration pipeline. Apps provide system prompt, routing rules, and LLM call function; the framework handles dedup, storage, fast ack, async interpretation, task dispatch, and completion response. Replaces ~400 lines of duplicated handler code per app with ~20 lines of config.
- **`thread_task_map` core table** — Maps chat threads to tasks for response routing. Previously required per-app table definitions.
- **`message_dedup` core table** — SHA256-based message deduplication with configurable time window. Previously required per-app table definitions.

### Changed

- Core table count: 25 → 27 (added `thread_task_map`, `message_dedup`).
- `ChatPipeline` emits `interpretation.error` hook on interpretation failures (no longer swallowed silently).

## [1.7.0] — 2026-04-05

### Added

- **Chat response layer** — `ChatResponder` class provides fast (<2s) conversational responses via a cheap LLM (Haiku). Rolling context window from thread history. All outbound messages filtered through LLM for human readability. LLM-based redundancy check suppresses duplicate messages. Full send pipeline: redundancy → filter → store → deliver. Emits `response.ready` and `response.suppressed` hooks.
- **Message store** — `MessageStore` class with store-before-respond guarantee. Inbound messages and attachments are stored before any bot response. Outbound messages stored before sending. Thread history and recent outbound queries for context building and redundancy checking. Emits `message.stored` hook.
- **Message interpretation** — `MessageInterpreter` class for async structured extraction from messages. Pluggable `Extractor` interface for custom data types. Built-in LLM extraction for tasks, memories, and user context. Stores extracted memories in the `memories` table. Emits `interpretation.completed` hook.
- **`memories` core table** — Structured memory storage for notes, thoughts, voice memos, and user context. Fields: summary, contents, tags (JSON), category. Linked to messages and users. The deliberate catchall for unstructured information.
- **`message_attachments` core table** — File storage linked to messages. Fields: file_type, filename, mime_type, contents (transcript/description/markdown), summary (one-line). Supports image, file, audio, and video types.

### Changed

- Core table count: 23 → 25 (added `memories`, `message_attachments`).

## [1.6.0] — 2026-04-05

### Added

- **Loop detection** — `LoopDetector` class scans agent routing history for self-loops, ping-pong patterns (A→B→A→B), and blocked re-entry. Complements the existing chain depth guard with active pattern detection.
- **Circuit breaker** — `CircuitBreaker` class with CLOSED/OPEN/HALF_OPEN states, configurable failure thresholds, automatic human escalation via `circuit_breaker.tripped` hook, and manual reset. Emits `circuit_breaker.recovered` and `circuit_breaker.reset` events.
- **RunManager + CircuitBreaker integration** — `RunManager.setCircuitBreaker(cb)` injects a circuit breaker. Failed runs record failures; successful runs record recovery. Retries are skipped when the circuit is open.
- **Deterministic adapter** — `DeterministicAdapter` executes user-specified scripts (Python, Node, bash) without any LLM calls. For routing, validation, and data-fetching tasks that don't need reasoning. Supports stdin and arg input modes with configurable timeout.
- **Triage routing** — `TriageRouter` replaces static channel→agent bindings with content-aware routing: keyword matching, regex patterns, priority ordering, and LLM fallback for ambiguous messages. Logs an ownership chain for every routing decision via `triage.routed` hook.
- **Learning pipeline** — `LearningPipeline` class for turning execution experience into durable knowledge. Structured feedback capture with severity and two-axis scoring (accuracy + efficiency). Auto-promotes to playbook after 3+ similar feedback records. Promotes playbook to skill when used by 3+ agents. New tables: `feedback`, `playbooks`, `agent_playbooks`.
- **Permission relay** — `PermissionRelay` posts approval prompts to messaging platforms and polls for responses. Provider interface for Slack/Discord/Telegram/SMS. Dual approval (local terminal + remote, first wins). Timeout and cancellation support.
- **Governance gates** — `GovernanceGate` base class with `QAGate` (data correctness), `QualityGate` (code quality), and `DriftGate` (architectural drift). `GateRunner` orchestrates independent gates that report to the human operator, not to each other. Emits `governance.gate_completed` and `governance.review_completed` hooks.
- **Agent context: SKILLS.md and PLAYBOOKS.md** — `defineCoreEntityContexts()` now renders per-agent SKILLS.md (via `agent_skills` junction) and PLAYBOOKS.md (via `agent_playbooks` junction) alongside the existing AGENT.md.

### Changed

- Core table count: 20 → 23 (added `feedback`, `playbooks`, `agent_playbooks`).

### Deprecated

- **`buildAgentBindings()`** — Use `TriageRouter` for content-aware routing with keyword/regex matching and LLM fallback. Static channel→agent bindings are kept for backward compatibility.

## [1.5.0] — 2026-04-04

### Fixed

- **Message source links** — Messages in MESSAGES.md now render as `[timestamp](messages/{id}/)` linking to the source message object.
- **Files in project context** — Projects now render FILES.md showing files linked via `file.project_id`.

## [1.4.2] — 2026-04-04

### Added

- Optional secret encryption in `SecretStore` — pass `encryptionKey` to constructor for AES-256-GCM at-rest encryption. Existing plaintext secrets readable transparently (migration-safe).

### Security

- **CRITICAL**: Fixed command injection in `autoUpdate()` — replaced `execSync` shell string with `execFileSync` array form + semver validation
- **CRITICAL**: Fixed command injection in FFmpeg transcription — replaced shell string with `execFileSync` array args
- **HIGH**: Fixed path traversal in entity slug rendering — validates slugs reject `/`, `\`, `..`
- **HIGH**: Added at-rest encryption for secrets in `SecretStore` via AES-256-GCM
- **MEDIUM**: Fixed deferred SQL injection — rejects multi-statement DDL (semicolons)
- **MEDIUM**: Fixed prototype pollution in Scheduler — filters `__`-prefixed keys from action_config
- **MEDIUM**: Fixed information disclosure in webhook server — returns generic errors to clients
- **LOW**: Fixed ReDoS in email address parsing — replaced regex with linear-time parser
- **LOW**: Tightened googleapis peer dependency to `>=140.0.0 <200.0.0`

## [1.4.0] — 2026-04-04

### Changed

- **Auto-combined entity context** — Entity primary files (PROJECT.md, CLIENT.md, etc.) now automatically contain all connected context (repos, rules, messages, invoices) in a single file. Powered by latticesql 1.2.0 auto-combined rendering. No explicit `combined` config required.
- Bumped `latticesql` to `^1.2.0`.

## [1.3.0] — 2026-04-04

### Added

- **Local voice transcription** — When Slack's built-in transcription is unavailable, the Slack adapter now downloads the audio file and transcribes locally via `whisper-node` (whisper.cpp C++ bindings). Requires `ffmpeg` on the system PATH. New exports from `botinabox/slack`: `transcribeAudio()`, `downloadAudio()`, `enrichVoiceMessage()`, `TranscribeOptions`, `TranscribeResult`.
- `whisper-node` added as optional dependency — transcription degrades gracefully if not installed.

## [1.2.1] — 2026-04-04

### Fixed

- Bug fixes and stability improvements.

### Dependencies

- Bumped `latticesql` dependency to `^1.1.1`.

## [1.2.0] — 2026-04-04

### Added

- **`autoUpdate()` function** — Checks npm for newer versions of framework packages at startup and installs them automatically. Accepts optional package list and options.

## [1.1.0] — 2026-04-04

### Added

- **Voice message support** — Slack adapter now handles `file_share` subtype with audio files. Extracts transcription from Slack voice messages and includes it in the message body prefixed with `[Voice message]`. Falls back to file preview text when transcription is unavailable. New exports: `extractVoiceTranscript()`, `SlackFile` type from `botinabox/slack`.
- **`truncateAtWord()` utility** — Truncates text at the nearest word boundary without splitting words. Exported from `botinabox`.
- **`SecretStore.loadCursor()` / `saveCursor()`** — Convenience methods for persisting sync cursors (e.g. Gmail historyId, Calendar syncToken) in the secrets table.
- **Domain schema upgrades** — New columns and junction tables for domain tables. `MESSAGES.md` entity context rendering.

## [1.0.0] — 2026-04-04

### Changed

- **Stable release** — botinabox is now 1.0.0. The API is considered stable. Consumers using `^1.0.0` will automatically receive all non-breaking updates.
- **latticesql ^1.0.0** — updated dependency to latticesql 1.0.

## [0.6.0] — 2026-04-04

### Removed

- **HeartbeatScheduler** — Deleted deprecated in-memory heartbeat scheduler. Use `Scheduler` (database-backed, cron-based) instead.
- **LATTICE-GAPS.md** — Removed internal gap-tracking document from docs.

### Changed

- **Full documentation rewrite** — All docs rewritten with correct import paths (`from 'botinabox'`), practical code examples, and complete API coverage. Added new `docs/connectors.md` for Google Gmail/Calendar integration.
- **README** — Rewritten with correct single-package structure, quick start, architecture diagram, and core concepts.

## [0.5.6] — 2026-04-04

### Added

- **CLI update checker** — `botinabox` CLI now checks for new versions in the background and prints a notice when an update is available. Cached for 24 hours.
- **`botinabox update` command** — self-update to the latest version from npm.
- **`botinabox --version` flag** — print current version.
- **CI/CD pipelines** — GitHub Actions for CI (typecheck, test, build on push/PR) and automated npm publishing with provenance on tag push.

### Fixed

- **cost-tracker** — uses correct `ModelInfo` field names (`inputCostPerMToken`/`outputCostPerMToken`).

## [0.5.3] — 2026-04-04

### Added

- **Service account auth for Google connectors** — `GoogleConnectorConfig` now supports `serviceAccount` with `keyFile` or inline `credentials` + `subject` for domain-wide delegation. Works headless in cloud deployments. Both `GoogleGmailConnector` and `GoogleCalendarConnector` auto-detect auth mode from config (service account vs OAuth2).
- **`createServiceAccountClient()`** — new OAuth helper for service account JWT auth with impersonation.
- Constructor opts are now optional on both Google connectors (not needed for service account auth).

## [0.5.2] — 2026-04-04

### Added

- **`authenticate()` method on Connector interface** — optional method for connectors that require OAuth or other auth flows. Accepts a `codeProvider` callback for interactive or programmatic authorization.
- **Google connectors implement `authenticate()`** — `GoogleGmailConnector` and `GoogleCalendarConnector` now support self-authentication: generate consent URL, exchange code for tokens, persist via tokenSaver callback.
- **`botinabox auth google` CLI** — native CLI command for Google OAuth setup: `botinabox auth google <account-email> --client-id=... --client-secret=...`. Stores tokens in the secrets table.

## [0.5.1] — 2026-04-04

### Fixed

- **cron-parser ESM import** — cron-parser v4 is CommonJS-only; fixed named import to default import (`import cronParser from "cron-parser"`).

## [0.5.0] — 2026-04-04

### Added

- **Connector interface** — Generic `Connector<T>` abstraction for external service integrations (Gmail, Calendar, Trello, Jira, Salesforce, etc.). Pull-based `sync()` returns typed records; optional `push()` writes back. Connectors produce data — consumers decide where to store it. New `connectors` config key in `BotConfig`.
- **Google connectors** — `GoogleGmailConnector` and `GoogleCalendarConnector` implementing `Connector<EmailRecord>` and `Connector<CalendarEventRecord>`. Incremental sync (Gmail historyId, Calendar syncToken), full sync with pagination, email sending via `push()`. OAuth2 helpers with callback-based token persistence. Exported from `botinabox/google`. `googleapis` as optional peer dependency.
- **Scheduler** — Database-backed `Scheduler` class with `schedules` core table. Supports recurring (cron expressions via `cron-parser`) and one-time schedules. Hook-based actions: when a schedule fires, it emits the configured action as a hook event. Methods: `register()`, `update()`, `unregister()`, `list()`, `tick()`.
- **`schedules` core table** — id, name, type (recurring/one_time), cron, run_at, timezone, enabled, action, action_config, last_fired_at, next_fire_at.

### Deprecated

- **HeartbeatScheduler** — Replaced by `Scheduler`. HeartbeatScheduler uses in-memory `setInterval` which loses state on restart. Kept for backward compatibility but marked `@deprecated`.

### Dependencies

- Added `cron-parser` ^4.9.0.
- Added `googleapis` >=140.0.0 as optional peer dependency.

## [0.3.0] — 2026-04-03

### Added

- **Domain tables** — `defineDomainTables(db, options?)` creates standard multi-agent app tables: org, project, client, invoice, repository, file, channel, rule, event + junction tables. Configurable: disable clients, repos, files, channels, rules, or events.
- **Domain entity contexts** — `defineDomainEntityContexts(db, options?)` renders per-entity context directories for all domain tables. Projects get REPOS.md + RULES.md. Clients get REPOS.md + AGENTS.md + INVOICES.md.
- **Claude stream parser** — `parseClaudeStream(stdout)` parses Claude CLI NDJSON output into structured results (session, model, cost, tokens, text, errors). Plus `isMaxTurns()`, `isLoginRequired()`, `deactivateLocalImagePaths()`.
- **Process env builder** — `buildProcessEnv(allowedKeys?, inject?)` creates a clean subprocess environment with only safe variables. Strips all secrets.

## [0.2.0] — 2026-04-03

### Added

- **Users primitive** — `users` and `user_identities` core tables. Users are protected objects (never auto-rendered into other entities' context). `UserRegistry` class: `register()`, `getById()`, `getByEmail()`, `resolveByIdentity()`, `resolveOrCreate()`, `addIdentity()`.
- **Secrets primitive** — `secrets` core table for encrypted credential storage. Protected by default. `SecretStore` class: `set()`, `get()`, `getMeta()`, `list()`, `rotate()`, `delete()`.
- **Message pipeline user resolution** — `MessagePipeline` accepts optional `UserRegistry`. When provided, resolves `InboundMessage.from` to a user ID via `resolveOrCreate()` before task creation. `InboundMessage.userId` field added.
- **`user_id` on messages table** — Tracks resolved user alongside raw `peer_id`.
- **Protected/encrypted passthrough** — `EntityContextDef` now supports `protected` and `encrypted` fields, passed through to Lattice's entity context system.

### Changed

- Core table count: 15 → 18 (added `users`, `user_identities`, `secrets`).
- `messages` table gains `user_id` column.

## [0.1.1] — 2026-03-28

### Fixed

- Initial release bug fixes and stability improvements.

## [0.1.0] — 2026-03-25

### Added

- Initial release: DataStore, HookBus, AgentRegistry, TaskQueue, RunManager, WakeupQueue, BudgetController, WorkflowEngine, SessionManager, ChannelRegistry, MessagePipeline.
- 15 core tables, LLM provider routing, channel adapters (Slack, Discord, Webhook).
