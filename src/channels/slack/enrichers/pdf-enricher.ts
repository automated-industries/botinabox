import type { Attachment } from "../../../shared/types/channel.js";
import type { ContentBlock } from "../../../shared/types/provider.js";
import type { AttachmentEnricher } from "./types.js";

/**
 * Slack PDF enricher. Downloads the PDF via the Slack bot token and returns
 * a single `document` ContentBlock containing the base64 data. No intermediate
 * document-extraction API call — the downstream Anthropic provider ingests
 * the PDF natively.
 */
export function createSlackPdfEnricher(): AttachmentEnricher {
  return async (att: Attachment, ctx): Promise<ContentBlock[]> => {
    if (!att.url) throw new Error("pdf enricher: attachment has no url");
    if (!ctx.slack?.botToken) throw new Error("pdf enricher: ctx.slack.botToken required");

    const response = await fetch(att.url, {
      headers: { Authorization: `Bearer ${ctx.slack.botToken}` },
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`slack download failed: ${response.status}`);

    const base64 = Buffer.from(await response.arrayBuffer()).toString("base64");
    return [
      {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: base64,
        },
      },
    ];
  };
}
