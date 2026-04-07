# Connectors

Connectors pull data from (and optionally push data to) external services. They produce typed records that your application decides how to store. botinabox ships with Google connectors for Gmail, Calendar, and Drive.

```bash
npm install botinabox
npm install googleapis   # peer dependency for Google connectors
```

```typescript
import type { Connector, SyncResult, SyncOptions } from 'botinabox';
import { GoogleGmailConnector, GoogleCalendarConnector, GoogleDriveConnector } from 'botinabox/google';
```

---

## Connector Interface

Every connector implements the generic `Connector<T>` interface:

```typescript
interface Connector<T = Record<string, unknown>> {
  readonly id: string;
  readonly meta: ConnectorMeta;

  connect(config: ConnectorConfig): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<{ ok: boolean; account?: string; error?: string }>;

  /** Pull records from the external source */
  sync(options?: SyncOptions): Promise<SyncResult<T>>;

  /** Push a record to the external source (optional) */
  push?(payload: T): Promise<PushResult>;

  /** Run the authentication flow (optional, for OAuth connectors) */
  authenticate?(
    codeProvider: (authUrl: string) => Promise<string>,
  ): Promise<AuthResult>;
}
```

### ConnectorMeta

```typescript
interface ConnectorMeta {
  displayName: string;
  provider: string;    // e.g. 'google', 'trello', 'jira'
  dataType: string;    // e.g. 'email', 'calendar', 'board'
}
```

### ConnectorConfig

```typescript
type ConnectorConfig = Record<string, unknown>;
```

Base type for connector configuration. Each connector extends this with its own typed config (e.g. `GoogleConnectorConfig`).

---

## SyncResult\<T\>

Every `sync()` call returns a `SyncResult`:

```typescript
interface SyncResult<T = Record<string, unknown>> {
  records: T[];
  cursor?: string;
  hasMore: boolean;
  errors: Array<{ id?: string; error: string }>;
}
```

| Field | Description |
|-------|-------------|
| `records` | The typed records produced by this sync. |
| `cursor` | Opaque token for incremental sync. Persist this and pass it in the next `sync()` call. |
| `hasMore` | Whether more records are available (pagination). |
| `errors` | Non-fatal per-record errors. The sync continues past individual failures. |

### Related types

```typescript
interface SyncOptions {
  since?: string;                       // ISO 8601 -- only records after this time
  cursor?: string;                      // Incremental sync token from a previous SyncResult
  limit?: number;                       // Max records to fetch
  filters?: Record<string, unknown>;    // Provider-specific query filters
}

interface PushResult {
  success: boolean;
  externalId?: string;    // ID assigned by the external service
  error?: string;
}

interface AuthResult {
  success: boolean;
  account?: string;
  authUrl?: string;       // URL the user must visit (OAuth flows)
  error?: string;
}
```

---

## GoogleConnectorConfig

Both Gmail and Calendar connectors use this shared config type:

```typescript
import type { GoogleConnectorConfig } from 'botinabox/google';

const config: GoogleConnectorConfig = {
  account: 'user@example.com',

  // Option A: OAuth2 (requires browser-based consent)
  oauth: {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: 'http://localhost:3000/oauth/callback',
  },

  // Option B: Service account (headless, for cloud deployments)
  serviceAccount: {
    keyFile: '/path/to/service-account.json',
    subject: 'user@example.com',  // User to impersonate
  },

  // OAuth scopes (defaults vary by connector)
  scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
};
```

You must provide either `oauth` or `serviceAccount` -- not both.

### GoogleConnectorConfig type

```typescript
interface GoogleConnectorConfig extends ConnectorConfig {
  account: string;
  oauth?: GoogleOAuthConfig;
  serviceAccount?: GoogleServiceAccountConfig;
  scopes?: string[];
}

interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface GoogleServiceAccountConfig {
  keyFile?: string;        // Path to service account key JSON
  credentials?: {          // Inline credentials (alternative to keyFile)
    client_email: string;
    private_key: string;
    project_id?: string;
  };
  subject: string;         // Email to impersonate via domain-wide delegation
}
```

