import type { Attachment } from "../../../shared/types/channel.js";
import type { ContentBlock } from "../../../shared/types/provider.js";
import type { AttachmentEnricher } from "./types.js";

/**
 * Slack image enricher. Downloads the image via the Slack bot token and
 * returns a single `image` ContentBlock containing the base64 data. No
 * intermediate vision API call — the downstream Anthropic provider sees
 * the raw image and processes it natively.
 *
 * Consumers wire this as `attachmentEnrichers.image = createSlackImageEnricher()`.
 */
export function createSlackImageEnricher(): AttachmentEnricher {
  return async (att: Attachment, ctx): Promise<ContentBlock[]> => {
    if (!att.url) throw new Error("image enricher: attachment has no url");
    if (!ctx.slack?.botToken) throw new Error("image enricher: ctx.slack.botToken required");

    const response = await fetch(att.url, {
      headers: { Authorization: `Bearer ${ctx.slack.botToken}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`slack download failed: ${response.status}`);

    const base64 = Buffer.from(await response.arrayBuffer()).toString("base64");
    return [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: att.mimeType ?? "image/jpeg",
          data: base64,
        },
      },
    ];
  };
}
