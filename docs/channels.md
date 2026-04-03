# Channel Adapters

Channel adapters connect your bot to messaging platforms. Each adapter implements the `ChannelAdapter` interface from `@botinabox/shared`.

## Built-in Channels

### Slack

```bash
pnpm add @botinabox/channel-slack
```

```typescript
import createSlackAdapter from '@botinabox/channel-slack';

const slack = createSlackAdapter(boltClient); // Optional: inject Bolt client
```

**Capabilities:**

| Feature | Supported |
|---------|-----------|
| Chat types | DM, group, channel |
| Threads | Yes |
| Reactions | Yes |
| Message editing | Yes |
| Media/attachments | Yes |
| Max text length | 40,000 chars |
| Formatting | Slack mrkdwn |

**Config:**

```yaml
channels:
  slack:
    enabled: true
    botToken: ${SLACK_BOT_TOKEN}
    appToken: ${SLACK_APP_TOKEN}     # Optional, for Socket Mode
    signingSecret: ${SLACK_SIGNING_SECRET}  # Optional, for HTTP mode
```

**Message handling:**

```typescript
// Inbound: Slack events are parsed into InboundMessage
// The adapter handles message normalization automatically

// Outbound: Send messages
await slack.send(
  { peerId: 'C1234567890', threadId: '1234567890.123456' },
  { text: 'Hello from the bot!' }
);
```

### Discord

```bash
pnpm add @botinabox/channel-discord
```

```typescript
import createDiscordAdapter from '@botinabox/channel-discord';

const discord = createDiscordAdapter(discordClient); // Optional: inject client
```

**Capabilities:**

| Feature | Supported |
|---------|-----------|
| Chat types | DM, group, channel |
| Threads | Yes |
| Reactions | Yes |
| Message editing | Yes |
| Media/attachments | Yes |
| Max text length | 2,000 chars |
| Formatting | Markdown |

**Config:**

```yaml
channels:
  discord:
    enabled: true
    botToken: ${DISCORD_BOT_TOKEN}
```

### Webhook

```bash
pnpm add @botinabox/channel-webhook
```

```typescript
import createWebhookAdapter from '@botinabox/channel-webhook';

const webhook = createWebhookAdapter();
```

**Capabilities:**

| Feature | Supported |
|---------|-----------|
| Chat types | DM only |
| Threads | No |
| Reactions | No |
| Message editing | No |
| Media/attachments | No |
| Max text length | 65,535 chars |
| Formatting | Plain text |

The webhook adapter can both receive and send webhooks:

- **Inbound**: Starts an HTTP server on the configured port, validates HMAC signatures
- **Outbound**: POSTs to the configured `callbackUrl`

**Config:**

```yaml
channels:
  webhook:
    enabled: true
    port: 8080                               # Listen port for inbound
    secret: ${WEBHOOK_SECRET}                # HMAC verification secret
    callbackUrl: https://example.com/hook    # Outbound target
```

**HMAC verification:**

Incoming requests must include an `X-Signature` header with an HMAC-SHA256 signature of the request body, computed using the shared secret.

## Channel Registry

```typescript
import { ChannelRegistry } from '@botinabox/core';

const registry = new ChannelRegistry();

// Register with config
registry.register(slack, config.channels.slack);

// Start all channels (calls connect() on each)
await registry.start();

// Health check all channels
const health = await registry.healthCheck();
// → { slack: { ok: true }, discord: { ok: true } }

// Reconfigure a channel at runtime
await registry.reconfigure('slack', newConfig);

// Remove a channel
await registry.unregister('slack');

// Stop all channels
await registry.stop();
```

## Message Pipeline

The `MessagePipeline` routes inbound messages to agents and creates tasks:

```typescript
import { MessagePipeline } from '@botinabox/core';

const pipeline = new MessagePipeline(hooks, agentRegistry, taskQueue, config);

// Process a message (usually called by channel adapter)
await pipeline.processInbound(message);
```

Processing flow:

1. Emit `message.inbound` hook
2. Resolve agent via channel bindings (which agent handles which channel)
3. Evaluate policies (allowlist, mention gate)
4. Create task in queue assigned to the resolved agent
5. Emit `message.processed` hook

