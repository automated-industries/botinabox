import type { Attachment, InboundMessage } from "../../../shared/types/channel.js";
import type { AttachmentMediaType } from "../../../shared/types/channel.js";

/**
 * An AttachmentEnricher downloads an attachment and extracts its textual content.
 *
 * Returns the extracted text on success, or `null` on failure. The framework
 * surfaces the filename/URL as a fallback when the enricher returns null.
 *
 * @param attachment - The attachment metadata (type, url, filename, etc.)
 * @param botToken - Slack bot token, required for authenticated downloads from url_private
 */
export type AttachmentEnricher = (
  attachment: Attachment,
  botToken: string,
) => Promise<string | null>;

/**
 * A map from attachment type to the enricher that handles it.
 * Types without an entry fall through to the framework's default behavior
 * (surfacing filename + URL in the message body).
 */
export type AttachmentEnricherMap = Partial<Record<AttachmentMediaType, AttachmentEnricher>>;

/** Internal: the result of running enrichAttachments on a message. */
export interface EnrichedMessage extends InboundMessage {
  body: string;
}
