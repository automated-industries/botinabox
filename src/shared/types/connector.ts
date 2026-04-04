/** Connector types — generic external service integrations. */

export interface ConnectorMeta {
  displayName: string;
  /** Provider identifier, e.g. "google", "trello", "jira", "salesforce" */
  provider: string;
  /** Data type this connector handles, e.g. "email", "calendar", "board", "crm" */
  dataType: string;
}

export interface SyncOptions {
  /** Only sync records after this ISO 8601 timestamp */
  since?: string;
  /** Provider-specific incremental sync token */
  cursor?: string;
  /** Maximum number of records to fetch */
  limit?: number;
  /** Provider-specific query filters */
  filters?: Record<string, unknown>;
}

export interface SyncResult<T = Record<string, unknown>> {
  /** Typed records produced by the connector — consumer decides where to store */
  records: T[];
  /** Next incremental sync token (persist for future calls) */
  cursor?: string;
  /** Whether more records are available (pagination) */
  hasMore: boolean;
  /** Errors encountered during sync (non-fatal per-record failures) */
  errors: Array<{ id?: string; error: string }>;
}

export interface PushResult {
  success: boolean;
  externalId?: string;
  error?: string;
}

export interface AuthResult {
  success: boolean;
  account?: string;
  /** URL the user must visit to authorize (for OAuth flows) */
  authUrl?: string;
  error?: string;
}

export type ConnectorConfig = Record<string, unknown>;

/**
 * Generic connector interface for external service integrations.
 *
 * Connectors pull and optionally push data to/from external services
 * (Gmail, Calendar, Trello, Jira, Salesforce, etc.). They produce
 * typed records — the consuming application decides where to store them.
 *
 * @typeParam T - The record type this connector produces/consumes.
 */
export interface Connector<T = Record<string, unknown>> {
  readonly id: string;
  readonly meta: ConnectorMeta;

  connect(config: ConnectorConfig): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<{ ok: boolean; account?: string; error?: string }>;

  /** Pull records from external source */
  sync(options?: SyncOptions): Promise<SyncResult<T>>;

  /** Push a record to external source (optional) */
  push?(payload: T): Promise<PushResult>;

  /**
   * Run the authentication/authorization flow for this connector.
   * For OAuth connectors, this generates the auth URL and exchanges the code for tokens.
   *
   * @param codeProvider - called with the auth URL; must return the authorization code.
   *   For CLI flows, this prints the URL and reads from stdin.
   *   For programmatic flows, the caller handles the redirect.
   */
  authenticate?(codeProvider: (authUrl: string) => Promise<string>): Promise<AuthResult>;
}
