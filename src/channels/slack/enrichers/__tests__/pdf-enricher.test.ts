import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPdfEnricher } from "../pdf-enricher.js";

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "PDF summary with key points." }],
      }),
    },
  })),
}));

describe("createPdfEnricher", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
    vi.clearAllMocks();
  });

  it("downloads PDF from Slack and sends to Claude document API", async () => {
    const mockBuffer = Buffer.from("fake-pdf-data");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => mockBuffer.buffer,
    } as any);

    const enricher = createPdfEnricher({ apiKey: "sk-test" });
    const result = await enricher({
      type: "pdf",
      url: "https://files.slack.com/document.pdf",
    }, "xoxb-token");

    expect(result).toBe("PDF summary with key points.");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://files.slack.com/document.pdf",
      expect.objectContaining({
        headers: { Authorization: "Bearer xoxb-token" },
      })
    );
  });

  it("returns null when URL is missing", async () => {
    const enricher = createPdfEnricher({ apiKey: "sk-test" });
    const result = await enricher({ type: "pdf" }, "xoxb-token");

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null when fetch fails with non-ok response", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 403,
    } as any);

    const enricher = createPdfEnricher({ apiKey: "sk-test" });
    const result = await enricher({
      type: "pdf",
      url: "https://files.slack.com/missing.pdf",
    }, "xoxb-token");

    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("Network error"));

    const enricher = createPdfEnricher({ apiKey: "sk-test" });
    const result = await enricher({
      type: "pdf",
      url: "https://files.slack.com/document.pdf",
    }, "xoxb-token");

    expect(result).toBeNull();
  });

  it("returns null when Anthropic API throws", async () => {
    const mockBuffer = Buffer.from("fake-pdf-data");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => mockBuffer.buffer,
    } as any);

    const { default: MockAnthropic } = await import("@anthropic-ai/sdk");
    (MockAnthropic as any).mockImplementationOnce(() => ({
      messages: {
        create: vi.fn().mockRejectedValue(new Error("API error")),
      },
    }));

    const enricher = createPdfEnricher({ apiKey: "sk-test" });
    const result = await enricher({
      type: "pdf",
      url: "https://files.slack.com/document.pdf",
    }, "xoxb-token");

    expect(result).toBeNull();
  });

  it("uses default model and maxTokens when not specified", async () => {
    const mockBuffer = Buffer.from("fake-pdf-data");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => mockBuffer.buffer,
    } as any);

    const { default: MockAnthropic } = await import("@anthropic-ai/sdk");
    const createSpy = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "summary" }],
    });
    (MockAnthropic as any).mockImplementationOnce(() => ({
      messages: { create: createSpy },
    }));

    const enricher = createPdfEnricher({ apiKey: "sk-test" });
    await enricher({
      type: "pdf",
      url: "https://files.slack.com/document.pdf",
    }, "xoxb-token");

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
      })
    );
  });

  it("uses custom model and maxTokens when specified", async () => {
    const mockBuffer = Buffer.from("fake-pdf-data");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => mockBuffer.buffer,
    } as any);

    const { default: MockAnthropic } = await import("@anthropic-ai/sdk");
    const createSpy = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "summary" }],
    });
    (MockAnthropic as any).mockImplementationOnce(() => ({
      messages: { create: createSpy },
    }));

    const enricher = createPdfEnricher({
      apiKey: "sk-test",
      model: "claude-opus-4",
      maxTokens: 8192,
    });
    await enricher({
      type: "pdf",
      url: "https://files.slack.com/document.pdf",
    }, "xoxb-token");

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-opus-4",
        max_tokens: 8192,
      })
    );
  });

  it("uses 60s timeout for PDF download", async () => {
    const mockBuffer = Buffer.from("fake-pdf-data");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => mockBuffer.buffer,
    } as any);

    const enricher = createPdfEnricher({ apiKey: "sk-test" });
    await enricher({
      type: "pdf",
      url: "https://files.slack.com/document.pdf",
    }, "xoxb-token");

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      })
    );
  });
});
