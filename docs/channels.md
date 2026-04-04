# Channel Adapters

Channel adapters connect your bot to messaging platforms. Each adapter implements the `ChannelAdapter` interface and is registered with the `ChannelRegistry` for lifecycle management.

Adapters are subpath imports -- install botinabox once, then import the adapter you need:

```typescript
import { ChannelRegistry } from 'botinabox';
import { SlackAdapter } from 'botinabox/slack';
import { DiscordAdapter } from 'botinabox/discord';
import { WebhookAdapter } from 'botinabox/webhook';
```

---

## Channel Registry

The `ChannelRegistry` manages adapter lifecycle: registration, connection, health checks, reconfiguration, and shutdown.

```typescript
import { ChannelRegistry } from 'botinabox';
import { SlackAdapter } from 'botinabox/slack';
import { DiscordAdapter } from 'botinabox/discord';

const registry = new ChannelRegistry();

// Register adapters with their config
registry.register(new SlackAdapter(), {
  botToken: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
});

registry.register(new DiscordAdapter(), {
  token: process.env.DISCORD_BOT_TOKEN,
});

// Start all channels (calls connect() on each adapter)
await registry.start();

// Health check all channels
const health = await registry.healthCheck();
// => { slack: { ok: true }, discord: { ok: true } }

// Reconfigure a channel at runtime (disconnects, updates config, reconnects)
await registry.reconfigure('slack', {
  botToken: process.env.NEW_SLACK_BOT_TOKEN,
});

// Check if an adapter is registered
registry.has('slack'); // => true

// Get a specific adapter
const slack = registry.get('slack');

// List all registered adapters
const adapters = registry.list();

// Remove a single channel
await registry.unregister('slack');

// Stop all channels (calls disconnect() on each)
await registry.stop();
```

### API

| Method | Returns | Description |
|--------|---------|-------------|
| `register(adapter, config?)` | `void` | Register an adapter. If already started, connects immediately. Throws on duplicate ID. |
| `unregister(id)` | `Promise<void>` | Disconnect and remove an adapter. |
| `reconfigure(id, config)` | `Promise<void>` | Disconnect, update config, reconnect. Throws if not found. |
| `start()` | `Promise<void>` | Connect all registered adapters. |
| `stop()` | `Promise<void>` | Disconnect all registered adapters. |
| `healthCheck()` | `Promise<Record<string, HealthStatus>>` | Run health checks on all adapters. |
| `has(id)` | `boolean` | Check if an adapter is registered. |
| `get(id)` | `ChannelAdapter \| undefined` | Get adapter by ID. |
| `list()` | `ChannelAdapter[]` | All registered adapters. |

---

## ChannelAdapter Interface

Every channel adapter implements this interface:

```typescript
import type {
  ChannelAdapter,
  ChannelMeta,
  ChannelCapabilities,
  ChannelConfig,
  HealthStatus,
  InboundMessage,
  OutboundPayload,
  SendResult,
} from 'botinabox';

interface ChannelAdapter {
  readonly id: string;
  readonly meta: ChannelMeta;
  readonly capabilities: ChannelCapabilities;

  connect(config: ChannelConfig): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<HealthStatus>;
  send(
    target: { peerId: string; threadId?: string },
    payload: OutboundPayload,
  ): Promise<SendResult>;

  // Set by the framework when the adapter is wired into the pipeline
  onMessage?: (message: InboundMessage) => Promise<void>;
}
```

### ChannelMeta

```typescript
interface ChannelMeta {
  displayName: string;
  icon?: string;
  homepage?: string;
}
```

### ChannelCapabilities

```typescript
interface ChannelCapabilities {
  chatTypes: ChatType[];            // 'direct' | 'group' | 'channel'
  threads: boolean;
  reactions: boolean;
  editing: boolean;
  media: boolean;
  polls: boolean;
  maxTextLength: number;
  formattingMode: FormattingMode;   // 'markdown' | 'mrkdwn' | 'html' | 'plain'
}
```

### Key Types

