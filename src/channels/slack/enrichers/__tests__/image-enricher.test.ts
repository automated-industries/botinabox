import { describe, it, expect, vi, beforeEach } from "vitest";
import { createImageEnricher } from "../image-enricher.js";

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "A detailed image description." }],
      }),
    },
  })),
}));

describe("createImageEnricher", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
    vi.clearAllMocks();
  });

  it("downloads image from Slack and sends to Claude vision API", async () => {
    const mockBuffer = Buffer.from("fake-image-data");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => mockBuffer.buffer,
    } as any);

    const enricher = createImageEnricher({ apiKey: "sk-test" });
    const result = await enricher({
      type: "image",
      url: "https://files.slack.com/image.jpg",
      mimeType: "image/jpeg",
    }, "xoxb-token");

    expect(result).toBe("A detailed image description.");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://files.slack.com/image.jpg",
      expect.objectContaining({
        headers: { Authorization: "Bearer xoxb-token" },
      })
    );
  });

  it("returns null when URL is missing", async () => {
    const enricher = createImageEnricher({ apiKey: "sk-test" });
    const result = await enricher({ type: "image" }, "xoxb-token");

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null when fetch fails with non-ok response", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as any);

    const enricher = createImageEnricher({ apiKey: "sk-test" });
    const result = await enricher({
      type: "image",
      url: "https://files.slack.com/missing.jpg",
    }, "xoxb-token");

    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("Network error"));

    const enricher = createImageEnricher({ apiKey: "sk-test" });
    const result = await enricher({
      type: "image",
      url: "https://files.slack.com/image.jpg",
    }, "xoxb-token");

    expect(result).toBeNull();
  });

  it("returns null when Anthropic API throws", async () => {
    const mockBuffer = Buffer.from("fake-image-data");
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

    const enricher = createImageEnricher({ apiKey: "sk-test" });
    const result = await enricher({
      type: "image",
      url: "https://files.slack.com/image.jpg",
    }, "xoxb-token");

    expect(result).toBeNull();
  });

  it("uses default model when not specified", async () => {
    const mockBuffer = Buffer.from("fake-image-data");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => mockBuffer.buffer,
    } as any);

    const { default: MockAnthropic } = await import("@anthropic-ai/sdk");
    const createSpy = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "description" }],
    });
    (MockAnthropic as any).mockImplementationOnce(() => ({
      messages: { create: createSpy },
    }));

    const enricher = createImageEnricher({ apiKey: "sk-test" });
    await enricher({
      type: "image",
      url: "https://files.slack.com/image.jpg",
      mimeType: "image/png",
    }, "xoxb-token");

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-4-6",
      })
    );
  });

  it("uses custom model when specified", async () => {
    const mockBuffer = Buffer.from("fake-image-data");
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => mockBuffer.buffer,
    } as any);

    const { default: MockAnthropic } = await import("@anthropic-ai/sdk");
    const createSpy = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "description" }],
    });
    (MockAnthropic as any).mockImplementationOnce(() => ({
      messages: { create: createSpy },
    }));

    const enricher = createImageEnricher({
      apiKey: "sk-test",
      model: "claude-opus-4",
    });
    await enricher({
      type: "image",
      url: "https://files.slack.com/image.jpg",
    }, "xoxb-token");

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-opus-4",
      })
    );
  });
});
