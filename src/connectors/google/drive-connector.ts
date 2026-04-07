/**
 * Google Drive connector — pulls file metadata from Drive.
 *
 * Produces `DriveFileRecord` objects. Does NOT write to any database
 * table; the consuming application decides how to store records.
 *
 * Supports incremental sync via Drive Changes API (startPageToken)
 * and full sync via files.list with optional folder/MIME filters.
 */

import type {
  Connector,
  ConnectorMeta,
  AuthResult,
  SyncOptions,
  SyncResult,
} from '../../shared/types/connector.js';
import type {
  DriveFileRecord,
  DriveOwner,
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

// ── Types for callback-based token I/O ─────────────────────────

export interface DriveConnectorOpts {
  /** Load persisted tokens for a given account key (OAuth2 flow only). */
  tokenLoader?: (key: string) => Promise<string | null>;
  /** Persist tokens for a given account key (OAuth2 flow only). */
  tokenSaver?: (key: string, value: string) => Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OAuth2Client = any;

const FILE_FIELDS =
  'id, name, mimeType, webViewLink, webContentLink, modifiedTime, createdTime, ' +
  'size, parents, description, owners, lastModifyingUser, starred, trashed';

// ── Connector ──────────────────────────────────────────────────

export class GoogleDriveConnector implements Connector<DriveFileRecord> {
  readonly id = 'google-drive';
  readonly meta: ConnectorMeta = {
    displayName: 'Google Drive',
    provider: 'google',
    dataType: 'document',
  };

  private tokenLoader?: DriveConnectorOpts['tokenLoader'];
  private tokenSaver?: DriveConnectorOpts['tokenSaver'];
  private client: OAuth2Client | null = null;
  private config: GoogleConnectorConfig | null = null;
  private tokens: GoogleTokens | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private drive: any = null;

  constructor(opts: DriveConnectorOpts = {}) {
    this.tokenLoader = opts.tokenLoader;
    this.tokenSaver = opts.tokenSaver;
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  async connect(config: GoogleConnectorConfig): Promise<void> {
    this.config = config;

    const scopes = config.scopes ?? [
      'https://www.googleapis.com/auth/drive.readonly',
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
    this.drive = google.drive({ version: 'v3', auth: this.client });
  }

  async disconnect(): Promise<void> {
    this.client = null;
    this.drive = null;
    this.tokens = null;
    this.config = null;
  }

  async healthCheck(): Promise<{ ok: boolean; account?: string; error?: string }> {
    try {
      this.ensureConnected();
      const res = await this.drive.about.get({ fields: 'user' });
      return { ok: true, account: res.data.user?.emailAddress ?? this.config!.account };
    } catch (err: unknown) {
      return { ok: false, error: errorMessage(err) };
    }
  }

  // ── Auth ───────────────────────────────────────────────────────

  async authenticate(
    codeProvider: (authUrl: string) => Promise<string>,
  ): Promise<AuthResult> {
    if (!this.config) {
      return { success: false, error: 'Call connect() first.' };
    }
    try {
      if (!this.config.oauth) {
        return { success: false, error: 'OAuth config required. Use serviceAccount for headless auth.' };
      }
      if (!this.tokenSaver) {
        return { success: false, error: 'tokenSaver required for authenticate() flow.' };
      }
      const client = await createOAuth2Client(this.config.oauth);
      const scopes = this.config.scopes ?? [
        'https://www.googleapis.com/auth/drive.readonly',
      ];
      const authUrl = getAuthUrl(client, scopes);
      const code = await codeProvider(authUrl);
      const tokens = await exchangeCode(client, code);
      await saveTokens(this.tokenSaver, this.config.account, tokens);
      this.tokens = tokens;
      this.client = client;
      this.client.setCredentials(tokens);
      const { google } = await import('googleapis');
      this.drive = google.drive({ version: 'v3', auth: this.client });
      return { success: true, account: this.config.account };
    } catch (err: unknown) {
      return { success: false, error: errorMessage(err) };
    }
  }

  // ── Sync ───────────────────────────────────────────────────────

  async sync(options?: SyncOptions): Promise<SyncResult<DriveFileRecord>> {
    this.ensureConnected();

    if (options?.cursor) {
      return this.syncIncremental(options.cursor, options);
    }
    return this.syncFull(options);
  }

  /** Incremental sync using Drive Changes API. */
  private async syncIncremental(
    startPageToken: string,
    options?: SyncOptions,
  ): Promise<SyncResult<DriveFileRecord>> {
    const records: DriveFileRecord[] = [];
    const errors: SyncResult<DriveFileRecord>['errors'] = [];
    let pageToken: string | undefined = startPageToken;
    let newStartPageToken: string | undefined;

    try {
      do {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res: any = await this.drive.changes.list({
          pageToken,
          fields: `nextPageToken, newStartPageToken, changes(fileId, removed, file(${FILE_FIELDS}))`,
          pageSize: options?.limit ? Math.min(options.limit - records.length, 100) : 100,
        });

        for (const change of res.data.changes ?? []) {
          try {
            if (change.removed || !change.file) {
              // File was deleted — create a trashed record so consumer can handle
              if (change.fileId) {
                records.push({
                  driveFileId: change.fileId,
                  account: this.config!.account,
                  name: '',
                  mimeType: '',
                  webViewLink: '',
                  modifiedTime: new Date().toISOString(),
                  createdTime: '',
                  owners: [],
                  starred: false,
                  trashed: true,
                });
              }
            } else {
              records.push(this.mapFile(change.file));
            }
          } catch (err: unknown) {
            errors.push({ id: change.fileId ?? 'unknown', error: errorMessage(err) });
          }
          if (options?.limit && records.length >= options.limit) break;
        }

        pageToken = res.data.nextPageToken ?? undefined;
        newStartPageToken = res.data.newStartPageToken ?? undefined;
      } while (pageToken && (!options?.limit || records.length < options.limit));
    } catch (err: unknown) {
      // If token is expired/invalid, fall back to full sync
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((err as any)?.code === 403 || (err as any)?.code === 404) {
        return this.syncFull(options);
      }
      throw err;
    }

    return {
      records,
      cursor: newStartPageToken,
      hasMore: !!pageToken,
      errors,
    };
  }

  /** Full sync using files.list. */
  private async syncFull(
    options?: SyncOptions,
  ): Promise<SyncResult<DriveFileRecord>> {
    const records: DriveFileRecord[] = [];
    const errors: SyncResult<DriveFileRecord>['errors'] = [];
    const maxResults = options?.limit ?? 500;

    // Build query
    const queryParts: string[] = ['trashed = false'];

    // Optional folder filter
    const folderId = options?.filters?.folderId as string | undefined;
    if (folderId) {
      queryParts.push(`'${folderId}' in parents`);
    }

    // Optional MIME type filter
    const mimeType = options?.filters?.mimeType as string | undefined;
    if (mimeType) {
      queryParts.push(`mimeType = '${mimeType}'`);
    }

    // Optional date filter
    if (options?.since) {
      queryParts.push(`modifiedTime > '${new Date(options.since).toISOString()}'`);
    }

    const q = queryParts.join(' and ');
    let pageToken: string | undefined;

    do {
      const res = await this.drive.files.list({
        q,
        fields: `nextPageToken, files(${FILE_FIELDS})`,
        orderBy: 'modifiedTime desc',
        pageSize: Math.min(maxResults - records.length, 100),
        ...(pageToken ? { pageToken } : {}),
      });

      for (const file of res.data.files ?? []) {
        try {
          records.push(this.mapFile(file));
        } catch (err: unknown) {
          errors.push({ id: file.id, error: errorMessage(err) });
        }
        if (records.length >= maxResults) break;
      }

      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken && records.length < maxResults);

    // Get startPageToken for future incremental syncs
    const tokenRes = await this.drive.changes.getStartPageToken({});
    const cursor = tokenRes.data.startPageToken ?? undefined;

    return {
      records,
      cursor,
      hasMore: !!pageToken,
      errors,
    };
  }

  // ── Internals ─────────────────────────────────────────────────

  private ensureConnected(): void {
    if (!this.drive || !this.config) {
      throw new Error('GoogleDriveConnector is not connected. Call connect() first.');
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapFile(file: any): DriveFileRecord {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapOwner = (o: any): DriveOwner => ({
      displayName: o?.displayName ?? '',
      emailAddress: o?.emailAddress ?? '',
    });

    return {
      driveFileId: file.id,
      account: this.config!.account,
      name: file.name ?? '(Untitled)',
      mimeType: file.mimeType ?? '',
      webViewLink: file.webViewLink ?? '',
      webContentLink: file.webContentLink ?? undefined,
      modifiedTime: file.modifiedTime ?? new Date().toISOString(),
      createdTime: file.createdTime ?? '',
      size: file.size ? parseInt(file.size, 10) : undefined,
      parents: file.parents ?? undefined,
      description: file.description ?? undefined,
      owners: (file.owners ?? []).map(mapOwner),
      lastModifyingUser: file.lastModifyingUser
        ? mapOwner(file.lastModifyingUser)
        : undefined,
      starred: file.starred ?? false,
      trashed: file.trashed ?? false,
    };
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
