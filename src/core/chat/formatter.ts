/**
 * Text formatter — converts markdown to channel-specific formats.
 * Story 4.4
 */

/**
 * Format text for the given mode:
 * - 'mrkdwn': Slack's mrkdwn format (**bold** → *bold*, _italic_ preserved, `code` preserved)
 * - 'html': basic markdown → HTML (strong, em, code, pre)
 * - 'plain': strip markdown markers
 */
export function formatText(text: string, mode: "mrkdwn" | "html" | "plain"): string {
  switch (mode) {
    case "mrkdwn":
      return toMrkdwn(text);
    case "html":
      return toHtml(text);
    case "plain":
      return toPlain(text);
  }
}

function toMrkdwn(text: string): string {
  // **bold** → *bold* (Slack uses single asterisk for bold)
  let result = text.replace(/\*\*(.+?)\*\*/g, "*$1*");
  // __bold__ → *bold*
  result = result.replace(/__(.+?)__/g, "*$1*");
  // _italic_ remains as _italic_ (already valid mrkdwn)
  // `code` remains as `code`
  // ```code block``` remains
  return result;
}

function toHtml(text: string): string {
  // Code blocks first (before inline)
  let result = text.replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>");
  // Inline code
  result = result.replace(/`(.+?)`/g, "<code>$1</code>");
  // **bold**
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // __bold__
  result = result.replace(/__(.+?)__/g, "<strong>$1</strong>");
  // *italic*
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // _italic_
  result = result.replace(/_(.+?)_/g, "<em>$1</em>");
  return result;
}

function toPlain(text: string): string {
  // Remove code blocks
  let result = text.replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, "").trim());
  // Remove inline code markers
  result = result.replace(/`(.+?)`/g, "$1");
  // Remove **bold**
  result = result.replace(/\*\*(.+?)\*\*/g, "$1");
  // Remove __bold__
  result = result.replace(/__(.+?)__/g, "$1");
  // Remove *italic*
  result = result.replace(/\*(.+?)\*/g, "$1");
  // Remove _italic_
  result = result.replace(/_(.+?)_/g, "$1");
  return result;
}
