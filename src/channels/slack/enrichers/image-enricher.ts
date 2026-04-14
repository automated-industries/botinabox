import type { Attachment } from "../../../shared/types/channel.js";
import type { AttachmentEnricher } from "./types.js";

export interface ImageEnricherConfig {
  /** Anthropic API key for vision calls. */
  apiKey: string;
  /** Model to use. Defaults to claude-sonnet-4-6. */
  model?: string;
  /** Max tokens for the description. Defaults to 1024. */
  maxTokens?: number;
  /** Prompt used for image description. */
  prompt?: string;
}

const DEFAULT_PROMPT =
  "Describe this image in detail. Include any visible text (OCR), objects, people, layout, and context. Be thorough — the description will be used as input to another agent that cannot see the image.";

/**
 * Download a Slack file via authenticated GET.
 * Returns the file as a base64 string, or null on failure.
 */
async function downloadAsBase64(urlPrivate: string, botToken: string): Promise<string | null> {
  try {
    const response = await fetch(urlPrivate, {
      headers: { Authorization: `Bearer ${botToken}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.toString("base64");
  } catch {
    return null;
  }
}

/**
 * Build an enricher that sends Slack-hosted images to Claude's vision API
 * and returns a text description.
 *
 * Consumer must provide an Anthropic API key. The Anthropic SDK is a peer
 * dependency of botinabox — the consumer must have it installed.
 */
export function createImageEnricher(config: ImageEnricherConfig): AttachmentEnricher {
  const { apiKey, model = "claude-sonnet-4-6", maxTokens = 1024, prompt = DEFAULT_PROMPT } = config;

  return async (att: Attachment, botToken: string): Promise<string | null> => {
    if (!att.url) return null;
    const mediaType = att.mimeType ?? "image/jpeg";

    const base64 = await downloadAsBase64(att.url, botToken);
    if (!base64) return null;

    // Dynamic import — @anthropic-ai/sdk is a peer dep
    const anthropicModule = "@anthropic-ai/sdk";
    const sdk = await (import(anthropicModule) as Promise<{
      default: new (config: { apiKey: string }) => {
        messages: {
          create(params: Record<string, unknown>): Promise<{
            content: Array<{ type: string; text?: string }>;
          }>;
        };
      };
    }>);

    const client = new sdk.default({ apiKey });

    try {
      const message = await client.messages.create({
        model,
        max_tokens: maxTokens,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: base64 },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      });

      const textBlock = message.content.find((c) => c.type === "text");
      return textBlock?.text ?? null;
    } catch {
      return null;
    }
  };
}