```typescript
interface InboundMessage {
  id: string;
  channel: string;
  account?: string;
  from: string;              // Raw peer ID from the platform (e.g. Slack user ID)
  userId?: string;           // Resolved botinabox user ID (set by the pipeline)
  body: string;
  threadId?: string;
  replyToId?: string;
  attachments?: Attachment[];
  receivedAt: string;        // ISO 8601
  raw?: unknown;             // Original platform event
}

interface OutboundPayload {
  text: string;
  threadId?: string;
  replyToId?: string;
  attachments?: Attachment[];
}

interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface HealthStatus {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}
```

---

## Message Pipeline

The `MessagePipeline` processes inbound messages end-to-end: resolving the user, routing to an agent, evaluating policies, and creating a task.

```typescript
import { MessagePipeline } from 'botinabox';

const pipeline = new MessagePipeline(
  hooks,
  agentRegistry,
  taskQueue,
  botConfig,
  userRegistry,   // optional
);

// Process a message (usually called by the adapter's onMessage callback)
await pipeline.processInbound(message);
```

### Processing Flow

1. **Emit `message.inbound` hook** -- lets plugins inspect or modify the message.
2. **Resolve user** -- if a `UserRegistry` is provided and the message has no `userId`, the sender is resolved (or auto-created) from their platform ID.
3. **Resolve agent** -- looks up which agent handles this channel via agent-channel bindings. Falls back to the first agent in config.
4. **Evaluate policy** -- checks allowlist and mention gate rules from channel config.
5. **Create task** -- inserts a task into the `TaskQueue` assigned to the resolved agent.
6. **Emit `message.processed` hook** -- signals completion with the resolved agent and user IDs.

### Agent-Channel Bindings

Agents declare which channel they handle via their config:

```yaml
agents:
  - slug: support-bot
    name: Support Bot
    adapter: api
    model: fast
    config:
      channel: slack
```

The pipeline calls `buildAgentBindings()` to create a lookup map from channel ID to agent slug.

### Policies

**Allowlist** -- restrict which platform users can interact with the bot:

```yaml
channels:
  slack:
    enabled: true
    allowFrom:
      - U0123456789
      - U9876543210
```

```typescript
import { checkAllowlist } from 'botinabox';

// Returns true if the sender is in the allowFrom list (or list is empty)
checkAllowlist(['U0123456789'], message.from);
```

**Mention gate** -- only process messages that explicitly mention the bot:

```yaml
channels:
  slack:
    enabled: true
    requireMention: true
```

```typescript
import { checkMentionGate } from 'botinabox';

// Returns true if the message body mentions the agent ID
checkMentionGate(message, agentId);
```

---

## Notification Queue

The `NotificationQueue` provides reliable outbound message delivery with persistence and automatic retries.

```typescript
import { NotificationQueue } from 'botinabox';

const queue = new NotificationQueue(db, hooks, channelRegistry, {
  maxRetries: 3,         // default: 3
  pollIntervalMs: 5000,  // default: 5000
});
```

### Enqueue a message

```typescript
const notificationId = await queue.enqueue('slack', 'C1234567890', {
  text: 'Your task has been completed.',
  threadId: '1234567890.123456',
});
```

### Start/stop the background worker

The worker polls the `notifications` table for pending messages and delivers them through the appropriate channel adapter.

```typescript
// Start polling
queue.startWorker();

// Stop polling
queue.stopWorker();
```

### Retry behavior

- Notifications are stored in the `notifications` table with status `pending`.
- On successful delivery, status becomes `sent` with a `sent_at` timestamp.
- On failure, `retries` is incremented. If `retries >= maxRetries`, status becomes `failed`.
- The `notification.enqueued`, `notification.sent`, and `notification.failed` hooks fire at each stage.

---

## Slack Adapter

Import from `botinabox/slack`.

```typescript
import { SlackAdapter } from 'botinabox/slack';
import type { SlackConfig, SlackEvent } from 'botinabox/slack';
import { parseSlackEvent, formatForSlack } from 'botinabox/slack';
```

