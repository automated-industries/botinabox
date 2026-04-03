import { describe, it, expect } from "vitest";
import { SessionKey } from "../session-key.js";

describe("SessionKey — Story 4.3", () => {
  it("toString produces correct format", () => {
    const key = new SessionKey("agent-1", "slack", "main");
    expect(key.toString()).toBe("agent:agent-1:slack:main");
  });

  it("toJSON returns structured object", () => {
    const key = new SessionKey("agent-1", "slack", "main");
    expect(key.toJSON()).toEqual({ agentId: "agent-1", channel: "slack", scope: "main" });
  });

  it("fromString round-trip", () => {
    const original = new SessionKey("agent-1", "slack", "user-42");
    const parsed = SessionKey.fromString(original.toString());
    expect(parsed.agentId).toBe("agent-1");
    expect(parsed.channel).toBe("slack");
    expect(parsed.scope).toBe("user-42");
  });

  it("fromString throws on invalid format", () => {
    expect(() => SessionKey.fromString("bad:format")).toThrow();
    expect(() => SessionKey.fromString("not-agent:a:b:c")).toThrow();
  });

  it("build: DM with dmScope=main produces main scope", () => {
    const key = SessionKey.build("bot", "slack", "dm", "user-1", "main");
    expect(key.scope).toBe("main");
    expect(key.toString()).toBe("agent:bot:slack:main");
  });

  it("build: DM with dmScope=per-peer scopes to peerId", () => {
    const key = SessionKey.build("bot", "slack", "dm", "user-42", "per-peer");
    expect(key.scope).toBe("user-42");
  });

  it("build: DM with dmScope=per-channel-peer scopes to channel+peer", () => {
    const key = SessionKey.build("bot", "slack", "dm", "user-42", "per-channel-peer");
    expect(key.scope).toBe("slack:user-42");
  });

  it("build: group chat scopes to channel", () => {
    const key = SessionKey.build("bot", "general", "group", "user-1", "per-peer");
    expect(key.scope).toBe("general");
    expect(key.channel).toBe("general");
  });

  it("two keys with same params produce identical strings", () => {
    const a = SessionKey.build("bot", "slack", "dm", "user-1", "per-peer");
    const b = SessionKey.build("bot", "slack", "dm", "user-1", "per-peer");
    expect(a.toString()).toBe(b.toString());
  });

  it("two keys with different scopes produce different strings", () => {
    const a = SessionKey.build("bot", "slack", "dm", "user-1", "main");
    const b = SessionKey.build("bot", "slack", "dm", "user-2", "per-peer");
    expect(a.toString()).not.toBe(b.toString());
  });
});
