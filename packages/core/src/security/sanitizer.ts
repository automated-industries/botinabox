import { Buffer } from 'node:buffer';
import type { SanitizerOptions } from './types.js';

const DEFAULT_FIELD_LIMIT = 65535;
const DEFAULT_SUFFIX = '[truncated]';

/**
 * Sanitizes a row object by:
 * 1. Stripping null bytes from string values
 * 2. Stripping control characters (preserving \n, \r, \t)
 * 3. Truncating fields that exceed their byte length limit
 *
 * Non-string values pass through unchanged.
 * Returns a new object — input is never mutated.
 */
export function sanitize(
  row: Record<string, unknown>,
  opts?: SanitizerOptions,
): Record<string, unknown> {
  const limits = opts?.fieldLengthLimits ?? {};
  const suffix = opts?.truncateSuffix ?? DEFAULT_SUFFIX;
  const result: Record<string, unknown> = {};

  for (const [col, val] of Object.entries(row)) {
    if (typeof val !== 'string') {
      result[col] = val;
      continue;
    }

    // 1. Strip null bytes
    let s = val.replace(/\x00/g, '');

    // 2. Strip control chars, preserving \n (0x0a), \r (0x0d), \t (0x09)
    s = s.replace(/[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');

    // 3. Enforce field length limit
    const limit = limits[col] ?? DEFAULT_FIELD_LIMIT;
    if (Buffer.byteLength(s) > limit) {
      // Truncate to fit within limit bytes (accounting for suffix)
      const suffixBytes = Buffer.byteLength(suffix);
      const maxContentBytes = limit - suffixBytes;
      // Slice the string to fit within maxContentBytes
      const buf = Buffer.from(s);
      s = buf.slice(0, maxContentBytes).toString() + suffix;
    }

    result[col] = s;
  }

  return result;
}
