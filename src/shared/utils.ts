/** Shared utility functions. */

/**
 * Truncate text at a word boundary, appending "..." if truncated.
 * Returns the original text if it's shorter than maxLen.
 */
export function truncateAtWord(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const truncated = text.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(" ");
  const cutPoint = lastSpace > maxLen * 0.5 ? lastSpace : maxLen;
  return truncated.slice(0, cutPoint) + "...";
}