---

## Google Gmail Connector

Pulls email metadata from Gmail and optionally sends email.

```typescript
import { GoogleGmailConnector } from 'botinabox/google';
import type { EmailRecord, GoogleConnectorConfig, GmailConnectorOpts } from 'botinabox/google';
```

### Setup with OAuth2

```typescript
const gmail = new GoogleGmailConnector({
  tokenLoader: async (key) => {
    // Load persisted tokens from your database, file, or secret store
    return await db.get('secrets', key);
  },
  tokenSaver: async (key, value) => {
    // Persist tokens
    await db.set('secrets', key, value);
  },
});

await gmail.connect({
  account: 'user@example.com',
  oauth: {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: 'http://localhost:3000/oauth/callback',
  },
  scopes: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
  ],
});
```

### Setup with Service Account

```typescript
const gmail = new GoogleGmailConnector();

await gmail.connect({
  account: 'user@example.com',
  serviceAccount: {
    keyFile: '/path/to/service-account.json',
    subject: 'user@example.com',
  },
  scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
});
```

### OAuth2 Flow

For first-time authorization with OAuth2, use the `authenticate()` method:

```typescript
const gmail = new GoogleGmailConnector({
  tokenLoader: async (key) => db.get('secrets', key),
  tokenSaver: async (key, value) => db.set('secrets', key, value),
});

// Set config first
await gmail.connect({
  account: 'user@example.com',
  oauth: {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: 'http://localhost:3000/oauth/callback',
  },
}).catch(() => {
  // Expected to throw if no tokens exist yet
});

// Run the OAuth flow
const authResult = await gmail.authenticate(async (authUrl) => {
  // For a CLI app: print the URL and read the code from stdin
  console.log('Visit this URL to authorize:', authUrl);
  const code = await readLine('Enter the authorization code: ');
  return code;

  // For a web app: redirect the user and capture the code from the callback
});

if (authResult.success) {
  console.log(`Authenticated as ${authResult.account}`);
}
```

### Sync (pull emails)

```typescript
// Full sync -- fetches recent emails
const result = await gmail.sync({
  limit: 50,
  since: '2025-01-01T00:00:00Z',
  filters: { q: 'is:unread' },   // Gmail search query syntax
});

console.log(`Fetched ${result.records.length} emails`);
console.log(`Cursor for next sync: ${result.cursor}`);
console.log(`More available: ${result.hasMore}`);

// Inspect an email record
const email = result.records[0];
console.log(email.subject);        // 'Meeting notes'
console.log(email.from.email);     // 'sender@example.com'
console.log(email.snippet);        // Preview text
console.log(email.body);           // Full plain text body (if available)
```

### Incremental sync

Save the `cursor` from each sync and pass it to the next call. Gmail uses its History API for efficient incremental syncing.

```typescript
// First sync: no cursor
const initial = await gmail.sync({ limit: 100 });
let cursor = initial.cursor;

// Later: only fetch new/changed messages since the cursor
const incremental = await gmail.sync({ cursor, limit: 100 });
cursor = incremental.cursor; // Update cursor for next time
```

### Push (send email)

```typescript
const sendResult = await gmail.push({
  gmailId: '',
  threadId: '',
  account: 'user@example.com',
  subject: 'Hello from Bot',
  from: { email: 'user@example.com' },
  to: [{ name: 'Recipient', email: 'recipient@example.com' }],
  cc: [],
  bcc: [],
  date: new Date().toISOString(),
  snippet: '',
  body: 'This is the email body.',
  labels: [],
  isRead: true,
});

if (sendResult.success) {
  console.log(`Sent! Gmail ID: ${sendResult.externalId}`);
}
```

### EmailRecord type

