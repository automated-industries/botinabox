/**
 * HMAC signature verification for webhook payloads.
 * Story 4.7
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify that the HMAC-SHA256 signature of body matches the provided signature.
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * @param body      - The raw request body string
 * @param secret    - The shared HMAC secret
 * @param signature - The signature to verify (hex string, possibly prefixed with "sha256=")
 */
export function verifyHmac(body: string, secret: string, signature: string): boolean {
  const expected = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  // Strip optional "sha256=" prefix
  const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;

  if (expected.length !== provided.length) return false;

  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
  } catch {
    return false;
  }
}
