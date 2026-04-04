/**
 * Google Calendar connector — pulls calendar events.
 *
 * Produces `CalendarEventRecord` objects. Does NOT write to any database
 * table; the consuming application decides how to store records.
 */

import type {
  Connector,
  ConnectorMeta,
  AuthResult,
  SyncOptions,
  SyncResult,
} from '../../shared/types/connector.js';
import type {
  CalendarEventRecord,
  CalendarAttendee,
  GoogleConnectorConfig,
  GoogleTokens,
} from './types.js';
import {
  createOAuth2Client,
  createServiceAccountClient,
  getAuthUrl,
  exchangeCode,
  loadTokens,
  saveTokens,
  refreshIfNeeded,
} from './oauth.js';

// ── Types for callback-based token I/O ─────────────────────────────

export interface CalendarConnectorOpts {
  /** Load persisted tokens for a given account key (OAuth2 flow only). */
  tokenLoader?: (key: string) => Promise<string | null>;
  /** Persist tokens for a given account key (OAuth2 flow only). */
  tokenSaver?: (key: string, value: string) => Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OAuth2Client = any;

// ── Connector ──────────────────────────────────────────────────────

export class GoogleCalendarConnector implements Connector<CalendarEventRecord> {
  readonly id = 'google-calendar';
  readonly meta: ConnectorMeta = {
    displayName: 'Google Calendar',
    provider: 'google',
    dataType: 'calendar',
  };

  private tokenLoader?: CalendarConnectorOpts['tokenLoader'];
  private tokenSaver?: CalendarConnectorOpts['tokenSaver'];
  private client: OAuth2Client | null = null;
  private config: GoogleConnectorConfig | null = null;
  private tokens: GoogleTokens | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private calendar: any = null;

  constructor(opts: CalendarConnectorOpts = {}) {
    this.tokenLoader = opts.tokenLoader;
    this.tokenSaver = opts.tokenSaver;
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  async connect(config: GoogleConnectorConfig): Promise<void> {
    this.config = config;

    const scopes = config.scopes ?? [
      'https://www.googleapis.com/auth/calendar.readonly',
    ];

    if (config.serviceAccount) {
      this.client = await createServiceAccountClient(config.serviceAccount, scopes);
    } else if (config.oauth) {
      this.client = await createOAuth2Client(config.oauth);
      if (!this.tokenLoader) {
        throw new Error('tokenLoader required for OAuth2 flow');
      }
      this.tokens = await loadTokens(this.tokenLoader, config.account);
      if (!this.tokens) {
        throw new Error(
          `No stored tokens for account ${config.account}. Complete the OAuth flow first.`,
        );
      }
      this.tokens = await refreshIfNeeded(
        this.client,
        this.tokens,
        this.tokenSaver
          ? async (t) => saveTokens(this.tokenSaver!, config.account, t)
          : undefined,
      );
      this.client.setCredentials(this.tokens);
    } else {
      throw new Error('Either serviceAccount or oauth config is required');
    }

    const { google } = await import('googleapis');
    this.calendar = google.calendar({ version: 'v3', auth: this.client });
  }

  async disconnect(): Promise<void> {
    this.client = null;
    this.calendar = null;
    this.tokens = null;
    this.config = null;
  }

  async healthCheck(): Promise<{ ok: boolean; account?: string; error?: string }> {
    try {
      this.ensureConnected();
      const res = await this.calendar.calendarList.list({ maxResults: 1 });
      const primary = (res.data.items ?? []).find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c: any) => c.primary,
      );
      return { ok: true, account: primary?.id ?? this.config!.account };
    } catch (err: unknown) {
      return { ok: false, error: errorMessage(err) };
    }
  }

  // ── Auth ───────────────────────────────────────────────────────

  async authenticate(
    codeProvider: (authUrl: string) => Promise<string>,
  ): Promise<AuthResult> {
    if (!this.config) {
      return { success: false, error: 'Call connect() first to set config, or pass config and call authenticate() before connect().' };
    }
    try {
      if (!this.config.oauth) {
        return { success: false, error: 'OAuth config required for browser-based authenticate(). Use serviceAccount for headless auth.' };
      }
      if (!this.tokenSaver) {
        return { success: false, error: 'tokenSaver required for authenticate() flow.' };
      }
      const client = await createOAuth2Client(this.config.oauth);
      const scopes = this.config.scopes ?? [
        'https://www.googleapis.com/auth/calendar.readonly',
      ];
      const authUrl = getAuthUrl(client, scopes);
      const code = await codeProvider(authUrl);
      const tokens = await exchangeCode(client, code);
      await saveTokens(this.tokenSaver, this.config.account, tokens);
      this.tokens = tokens;
      this.client = client;
      this.client.setCredentials(tokens);
      const { google } = await import('googleapis');
      this.calendar = google.calendar({ version: 'v3', auth: this.client });
      return { success: true, account: this.config.account };
    } catch (err: unknown) {
      return { success: false, error: errorMessage(err) };
    }
  }