```typescript
interface EmailRecord {
  gmailId: string;
  threadId: string;
  account: string;
  subject: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  date: string;            // ISO 8601
  snippet: string;         // Gmail preview text
  body?: string;           // Full plain text body
  labels: string[];        // Gmail label IDs (e.g. 'INBOX', 'UNREAD')
  isRead: boolean;
}

interface EmailAddress {
  name?: string;
  email: string;
}
```

### Health check

```typescript
const health = await gmail.healthCheck();
// => { ok: true, account: 'user@example.com' }
```

### Disconnect

```typescript
await gmail.disconnect();
```

---

## Google Calendar Connector

Pulls calendar events from Google Calendar.

```typescript
import { GoogleCalendarConnector } from 'botinabox/google';
import type {
  CalendarEventRecord,
  CalendarAttendee,
  GoogleConnectorConfig,
  CalendarConnectorOpts,
} from 'botinabox/google';
```

### Setup

```typescript
const calendar = new GoogleCalendarConnector({
  tokenLoader: async (key) => db.get('secrets', key),
  tokenSaver: async (key, value) => db.set('secrets', key, value),
});

await calendar.connect({
  account: 'user@example.com',
  oauth: {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: 'http://localhost:3000/oauth/callback',
  },
  scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
});
```

Or with a service account:

```typescript
const calendar = new GoogleCalendarConnector();

await calendar.connect({
  account: 'user@example.com',
  serviceAccount: {
    credentials: {
      client_email: 'bot@project.iam.gserviceaccount.com',
      private_key: process.env.GOOGLE_PRIVATE_KEY!,
      project_id: 'my-project',
    },
    subject: 'user@example.com',
  },
});
```

### Sync (pull events)

```typescript
// Full sync -- defaults to events from the last 30 days
const result = await calendar.sync({
  limit: 100,
  since: '2025-01-01T00:00:00Z',
  filters: { calendarId: 'primary' },   // Default: 'primary'
});

for (const event of result.records) {
  console.log(`${event.title} at ${event.startAt}`);
  console.log(`  Location: ${event.location ?? 'none'}`);
  console.log(`  Attendees: ${event.attendees.map(a => a.email).join(', ')}`);
}
```

### Incremental sync

Calendar uses Google's `syncToken` for efficient incremental sync. If a sync token becomes invalid (HTTP 410), the connector automatically falls back to a full sync.

```typescript
const initial = await calendar.sync({ limit: 250 });
let cursor = initial.cursor;

// Later: only new/changed/deleted events
const delta = await calendar.sync({ cursor });
cursor = delta.cursor;
```

### CalendarEventRecord type

```typescript
interface CalendarEventRecord {
  googleEventId: string;
  calendarId: string;
  account: string;
  title: string;
  description?: string;
  location?: string;
  startAt: string;           // ISO 8601
  endAt: string;             // ISO 8601
  allDay: boolean;
  timezone?: string;
  status: string;            // 'confirmed', 'tentative', 'cancelled'
  organizerEmail: string;
  attendees: CalendarAttendee[];
  recurrence?: string[];     // RRULE strings
  htmlLink?: string;         // Link to event in Google Calendar
}

interface CalendarAttendee {
  email: string;
  displayName?: string;
  responseStatus?: string;   // 'needsAction', 'accepted', 'declined', 'tentative'
}
```

---

## Google Drive Connector

Pulls file metadata from Google Drive. Supports incremental sync via the Drive Changes API.

```typescript
import { GoogleDriveConnector } from 'botinabox/google';
import type {
  DriveFileRecord,
  DriveOwner,
  GoogleConnectorConfig,
  DriveConnectorOpts,
} from 'botinabox/google';
```

### Setup

```typescript
const drive = new GoogleDriveConnector();

await drive.connect({
  account: 'user@example.com',
  serviceAccount: {
    keyFile: '/path/to/service-account.json',
    subject: 'user@example.com',
  },
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});
```

Or with OAuth2:

