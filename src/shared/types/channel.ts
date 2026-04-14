/** Channel adapter types — Story 1.5 / 4.1 */

import type { ContentBlock } from "./provider.js";

export type ChatType = "direct" | "group" | "channel";
export type FormattingMode = "markdown" | "mrkdwn" | "html" | "plain";

export interface ChannelCapabilities {
  chatTypes: ChatType[];
  threads: boolean;
  reactions: boolean;
  editing: boolean;
  media: boolean;
  polls: boolean;
  maxTextLength: number;
  formattingMode: FormattingMode;
}

export interface ChannelMeta {
  displayName: string;
  icon?: string;
  homepage?: string;
}

export interface InboundMessage {
  id: string;
  channel: string;
  account?: string;
  from: string;             // Raw peer ID from channel (e.g. Slack user ID)
  userId?: string;          // Resolved botinabox user ID (set by pipeline)
  body: string;
  threadId?: string;
  replyToId?: string;
  attachments?: Attachment[];
  /**
   * Multimodal content blocks produced by attachment enrichers.
   * When set, ChatPipeline builds a multimodal user message that passes
   * these blocks through to the LLM provider alongside `body`.
   */
  attachmentBlocks?: ContentBlock[];
  receivedAt: string;       // ISO 8601
  raw?: unknown;
}

export type AttachmentMediaType =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "doc"
  | "excel"
  | "presentation"
  | "html"
  | "link"
  | "misc";

export interface Attachment {
  type: AttachmentMediaType;
  url?: string;
  mimeType?: string;
  filename?: string;
  size?: number;
}

export interface OutboundPayload {
  text: string;
  threadId?: string;
  replyToId?: string;
  attachments?: Attachment[];
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface HealthStatus {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export type ChannelConfig = Record<string, unknown>;

export interface ChannelAdapter {
  /** Unique identifier for this adapter instance */
  id: string;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;

  connect(config: ChannelConfig): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<HealthStatus>;
  send(target: { peerId: string; threadId?: string }, payload: OutboundPayload): Promise<SendResult>;

  /** Called when a message arrives — set by the framework */
  onMessage?: (message: InboundMessage) => Promise<void>;
}