  // ── Sync ───────────────────────────────────────────────────────

  async sync(options?: SyncOptions): Promise<SyncResult<CalendarEventRecord>> {
    this.ensureConnected();

    if (options?.cursor) {
      return this.syncIncremental(options.cursor, options);
    }
    return this.syncFull(options);
  }

  /** Incremental sync using Calendar syncToken. */
  private async syncIncremental(
    syncToken: string,
    options?: SyncOptions,
  ): Promise<SyncResult<CalendarEventRecord>> {
    const calendarId = (options?.filters?.calendarId as string) ?? 'primary';
    const records: CalendarEventRecord[] = [];
    const errors: SyncResult<CalendarEventRecord>['errors'] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;

    try {
      do {
        const res = await this.calendar.events.list({
          calendarId,
          syncToken,
          ...(pageToken ? { pageToken } : {}),
          maxResults: options?.limit ? Math.min(options.limit - records.length, 250) : 250,
        });

        for (const event of res.data.items ?? []) {
          try {
            records.push(this.mapEvent(event, calendarId));
          } catch (err: unknown) {
            errors.push({ id: event.id, error: errorMessage(err) });
          }
          if (options?.limit && records.length >= options.limit) break;
        }

        pageToken = res.data.nextPageToken ?? undefined;
        nextSyncToken = res.data.nextSyncToken ?? undefined;
      } while (pageToken && (!options?.limit || records.length < options.limit));
    } catch (err: unknown) {
      // If syncToken is expired/invalid, fall back to full sync
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((err as any)?.code === 410) {
        return this.syncFull(options);
      }
      throw err;
    }

    return {
      records,
      cursor: nextSyncToken,
      hasMore: !!pageToken,
      errors,
    };
  }

  /** Full sync using timeMin. */
  private async syncFull(
    options?: SyncOptions,
  ): Promise<SyncResult<CalendarEventRecord>> {
    const calendarId = (options?.filters?.calendarId as string) ?? 'primary';
    const records: CalendarEventRecord[] = [];
    const errors: SyncResult<CalendarEventRecord>['errors'] = [];
    const maxResults = options?.limit ?? 250;

    const timeMin = options?.since
      ? new Date(options.since).toISOString()
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // default: 30 days ago

    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;

    do {
      const res = await this.calendar.events.list({
        calendarId,
        timeMin,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: Math.min(maxResults - records.length, 250),
        ...(pageToken ? { pageToken } : {}),
      });

      for (const event of res.data.items ?? []) {
        try {
          records.push(this.mapEvent(event, calendarId));
        } catch (err: unknown) {
          errors.push({ id: event.id, error: errorMessage(err) });
        }
        if (records.length >= maxResults) break;
      }

      pageToken = res.data.nextPageToken ?? undefined;
      nextSyncToken = res.data.nextSyncToken ?? undefined;
    } while (pageToken && records.length < maxResults);

    return {
      records,
      cursor: nextSyncToken,
      hasMore: !!pageToken,
      errors,
    };
  }

  // ── Internals ─────────────────────────────────────────────────

  private ensureConnected(): void {
    if (!this.calendar || !this.config) {
      throw new Error('GoogleCalendarConnector is not connected. Call connect() first.');
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapEvent(event: any, calendarId: string): CalendarEventRecord {
    const start = event.start ?? {};
    const end = event.end ?? {};

    const allDay = !!start.date;
    const startAt = allDay
      ? new Date(start.date).toISOString()
      : new Date(start.dateTime).toISOString();
    const endAt = allDay
      ? new Date(end.date).toISOString()
      : new Date(end.dateTime).toISOString();

    const attendees: CalendarAttendee[] = (event.attendees ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (a: any) => ({
        email: a.email,
        displayName: a.displayName,
        responseStatus: a.responseStatus,
      }),
    );

    return {
      googleEventId: event.id,
      calendarId,
      account: this.config!.account,
      title: event.summary ?? '(No title)',
      description: event.description ?? undefined,
      location: event.location ?? undefined,
      startAt,
      endAt,
      allDay,
      timezone: start.timeZone ?? undefined,
      status: event.status ?? 'confirmed',
      organizerEmail: event.organizer?.email ?? '',
      attendees,
      recurrence: event.recurrence ?? undefined,
      htmlLink: event.htmlLink ?? undefined,
    };
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