### Setup

```typescript
const slack = new SlackAdapter(boltClient); // Optional: inject a Bolt-compatible client

registry.register(slack, {
  botToken: process.env.SLACK_BOT_TOKEN!,
  appToken: process.env.SLACK_APP_TOKEN,       // For Socket Mode
  signingSecret: process.env.SLACK_SIGNING_SECRET,  // For HTTP mode
} satisfies SlackConfig);
```

### SlackConfig

```typescript
interface SlackConfig {
  botToken: string;
  appToken?: string;        // Required for Socket Mode
  signingSecret?: string;   // Required for HTTP verification
}
```

### Capabilities

| Feature | Value |
|---------|-------|
| Chat types | direct, group, channel |
| Threads | Yes |
| Reactions | Yes |
| Editing | Yes |
| Media | Yes |
| Max text length | 40,000 chars |
| Formatting | `mrkdwn` (Slack's variant) |

### Message Format Conversion

Slack uses `mrkdwn` instead of standard markdown. The adapter automatically converts outbound messages:

```typescript
import { formatForSlack } from 'botinabox/slack';

formatForSlack('**bold text**');
// => '*bold text*'   (Slack uses single asterisks for bold)

formatForSlack('__also bold__');
// => '*also bold*'
```

Inbound Slack events are parsed into `InboundMessage`:

```typescript
import { parseSlackEvent } from 'botinabox/slack';

const msg = parseSlackEvent({
  type: 'message',
  channel: 'C1234567890',
  user: 'U9876543210',
  text: 'Hello bot!',
  ts: '1234567890.123456',
  thread_ts: '1234567890.000000',
});
// => { id: '...', channel: 'C1234567890', from: 'U9876543210', body: 'Hello bot!', ... }
```

### Sending Messages

```typescript
const result = await slack.send(
  { peerId: 'C1234567890', threadId: '1234567890.123456' },
  { text: 'Task completed successfully.' },
);
// => { success: true, messageId: '1234567891.000000' }
```

### BoltClient Interface

The adapter accepts a minimal `BoltClient` interface for dependency injection and testing:

```typescript
interface BoltClient {
  postMessage(
    channel: string,
    text: string,
    threadTs?: string,
  ): Promise<{ ok: boolean; ts?: string }>;
}
```

### YAML Config

```yaml
channels:
  slack:
    enabled: true
    botToken: ${SLACK_BOT_TOKEN}
    appToken: ${SLACK_APP_TOKEN}
    signingSecret: ${SLACK_SIGNING_SECRET}
```

---

## Discord Adapter

Import from `botinabox/discord`.

```typescript
import { DiscordAdapter } from 'botinabox/discord';
import type { DiscordConfig, DiscordEvent } from 'botinabox/discord';
import { formatForDiscord, chunkForDiscord } from 'botinabox/discord';
```

### Setup

```typescript
const discord = new DiscordAdapter(discordClient); // Optional: inject client

registry.register(discord, {
  token: process.env.DISCORD_BOT_TOKEN!,
  guildId: process.env.DISCORD_GUILD_ID,  // Optional: restrict to one guild
} satisfies DiscordConfig);
```

### DiscordConfig

```typescript
interface DiscordConfig {
  token: string;
  guildId?: string;
}
```

### Capabilities

| Feature | Value |
|---------|-------|
| Chat types | direct, group, channel |
| Threads | Yes |
| Reactions | Yes |
| Editing | Yes |
| Media | Yes |
| Max text length | 2,000 chars |
| Formatting | `markdown` (native Discord markdown) |

### Chunking for the 2,000 Character Limit

Discord enforces a 2,000 character limit per message. Use `chunkForDiscord()` to split long text into multiple messages:

```typescript
import { chunkForDiscord } from 'botinabox/discord';

const chunks = chunkForDiscord(longText);
// => ['First 2000 chars...', 'Next chunk...', ...]

// Chunks split at word boundaries when possible
for (const chunk of chunks) {
  await discord.send({ peerId: channelId }, { text: chunk });
}
```

### Message Formatting

Discord uses native markdown -- no conversion is needed. `formatForDiscord()` returns the text unchanged:

```typescript
import { formatForDiscord } from 'botinabox/discord';

formatForDiscord('**bold** and _italic_');
// => '**bold** and _italic_'  (unchanged)
```

### DiscordClient Interface

```typescript
interface DiscordClient {
  sendMessage(channelId: string, content: string): Promise<{ id: string }>;
}
```

### YAML Config

```yaml
channels:
  discord:
    enabled: true
    token: ${DISCORD_BOT_TOKEN}
    guildId: ${DISCORD_GUILD_ID}
```

---

## Webhook Adapter

Import from `botinabox/webhook`. A generic HTTP-based adapter for custom integrations.

```typescript
import { WebhookAdapter, WebhookServer, verifyHmac } from 'botinabox/webhook';
import type { WebhookConfig, WebhookServerOpts } from 'botinabox/webhook';
```

### Setup

```typescript
const webhook = new WebhookAdapter();

registry.register(webhook, {
  port: 8080,
  secret: process.env.WEBHOOK_SECRET,
  callbackUrl: 'https://example.com/outbound',
} satisfies WebhookConfig);
```

### WebhookConfig

```typescript
interface WebhookConfig {
  port?: number;           // HTTP server listen port (inbound)
  secret?: string;         // HMAC-SHA256 shared secret
  callbackUrl?: string;    // URL to POST outbound messages to
}
```

### Capabilities

| Feature | Value |
|---------|-------|
| Chat types | direct only |
| Threads | No |
| Reactions | No |
| Editing | No |
| Media | No |
| Max text length | 65,535 chars |
| Formatting | `plain` |

### Inbound: WebhookServer

When `port` is set in the config, the adapter starts an HTTP server on `connect()`. The server listens for POST requests to `/webhook/inbound`.

```typescript
// The WebhookServer can also be used standalone
import { WebhookServer } from 'botinabox/webhook';

const server = new WebhookServer({
  port: 3200,
  secret: 'my-hmac-secret',
  onMessage: async (msg) => {
    console.log('Received:', msg.body);
  },
});

await server.start();
// POST http://localhost:3200/webhook/inbound
// Body: { "id": "msg-1", "from": "external-system", "text": "Hello" }

await server.stop();
```

Expected inbound JSON payload:

```json
{
  "id": "unique-message-id",
  "from": "sender-identifier",
  "text": "The message body",
  "threadId": "optional-thread-id"
}
```

### HMAC Verification

When a `secret` is configured, all inbound requests must include an `X-Webhook-Signature` header containing the HMAC-SHA256 hex digest of the request body. The signature may optionally be prefixed with `sha256=`.

```typescript
import { verifyHmac } from 'botinabox/webhook';

// Returns true if the signature is valid
const valid = verifyHmac(requestBody, 'my-secret', signatureHeader);
```

The verification uses timing-safe comparison to prevent timing attacks.

### Outbound

When `callbackUrl` is configured, the `send()` method POSTs to that URL:

```typescript
await webhook.send(
  { peerId: 'recipient-id' },
  { text: 'Hello from the bot!' },
);
// POSTs to callbackUrl: { to: 'recipient-id', text: 'Hello from the bot!' }
```

### YAML Config

```yaml
channels:
  webhook:
    enabled: true
    port: 8080
    secret: ${WEBHOOK_SECRET}
    callbackUrl: https://your-app.com/bot-messages
```

---

## Session Management

Chat sessions track conversation state across messages. The `ChatSessionManager` stores state per agent + channel + peer combination.

```typescript
import { ChatSessionManager, SessionKey } from 'botinabox';

const sessions = new ChatSessionManager(db);
```

### SessionKey

A `SessionKey` uniquely identifies a session by agent, channel, and scope:

```typescript
const key = new SessionKey('my-agent', 'slack', 'U123456');
key.toString();
// => 'agent:my-agent:slack:U123456'
```

### Building session keys with scoping strategies

`SessionKey.build()` handles different scoping strategies automatically:

```typescript
// One session per user (most common)
const perPeer = SessionKey.build('bot', 'slack', 'dm', 'U123', 'per-peer');
// => agent:bot:slack:U123

// Single shared session for all users on a channel
const shared = SessionKey.build('bot', 'slack', 'dm', 'U123', 'main');
// => agent:bot:slack:main

// Separate per channel + user (for multi-workspace bots)
const perChannelPeer = SessionKey.build('bot', 'slack', 'dm', 'U123', 'per-channel-peer');
// => agent:bot:slack:slack:U123

// Group chats are always scoped to the channel
const group = SessionKey.build('bot', 'slack', 'group', 'C456', 'per-peer');
// => agent:bot:slack:C456
```

| Scope | Session Key | Use Case |
|-------|-------------|----------|
| `main` | `agent:{id}:{channel}:main` | Single shared session per agent+channel |
| `per-peer` | `agent:{id}:{channel}:{peerId}` | Separate session per user |
| `per-channel-peer` | `agent:{id}:{channel}:{channel}:{peerId}` | Separate per channel+user combination |

### Save, load, clear

```typescript
const key = SessionKey.build('bot', 'slack', 'dm', 'U123', 'per-peer');

// Save session state (any serializable object)
await sessions.save(key, {
  history: [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there!' },
  ],
  runCount: 1,
});

// Load session state
const state = await sessions.load(key);
// => { history: [...], runCount: 1 } or undefined

// Clear session
await sessions.clear(key);
```

### Automatic session expiry

Check if a session should be cleared based on age or run count:

```typescript
const shouldReset = await sessions.shouldClear(state, {
  maxRuns: 50,       // Clear after 50 interactions
  maxAgeHours: 24,   // Clear after 24 hours
});

if (shouldReset) {
  await sessions.clear(key);
}
```

---

## Text Formatting

The `formatText()` function converts standard markdown to channel-specific formats. Use it when sending messages to channels with different formatting rules.

```typescript
import { formatText } from 'botinabox';

// Slack's mrkdwn: **bold** becomes *bold*
formatText('**bold** and _italic_', 'mrkdwn');
// => '*bold* and _italic_'

// HTML: markdown becomes HTML tags
formatText('**bold** and `code`', 'html');
// => '<strong>bold</strong> and <code>code</code>'

// Plain: strip all markdown markers
formatText('**bold** and `code`', 'plain');
// => 'bold and code'
```

### Supported modes

| Mode | Input | Output |
|------|-------|--------|
| `mrkdwn` | `**bold**` | `*bold*` |
| `mrkdwn` | `` `code` `` | `` `code` `` |
| `html` | `**bold**` | `<strong>bold</strong>` |
| `html` | `` `code` `` | `<code>code</code>` |
| `html` | ```` ```block``` ```` | `<pre><code>block</code></pre>` |
| `plain` | `**bold**` | `bold` |
| `plain` | `` `code` `` | `code` |

---

## Text Chunking

The `chunkText()` function splits long text into chunks that respect character limits. It splits at natural boundaries: paragraphs first, then sentences, then words, then hard-cuts.

```typescript
import { chunkText } from 'botinabox';

// Split for Discord's 2000-char limit
const chunks = chunkText(longMessage, 2000);

// Split for any custom limit
const smsChunks = chunkText(message, 160);
```

The splitting priority order:

1. Paragraph boundaries (`\n\n`)
2. Sentence boundaries (`. `)
3. Word boundaries (` `)
4. Hard cut (exact character position)

---

## Building a Custom Channel Adapter

Implement the `ChannelAdapter` interface and optionally export a factory function.

```typescript
import type {
  ChannelAdapter,
  ChannelMeta,
  ChannelCapabilities,
  ChannelConfig,
  HealthStatus,
  InboundMessage,
  OutboundPayload,
  SendResult,
} from 'botinabox';

class TelegramAdapter implements ChannelAdapter {
  readonly id = 'telegram';

  readonly meta: ChannelMeta = {
    displayName: 'Telegram',
    icon: 'https://telegram.org/favicon.ico',
    homepage: 'https://telegram.org',
  };

  readonly capabilities: ChannelCapabilities = {
    chatTypes: ['direct', 'group'],
    threads: false,
    reactions: true,
    editing: true,
    media: true,
    polls: true,
    maxTextLength: 4096,
    formattingMode: 'html',
  };

  onMessage?: (message: InboundMessage) => Promise<void>;

  private botToken: string | null = null;

  async connect(config: ChannelConfig): Promise<void> {
    this.botToken = config.botToken as string;
    // Set up webhook or long polling with Telegram Bot API
  }

  async disconnect(): Promise<void> {
    this.botToken = null;
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this.botToken) return { ok: false, error: 'Not connected' };
    // Call Telegram getMe API
    return { ok: true };
  }

  async send(
    target: { peerId: string; threadId?: string },
    payload: OutboundPayload,
  ): Promise<SendResult> {
    // Call Telegram sendMessage API
    const response = await fetch(
      `https://api.telegram.org/bot${this.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: target.peerId,
          text: payload.text,
          parse_mode: 'HTML',
          reply_to_message_id: target.threadId,
        }),
      },
    );

    const data = await response.json();
    return {
      success: data.ok,
      messageId: String(data.result?.message_id),
    };
  }
}

