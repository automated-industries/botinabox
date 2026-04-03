/**
 * Slack inbound message parsing.
 * Story 4.5
 */

import type { InboundMessage } from "@botinabox/shared";

export interface SlackEvent {
  type: string;
  client_msg_id?: string;
  ts?: string;
  event_ts?: string;
  channel?: string;
  user?: string;
  text?: string;
  thread_ts?: string;
  [key: string]: unknown;
}

/**
 * Parse a Slack event into an InboundMessage.
 */
export function parseSlackEvent(event: SlackEvent): InboundMessage {
  const id = event.client_msg_id ?? event.ts ?? event.event_ts ?? `slack-${Date.now()}`;
  const channel = event.channel ?? "unknown";
  const from = event.user ?? "unknown";
  const body = event.text ?? "";
  const threadId = event.thread_ts !== undefined ? event.thread_ts : undefined;
  const receivedAt = event.ts
    ? new Date(parseFloat(event.ts) * 1000).toISOString()
    : new Date().toISOString();

  return {
    id,
    channel,
    from,
    body,
    threadId,
    receivedAt,
    raw: event,
  };
}
