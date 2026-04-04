/**
 * @botinabox/channel-slack — Slack channel adapter.
 * Story 4.5
 */

export { SlackAdapter } from "./adapter.js";
export type { BoltClient } from "./adapter.js";
export { parseSlackEvent, extractVoiceTranscript, enrichVoiceMessage } from "./inbound.js";
export type { SlackEvent, SlackFile } from "./inbound.js";
export { transcribeAudio, downloadAudio } from "./transcribe.js";
export type { TranscribeOptions, TranscribeResult } from "./transcribe.js";
export { formatForSlack } from "./outbound.js";
export type { SlackConfig } from "./models.js";

export { default } from "./adapter.js";
