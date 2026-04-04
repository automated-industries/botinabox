# Changelog

All notable changes to `botinabox` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

---

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
