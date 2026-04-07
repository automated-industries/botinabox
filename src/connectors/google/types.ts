/** Google connector types. */

import type { ConnectorConfig } from '../../shared/types/connector.js';

// ── OAuth ──────────────────────────────────────────────────────────

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type: string;
}

// ── Service account ───────────────────────────────────────────────

export interface GoogleServiceAccountConfig {
  /** Path to service account key JSON file */
  keyFile?: string;
  /** Inline service account credentials (alternative to keyFile) */
  credentials?: {
    client_email: string;
    private_key: string;
    project_id?: string;
  };
  /** Email of the user to impersonate via domain-wide delegation */
  subject: string;
}

// ── Connector config ───────────────────────────────────────────────

export interface GoogleConnectorConfig extends ConnectorConfig {
  /** Google account email */
  account: string;
  /** OAuth2 user auth (requires browser flow) */
  oauth?: GoogleOAuthConfig;
  /** Service account auth (headless, for cloud deployments) */
  serviceAccount?: GoogleServiceAccountConfig;
  scopes?: string[];
}

// ── Gmail records ──────────────────────────────────────────────────

export interface EmailAddress {
  name?: string;
  email: string;
}

export interface EmailRecord {
  gmailId: string;
  threadId: string;
  account: string;
  subject: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  /** ISO 8601 timestamp */
  date: string;
  snippet: string;
  body?: string;
  labels: string[];
  isRead: boolean;
}

// ── Drive records ─────────────────────────────────────────────

export interface DriveOwner {
  displayName: string;
  emailAddress: string;
}

export interface DriveFileRecord {
  driveFileId: string;
  account: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  webContentLink?: string;
  /** ISO 8601 */
  modifiedTime: string;
  /** ISO 8601 */
  createdTime: string;
  size?: number;
  parents?: string[];
  description?: string;
  owners: DriveOwner[];
  lastModifyingUser?: DriveOwner;
  starred: boolean;
  trashed: boolean;
}

// ── Calendar records ───────────────────────────────────────────────

export interface CalendarAttendee {
  email: string;
  displayName?: string;
  responseStatus?: string;
}

export interface CalendarEventRecord {
  googleEventId: string;
  calendarId: string;
  account: string;
  title: string;
  description?: string;
  location?: string;
  /** ISO 8601 timestamp */
  startAt: string;
  /** ISO 8601 timestamp */
  endAt: string;
  allDay: boolean;
  timezone?: string;
  status: string;
  organizerEmail: string;
  attendees: CalendarAttendee[];
  recurrence?: string[];
  htmlLink?: string;
}
