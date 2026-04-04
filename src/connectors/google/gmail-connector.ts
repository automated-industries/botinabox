/**
 * Gmail connector — pulls email metadata and optionally sends mail.
 *
 * Produces `EmailRecord` objects. Does NOT write to any database table;
 * the consuming application decides how to store records.
 */

import type {
  Connector,
  ConnectorMeta,
  AuthResult,
  SyncOptions,
  SyncResult,
  PushResult,
} from '../../shared/types/connector.js';
import type {
  EmailRecord,
  EmailAddress,
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

export interface GmailConnectorOpts {
  /** Load persisted tokens for a given account key (OAuth2 flow only). */
  tokenLoader?: (key: string) => Promise<string | null>;
  /** Persist tokens for a given account key (OAuth2 flow only). */
  tokenSaver?: (key: string, value: string) => Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OAuth2Client = any;

// ── Connector ──────────────────────────────────────────────────────

export class GoogleGmailConnector implements Connector<EmailRecord> {
  readonly id = 'google-gmail';
  readonly meta: ConnectorMeta = {
    displayName: 'Google Gmail',
    provider: 'google',
    dataType: 'email',
  };

  private tokenLoader?: GmailConnectorOpts['tokenLoader'];
  private tokenSaver?: GmailConnectorOpts['tokenSaver'];
  private client: OAuth2Client | null = null;
  private config: GoogleConnectorConfig | null = null;
  private tokens: GoogleTokens | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private gmail: any = null;

  constructor(opts: GmailConnectorOpts = {}) {
    this.tokenLoader = opts.tokenLoader;
    this.tokenSaver = opts.tokenSaver;
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  async connect(config: GoogleConnectorConfig): Promise<void> {
    this.config = config;

    const scopes = config.scopes ?? [
      'https://www.googleapis.com/auth/gmail.readonly',
    ];

    if (config.serviceAccount) {
      // Service account auth — headless, no browser
      this.client = await createServiceAccountClient(config.serviceAccount, scopes);
    } else if (config.oauth) {
      // OAuth2 user flow — requires tokens from prior browser auth
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
    this.gmail = google.gmail({ version: 'v1', auth: this.client });
  }

  async disconnect(): Promise<void> {
    this.client = null;
    this.gmail = null;
    this.tokens = null;
    this.config = null;
  }

  async healthCheck(): Promise<{ ok: boolean; account?: string; error?: string }> {
    try {
      this.ensureConnected();
      const res = await this.gmail.users.getProfile({ userId: 'me' });
      return { ok: true, account: res.data.emailAddress };
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
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
      ];
      const authUrl = getAuthUrl(client, scopes);
      const code = await codeProvider(authUrl);
      const tokens = await exchangeCode(client, code);
      await saveTokens(this.tokenSaver, this.config.account, tokens);
      this.tokens = tokens;
      this.client = client;
      this.client.setCredentials(tokens);
      const { google } = await import('googleapis');
      this.gmail = google.gmail({ version: 'v1', auth: this.client });
      return { success: true, account: this.config.account };
    } catch (err: unknown) {
      return { success: false, error: errorMessage(err) };
    }
  }

  // ── Sync ───────────────────────────────────────────────────────

  async sync(options?: SyncOptions): Promise<SyncResult<EmailRecord>> {
    this.ensureConnected();

    if (options?.cursor) {
      return this.syncIncremental(options.cursor, options.limit);
    }
    return this.syncFull(options);
  }

  /** Incremental sync using Gmail history API. */
  private async syncIncremental(
    startHistoryId: string,
    limit?: number,
  ): Promise<SyncResult<EmailRecord>> {
    const records: EmailRecord[] = [];
    const errors: SyncResult<EmailRecord>['errors'] = [];
    const seenIds = new Set<string>();
    let pageToken: string | undefined;
    let latestHistoryId = startHistoryId;

    do {
      const res = await this.gmail.users.history.list({
        userId: 'me',
        startHistoryId,
        historyTypes: ['messageAdded'],
        ...(pageToken ? { pageToken } : {}),
      });

      latestHistoryId = res.data.historyId ?? latestHistoryId;

      const histories = res.data.history ?? [];
      for (const h of histories) {
        for (const added of h.messagesAdded ?? []) {
          const msgId = added.message?.id;
          if (!msgId || seenIds.has(msgId)) continue;
          seenIds.add(msgId);

          try {
            const record = await this.fetchMessage(msgId);
            records.push(record);
          } catch (err: unknown) {
            errors.push({ id: msgId, error: errorMessage(err) });
          }

          if (limit && records.length >= limit) {
            return { records, cursor: latestHistoryId, hasMore: true, errors };
          }
        }
      }

      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    return { records, cursor: latestHistoryId, hasMore: false, errors };
  }

  /** Full sync — list messages and fetch each one. */
  private async syncFull(
    options?: SyncOptions,
  ): Promise<SyncResult<EmailRecord>> {
    const records: EmailRecord[] = [];
    const errors: SyncResult<EmailRecord>['errors'] = [];
    const maxResults = options?.limit ?? 100;

    let query = '';
    if (options?.since) {
      // Gmail `after:` uses epoch seconds
      const epoch = Math.floor(new Date(options.since).getTime() / 1000);
      query = `after:${epoch}`;
    }
    if (options?.filters?.q) {
      query = query ? `${query} ${options.filters.q}` : String(options.filters.q);
    }

    let pageToken: string | undefined;
    let collected = 0;

    do {
      const res = await this.gmail.users.messages.list({
        userId: 'me',
        maxResults: Math.min(maxResults - collected, 100),
        ...(query ? { q: query } : {}),
        ...(pageToken ? { pageToken } : {}),
      });

      const messages = res.data.messages ?? [];
      for (const msg of messages) {
        try {
          const record = await this.fetchMessage(msg.id!);
          records.push(record);
        } catch (err: unknown) {
          errors.push({ id: msg.id, error: errorMessage(err) });
        }
        collected++;
        if (collected >= maxResults) break;
      }

      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken && collected < maxResults);

    // Get current historyId for future incremental syncs
    const profile = await this.gmail.users.getProfile({ userId: 'me' });
    const cursor = profile.data.historyId ?? undefined;

    return {
      records,
      cursor,
      hasMore: !!pageToken,
      errors,
    };
  }

  // ── Push (send email) ─────────────────────────────────────────

  async push(payload: EmailRecord): Promise<PushResult> {
    this.ensureConnected();

    try {
      const toHeader = payload.to.map(formatAddress).join(', ');
      const ccHeader = payload.cc.length
        ? `Cc: ${payload.cc.map(formatAddress).join(', ')}\r\n`
        : '';
      const bccHeader = payload.bcc.length
        ? `Bcc: ${payload.bcc.map(formatAddress).join(', ')}\r\n`
        : '';

      const mime = [
        `To: ${toHeader}\r\n`,
        ccHeader,
        bccHeader,
        `Subject: ${payload.subject}\r\n`,
        `Content-Type: text/plain; charset="UTF-8"\r\n`,
        `\r\n`,
        payload.body ?? '',
      ].join('');

      const encoded = Buffer.from(mime)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const res = await this.gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: encoded },
      });

      return { success: true, externalId: res.data.id };
    } catch (err: unknown) {
      return { success: false, error: errorMessage(err) };
    }
  }

  // ── Internals ─────────────────────────────────────────────────

  private ensureConnected(): void {
    if (!this.gmail || !this.config) {
      throw new Error('GoogleGmailConnector is not connected. Call connect() first.');
    }
  }

  /** Fetch a single message by ID and parse into an EmailRecord. */
  private async fetchMessage(messageId: string): Promise<EmailRecord> {
    const res = await this.gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const msg = res.data;
    const headers = msg.payload?.headers ?? [];

    const getHeader = (name: string): string =>
      headers.find((h: { name: string }) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

    return {
      gmailId: msg.id!,
      threadId: msg.threadId!,
      account: this.config!.account,
      subject: getHeader('Subject'),
      from: parseAddress(getHeader('From')),
      to: parseAddressList(getHeader('To')),
      cc: parseAddressList(getHeader('Cc')),
      bcc: parseAddressList(getHeader('Bcc')),
      date: new Date(getHeader('Date')).toISOString(),
      snippet: msg.snippet ?? '',
      body: extractPlainTextBody(msg.payload),
      labels: msg.labelIds ?? [],
      isRead: !(msg.labelIds ?? []).includes('UNREAD'),
    };
  }
}

// ── MIME body extraction ──────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractPlainTextBody(payload: any): string | undefined {
  if (!payload) return undefined;

  // Single-part message: body is directly on the payload
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  // Multipart: recurse through parts, prefer text/plain
  if (payload.parts) {
    // First pass: look for text/plain
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }
    // Second pass: recurse into nested multipart
    for (const part of payload.parts) {
      if (part.mimeType?.startsWith('multipart/')) {
        const result = extractPlainTextBody(part);
        if (result) return result;
      }
    }
  }

  return undefined;
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

// ── Address parsing utilities ──────────────────────────────────────

/**
 * Parse a single "Name <email>" or bare "email" string.
 */
function parseAddress(raw: string): EmailAddress {
  const match = raw.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) {
    return { name: match[1].replace(/^["']|["']$/g, '').trim(), email: match[2] };
  }
  return { email: raw.trim() };
}

/**
 * Parse a comma-separated list of addresses.
 */
function parseAddressList(raw: string): EmailAddress[] {
  if (!raw.trim()) return [];

  const results: EmailAddress[] = [];
  let current = '';
  let depth = 0;
  for (const ch of raw) {
    if (ch === '<') depth++;
    else if (ch === '>') depth--;
    else if (ch === ',' && depth === 0) {
      if (current.trim()) results.push(parseAddress(current.trim()));
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) results.push(parseAddress(current.trim()));
  return results;
}

/**
 * Format an EmailAddress back into "Name <email>" string.
 */
function formatAddress(addr: EmailAddress): string {
  return addr.name ? `${addr.name} <${addr.email}>` : addr.email;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
