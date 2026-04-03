/**
 * Text chunker — splits long text into chunks at natural boundaries.
 * Story 4.4
 */

/**
 * Split text into chunks of at most maxLen characters.
 * Splits at paragraph boundaries first, then sentence, then word, then hard-cuts.
 */
export function chunkText(text: string, maxLen: number): string[] {
  if (maxLen <= 0) throw new Error("maxLen must be > 0");
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];

  function splitInto(segment: string): void {
    if (segment.length <= maxLen) {
      if (segment.length > 0) chunks.push(segment);
      return;
    }

    // Try paragraph split (\n\n)
    const paraIdx = segment.lastIndexOf("\n\n", maxLen);
    if (paraIdx > 0) {
      chunks.push(segment.slice(0, paraIdx));
      splitInto(segment.slice(paraIdx + 2).trimStart());
      return;
    }

    // Try sentence split (". ")
    const sentIdx = segment.lastIndexOf(". ", maxLen);
    if (sentIdx > 0) {
      chunks.push(segment.slice(0, sentIdx + 1));
      splitInto(segment.slice(sentIdx + 2).trimStart());
      return;
    }

    // Try word split (" ")
    const wordIdx = segment.lastIndexOf(" ", maxLen);
    if (wordIdx > 0) {
      chunks.push(segment.slice(0, wordIdx));
      splitInto(segment.slice(wordIdx + 1));
      return;
    }

    // Hard cut
    chunks.push(segment.slice(0, maxLen));
    splitInto(segment.slice(maxLen));
  }

  splitInto(text);
  return chunks;
}
