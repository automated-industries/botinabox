import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSlackImageEnricher } from "../image-enricher.js";
import type { EnrichmentContext } from "../types.js";

const ctx: EnrichmentContext = { slack: { botToken: "xoxb-token" } };

describe("createSlackImageEnricher", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
    vi.clearAllMocks();
  });

  it("downloads image from Slack and returns a single image ContentBlock", async () => {
    const mockBuffer = Buffer.from("fake-image-data");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => mockBuffer.buffer.slice(mockBuffer.byteOffset, mockBuffer.byteOffset + mockBuffer.byteLength),
    } as any);

    const enricher = createSlackImageEnricher();
    const result = await enricher({
      type: "image",
      url: "https://files.slack.com/image.jpg",
      mimeType: "image/jpeg",
    }, ctx);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: mockBuffer.toString("base64"),
      },
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://files.slack.com/image.jpg",
      expect.objectContaining({
        headers: { Authorization: "Bearer xoxb-token" },
      }),
    );
  });

  it("defaults media_type to image/jpeg when mimeType is missing", async () => {
    const mockBuffer = Buffer.from("data");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => mockBuffer.buffer.slice(mockBuffer.byteOffset, mockBuffer.byteOffset + mockBuffer.byteLength),
    } as any);

    const enricher = createSlackImageEnricher();
    const result = await enricher({
      type: "image",
      url: "https://files.slack.com/image.bin",
    }, ctx);

    expect(result[0]).toMatchObject({
      type: "image",
      source: { media_type: "image/jpeg" },
    });
  });

  it("throws when attachment has no URL", async () => {
    const enricher = createSlackImageEnricher();
    await expect(enricher({ type: "image" }, ctx)).rejects.toThrow(/no url/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws when ctx.slack.botToken is missing", async () => {
    const enricher = createSlackImageEnricher();
    await expect(
      enricher({ type: "image", url: "https://files.slack.com/image.jpg" }, {}),
    ).rejects.toThrow(/botToken/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws when fetch returns non-ok", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 404 } as any);

    const enricher = createSlackImageEnricher();
    await expect(
      enricher({ type: "image", url: "https://files.slack.com/missing.jpg" }, ctx),
    ).rejects.toThrow(/404/);
  });

  it("propagates fetch errors", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("Network error"));

    const enricher = createSlackImageEnricher();
    await expect(
      enricher({ type: "image", url: "https://files.slack.com/image.jpg" }, ctx),
    ).rejects.toThrow("Network error");
  });
});
