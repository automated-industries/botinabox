import type { Attachment } from "../../../shared/types/channel.js";
import type { AttachmentEnricher } from "./types.js";

export interface PdfEnricherConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  prompt?: string;
}

const DEFAULT_PROMPT =
  "Summarize this PDF in detail. Include all key facts, numbers, dates, names, and any structured content (tables, lists). The summary will be used as input to another agent that cannot see the PDF.";

async function downloadAsBase64(urlPrivate: string, botToken: string): Promise<string | null> {
  try {
    const response = await fetch(urlPrivate, {
      headers: { Authorization: `Bearer ${botToken}` },
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.toString("base64");
  } catch {
    return null;
  }
}

/**
 * Build an enricher that sends Slack-hosted PDFs to Claude's document API
 * and returns a text summary. Requires Claude 3.5+.
 */
export function createPdfEnricher(config: PdfEnricherConfig): AttachmentEnricher {
  const { apiKey, model = "claude-sonnet-4-6", maxTokens = 4096, prompt = DEFAULT_PROMPT } = config;

  return async (att: Attachment, botToken: string): Promise<string | null> => {
    if (!att.url) return null;

    const base64 = await downloadAsBase64(att.url, botToken);
    if (!base64) return null;

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
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: base64 },
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
