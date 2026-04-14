import { describe, it, expect, vi } from "vitest";
import { SlackAdapter } from "../adapter.js";
import type { BoltClient } from "../adapter.js";

function makeMockClient(): BoltClient & { calls: { channel: string; text: string; threadTs?: string }[] } {
  const calls: { channel: string; text: string; threadTs?: string }[] = [];
  return {
    calls,
    async postMessage(channel, text, threadTs) {
      calls.push({ channel, text, threadTs });
      return { ok: true, ts: "1234567890.000001" };
    },
  };
}

describe("SlackAdapter — Story 4.5", () => {
  it("connect sets connected state", async () => {
    const adapter = new SlackAdapter();
    await adapter.connect({ botToken: "xoxb-test" });
    const health = await adapter.healthCheck();
    expect(health.ok).toBe(true);
  });

  it("disconnect clears connected state", async () => {
    const adapter = new SlackAdapter();
    await adapter.connect({ botToken: "xoxb-test" });
    await adapter.disconnect();
    const health = await adapter.healthCheck();
    expect(health.ok).toBe(false);
  });

  it("send returns success: false when not connected", async () => {
    const adapter = new SlackAdapter();
    const result = await adapter.send({ peerId: "C123" }, { text: "hello" });
    expect(result.success).toBe(false);
  });

  it("send uses mock client when provided", async () => {
    const client = makeMockClient();
    const adapter = new SlackAdapter(client);
    await adapter.connect({ botToken: "xoxb-test" });

    const result = await adapter.send({ peerId: "C123" }, { text: "hello" });
    expect(result.success).toBe(true);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].channel).toBe("C123");
    expect(client.calls[0].text).toBe("hello");
  });

  it("send converts **bold** to *bold* in mrkdwn", async () => {
    const client = makeMockClient();
    const adapter = new SlackAdapter(client);
    await adapter.connect({ botToken: "xoxb-test" });

    await adapter.send({ peerId: "C123" }, { text: "**bold text**" });
    expect(client.calls[0].text).toBe("*bold text*");
  });

  it("send passes threadId as threadTs", async () => {
    const client = makeMockClient();
    const adapter = new SlackAdapter(client);
    await adapter.connect({ botToken: "xoxb-test" });

    await adapter.send({ peerId: "C123", threadId: "1234.0001" }, { text: "reply" });
    expect(client.calls[0].threadTs).toBe("1234.0001");
  });

  it("healthCheck returns ok: false before connecting", async () => {
    const adapter = new SlackAdapter();
    const health = await adapter.healthCheck();
    expect(health.ok).toBe(false);
  });

  it("id is 'slack'", () => {
    const adapter = new SlackAdapter();
    expect(adapter.id).toBe("slack");
  });
});

describe("parseSlackEvent — Story 4.5", () => {
  it("parses a basic message event", async () => {
    const { parseSlackEvent } = await import("../inbound.js");
    const event = {
      type: "message",
      client_msg_id: "abc-123",
      ts: "1617000000.000001",
      channel: "C123",
      user: "U456",
      text: "Hello world",
    };
    const msg = parseSlackEvent(event);
    expect(msg.id).toBe("abc-123");
    expect(msg.channel).toBe("C123");
    expect(msg.from).toBe("U456");
    expect(msg.body).toBe("Hello world");
    expect(msg.threadId).toBeUndefined();
  });

  it("parses thread_ts when present", async () => {
    const { parseSlackEvent } = await import("../inbound.js");
    const event = {
      type: "message",
      ts: "1617000001.000001",
      channel: "C123",
      user: "U456",
      text: "In a thread",
      thread_ts: "1617000000.000001",
    };
    const msg = parseSlackEvent(event);
    expect(msg.threadId).toBe("1617000000.000001");
  });

  it("falls back to ts as id when no client_msg_id", async () => {
    const { parseSlackEvent } = await import("../inbound.js");
    const event = {
      type: "message",
      ts: "1617000000.000001",
      channel: "C123",
      user: "U456",
      text: "Hi",
    };
    const msg = parseSlackEvent(event);
    expect(msg.id).toBe("1617000000.000001");
  });
});

