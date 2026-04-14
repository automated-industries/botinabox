import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSlackPdfEnricher } from "../pdf-enricher.js";
import type { EnrichmentContext } from "../types.js";

const ctx: EnrichmentContext = { slack: { botToken: "xoxb-token" } };

describe("createSlackPdfEnricher", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
    vi.clearAllMocks();
  });

  it("downloads PDF from Slack and returns a single document ContentBlock", async () => {
    const mockBuffer = Buffer.from("fake-pdf-data");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => mockBuffer.buffer.slice(mockBuffer.byteOffset, mockBuffer.byteOffset + mockBuffer.byteLength),
    } as any);

    const enricher = createSlackPdfEnricher();
    const result = await enricher({
      type: "pdf",
      url: "https://files.slack.com/document.pdf",
    }, ctx);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: mockBuffer.toString("base64"),
      },
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://files.slack.com/document.pdf",
      expect.objectContaining({
        headers: { Authorization: "Bearer xoxb-token" },
      }),
    );
  });

  it("throws when attachment has no URL", async () => {
    const enricher = createSlackPdfEnricher();
    await expect(enricher({ type: "pdf" }, ctx)).rejects.toThrow(/no url/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws when ctx.slack.botToken is missing", async () => {
    const enricher = createSlackPdfEnricher();
    await expect(
      enricher({ type: "pdf", url: "https://files.slack.com/doc.pdf" }, {}),
    ).rejects.toThrow(/botToken/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws when fetch returns non-ok", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 403 } as any);

    const enricher = createSlackPdfEnricher();
    await expect(
      enricher({ type: "pdf", url: "https://files.slack.com/missing.pdf" }, ctx),
    ).rejects.toThrow(/403/);
  });

  it("propagates fetch errors", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("Network error"));

    const enricher = createSlackPdfEnricher();
    await expect(
      enricher({ type: "pdf", url: "https://files.slack.com/doc.pdf" }, ctx),
    ).rejects.toThrow("Network error");
  });

  it("uses an AbortSignal with a 60s timeout", async () => {
    const mockBuffer = Buffer.from("fake-pdf-data");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => mockBuffer.buffer.slice(mockBuffer.byteOffset, mockBuffer.byteOffset + mockBuffer.byteLength),
    } as any);

    const enricher = createSlackPdfEnricher();
    await enricher({
      type: "pdf",
      url: "https://files.slack.com/document.pdf",
    }, ctx);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });
});
