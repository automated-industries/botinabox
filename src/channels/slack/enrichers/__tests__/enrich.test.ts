import { describe, it, expect, vi } from "vitest";
import { enrichAttachments } from "../enrich.js";
import type { Attachment, InboundMessage } from "../../../../shared/types/channel.js";

describe("enrichAttachments", () => {
  it("returns message unchanged when no attachments", async () => {
    const msg: InboundMessage = {
      id: "test-1",
      channel: "C123",
      from: "U456",
      body: "Plain text",
      receivedAt: new Date().toISOString(),
    };
    const result = await enrichAttachments(msg, "xoxb-token", {});
    expect(result).toBe(msg);
  });

  it("appends enriched content for matching enricher", async () => {
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
    const enricher = vi.fn().mockResolvedValue("PDF summary content");
    const result = await enrichAttachments(msg, "xoxb-token", { pdf: enricher });

    expect(result.body).toContain("Original message");
    expect(result.body).toContain("[Attached: document.pdf]");
    expect(result.body).toContain("PDF summary content");
    expect(enricher).toHaveBeenCalledWith(msg.attachments![0], "xoxb-token");
  });

  it("appends filename only when enricher returns null", async () => {
    const msg: InboundMessage = {
      id: "test-3",
      channel: "C123",
      from: "U456",
      body: "Message",
      attachments: [{
        type: "pdf",
        filename: "document.pdf",
        url: "https://example.com/doc.pdf",
      }],
      receivedAt: new Date().toISOString(),
    };
    const enricher = vi.fn().mockResolvedValue(null);
    const result = await enrichAttachments(msg, "xoxb-token", { pdf: enricher });

    expect(result.body).toBe("Message\n\n[Attached: document.pdf]");
  });

  it("appends filename when no matching enricher", async () => {
    const msg: InboundMessage = {
      id: "test-4",
      channel: "C123",
      from: "U456",
      body: "Message",
      attachments: [{
        type: "image",
        filename: "photo.jpg",
        url: "https://example.com/photo.jpg",
      }],
      receivedAt: new Date().toISOString(),
    };
    const result = await enrichAttachments(msg, "xoxb-token", {});

    expect(result.body).toBe("Message\n\n[Attached: photo.jpg]");
  });

  it("catches exceptions from enricher and falls back to filename", async () => {
    const msg: InboundMessage = {
      id: "test-5",
      channel: "C123",
      from: "U456",
      body: "Message",
      attachments: [{
        type: "pdf",
        filename: "document.pdf",
        url: "https://example.com/doc.pdf",
      }],
      receivedAt: new Date().toISOString(),
    };
    const enricher = vi.fn().mockRejectedValue(new Error("Enricher failed"));
    const result = await enrichAttachments(msg, "xoxb-token", { pdf: enricher });

    expect(result.body).toBe("Message\n\n[Attached: document.pdf]");
  });

  it("handles multiple attachments sequentially", async () => {
    const msg: InboundMessage = {
      id: "test-6",
      channel: "C123",
      from: "U456",
      body: "Original",
      attachments: [
        { type: "pdf", filename: "doc1.pdf", url: "https://example.com/1.pdf" },
        { type: "image", filename: "photo.jpg", url: "https://example.com/photo.jpg" },
      ],
      receivedAt: new Date().toISOString(),
    };
    const pdfEnricher = vi.fn().mockResolvedValue("PDF content");
    const result = await enrichAttachments(msg, "xoxb-token", { pdf: pdfEnricher });

    expect(result.body).toContain("Original");
    expect(result.body).toContain("[Attached: doc1.pdf]");
    expect(result.body).toContain("PDF content");
    expect(result.body).toContain("[Attached: photo.jpg]");
    expect(pdfEnricher).toHaveBeenCalledOnce();
  });

  it("uses URL as label when filename is missing", async () => {
    const msg: InboundMessage = {
      id: "test-7",
      channel: "C123",
      from: "U456",
      body: "Message",
      attachments: [{
        type: "pdf",
        url: "https://example.com/doc.pdf",
      }],
      receivedAt: new Date().toISOString(),
    };
    const result = await enrichAttachments(msg, "xoxb-token", {});

    expect(result.body).toBe("Message\n\n[Attached: https://example.com/doc.pdf]");
  });

  it("uses type as label when filename and URL are missing", async () => {
    const msg: InboundMessage = {
      id: "test-8",
      channel: "C123",
      from: "U456",
      body: "Message",
      attachments: [{ type: "link" }],
      receivedAt: new Date().toISOString(),
    };
    const result = await enrichAttachments(msg, "xoxb-token", {});

    expect(result.body).toBe("Message\n\n[Attached: link]");
  });

  it("handles empty body correctly", async () => {
    const msg: InboundMessage = {
      id: "test-9",
      channel: "C123",
      from: "U456",
      body: "",
      attachments: [{
        type: "pdf",
        filename: "doc.pdf",
        url: "https://example.com/doc.pdf",
      }],
      receivedAt: new Date().toISOString(),
    };
    const enricher = vi.fn().mockResolvedValue("Content");
    const result = await enrichAttachments(msg, "xoxb-token", { pdf: enricher });

    expect(result.body).toBe("[Attached: doc.pdf]\nContent");
  });
});
