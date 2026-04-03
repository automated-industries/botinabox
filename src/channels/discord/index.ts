/**
 * @botinabox/channel-discord — Discord channel adapter.
 * Story 4.6
 */

export { DiscordAdapter } from "./adapter.js";
export type { DiscordClient } from "./adapter.js";
export { parseDiscordEvent } from "./inbound.js";
export type { DiscordEvent } from "./inbound.js";
export { formatForDiscord, chunkForDiscord } from "./outbound.js";
export type { DiscordConfig } from "./models.js";

export { default } from "./adapter.js";
