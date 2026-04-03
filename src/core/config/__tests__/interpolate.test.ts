import { describe, it, expect } from "vitest";
import { interpolateEnv } from "../interpolate.js";

describe("interpolateEnv — Story 1.2", () => {
  it("replaces ${VAR} with env value", () => {
    expect(interpolateEnv("${FOO}", { FOO: "bar" })).toBe("bar");
  });

  it("leaves placeholder if env var not set", () => {
    expect(interpolateEnv("${MISSING}", {})).toBe("${MISSING}");
  });

  it("replaces multiple vars in one string", () => {
    expect(interpolateEnv("${A}/${B}", { A: "hello", B: "world" })).toBe("hello/world");
  });

  it("recurses into objects", () => {
    const result = interpolateEnv({ key: "${TOKEN}" }, { TOKEN: "abc123" });
    expect(result).toEqual({ key: "abc123" });
  });

  it("recurses into arrays", () => {
    const result = interpolateEnv(["${X}", "${Y}"], { X: "1", Y: "2" });
    expect(result).toEqual(["1", "2"]);
  });

  it("passes through non-string primitives unchanged", () => {
    expect(interpolateEnv(42, {})).toBe(42);
    expect(interpolateEnv(true, {})).toBe(true);
    expect(interpolateEnv(null, {})).toBe(null);
  });

  it("handles nested objects and arrays", () => {
    const input = { a: { b: ["${X}", "${Y}"] } };
    const result = interpolateEnv(input, { X: "foo", Y: "bar" });
    expect(result).toEqual({ a: { b: ["foo", "bar"] } });
  });

  it("does not double-substitute — result is not re-interpolated", () => {
    // If env var value itself contains ${...}, it should NOT be substituted
    expect(interpolateEnv("${A}", { A: "${B}", B: "secret" })).toBe("${B}");
  });

  it("partial substitution — unknown var left as-is, known var replaced", () => {
    const result = interpolateEnv("${KNOWN}:${UNKNOWN}", { KNOWN: "yes" });
    expect(result).toBe("yes:${UNKNOWN}");
  });
});
