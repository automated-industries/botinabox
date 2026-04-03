import { readFileSync } from 'node:fs';

export const MAX_OUTPUT_BYTES = 4 * 1024 * 1024; // 4MB

/**
 * Extract final output from NDJSON log content.
 * Finds last line with {type:'result'} or {role:'assistant'}.
 * Caps at 4MB.
 */
export function extractOutput(ndjsonContent: string): string {
  const lines = ndjsonContent.split('\n').filter((l) => l.trim().length > 0);

  let lastOutput: string | undefined;

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;

      if (parsed['type'] === 'result') {
        const content = parsed['result'] ?? parsed['content'] ?? parsed['output'];
        if (typeof content === 'string') {
          lastOutput = content;
        }
      } else if (parsed['role'] === 'assistant') {
        const content = parsed['content'];
        if (typeof content === 'string') {
          lastOutput = content;
        }
      } else if (parsed['type'] === 'assistant') {
        const message = parsed['message'] as Record<string, unknown> | undefined;
        if (message && Array.isArray(message['content'])) {
          for (const block of message['content']) {
            if (
              typeof block === 'object' &&
              block !== null &&
              (block as Record<string, unknown>)['type'] === 'text'
            ) {
              lastOutput = (block as Record<string, unknown>)['text'] as string;
            }
          }
        }
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  if (!lastOutput) {
    // Fall back to raw content
    lastOutput = ndjsonContent;
  }

  // Cap at 4MB
  if (Buffer.byteLength(lastOutput, 'utf8') > MAX_OUTPUT_BYTES) {
    return Buffer.from(lastOutput, 'utf8').subarray(0, MAX_OUTPUT_BYTES).toString('utf8');
  }

  return lastOutput;
}

/**
 * Read file and extract output.
 */
export function extractOutputFromFile(logPath: string): string {
  const content = readFileSync(logPath, 'utf8');
  return extractOutput(content);
}