describe("formatForSlack — Story 4.5", () => {
  it("converts **bold** to *bold*", async () => {
    const { formatForSlack } = await import("../outbound.js");
    expect(formatForSlack("**hello**")).toBe("*hello*");
  });

  it("converts __bold__ to *bold*", async () => {
    const { formatForSlack } = await import("../outbound.js");
    expect(formatForSlack("__hello__")).toBe("*hello*");
  });

  it("leaves _italic_ unchanged", async () => {
    const { formatForSlack } = await import("../outbound.js");
    expect(formatForSlack("_italic_")).toBe("_italic_");
  });

  it("leaves `code` unchanged", async () => {
    const { formatForSlack } = await import("../outbound.js");
    expect(formatForSlack("`code`")).toBe("`code`");
  });
});

describe("Voice message parsing", () => {
  it("extracts transcript from voice message with transcription.preview.content", async () => {
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
        transcription: { status: "complete", preview: { content: "Deploy the new build today" } },
      }],
    });
    expect(msg.body).toBe("[Voice message] Deploy the new build today");
  });

  it("falls back to file preview when transcription is unavailable", async () => {
    const { parseSlackEvent } = await import("../inbound.js");
    const msg = parseSlackEvent({
      type: "message",
      subtype: "file_share",
      ts: "1700000000.000002",
      channel: "D123",
      user: "U123",
      text: "",
      files: [{
        id: "F2",
        filetype: "m4a",
        subtype: "slack_audio",
        preview: "Check the server logs",
      }],
    });
    expect(msg.body).toBe("[Voice message] Check the server logs");
  });

  it("appends voice transcript to existing text body", async () => {
    const { parseSlackEvent } = await import("../inbound.js");
    const msg = parseSlackEvent({
      type: "message",
      subtype: "file_share",
      ts: "1700000000.000003",
      channel: "D123",
      user: "U123",
      text: "See attached",
      files: [{
        id: "F3",
        filetype: "aac",
        subtype: "slack_audio",
        transcription: { status: "complete", preview: { content: "Here is more context" } },
      }],
    });
    expect(msg.body).toContain("See attached");
    expect(msg.body).toContain("[Voice message] Here is more context");
  });

  it("marks voice message for local transcription when no Slack transcript", async () => {
    const { parseSlackEvent } = await import("../inbound.js");
    const msg = parseSlackEvent({
      type: "message",
      subtype: "file_share",
      ts: "1700000000.000004",
      channel: "D123",
      user: "U123",
      text: "",
      files: [{
        id: "F4",
        filetype: "aac",
        subtype: "slack_audio",
      }],
    });
    expect(msg.body).toBe("[Voice message — no transcript available]");
  });

  it("ignores non-audio file_share events", async () => {
    const { parseSlackEvent } = await import("../inbound.js");
    const msg = parseSlackEvent({
      type: "message",
      subtype: "file_share",
      ts: "1700000000.000005",
      channel: "D123",
      user: "U123",
      text: "Here is a document",
      files: [{
        id: "F5",
        filetype: "pdf",
        url_private: "https://files.slack.com/doc.pdf",
      }],
    });
    expect(msg.body).toBe("Here is a document");
  });

  it("extractVoiceTranscript returns null for non-audio files", async () => {
    const { extractVoiceTranscript } = await import("../inbound.js");
    expect(extractVoiceTranscript({ filetype: "pdf" })).toBeNull();
    expect(extractVoiceTranscript({ filetype: "png" })).toBeNull();
  });

  it("extractVoiceTranscript returns transcript for audio files", async () => {
    const { extractVoiceTranscript } = await import("../inbound.js");
    expect(extractVoiceTranscript({
      filetype: "aac",
      subtype: "slack_audio",
      transcription: { status: "complete", preview: { content: "Hello world" } },
    })).toBe("Hello world");
  });
});

