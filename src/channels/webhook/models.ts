/**
 * Webhook channel configuration types.
 * Story 4.7
 */

export interface WebhookConfig {
  callbackUrl?: string;
  secret?: string;
  port?: number;
}
