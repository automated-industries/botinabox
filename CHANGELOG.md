# Changelog

All notable changes to `botinabox` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

---

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
