import { describe, it, expect } from "vitest";
import {
  parseClaudeStream,
  isMaxTurns,
  isLoginRequired,
  deactivateLocalImagePaths,
} from "../claude-stream-parser.js";

describe("parseClaudeStream", () => {
  it("parses init event for session and model", () => {
    const stdout = `{"type":"system","subtype":"init","session_id":"sess-123","model":"claude-sonnet-4-6"}`;
    const result = parseClaudeStream(stdout);
    expect(result.sessionId).toBe("sess-123");
    expect(result.model).toBe("claude-sonnet-4-6");
  });

  it("extracts text from assistant message", () => {
    const stdout = `{"type":"assistant","message":{"content":[{"type":"text","text":"Hello world"}]}}`;
    const result = parseClaudeStream(stdout);
    expect(result.summary).toBe("Hello world");
  });

  it("extracts cost and usage from result", () => {
    const stdout = `{"type":"result","is_error":false,"stop_reason":"end_turn","total_cost_usd":0.05,"usage":{"input_tokens":100,"cache_read_input_tokens":50,"output_tokens":200}}`;
    const result = parseClaudeStream(stdout);
    expect(result.costUsd).toBe(0.05);
    expect(result.usage!.inputTokens).toBe(100);
    expect(result.usage!.cachedInputTokens).toBe(50);
    expect(result.usage!.outputTokens).toBe(200);
    expect(result.isError).toBe(false);
  });

  it("detects errors", () => {
    const stdout = `{"type":"result","is_error":true,"error":"Something broke","stop_reason":"error"}`;
    const result = parseClaudeStream(stdout);
    expect(result.isError).toBe(true);
    expect(result.errorMessage).toBe("Something broke");
  });

  it("handles empty/malformed input", () => {
    const result = parseClaudeStream("");
    expect(result.summary).toBe("");
    expect(result.isError).toBe(false);
    expect(result.sessionId).toBeNull();
  });

  it("handles multiple text blocks", () => {
    const stdout = [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Part 1"}]}}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Part 2"}]}}',
    ].join("\n");
    const result = parseClaudeStream(stdout);
    expect(result.summary).toBe("Part 1\nPart 2");
  });
});

describe("isMaxTurns", () => {
  it("returns true for max_turns stop reason", () => {
    expect(isMaxTurns({ stopReason: "max_turns" } as any)).toBe(true);
  });
  it("returns false for end_turn", () => {
    expect(isMaxTurns({ stopReason: "end_turn" } as any)).toBe(false);
  });
});

describe("isLoginRequired", () => {
  it("detects login required messages", () => {
    expect(isLoginRequired("Error: Not logged in")).toBe(true);
    expect(isLoginRequired("Everything is fine")).toBe(false);
  });
});

describe("deactivateLocalImagePaths", () => {
  it("rewrites image paths", () => {
    const input = "Check this file /tmp/screenshot.png please";
    const result = deactivateLocalImagePaths(input);
    expect(result).toBe("Check this file [image-path:/tmp/screenshot.png] please");
  });
  it("leaves non-image paths alone", () => {
    const input = "Check /tmp/data.json";
    expect(deactivateLocalImagePaths(input)).toBe(input);
  });
});
