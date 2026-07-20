import type { InboundMessage } from "../../../shared/types/channel.js";
import type { ContentBlock } from "../../../shared/types/provider.js";
import type { AttachmentEnricherMap, EnrichmentContext } from "./types.js";

/**
 * Run enrichers over each attachment on an InboundMessage. Text blocks get
 * appended to `body`; image/document blocks get stored on `attachmentBlocks`
 * so ChatPipeline can assemble a multimodal user message.
 *
 * Breadcrumb markers in the body distinguish four outcomes:
 * - `[Attached (content not extracted): <filename>]` — no enricher registered for this type
 * - `[Attachment could not be read: <filename>]` — enricher threw or returned empty
 * - `[Attachment content — <filename>]` — text block extracted and follows inline
 * - `[Attached: <filename>]` — image/document block (multimodal content attached separately)
 */
export async function enrichAttachments(
  msg: InboundMessage,
  ctx: EnrichmentContext,
  enrichers: AttachmentEnricherMap,
): Promise<InboundMessage> {
  if (!msg.attachments?.length) return msg;

  const textParts: string[] = msg.body ? [msg.body] : [];
  const mediaBlocks: ContentBlock[] = [];

  for (const att of msg.attachments) {
    const enricher = enrichers[att.type];
    const label = att.filename ?? att.url ?? att.type;

    if (!enricher) {
      textParts.push(`[Attached (content not extracted): ${label}]`);
      continue;
    }

    let blocks: ContentBlock[];
    try {
      blocks = await enricher(att, ctx);
    } catch (err) {
      console.warn(`[botinabox] Attachment enricher failed for ${label}:`, err);
      textParts.push(`[Attachment could not be read: ${label}]`);
      continue;
    }

    if (blocks.length === 0) {
      textParts.push(`[Attachment could not be read: ${label}]`);
      continue;
    }

    for (const block of blocks) {
      if (block.type === "text") {
        textParts.push(`[Attachment content — ${label}]\n${block.text}`);
      } else if (block.type === "image" || block.type === "document") {
        mediaBlocks.push(block);
        textParts.push(`[Attached: ${label}]`);
      }
      // tool_use / tool_result blocks are never valid enricher output — drop silently
    }
  }

  return {
    ...msg,
    body: textParts.join("\n\n"),
    attachmentBlocks: mediaBlocks.length > 0 ? mediaBlocks : undefined,
  };
}
