/**
 * Interpolate ${ENV_VAR} references in YAML string values.
 * Recursively walks objects and arrays.
 */
export function interpolateEnv(value: unknown, env: Record<string, string | undefined> = process.env): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([^}]+)\}/g, (_, name) => {
      const envVal = env[name];
      if (envVal === undefined) {
        // Leave the placeholder if env var is not set (don't silently swallow)
        return `\${${name}}`;
      }
      return envVal;
    });
  }

  if (Array.isArray(value)) {
    return value.map(item => interpolateEnv(item, env));
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = interpolateEnv(v, env);
    }
    return result;
  }

  return value;
}
