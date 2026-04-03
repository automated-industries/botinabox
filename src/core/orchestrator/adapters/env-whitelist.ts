const DEFAULT_ALLOWED_ENV = [
  'PATH',
  'HOME',
  'SHELL',
  'LANG',
  'USER',
  'TERM',
  'NODE_PATH',
  'TMPDIR',
];

/**
 * Filter the process environment to only allowed keys, then merge in extras.
 */
export function filterEnv(
  allowed?: string[],
  extra?: Record<string, string>,
): Record<string, string> {
  const allowedKeys = allowed ?? DEFAULT_ALLOWED_ENV;
  const result: Record<string, string> = {};

  for (const key of allowedKeys) {
    const val = process.env[key];
    if (val !== undefined) {
      result[key] = val;
    }
  }

  if (extra) {
    Object.assign(result, extra);
  }

  return result;
}