```typescript
const drive = new GoogleDriveConnector({
  tokenLoader: async (key) => db.get('secrets', key),
  tokenSaver: async (key, value) => db.set('secrets', key, value),
});

await drive.connect({
  account: 'user@example.com',
  oauth: {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: 'http://localhost:3000/oauth/callback',
  },
});
```

### Sync (pull file metadata)

```typescript
// Full sync -- all non-trashed files
const result = await drive.sync({ limit: 200 });

for (const file of result.records) {
  console.log(`${file.name} (${file.mimeType})`);
  console.log(`  Modified: ${file.modifiedTime}`);
  console.log(`  Link: ${file.webViewLink}`);
  console.log(`  Owners: ${file.owners.map(o => o.emailAddress).join(', ')}`);
}

// Scoped to a specific folder
const folderResult = await drive.sync({
  filters: { folderId: 'abc123-folder-id' },
});

// Scoped to PDFs only
const pdfResult = await drive.sync({
  filters: { mimeType: 'application/pdf' },
});

// Modified since a specific date
const recentResult = await drive.sync({
  since: '2025-06-01T00:00:00Z',
});
```

### Incremental sync

Drive uses the Changes API with a `startPageToken` for efficient incremental sync. If the token becomes invalid (HTTP 403/404), the connector automatically falls back to a full sync.

```typescript
const initial = await drive.sync({ limit: 500 });
let cursor = initial.cursor;

// Later: only new/changed/deleted files
const delta = await drive.sync({ cursor });
cursor = delta.cursor;

// Deleted files appear with trashed: true
for (const file of delta.records) {
  if (file.trashed) {
    console.log(`Deleted: ${file.driveFileId}`);
  }
}
```

### DriveFileRecord type

```typescript
interface DriveFileRecord {
  driveFileId: string;
  account: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  webContentLink?: string;     // Direct download URL (binary files only)
  modifiedTime: string;        // ISO 8601
  createdTime: string;         // ISO 8601
  size?: number;               // Bytes (not available for native Google Docs types)
  parents?: string[];          // Parent folder IDs
  description?: string;
  owners: DriveOwner[];
  lastModifyingUser?: DriveOwner;
  starred: boolean;
  trashed: boolean;
}

interface DriveOwner {
  displayName: string;
  emailAddress: string;
}
```

### Sync filters

| Filter | Type | Description |
|--------|------|-------------|
| `folderId` | `string` | Only files in this folder (not recursive). |
| `mimeType` | `string` | Only files matching this MIME type. |

Combine with `since` for date-scoped syncs, or `cursor` for incremental syncs.

---

## OAuth Utilities

The `botinabox/google` subpath exports low-level OAuth2 helpers for advanced use cases. Most users will not need these directly -- the connectors handle OAuth internally.

```typescript
import {
  createOAuth2Client,
  getAuthUrl,
  exchangeCode,
  loadTokens,
  saveTokens,
  refreshIfNeeded,
  createServiceAccountClient,
} from 'botinabox/google';
```

### createOAuth2Client

Create a Google OAuth2 client from your app credentials:

```typescript
const client = await createOAuth2Client({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  redirectUri: 'http://localhost:3000/oauth/callback',
});
```

### getAuthUrl

Generate the consent screen URL:

```typescript
const authUrl = getAuthUrl(client, [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
]);
// => 'https://accounts.google.com/o/oauth2/v2/auth?...'
```

The generated URL requests `access_type: 'offline'` and `prompt: 'consent'` to ensure a refresh token is returned.

### exchangeCode

Exchange the authorization code from the callback for tokens:

```typescript
const tokens = await exchangeCode(client, authorizationCode);
// => { access_token: '...', refresh_token: '...', expiry_date: 1234567890, token_type: 'Bearer' }
```

### GoogleTokens type

```typescript
interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;      // Unix timestamp in milliseconds
  token_type: string;        // Usually 'Bearer'
}
```

