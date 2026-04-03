/**
 * Simple template interpolation for workflow step templates.
 * Supports {{key}} and {{steps.stepId.output}} patterns.
 */
export function interpolate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, path: string) => {
    const parts = path.trim().split('.');
    let value: unknown = context;
    for (const part of parts) {
      if (value == null || typeof value !== 'object') return '';
      value = (value as Record<string, unknown>)[part];
    }
    if (value == null) return '';
    return String(value);
  });
}
