/**
 * Chat layer exports — Stories 4.1–4.4
 */

export { ChannelRegistry, ChannelRegistryError } from "./channel-registry.js";
export { discoverChannels } from "./auto-discovery.js";
export { MessagePipeline } from "./pipeline.js";
export { buildAgentBindings } from "./routing.js";
export { checkAllowlist, checkMentionGate } from "./policies.js";
export { SessionKey } from "./session-key.js";
export { ChatSessionManager } from "./session-manager.js";
export { NotificationQueue } from "./notification-queue.js";
export { chunkText } from "./text-chunker.js";
export { formatText } from "./formatter.js";
export type {
  ChatType,
  FormattingMode,
  ChannelCapabilities,
  ChannelMeta,
  InboundMessage,
  Attachment,
  OutboundPayload,
  SendResult,
  HealthStatus,
  ChannelConfig,
  ChannelAdapter,
} from "./types.js";