---

## Service Account Auth

For server-to-server authentication without a browser flow:

```typescript
import { createServiceAccountClient } from 'botinabox/google';

// From a key file
const client = await createServiceAccountClient(
  {
    keyFile: '/path/to/service-account.json',
    subject: 'user@example.com',
  },
  ['https://www.googleapis.com/auth/gmail.readonly'],
);

// From inline credentials
const client2 = await createServiceAccountClient(
  {
    credentials: {
      client_email: 'bot@project.iam.gserviceaccount.com',
      private_key: process.env.GOOGLE_PRIVATE_KEY!,
      project_id: 'my-project',
    },
    subject: 'user@example.com',
  },
  ['https://www.googleapis.com/auth/calendar.readonly'],
);
```

The `subject` field enables domain-wide delegation -- the service account impersonates the specified user. This must be configured in Google Workspace admin.

---

## Token Persistence Pattern

Connectors accept `tokenLoader` and `tokenSaver` callbacks for persisting OAuth tokens. This decouples token storage from the connector itself -- you can use a database, file system, secret manager, or any other store.

```typescript
import { GoogleGmailConnector } from 'botinabox/google';

const gmail = new GoogleGmailConnector({
  // Load: called during connect() to retrieve stored tokens
  tokenLoader: async (key: string): Promise<string | null> => {
    // key is 'google_tokens:{account}'
    const row = await db.get('secrets', key);
    return row?.value ?? null;
  },

  // Save: called when tokens are refreshed or newly obtained
  tokenSaver: async (key: string, value: string): Promise<void> => {
    await db.upsert('secrets', { key, value });
  },
});
```

### Low-level token helpers

```typescript
import { loadTokens, saveTokens, refreshIfNeeded } from 'botinabox/google';

// Load tokens using a generic getter function
const tokens = await loadTokens(
  async (key) => db.get('secrets', key),
  'user@example.com',
);
// Reads key 'google_tokens:user@example.com'

// Save tokens using a generic setter function
await saveTokens(
  async (key, value) => db.set('secrets', key, value),
  'user@example.com',
  tokens,
);

// Refresh if expired (checks expiry_date with 60-second buffer)
const freshTokens = await refreshIfNeeded(
  oauthClient,
  tokens,
  async (newTokens) => {
    // Auto-persist refreshed tokens
    await saveTokens(setter, 'user@example.com', newTokens);
  },
);
```

---

## Cursor-Based Incremental Sync Pattern

All connectors follow the same incremental sync pattern:

```typescript
import type { Connector, SyncResult } from 'botinabox';

async function syncLoop<T>(
  connector: Connector<T>,
  getCursor: () => Promise<string | undefined>,
  saveCursor: (cursor: string) => Promise<void>,
  processRecords: (records: T[]) => Promise<void>,
) {
  const cursor = await getCursor();

  // If we have a cursor, do incremental sync; otherwise full sync
  const result = await connector.sync({
    cursor,
    limit: 100,
  });

  // Process the records (store in DB, trigger workflows, etc.)
  await processRecords(result.records);

  // Log any per-record errors
  for (const err of result.errors) {
    console.warn(`Sync error for ${err.id}: ${err.error}`);
  }

  // Persist the cursor for next time
  if (result.cursor) {
    await saveCursor(result.cursor);
  }

  // If there are more records, continue syncing
  if (result.hasMore) {
    await syncLoop(connector, getCursor, saveCursor, processRecords);
  }
}

// Usage
await syncLoop(
  gmailConnector,
  async () => db.get('sync_cursors', 'gmail')?.cursor,
  async (cursor) => db.upsert('sync_cursors', { id: 'gmail', cursor }),
  async (emails) => {
    for (const email of emails) {
      await db.upsert('emails', { id: email.gmailId, ...email });
    }
  },
);
```

### Gmail sync details

