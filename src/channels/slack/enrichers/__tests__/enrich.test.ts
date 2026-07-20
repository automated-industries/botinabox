import { describe, it, expect, vi } from "vitest";
import { enrichAttachments } from "../enrich.js";
import type { InboundMessage } from "../../../../shared/types/channel.js";
import type { ContentBlock } from "../../../../shared/types/provider.js";
import type { EnrichmentContext } from "../types.js";

const ctx: EnrichmentContext = { slack: { botToken: "xoxb-token" } };

describe("enrichAttachments", () => {
  it("returns message unchanged when no attachments", async () => {
    const msg: InboundMessage = {
      id: "test-1",
      channel: "C123",
      from: "U456",
      body: "Plain text",
      receivedAt: new Date().toISOString(),
    };
    const result = await enrichAttachments(msg, ctx, {});
    expect(result).toBe(msg);
  });

  it("appends a text block as inline body content", async () => {
    const msg: InboundMessage = {
      id: "test-2",
      channel: "C123",
      from: "U456",
      body: "Original message",
      attachments: [{
        type: "pdf",
        filename: "document.pdf",
        url: "https://example.com/doc.pdf",
      }],
      receivedAt: new Date().toISOString(),
    };
    const enricher = vi.fn().mockResolvedValue([
      { type: "text", text: "PDF summary content" } satisfies ContentBlock,
    ]);
    const result = await enrichAttachments(msg, ctx, { pdf: enricher });

    expect(result.body).toContain("Original message");
    expect(result.body).toContain("[Attachment content — document.pdf]");
    expect(result.body).toContain("PDF summary content");
    expect(result.attachmentBlocks).toBeUndefined();
    expect(enricher).toHaveBeenCalledWith(msg.attachments![0], ctx);
  });

  it("collects an image block into attachmentBlocks and leaves a body breadcrumb", async () => {
    const imageBlock: ContentBlock = {
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "AAAA" },
    };
    const msg: InboundMessage = {
      id: "test-3",
      channel: "C123",
      from: "U456",
      body: "Look at this",
      attachments: [{ type: "image", filename: "photo.jpg", url: "https://example.com/photo.jpg" }],
      receivedAt: new Date().toISOString(),
    };
    const enricher = vi.fn().mockResolvedValue([imageBlock]);
    const result = await enrichAttachments(msg, ctx, { image: enricher });

    expect(result.body).toBe("Look at this\n\n[Attached: photo.jpg]");
    expect(result.attachmentBlocks).toEqual([imageBlock]);
  });

  it("collects a document block into attachmentBlocks", async () => {
    const docBlock: ContentBlock = {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: "BBBB" },
    };
    const msg: InboundMessage = {
      id: "test-4",
      channel: "C123",
      from: "U456",
      body: "Review this",
      attachments: [{ type: "pdf", filename: "report.pdf", url: "https://example.com/r.pdf" }],
      receivedAt: new Date().toISOString(),
    };
    const enricher = vi.fn().mockResolvedValue([docBlock]);
    const result = await enrichAttachments(msg, ctx, { pdf: enricher });

    expect(result.body).toBe("Review this\n\n[Attached: report.pdf]");
    expect(result.attachmentBlocks).toEqual([docBlock]);
  });

  it("handles a mixed text + image return from a single enricher", async () => {
    const imageBlock: ContentBlock = {
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "CCCC" },
    };
    const msg: InboundMessage = {
      id: "test-5",
      channel: "C123",
      from: "U456",
      body: "Body",
      attachments: [{ type: "image", filename: "mix.png", url: "https://example.com/mix.png" }],
      receivedAt: new Date().toISOString(),
    };
    const enricher = vi.fn().mockResolvedValue([
      { type: "text", text: "caption" } as ContentBlock,
      imageBlock,
    ]);
    const result = await enrichAttachments(msg, ctx, { image: enricher });

    expect(result.body).toContain("Body");
    expect(result.body).toContain("[Attachment content — mix.png]\ncaption");
    expect(result.body).toContain("[Attached: mix.png]");
    expect(result.attachmentBlocks).toEqual([imageBlock]);
  });

  it("falls back to filename breadcrumb when enricher returns empty array", async () => {
    const msg: InboundMessage = {
      id: "test-6",
      channel: "C123",
      from: "U456",
      body: "Message",
      attachments: [{ type: "pdf", filename: "document.pdf", url: "https://example.com/doc.pdf" }],
      receivedAt: new Date().toISOString(),
    };
    const enricher = vi.fn().mockResolvedValue([]);
    const result = await enrichAttachments(msg, ctx, { pdf: enricher });

    expect(result.body).toBe("Message\n\n[Attachment could not be read: document.pdf]");
    expect(result.attachmentBlocks).toBeUndefined();
  });

  it("falls back to filename breadcrumb when no matching enricher", async () => {
    const msg: InboundMessage = {
      id: "test-7",
      channel: "C123",
      from: "U456",
      body: "Message",
      attachments: [{ type: "image", filename: "photo.jpg", url: "https://example.com/photo.jpg" }],
      receivedAt: new Date().toISOString(),
    };
    const result = await enrichAttachments(msg, ctx, {});

    expect(result.body).toBe("Message\n\n[Attached (content not extracted): photo.jpg]");
    expect(result.attachmentBlocks).toBeUndefined();
  });

  it("catches exceptions from enricher and falls back to filename", async () => {
    const msg: InboundMessage = {
      id: "test-8",
      channel: "C123",
      from: "U456",
      body: "Message",
      attachments: [{ type: "pdf", filename: "document.pdf", url: "https://example.com/doc.pdf" }],
      receivedAt: new Date().toISOString(),
    };
    const enricher = vi.fn().mockRejectedValue(new Error("Enricher failed"));
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await enrichAttachments(msg, ctx, { pdf: enricher });

    expect(result.body).toBe("Message\n\n[Attachment could not be read: document.pdf]");
    expect(result.attachmentBlocks).toBeUndefined();
    expect(consoleWarnSpy).toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });

  it("handles multiple attachments sequentially", async () => {
    const imageBlock: ContentBlock = {
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "DDDD" },
    };
    const msg: InboundMessage = {
      id: "test-9",
      channel: "C123",
      from: "U456",
      body: "Original",
      attachments: [
        { type: "pdf", filename: "doc1.pdf", url: "https://example.com/1.pdf" },
        { type: "image", filename: "photo.jpg", url: "https://example.com/photo.jpg" },
      ],
      receivedAt: new Date().toISOString(),
    };
    const pdfEnricher = vi.fn().mockResolvedValue([
      { type: "text", text: "PDF content" } as ContentBlock,
    ]);
    const imageEnricher = vi.fn().mockResolvedValue([imageBlock]);
    const result = await enrichAttachments(msg, ctx, {
      pdf: pdfEnricher,
      image: imageEnricher,
    });

    expect(result.body).toContain("Original");
    expect(result.body).toContain("[Attachment content — doc1.pdf]\nPDF content");
    expect(result.body).toContain("[Attached: photo.jpg]");
    expect(result.attachmentBlocks).toEqual([imageBlock]);
    expect(pdfEnricher).toHaveBeenCalledOnce();
    expect(imageEnricher).toHaveBeenCalledOnce();
  });

  it("forwards ctx unchanged to the enricher", async () => {
    const msg: InboundMessage = {
      id: "test-10",
      channel: "C123",
      from: "U456",
      body: "Message",
      attachments: [{ type: "pdf", filename: "doc.pdf", url: "https://example.com/doc.pdf" }],
      receivedAt: new Date().toISOString(),
    };
    const enricher = vi.fn().mockResolvedValue([
      { type: "text", text: "content" } as ContentBlock,
    ]);
    await enrichAttachments(msg, ctx, { pdf: enricher });
    expect(enricher).toHaveBeenCalledWith(msg.attachments![0], ctx);
  });

  it("uses URL as label when filename is missing", async () => {
    const msg: InboundMessage = {
      id: "test-11",
      channel: "C123",
      from: "U456",
      body: "Message",
      attachments: [{ type: "pdf", url: "https://example.com/doc.pdf" }],
      receivedAt: new Date().toISOString(),
    };
    const result = await enrichAttachments(msg, ctx, {});

    expect(result.body).toBe("Message\n\n[Attached (content not extracted): https://example.com/doc.pdf]");
  });

  it("uses type as label when filename and URL are missing", async () => {
    const msg: InboundMessage = {
      id: "test-12",
      channel: "C123",
      from: "U456",
      body: "Message",
      attachments: [{ type: "link" }],
      receivedAt: new Date().toISOString(),
    };
    const result = await enrichAttachments(msg, ctx, {});

    expect(result.body).toBe("Message\n\n[Attached (content not extracted): link]");
  });

  it("handles empty body with a text-block enricher", async () => {
    const msg: InboundMessage = {
      id: "test-13",
      channel: "C123",
      from: "U456",
      body: "",
      attachments: [{ type: "pdf", filename: "doc.pdf", url: "https://example.com/doc.pdf" }],
      receivedAt: new Date().toISOString(),
    };
    const enricher = vi.fn().mockResolvedValue([
      { type: "text", text: "Content" } as ContentBlock,
    ]);
    const result = await enrichAttachments(msg, ctx, { pdf: enricher });

    expect(result.body).toBe("[Attachment content — doc.pdf]\nContent");
  });

  it("distinguishes extracted content with [Attachment content — ...] marker", async () => {
    const msg: InboundMessage = {
      id: "test-14",
      channel: "C123",
      from: "U456",
      body: "Original message",
      attachments: [{
        type: "pdf",
        filename: "document.pdf",
        url: "https://example.com/doc.pdf",
      }],
      receivedAt: new Date().toISOString(),
    };
    const enricher = vi.fn().mockResolvedValue([
      { type: "text", text: "PDF summary content" } satisfies ContentBlock,
    ]);
    const result = await enrichAttachments(msg, ctx, { pdf: enricher });

    expect(result.body).toContain("Original message");
    expect(result.body).toContain("[Attachment content — document.pdf]");
    expect(result.body).toContain("PDF summary content");
    expect(result.attachmentBlocks).toBeUndefined();
  });

  it("logs enricher failure and uses [Attachment could not be read: ...] marker", async () => {
    const msg: InboundMessage = {
      id: "test-15",
      channel: "C123",
      from: "U456",
      body: "Message",
      attachments: [{ type: "pdf", filename: "document.pdf", url: "https://example.com/doc.pdf" }],
      receivedAt: new Date().toISOString(),
    };
    const testErr = new Error("Enricher failed");
    const enricher = vi.fn().mockRejectedValue(testErr);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await enrichAttachments(msg, ctx, { pdf: enricher });

    expect(result.body).toBe("Message\n\n[Attachment could not be read: document.pdf]");
    expect(result.attachmentBlocks).toBeUndefined();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[botinabox] Attachment enricher failed for document.pdf:"),
      testErr,
    );
    consoleWarnSpy.mockRestore();
  });

  it("uses [Attachment could not be read: ...] marker when enricher returns empty array", async () => {
    const msg: InboundMessage = {
      id: "test-16",
      channel: "C123",
      from: "U456",
      body: "Message",
      attachments: [{ type: "pdf", filename: "document.pdf", url: "https://example.com/doc.pdf" }],
      receivedAt: new Date().toISOString(),
    };
    const enricher = vi.fn().mockResolvedValue([]);
    const result = await enrichAttachments(msg, ctx, { pdf: enricher });

    expect(result.body).toBe("Message\n\n[Attachment could not be read: document.pdf]");
    expect(result.attachmentBlocks).toBeUndefined();
  });

  it("uses [Attached (content not extracted): ...] marker when no matching enricher", async () => {
    const msg: InboundMessage = {
      id: "test-17",
      channel: "C123",
      from: "U456",
      body: "Message",
      attachments: [{ type: "image", filename: "photo.jpg", url: "https://example.com/photo.jpg" }],
      receivedAt: new Date().toISOString(),
    };
    const result = await enrichAttachments(msg, ctx, {});

    expect(result.body).toBe("Message\n\n[Attached (content not extracted): photo.jpg]");
    expect(result.attachmentBlocks).toBeUndefined();
  });
});
