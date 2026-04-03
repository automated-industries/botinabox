/**
 * Slack outbound formatting.
 * Story 4.5
 */

/**
 * Convert standard markdown to Slack's mrkdwn format.
 * - **bold** → *bold*
 * - _italic_ preserved
 * - `code` preserved
 * - ```code block``` preserved
 */
export function formatForSlack(text: string): string {
  // **bold** → *bold*
  let result = text.replace(/\*\*(.+?)\*\*/gs, "*$1*");
  // __bold__ → *bold*
  result = result.replace(/__(.+?)__/gs, "*$1*");
  return result;
}