describe("parseSlackEvent — attachments", () => {
  it("populates attachments from file_share with PDF", async () => {
    const { parseSlackEvent } = await import("../inbound.js");
    const msg = parseSlackEvent({
      type: "message",
      subtype: "file_share",
      ts: "1700000000.000006",
      channel: "C123",
      user: "U456",
      text: "Here is a PDF",
      files: [{
        id: "F6",
        filetype: "pdf",
        name: "report.pdf",
        url_private: "https://files.slack.com/report.pdf",
        size: 51200,
        mimetype: "application/pdf",
      }],
    });
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments![0].type).toBe("pdf");
    expect(msg.attachments![0].url).toBe("https://files.slack.com/report.pdf");
    expect(msg.attachments![0].filename).toBe("report.pdf");
    expect(msg.attachments![0].size).toBe(51200);
  });

  it("populates attachments from file_share with docx", async () => {
    const { parseSlackEvent } = await import("../inbound.js");
    const msg = parseSlackEvent({
      type: "message",
      subtype: "file_share",
      ts: "1700000000.000007",
      channel: "C123",
      user: "U456",
      text: "Document",
      files: [{
        id: "F7",
        filetype: "docx",
        name: "contract.docx",
        url_private: "https://files.slack.com/contract.docx",
      }],
    });
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments![0].type).toBe("doc");
  });

  it("populates link attachments from URLs in message text", async () => {
    const { parseSlackEvent } = await import("../inbound.js");
    const msg = parseSlackEvent({
      type: "message",
      ts: "1700000000.000008",
      channel: "C123",
      user: "U456",
      text: "Check https://example.com and http://test.com",
    });
    expect(msg.attachments).toHaveLength(2);
    expect(msg.attachments![0].type).toBe("link");
    expect(msg.attachments![0].url).toBe("https://example.com");
    expect(msg.attachments![1].type).toBe("link");
    expect(msg.attachments![1].url).toBe("http://test.com");
  });

  it("returns undefined attachments for messages with no files or URLs", async () => {
    const { parseSlackEvent } = await import("../inbound.js");
    const msg = parseSlackEvent({
      type: "message",
      ts: "1700000000.000009",
      channel: "C123",
      user: "U456",
      text: "Plain text message",
    });
    expect(msg.attachments).toBeUndefined();
  });

  it("skips audio files from attachments (handled by voice path)", async () => {
    const { parseSlackEvent } = await import("../inbound.js");
    const msg = parseSlackEvent({
      type: "message",
      subtype: "file_share",
      ts: "1700000000.000010",
      channel: "D123",
      user: "U456",
      text: "",
      files: [{
        id: "F10",
        filetype: "aac",
        subtype: "slack_audio",
        transcription: { status: "complete", preview: { content: "Audio transcript" } },
      }],
    });
    expect(msg.attachments).toBeUndefined();
    expect(msg.body).toBe("[Voice message] Audio transcript");
  });

  it("combines file attachments and URL attachments", async () => {
    const { parseSlackEvent } = await import("../inbound.js");
    const msg = parseSlackEvent({
      type: "message",
      subtype: "file_share",
      ts: "1700000000.000011",
      channel: "C123",
      user: "U456",
      text: "See attachment and https://example.com",
      files: [{
        id: "F11",
        filetype: "pdf",
        name: "doc.pdf",
        url_private: "https://files.slack.com/doc.pdf",
      }],
    });
    expect(msg.attachments).toHaveLength(2);
    expect(msg.attachments![0].type).toBe("pdf");
    expect(msg.attachments![1].type).toBe("link");
  });

  it("uses file title as fallback filename", async () => {
    const { parseSlackEvent } = await import("../inbound.js");
    const msg = parseSlackEvent({
      type: "message",
      subtype: "file_share",
      ts: "1700000000.000012",
      channel: "C123",
      user: "U456",
      text: "",
      files: [{
        id: "F12",
        filetype: "pdf",
        title: "Important Document",
        url_private: "https://files.slack.com/doc.pdf",
      }],
    });
    expect(msg.attachments![0].filename).toBe("Important Document");
  });
});
