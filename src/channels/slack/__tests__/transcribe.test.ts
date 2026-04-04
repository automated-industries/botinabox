import { describe, it, expect, vi } from "vitest";

describe("enrichVoiceMessage", () => {
  it("passes through messages without voice markers", async () => {
    const { enrichVoiceMessage } = await import("../inbound.js");
    const msg = {
      id: "m1",
      channel: "slack",
      from: "U123",
      body: "Hello world",
      receivedAt: new Date().toISOString(),
    };
    const result = await enrichVoiceMessage(msg, "xoxb-token");
    expect(result.body).toBe("Hello world");
  });

  it("passes through messages that already have a transcript", async () => {
    const { enrichVoiceMessage } = await import("../inbound.js");
    const msg = {
      id: "m2",
      channel: "slack",
      from: "U123",
      body: "[Voice message] Already transcribed",
      receivedAt: new Date().toISOString(),
    };
    const result = await enrichVoiceMessage(msg, "xoxb-token");
    expect(result.body).toBe("[Voice message] Already transcribed");
  });

  it("returns original message when no files in raw event", async () => {
    const { enrichVoiceMessage } = await import("../inbound.js");
    const msg = {
      id: "m3",
      channel: "slack",
      from: "U123",
      body: "[Voice message — no transcript available]",
      receivedAt: new Date().toISOString(),
      raw: { type: "message", subtype: "file_share" },
    };
    const result = await enrichVoiceMessage(msg, "xoxb-token");
    expect(result.body).toBe("[Voice message — no transcript available]");
  });
});

describe("parseSlackEvent — voice with no transcript", () => {
  it("marks voice message as no transcript when Slack provides none", async () => {
    const { parseSlackEvent } = await import("../inbound.js");
    const msg = parseSlackEvent({
      type: "message",
      subtype: "file_share",
      ts: "1700000000.000001",
      channel: "D123",
      user: "U123",
      text: "",
      files: [{
        id: "F1",
        filetype: "aac",
        subtype: "slack_audio",
        url_private: "https://files.slack.com/voice.aac",
        // No transcription or preview
      }],
    });
    expect(msg.body).toBe("[Voice message — no transcript available]");
  });
});