export default function createTelegramAdapter(): TelegramAdapter {
  return new TelegramAdapter();
}
```

Register your custom adapter:

```typescript
import createTelegramAdapter from './telegram-adapter.js';

registry.register(createTelegramAdapter(), {
  botToken: process.env.TELEGRAM_BOT_TOKEN,
});
```

---

## Voice Message Transcription

The Slack adapter includes built-in voice message support. When a user sends a voice message (audio clip), the adapter:

1. Checks for Slack's built-in transcription (available on some plans)
2. If unavailable, downloads the audio and transcribes locally via [whisper-node](https://www.npmjs.com/package/whisper-node) (whisper.cpp bindings)

### Setup

```bash
# Install whisper-node (optional dependency — transcription degrades gracefully without it)
npm install whisper-node

# Download a Whisper model
npx whisper-node download
# Choose "base.en" for English-only (fast) or "base" for multilingual

# Ensure ffmpeg is installed (required for audio format conversion)
brew install ffmpeg    # macOS
apt install ffmpeg     # Ubuntu/Debian
```

### How It Works

Voice messages arrive as `file_share` events with audio attachments. The adapter processes them automatically:

```
Slack voice message
  → parseSlackEvent() extracts Slack transcript (if available)
  → enrichVoiceMessage() downloads audio + transcribes locally (if no Slack transcript)
  → Message body: "[Voice message] Hey, can you check the deploy status?"
```

### Using Transcription Directly

You can also use the transcription utilities independently:

```typescript
import { transcribeAudio, downloadAudio, enrichVoiceMessage } from 'botinabox/slack';

// Transcribe a local audio buffer
const transcript = await transcribeAudio(audioBuffer, 'recording.m4a', {
  modelName: 'base.en',  // Whisper model (default: 'base.en')
  language: 'auto',       // Language detection (default: 'auto')
});

// Download audio from Slack
const buffer = await downloadAudio(fileUrl, botToken);

// Enrich a parsed message with local transcription
const enriched = await enrichVoiceMessage(parsedMessage, botToken);
```

### Supported Audio Formats

Any format ffmpeg can decode: `aac`, `m4a`, `mp4`, `ogg`, `webm`, `mp3`, `wav`. Audio is automatically converted to 16kHz WAV (required by Whisper) before transcription.

### Without whisper-node

If `whisper-node` is not installed, voice messages fall back to Slack's built-in transcription. If that's also unavailable, the message body will be `[Voice message — no transcript available]` and the task is still created so the agent can acknowledge it.