- **Full sync**: Lists messages using the Gmail Messages API with optional `q` (search query) and `after:` (timestamp) filters. Returns the current `historyId` as the cursor.
- **Incremental sync**: Uses the Gmail History API with `startHistoryId`. Only returns messages added since that history ID.

### Calendar sync details

- **Full sync**: Lists events using the Calendar Events API with `timeMin` (defaults to 30 days ago). Returns a `nextSyncToken` as the cursor.
- **Incremental sync**: Uses the Calendar Events API with `syncToken`. If the token is expired (HTTP 410), automatically falls back to a full sync.

### Drive sync details

- **Full sync**: Lists files using the Drive Files API with optional `folderId`, `mimeType`, and `modifiedTime` filters. Excludes trashed files by default. Returns a `startPageToken` (from Changes API) as the cursor.
- **Incremental sync**: Uses the Drive Changes API with `startPageToken`. Returns new/modified/deleted files. Deleted files have `trashed: true` and empty metadata. Falls back to full sync on HTTP 403/404.

---

## Building a Custom Connector

Implement the `Connector<T>` interface with your record type:

```typescript
import type {
  Connector,
  ConnectorMeta,
  ConnectorConfig,
  SyncOptions,
  SyncResult,
  PushResult,
  AuthResult,
} from 'botinabox';

// Define your record type
interface TodoItem {
  id: string;
  title: string;
  completed: boolean;
  dueDate?: string;
}

class TrelloConnector implements Connector<TodoItem> {
  readonly id = 'trello';
  readonly meta: ConnectorMeta = {
    displayName: 'Trello',
    provider: 'trello',
    dataType: 'board',
  };

  private apiKey: string | null = null;
  private token: string | null = null;
  private boardId: string | null = null;

  async connect(config: ConnectorConfig): Promise<void> {
    this.apiKey = config.apiKey as string;
    this.token = config.token as string;
    this.boardId = config.boardId as string;
  }

  async disconnect(): Promise<void> {
    this.apiKey = null;
    this.token = null;
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(
        `https://api.trello.com/1/boards/${this.boardId}?key=${this.apiKey}&token=${this.token}`,
      );
      return { ok: res.ok };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async sync(options?: SyncOptions): Promise<SyncResult<TodoItem>> {
    const records: TodoItem[] = [];
    const errors: SyncResult<TodoItem>['errors'] = [];

    // Fetch cards from Trello API
    const res = await fetch(
      `https://api.trello.com/1/boards/${this.boardId}/cards?key=${this.apiKey}&token=${this.token}`,
    );
    const cards = await res.json();

    for (const card of cards) {
      try {
        records.push({
          id: card.id,
          title: card.name,
          completed: card.dueComplete ?? false,
          dueDate: card.due ?? undefined,
        });
      } catch (err) {
        errors.push({ id: card.id, error: String(err) });
      }
    }

    return {
      records,
      cursor: undefined,   // Trello doesn't have incremental sync tokens
      hasMore: false,
      errors,
    };
  }

  async push(payload: TodoItem): Promise<PushResult> {
    const res = await fetch(
      `https://api.trello.com/1/cards?key=${this.apiKey}&token=${this.token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idList: this.boardId,
          name: payload.title,
          due: payload.dueDate,
        }),
      },
    );

    const data = await res.json();
    return { success: res.ok, externalId: data.id };
  }
}

export default function createTrelloConnector(): TrelloConnector {
  return new TrelloConnector();
}
```

### Key implementation notes

- `sync()` must return a `SyncResult<T>` with `records`, `cursor`, `hasMore`, and `errors`.
- `push()` is optional -- omit it if the connector is read-only.
- `authenticate()` is optional -- implement it for connectors that need OAuth or other interactive auth flows.
- Use the `cursor` field for incremental sync. Return `undefined` if the service does not support it.
- Non-fatal per-record errors go in the `errors` array. The sync should continue past individual failures.
- The connector produces typed records -- it never writes to any database table. The consuming application decides how to store records.
