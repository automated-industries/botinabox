import type { Attachment, AttachmentMediaType, InboundMessage } from "../../../shared/types/channel.js";
import type { ContentBlock } from "../../../shared/types/provider.js";

/**
 * Transport-specific context passed to every enricher. Extensible — add a new
 * optional sub-context when wiring a new source (gmail, drive, dropbox, etc.)
 * and enrichers that need it can type-guard.
 */
export interface EnrichmentContext {
  slack?: { botToken: string };
  drive?: { client: unknown };
  gmail?: { client: unknown };
}

/**
 * An AttachmentEnricher downloads an attachment and returns Claude content
 * blocks representing it. Text blocks become part of the message body; image
 * and document blocks flow through to the Anthropic provider unchanged.
 *
 * Enrichers throw on failure. The framework catches and falls back to a
 * plain `[Attached: <filename>]` breadcrumb in the message body.
 */
export type AttachmentEnricher = (
  attachment: Attachment,
  ctx: EnrichmentContext,
) => Promise<ContentBlock[]>;

export type AttachmentEnricherMap = Partial<Record<AttachmentMediaType, AttachmentEnricher>>;

/** Internal: the result of running enrichAttachments on a message. */
export interface EnrichedMessage extends InboundMessage {
  body: string;
}

export type { InboundMessage };