### Agent-Channel Bindings

Agents bind to channels via their config:

```yaml
agents:
  - slug: support-bot
    name: Support Bot
    adapter: api
    model: fast
    config:
      channel: slack       # This agent handles Slack messages
```

The pipeline uses `buildAgentBindings()` to create a `Map<channelId, agentId>` from agent configs.

### Policies

**Allowlist**: Restrict which users can message the bot.

```typescript
// Returns true if senderId is in the allowFrom list
checkAllowlist(['U123', 'U456'], message.from);
```

**Mention gate**: Only process messages that mention the bot.

```typescript
// Returns true if message mentions the bot's ID
checkMentionGate(message, botUserId);
```

## Sessions

Chat sessions track conversation state per agent/channel/peer:

```typescript
import { ChatSessionManager, SessionKey } from '@botinabox/core';

const sessions = new ChatSessionManager(db);

// Build a session key
const key = SessionKey.build(agentId, 'slack', 'dm', peerId, 'per-peer');

// Save session state
await sessions.save(agentId, 'slack', peerId, { history: messages });

// Load session state
const state = await sessions.load(agentId, 'slack', peerId);

// Clear session
await sessions.clear(agentId, 'slack', peerId);

// Check if session should be cleared (age/run limits)
const stale = await sessions.shouldClear(state, { maxRuns: 10, maxAgeHours: 24 });
```

### Session Scoping

`SessionKey.build()` supports different scoping strategies:

| Scope | Key Format | Use Case |
|-------|-----------|----------|
| `main` | `agent:{id}:{channel}:main` | Single shared session per agent+channel |
| `per-peer` | `agent:{id}:{channel}:{peerId}` | Separate session per user |
| `per-channel-peer` | `agent:{id}:{channel}:{channelId}:{peerId}` | Separate per channel+user |

## Notification Queue

Reliable outbound message delivery with retries:

```typescript
import { NotificationQueue } from '@botinabox/core';

const queue = new NotificationQueue(db, hooks, channelRegistry, {
  pollIntervalMs: 5000,
  maxRetries: 3,
});

// Enqueue a message
const notificationId = await queue.enqueue('slack', 'C1234567890', {
  text: 'Task completed!',
  threadId: '1234567890.123456',
});

// Start the worker (polls for pending notifications)
queue.startWorker();

// Stop
queue.stopWorker();
```

Notifications are persisted in the `notifications` table and retried on failure up to `maxRetries` times.

## Auto-Discovery

Channel adapters are auto-discovered from installed `@botinabox/*` packages with `"botinabox": { "type": "channel" }` in `package.json`.

```typescript
import { discoverChannels } from '@botinabox/core';

const channels = await discoverChannels('./node_modules');
channels.forEach(ch => registry.register(ch));
```

## Writing a Custom Channel Adapter

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
} from '@botinabox/shared';

const myAdapter: ChannelAdapter = {
  id: 'my-channel',

  meta: {
    name: 'My Channel',
    version: '1.0.0',
  },

  capabilities: {
    chatTypes: ['direct', 'channel'],
    threads: false,
    reactions: false,
    editing: false,
    media: false,
    polls: false,
    maxTextLength: 10000,
    formattingMode: 'plain',
  },

  async connect(config: ChannelConfig): Promise<void> {
    // Initialize connection to your platform
  },

  async disconnect(): Promise<void> {
    // Clean up
  },

  async healthCheck(): Promise<HealthStatus> {
    return { ok: true };
  },

  async send(
    target: { peerId: string; threadId?: string },
    payload: OutboundPayload
  ): Promise<SendResult> {
    // Send the message
    return { success: true, messageId: 'msg-123' };
  },

  async onMessage(message: InboundMessage): Promise<void> {
    // Called by the pipeline when a message arrives
  },
};

export default function createMyAdapter(): ChannelAdapter {
  return myAdapter;
}
```

Add `"botinabox": { "type": "channel" }` to your package's `package.json` for auto-discovery.
