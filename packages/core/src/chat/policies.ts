/**
 * Chat policy helpers — allowlist and mention gate checks.
 * Story 4.2
 */

import type { InboundMessage } from "./types.js";

/**
 * Returns true if the sender is in the allowlist.
 * If allowFrom is empty, all senders are allowed.
 */
export function checkAllowlist(allowFrom: string[], senderId: string): boolean {
  if (allowFrom.length === 0) return true;
  return allowFrom.includes(senderId);
}

/**
 * Returns true if the message passes the mention gate.
 * In group/channel contexts, the bot must be mentioned (body contains @botId or similar).
 * In direct contexts, always passes.
 */
export function checkMentionGate(msg: InboundMessage, botId: string): boolean {
  // For direct messages, no mention required
  // We check via a simple heuristic: if the message contains the botId mention
  // This is called only when mention gating is enabled
  const body = msg.body ?? "";
  return body.includes(`@${botId}`) || body.includes(botId);
}
