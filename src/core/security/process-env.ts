/**
 * Build a clean environment for spawned subprocesses.
 * Strips secrets and passes only safe system variables.
 * Used by the CLI execution adapter when spawning agent processes.
 */

const DEFAULT_ALLOWED_KEYS = new Set([
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "LANG",
  "TERM",
  "TMPDIR",
  "XDG_RUNTIME_DIR",
  "NODE_ENV",
  // Git
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
  // Homebrew / system
  "HOMEBREW_PREFIX",
  "HOMEBREW_CELLAR",
  "HOMEBREW_REPOSITORY",
]);

/**
 * Build a filtered environment for subprocess execution.
 * Only passes explicitly allowed variables — all secrets are stripped.
 *
 * @param allowedKeys - Additional keys to allow beyond the defaults
 * @param inject - Extra key-value pairs to inject into the env
 */
export function buildProcessEnv(
  allowedKeys?: string[],
  inject?: Record<string, string>,
): Record<string, string> {
  const allowed = new Set(DEFAULT_ALLOWED_KEYS);
  if (allowedKeys) {
    for (const k of allowedKeys) allowed.add(k);
  }

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (allowed.has(key) && value !== undefined) {
      env[key] = value;
    }
  }

  if (inject) {
    Object.assign(env, inject);
  }

  return env;
}
