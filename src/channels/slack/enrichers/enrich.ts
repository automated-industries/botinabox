import type { InboundMessage } from "../../../shared/types/channel.js";
import type { AttachmentEnricherMap } from "./types.js";

/**
 * Run enrichers over each attachment on an InboundMessage and append extracted
 * content to the message body.
 *
 * Enrichers are run sequentially. If an enricher throws or returns null, the
 * attachment is surfaced as `[Attached: <filename>]` with no content — the
 * LLM still sees that a file was present.
 *
 * Extracted text is appended to the body in this format:
 *
 *     <original body>
 *
 *     [Attached: invoice.pdf]
 *     <extracted content>
 */
export async function enrichAttachments(
  msg: InboundMessage,
  botToken: string,
  enrichers: AttachmentEnricherMap,
): Promise<InboundMessage> {
  if (!msg.attachments?.length) return msg;

  const parts: string[] = msg.body ? [msg.body] : [];

  for (const att of msg.attachments) {
    const enricher = enrichers[att.type];
    const label = att.filename ?? att.url ?? att.type;

    if (!enricher) {
      parts.push(`[Attached: ${label}]`);
      continue;
    }

    let extracted: string | null = null;
    try {
      extracted = await enricher(att, botToken);
    } catch {
      extracted = null;
    }

    if (extracted) {
      parts.push(`[Attached: ${label}]\n${extracted}`);
    } else {
      parts.push(`[Attached: ${label}]`);
    }
  }

  return { ...msg, body: parts.join("\n\n") };
}
