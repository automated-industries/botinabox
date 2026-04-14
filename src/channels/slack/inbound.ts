/**
 * Slack inbound message parsing.
 * Story 4.5
 */

import type { InboundMessage, Attachment } from "../../shared/index.js";
import { transcribeAudio, downloadAudio } from "./transcribe.js";
import { slackFiletypeToMediaType, extractUrls } from "./media-type.js";

export interface SlackFile {
  id?: string;
  filetype?: string;
  subtype?: string;
  url_private?: string;
  preview?: string;
  transcription?: {
    status?: string;
    preview?: { content?: string };
  };
  [key: string]: unknown;
}

export interface SlackEvent {
  type: string;
  subtype?: string;
  client_msg_id?: string;
  ts?: string;
  event_ts?: string;
  channel?: string;
  user?: string;
  text?: string;
  thread_ts?: string;
  files?: SlackFile[];
  [key: string]: unknown;
}

const AUDIO_TYPES = new Set(["aac", "mp4", "m4a", "ogg", "webm", "mp3", "wav"]);

/**
 * Extract the text content from a voice message file.
 * Prefers the transcription preview; falls back to the file preview text.
 * Returns null if the file is not a voice message or has no transcript.
 */
export function extractVoiceTranscript(file: SlackFile): string | null {
  const isAudio = file.subtype === "slack_audio" || AUDIO_TYPES.has(file.filetype ?? "");
  if (!isAudio) return null;

  const transcript =
    file.transcription?.preview?.content ??
    (typeof file.preview === "string" ? file.preview : null);

  return transcript ?? null;
}

/**
 * Parse a Slack event into an InboundMessage.
 *
 * Handles standard text messages and voice messages (file_share subtype
 * with audio files). Voice message transcripts are extracted and prefixed
 * with `[Voice message]`.
 */
export function parseSlackEvent(event: SlackEvent): InboundMessage {
  const id = event.client_msg_id ?? event.ts ?? event.event_ts ?? `slack-${Date.now()}`;
  const channel = event.channel ?? "unknown";
  const from = event.user ?? "unknown";
  const threadId = event.thread_ts !== undefined ? event.thread_ts : undefined;
  const receivedAt = event.ts
    ? new Date(parseFloat(event.ts) * 1000).toISOString()
    : new Date().toISOString();

  let body = event.text ?? "";

  // Voice messages: extract transcript from audio file attachments
  if (event.subtype === "file_share" && event.files?.length) {
    for (const file of event.files) {
      const transcript = extractVoiceTranscript(file);
      if (transcript) {
        body = body ? `${body}\n\n[Voice message] ${transcript}` : `[Voice message] ${transcript}`;
        break; // Only one voice message per event
      }
    }
  }

  // If voice message had no Slack transcript, mark for local transcription
  if (event.subtype === "file_share" && event.files?.length && !body) {
    const hasAudio = event.files.some(
      (f) => f.subtype === "slack_audio" || AUDIO_TYPES.has(f.filetype ?? ""),
    );
    if (hasAudio) {
      body = "[Voice message — no transcript available]";
    }
  }

  // Non-audio file attachments → Attachment[]
  const attachments: Attachment[] = [];
  if (event.subtype === "file_share" && event.files?.length) {
    for (const file of event.files) {
      // Skip audio — handled by voice-message path above
      const isAudio = file.subtype === "slack_audio" || AUDIO_TYPES.has(file.filetype ?? "");
      if (isAudio) continue;

      attachments.push({
        type: slackFiletypeToMediaType(file.filetype),
        url: file.url_private,
        mimeType: (file as Record<string, unknown>).mimetype as string | undefined,
        filename: ((file as Record<string, unknown>).name as string | undefined)
          ?? ((file as Record<string, unknown>).title as string | undefined),
        size: (file as Record<string, unknown>).size as number | undefined,
      });
    }
  }

  // URLs in message text → "link" attachments
  const urls = extractUrls(body);
  for (const url of urls) {
    attachments.push({ type: "link", url });
  }

  return {
    id,
    channel,
    from,
    body,
    threadId,
    attachments: attachments.length > 0 ? attachments : undefined,
    receivedAt,
    raw: event,
  };
}

/**
 * Enrich a voice message with local transcription when Slack's built-in
 * transcription is unavailable.
 *
 * Downloads the audio file from Slack using the bot token, converts to WAV,
 * and transcribes locally via whisper-node. Returns the original message
 * unchanged if transcription fails or is not needed.
 *
 * @param msg - The parsed inbound message (from parseSlackEvent)
 * @param botToken - Slack bot token for authenticated file download
 * @returns The message with body replaced by transcript, or original on failure
 */
export async function enrichVoiceMessage(
  msg: InboundMessage,
  botToken: string,
): Promise<InboundMessage> {
  if (!msg.body.includes("[Voice message — no transcript available]")) return msg;

  const raw = msg.raw as SlackEvent | undefined;
  const files = raw?.files;
  if (!files?.length) return msg;

  const audioFile = files.find(
    (f) => f.subtype === "slack_audio" || AUDIO_TYPES.has(f.filetype ?? ""),
  );
  if (!audioFile?.url_private) return msg;

  const buffer = await downloadAudio(audioFile.url_private, botToken);
  if (!buffer) return msg;

  const filename = (audioFile.name as string) ?? `voice.${audioFile.filetype ?? "aac"}`;
  const transcript = await transcribeAudio(buffer, filename);
  if (!transcript) return msg;

  return {
    ...msg,
    body: `[Voice message] ${transcript}`,
  };
}
