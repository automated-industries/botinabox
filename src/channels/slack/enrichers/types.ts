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
 * Enrichers throw on failure or return empty arrays when content is not
 * applicable. The framework distinguishes four outcomes in the message body:
 * - Text successfully extracted: `[Attachment content — <filename>]` with inline text
 * - Extraction failed or not applicable: `[Attachment could not be read: <filename>]`
 * - No enricher registered: `[Attached (content not extracted): <filename>]`
 * - Image/document blocks: `[Attached: <filename>]` with multimodal block attached
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
