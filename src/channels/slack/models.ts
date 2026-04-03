/**
 * Slack channel configuration types.
 * Story 4.5
 */

export interface SlackConfig {
  botToken: string;
  appToken?: string;
  signingSecret?: string;
}
