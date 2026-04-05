/**
 * Chat layer exports — Stories 4.1–4.4
 */

export { ChannelRegistry, ChannelRegistryError } from "./channel-registry.js";
export { discoverChannels } from "./auto-discovery.js";
export { MessagePipeline } from "./pipeline.js";
export { buildAgentBindings } from "./routing.js";
export { TriageRouter } from "./triage-router.js";
export type { RoutingRule, RoutingDecision, TriageRouterConfig } from "./triage-router.js";
export { checkAllowlist, checkMentionGate } from "./policies.js";
export { SessionKey } from "./session-key.js";
export { ChatSessionManager } from "./session-manager.js";
export { NotificationQueue } from "./notification-queue.js";
export { MessageStore } from "./message-store.js";
export type { StoredAttachment, StoreResult } from "./message-store.js";
export { ChatResponder } from "./chat-responder.js";
export type { ChatResponderConfig } from "./chat-responder.js";
export { MessageInterpreter } from "./message-interpreter.js";
export type {
  Extractor,
  ExtractedTask,
  ExtractedMemory,
  ExtractedFile,
  ExtractedUserContext,
  InterpretationResult,
  MessageInterpreterConfig,
  LLMCallFn,
} from "./message-interpreter.js";
export { ChatPipeline } from "./chat-pipeline.js";
export type { ChatPipelineConfig } from "./chat-pipeline.js";
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
