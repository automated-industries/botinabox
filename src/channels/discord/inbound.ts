/**
 * Discord inbound message parsing.
 * Story 4.6
 */

import type { InboundMessage } from "../../shared/index.js";

export interface DiscordEvent {
  id?: string;
  channel_id?: string;
  guild_id?: string;
  author?: { id?: string; username?: string };
  content?: string;
  message_reference?: { message_id?: string; channel_id?: string };
  timestamp?: string;
  [key: string]: unknown;
}

/**
 * Parse a Discord message event into an InboundMessage.
 */
export function parseDiscordEvent(event: DiscordEvent): InboundMessage {
  const id = event.id ?? `discord-${Date.now()}`;
  const channel = event.channel_id ?? "unknown";
  const from = event.author?.id ?? "unknown";
  const body = event.content ?? "";
  const replyToId = event.message_reference?.message_id;
  const receivedAt = event.timestamp ?? new Date().toISOString();

  return {
    id,
    channel,
    from,
    body,
    replyToId,
    receivedAt,
    raw: event,
  };
}
