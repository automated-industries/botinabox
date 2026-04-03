import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { WebhookAdapter } from "../adapter.js";
import { verifyHmac } from "../hmac.js";

function makeHmacSignature(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

describe("WebhookAdapter — Story 4.7", () => {
  it("connect sets connected state", async () => {
    const adapter = new WebhookAdapter();
    await adapter.connect({ callbackUrl: "https://example.com/cb" });
    const health = await adapter.healthCheck();
    expect(health.ok).toBe(true);
    await adapter.disconnect();
  });

  it("disconnect clears connected state", async () => {
    const adapter = new WebhookAdapter();
    await adapter.connect({ callbackUrl: "https://example.com/cb" });
    await adapter.disconnect();
    const health = await adapter.healthCheck();
    expect(health.ok).toBe(false);
  });

  it("send returns success: false when not connected", async () => {
    const adapter = new WebhookAdapter();
    const result = await adapter.send({ peerId: "user-1" }, { text: "hello" });
    expect(result.success).toBe(false);
  });

  it("send returns success: true with no callbackUrl", async () => {
    const adapter = new WebhookAdapter();
    await adapter.connect({});
    const result = await adapter.send({ peerId: "user-1" }, { text: "hello" });
    expect(result.success).toBe(true);
    await adapter.disconnect();
  });

  it("send POSTs to callbackUrl when configured", async () => {
    const fetchCalls: { url: string; body: string }[] = [];
    const mockFetch = vi.fn(async (url: string, opts: RequestInit) => {
      fetchCalls.push({ url, body: opts.body as string });
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", mockFetch);

    const adapter = new WebhookAdapter();
    await adapter.connect({ callbackUrl: "https://example.com/cb" });
    const result = await adapter.send({ peerId: "user-1" }, { text: "hello" });

    expect(result.success).toBe(true);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("https://example.com/cb");
    const parsed = JSON.parse(fetchCalls[0].body) as { text: string; to: string };
    expect(parsed.text).toBe("hello");
    expect(parsed.to).toBe("user-1");

    await adapter.disconnect();
    vi.unstubAllGlobals();
  });

  it("id is 'webhook'", () => {
    const adapter = new WebhookAdapter();
    expect(adapter.id).toBe("webhook");
  });

  it("healthCheck returns ok: false before connecting", async () => {
    const adapter = new WebhookAdapter();
    const health = await adapter.healthCheck();
    expect(health.ok).toBe(false);
  });
});

describe("verifyHmac — Story 4.7", () => {
  it("returns true for correct signature", () => {
    const body = '{"hello":"world"}';
    const secret = "my-secret";
    const sig = makeHmacSignature(body, secret);
    expect(verifyHmac(body, secret, sig)).toBe(true);
  });

  it("returns false for incorrect signature", () => {
    expect(verifyHmac("body", "secret", "0000000000000000000000000000000000000000000000000000000000000000")).toBe(false);
  });

  it("handles sha256= prefix", () => {
    const body = "test body";
    const secret = "mysecret";
    const sig = makeHmacSignature(body, secret);
    expect(verifyHmac(body, secret, `sha256=${sig}`)).toBe(true);
  });

  it("returns false for wrong secret", () => {
    const body = "test body";
    const sig = makeHmacSignature(body, "correct-secret");
    expect(verifyHmac(body, "wrong-secret", sig)).toBe(false);
  });

  it("returns false for malformed signature (wrong length)", () => {
    expect(verifyHmac("body", "secret", "tooshort")).toBe(false);
  });
});
