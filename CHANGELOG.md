# Changelog

All notable changes to `botinabox` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

---

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
