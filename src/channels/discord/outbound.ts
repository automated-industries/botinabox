/**
 * Discord outbound formatting.
 * Discord uses native markdown — just enforce the 2000-char limit.
 * Story 4.6
 */

const DISCORD_MAX_LENGTH = 2000;

/**
 * Split text into Discord-compatible chunks (2000 char max each).
 */
export function chunkForDiscord(text: string): string[] {
  if (text.length <= DISCORD_MAX_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > DISCORD_MAX_LENGTH) {
    // Try to split at a word boundary
    const slice = remaining.slice(0, DISCORD_MAX_LENGTH);
    const lastSpace = slice.lastIndexOf(" ");
    if (lastSpace > 0) {
      chunks.push(remaining.slice(0, lastSpace));
      remaining = remaining.slice(lastSpace + 1);
    } else {
      chunks.push(remaining.slice(0, DISCORD_MAX_LENGTH));
      remaining = remaining.slice(DISCORD_MAX_LENGTH);
    }
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

/**
 * Discord uses native markdown — no conversion needed.
 * Returns the text unchanged (Discord renders it natively).
 */
export function formatForDiscord(text: string): string {
  return text;
}
