import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock googleapis ───────────────────────────────────────────────────

const mockGmail = {
  users: {
    getProfile: vi.fn(),
    messages: { list: vi.fn(), get: vi.fn(), send: vi.fn() },
    history: { list: vi.fn() },
  },
};

const mockCalendar = {
  events: { list: vi.fn() },
  calendarList: { list: vi.fn() },
};

vi.mock('googleapis', () => ({
  google: {
    gmail: () => mockGmail,
    calendar: () => mockCalendar,
    auth: {
      OAuth2: class MockOAuth2 {
        setCredentials() {}
      },
    },
  },
}));

// ── Mock oauth helpers ────────────────────────────────────────────────

const mockLoadTokens = vi.fn();
const mockSaveTokens = vi.fn();
const mockRefreshIfNeeded = vi.fn();
const mockCreateOAuth2Client = vi.fn();

vi.mock('../oauth.js', () => ({
  createOAuth2Client: (...args: unknown[]) => mockCreateOAuth2Client(...args),
  loadTokens: (...args: unknown[]) => mockLoadTokens(...args),
  saveTokens: (...args: unknown[]) => mockSaveTokens(...args),
  refreshIfNeeded: (...args: unknown[]) => mockRefreshIfNeeded(...args),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────

import { GoogleGmailConnector } from '../gmail-connector.js';
import { GoogleCalendarConnector } from '../calendar-connector.js';
import type { GoogleConnectorConfig, EmailRecord } from '../types.js';

// ── Shared fixtures ───────────────────────────────────────────────────

const TEST_TOKENS = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  expiry_date: Date.now() + 3_600_000,
  token_type: 'Bearer',
};

const TEST_CONFIG: GoogleConnectorConfig = {
  account: 'user@example.com',
  oauth: {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'http://localhost/callback',
  },
  scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
};

function makeTokenLoader(returns: string | null = JSON.stringify(TEST_TOKENS)) {
  return vi.fn().mockResolvedValue(returns);
}

function makeTokenSaver() {
  return vi.fn().mockResolvedValue(undefined);
}

/** Helper: build a Gmail message response with specific headers. */
function gmailMessage(
  id: string,
  opts: {
    from?: string;
    to?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    date?: string;
    snippet?: string;
    labels?: string[];
  } = {},
) {
  const headers = [
    { name: 'From', value: opts.from ?? 'Sender <sender@example.com>' },
    { name: 'To', value: opts.to ?? 'recipient@example.com' },
    { name: 'Cc', value: opts.cc ?? '' },
    { name: 'Bcc', value: opts.bcc ?? '' },
    { name: 'Subject', value: opts.subject ?? 'Test Subject' },
    { name: 'Date', value: opts.date ?? 'Mon, 01 Jan 2024 12:00:00 +0000' },
  ];

  return {
    data: {
      id,
      threadId: `thread-${id}`,
      snippet: opts.snippet ?? 'Preview text...',
      labelIds: opts.labels ?? ['INBOX'],
      payload: { headers },
    },
  };
}

// ── Setup ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default: oauth helpers succeed with test tokens
  mockCreateOAuth2Client.mockResolvedValue({ setCredentials: vi.fn() });
  mockLoadTokens.mockResolvedValue(TEST_TOKENS);
  mockRefreshIfNeeded.mockResolvedValue(TEST_TOKENS);
  mockSaveTokens.mockResolvedValue(undefined);
});

// ======================================================================
// Gmail Connector
// ======================================================================

describe('GoogleGmailConnector', () => {
  let connector: GoogleGmailConnector;

  beforeEach(() => {
    connector = new GoogleGmailConnector({
      tokenLoader: makeTokenLoader(),
      tokenSaver: makeTokenSaver(),
    });
  });

  // ── connect() ─────────────────────────────────────────────────────

  describe('connect()', () => {
    it('loads tokens and initializes the gmail client', async () => {
      await connector.connect(TEST_CONFIG);

      expect(mockCreateOAuth2Client).toHaveBeenCalledWith(TEST_CONFIG.oauth);
      expect(mockLoadTokens).toHaveBeenCalled();
      expect(mockRefreshIfNeeded).toHaveBeenCalled();

      // Should be able to call healthCheck without throwing "not connected"
      mockGmail.users.getProfile.mockResolvedValue({
        data: { emailAddress: 'user@example.com' },
      });
      const health = await connector.healthCheck();
      expect(health.ok).toBe(true);
    });

    it('throws if no tokens are stored', async () => {
      mockLoadTokens.mockResolvedValue(null);

      await expect(connector.connect(TEST_CONFIG)).rejects.toThrow(
        /No stored tokens.*user@example\.com/,
      );
    });
  });

  // ── healthCheck() ─────────────────────────────────────────────────

  describe('healthCheck()', () => {
    it('returns ok:true with account email', async () => {
      await connector.connect(TEST_CONFIG);
      mockGmail.users.getProfile.mockResolvedValue({
        data: { emailAddress: 'user@example.com' },
      });

      const result = await connector.healthCheck();
      expect(result).toEqual({ ok: true, account: 'user@example.com' });
    });

    it('returns ok:false when getProfile fails', async () => {
      await connector.connect(TEST_CONFIG);
      mockGmail.users.getProfile.mockRejectedValue(new Error('Auth expired'));

      const result = await connector.healthCheck();
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Auth expired');
    });
  });

  // ── sync() full mode ──────────────────────────────────────────────

  describe('sync() full mode', () => {
    it('returns EmailRecords with properly parsed headers', async () => {
      await connector.connect(TEST_CONFIG);

      mockGmail.users.messages.list.mockResolvedValue({
        data: {
          messages: [{ id: 'msg-1' }, { id: 'msg-2' }],
        },
      });

      mockGmail.users.messages.get
        .mockResolvedValueOnce(
          gmailMessage('msg-1', {
            from: 'Alice Smith <alice@example.com>',
            to: 'Bob <bob@example.com>, carol@example.com',
            subject: 'Meeting notes',
          }),
        )
        .mockResolvedValueOnce(
          gmailMessage('msg-2', {
            from: 'dave@example.com',
            to: 'user@example.com',
            cc: 'Eve <eve@example.com>',
            subject: 'Follow up',
            labels: ['INBOX', 'UNREAD'],
          }),
        );

      mockGmail.users.getProfile.mockResolvedValue({
        data: { historyId: '12345' },
      });

      const result = await connector.sync();

      expect(result.records).toHaveLength(2);
      expect(result.cursor).toBe('12345');
      expect(result.errors).toEqual([]);

      // First record
      const r1 = result.records[0];
      expect(r1.gmailId).toBe('msg-1');
      expect(r1.threadId).toBe('thread-msg-1');
      expect(r1.account).toBe('user@example.com');
      expect(r1.subject).toBe('Meeting notes');
      expect(r1.from).toEqual({ name: 'Alice Smith', email: 'alice@example.com' });
      expect(r1.to).toEqual([
        { name: 'Bob', email: 'bob@example.com' },
        { email: 'carol@example.com' },
      ]);
      expect(r1.isRead).toBe(true); // no UNREAD label

      // Second record
      const r2 = result.records[1];
      expect(r2.from).toEqual({ email: 'dave@example.com' });
      expect(r2.cc).toEqual([{ name: 'Eve', email: 'eve@example.com' }]);
      expect(r2.isRead).toBe(false); // has UNREAD label
    });

    it('extracts attachments from multipart payload and skips inline parts', async () => {
      await connector.connect(TEST_CONFIG);

      mockGmail.users.messages.list.mockResolvedValue({
        data: { messages: [{ id: 'att-1' }] },
      });

      mockGmail.users.messages.get.mockResolvedValueOnce({
        data: {
          id: 'att-1',
          threadId: 'thread-att-1',
          snippet: 'email with attachments',
          labelIds: ['INBOX'],
          payload: {
            mimeType: 'multipart/mixed',
            headers: [
              { name: 'From', value: 'a@example.com' },
              { name: 'To', value: 'b@example.com' },
              { name: 'Subject', value: 'Invoice attached' },
              { name: 'Date', value: 'Mon, 01 Jan 2024 12:00:00 +0000' },
            ],
            parts: [
              {
                mimeType: 'text/plain',
                body: { data: Buffer.from('See attached').toString('base64') },
              },
              {
                mimeType: 'application/pdf',
                filename: 'invoice.pdf',
                body: { attachmentId: 'att-abc', size: 12345 },
                headers: [
                  { name: 'Content-Disposition', value: 'attachment; filename="invoice.pdf"' },
                ],
              },
              {
                mimeType: 'image/png',
                filename: 'signature.png',
                body: { attachmentId: 'inline-1', size: 512 },
                headers: [
                  { name: 'Content-Disposition', value: 'inline; filename="signature.png"' },
                ],
              },
            ],
          },
        },
      });

      mockGmail.users.getProfile.mockResolvedValue({
        data: { historyId: '1' },
      });

      const result = await connector.sync();
      const r = result.records[0];
      expect(r.attachments).toHaveLength(1);
      expect(r.attachments[0]).toEqual({
        attachmentId: 'att-abc',
        filename: 'invoice.pdf',
        mimeType: 'application/pdf',
        size: 12345,
      });
    });

    it('returns empty attachments array when payload has none', async () => {
      await connector.connect(TEST_CONFIG);

      mockGmail.users.messages.list.mockResolvedValue({
        data: { messages: [{ id: 'plain-1' }] },
      });
      mockGmail.users.messages.get.mockResolvedValueOnce(gmailMessage('plain-1'));
      mockGmail.users.getProfile.mockResolvedValue({ data: { historyId: '1' } });

      const result = await connector.sync();
      expect(result.records[0].attachments).toEqual([]);
    });
  });

  // ── sync() incremental mode ───────────────────────────────────────

  describe('sync() incremental mode', () => {
    it('uses history API with startHistoryId', async () => {
      await connector.connect(TEST_CONFIG);

      mockGmail.users.history.list.mockResolvedValue({
        data: {
          historyId: '99999',
          history: [
            {
              messagesAdded: [{ message: { id: 'inc-1' } }],
            },
          ],
        },
      });

      mockGmail.users.messages.get.mockResolvedValue(
        gmailMessage('inc-1', { subject: 'New message' }),
      );

      const result = await connector.sync({ cursor: '50000' });

      expect(mockGmail.users.history.list).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'me',
          startHistoryId: '50000',
          historyTypes: ['messageAdded'],
        }),
      );

      expect(result.records).toHaveLength(1);
      expect(result.records[0].subject).toBe('New message');
      expect(result.cursor).toBe('99999');
      expect(result.hasMore).toBe(false);
    });
  });

  // ── sync() error handling ─────────────────────────────────────────

  describe('sync() per-record errors', () => {
    it('captures per-record errors without failing the whole sync', async () => {
      await connector.connect(TEST_CONFIG);

      mockGmail.users.messages.list.mockResolvedValue({
        data: {
          messages: [{ id: 'ok-1' }, { id: 'fail-1' }, { id: 'ok-2' }],
        },
      });

      mockGmail.users.messages.get
        .mockResolvedValueOnce(gmailMessage('ok-1'))
        .mockRejectedValueOnce(new Error('404 Not Found'))
        .mockResolvedValueOnce(gmailMessage('ok-2'));

      mockGmail.users.getProfile.mockResolvedValue({
        data: { historyId: '100' },
      });

      const result = await connector.sync();

      expect(result.records).toHaveLength(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        id: 'fail-1',
        error: '404 Not Found',
      });
    });
  });

  // ── push() ────────────────────────────────────────────────────────

  describe('push()', () => {
    it('sends email with correct MIME encoding and base64', async () => {
      await connector.connect(TEST_CONFIG);

      mockGmail.users.messages.send.mockResolvedValue({
        data: { id: 'sent-1' },
      });

      const payload: EmailRecord = {
        gmailId: '',
        threadId: '',
        account: 'user@example.com',
        subject: 'Test send',
        from: { email: 'user@example.com' },
        to: [{ name: 'Bob', email: 'bob@example.com' }],
        cc: [{ email: 'cc@example.com' }],
        bcc: [],
        date: new Date().toISOString(),
        snippet: '',
        body: 'Hello, world!',
        labels: [],
        isRead: true,
        attachments: [],
      };

      const result = await connector.push(payload);

      expect(result).toEqual({ success: true, externalId: 'sent-1' });

      // Verify the send call
      const call = mockGmail.users.messages.send.mock.calls[0][0];
      expect(call.userId).toBe('me');

      // Decode the raw payload and verify MIME content
      const raw = call.requestBody.raw;
      const decoded = Buffer.from(raw, 'base64').toString('utf-8');
      expect(decoded).toContain('To: Bob <bob@example.com>');
      expect(decoded).toContain('Cc: cc@example.com');
      expect(decoded).toContain('Subject: Test send');
      expect(decoded).toContain('Hello, world!');
    });

    it('returns success:false when send fails', async () => {
      await connector.connect(TEST_CONFIG);

      mockGmail.users.messages.send.mockRejectedValue(
        new Error('Quota exceeded'),
      );

      const payload: EmailRecord = {
        gmailId: '',
        threadId: '',
        account: 'user@example.com',
        subject: 'Fail',
        from: { email: 'user@example.com' },
        to: [{ email: 'bob@example.com' }],
        cc: [],
        bcc: [],
        date: new Date().toISOString(),
        snippet: '',
        labels: [],
        isRead: true,
        attachments: [],
      };

      const result = await connector.push(payload);
      expect(result).toEqual({ success: false, error: 'Quota exceeded' });
    });
  });

  // ── Header parsing (tested through sync) ──────────────────────────

  describe('address parsing', () => {
    beforeEach(async () => {
      await connector.connect(TEST_CONFIG);
      mockGmail.users.getProfile.mockResolvedValue({
        data: { historyId: '1' },
      });
    });

    it('parses "Name <email>" format', async () => {
      mockGmail.users.messages.list.mockResolvedValue({
        data: { messages: [{ id: 'p1' }] },
      });
      mockGmail.users.messages.get.mockResolvedValue(
        gmailMessage('p1', { from: 'Jane Doe <jane@example.com>' }),
      );

      const result = await connector.sync();
      expect(result.records[0].from).toEqual({
        name: 'Jane Doe',
        email: 'jane@example.com',
      });
    });

    it('parses bare email address', async () => {
      mockGmail.users.messages.list.mockResolvedValue({
        data: { messages: [{ id: 'p2' }] },
      });
      mockGmail.users.messages.get.mockResolvedValue(
        gmailMessage('p2', { from: 'plain@example.com' }),
      );

      const result = await connector.sync();
      expect(result.records[0].from).toEqual({ email: 'plain@example.com' });
    });

    it('parses comma-separated address list', async () => {
      mockGmail.users.messages.list.mockResolvedValue({
        data: { messages: [{ id: 'p3' }] },
      });
      mockGmail.users.messages.get.mockResolvedValue(
        gmailMessage('p3', {
          to: 'Alpha <a@example.com>, b@example.com, Charlie <c@example.com>',
        }),
      );

      const result = await connector.sync();
      expect(result.records[0].to).toEqual([
        { name: 'Alpha', email: 'a@example.com' },
        { email: 'b@example.com' },
        { name: 'Charlie', email: 'c@example.com' },
      ]);
    });

    it('parses quoted name in "Name <email>" format', async () => {
      mockGmail.users.messages.list.mockResolvedValue({
        data: { messages: [{ id: 'p4' }] },
      });
      mockGmail.users.messages.get.mockResolvedValue(
        gmailMessage('p4', { from: '"John Q. Public" <john@example.com>' }),
      );

      const result = await connector.sync();
      expect(result.records[0].from).toEqual({
        name: 'John Q. Public',
        email: 'john@example.com',
      });
    });
  });
});

// ======================================================================
// Calendar Connector
// ======================================================================

describe('GoogleCalendarConnector', () => {
  let connector: GoogleCalendarConnector;

  beforeEach(() => {
    connector = new GoogleCalendarConnector({
      tokenLoader: makeTokenLoader(),
      tokenSaver: makeTokenSaver(),
    });
  });

  // ── connect() ─────────────────────────────────────────────────────

  describe('connect()', () => {
    it('loads tokens and initializes', async () => {
      await connector.connect(TEST_CONFIG);

      expect(mockCreateOAuth2Client).toHaveBeenCalledWith(TEST_CONFIG.oauth);
      expect(mockLoadTokens).toHaveBeenCalled();
      expect(mockRefreshIfNeeded).toHaveBeenCalled();
    });

    it('throws if no tokens are stored', async () => {
      mockLoadTokens.mockResolvedValue(null);

      await expect(connector.connect(TEST_CONFIG)).rejects.toThrow(
        /No stored tokens/,
      );
    });
  });

  // ── healthCheck() ─────────────────────────────────────────────────

  describe('healthCheck()', () => {
    it('returns ok:true with primary calendar account', async () => {
      await connector.connect(TEST_CONFIG);
      mockCalendar.calendarList.list.mockResolvedValue({
        data: {
          items: [{ id: 'user@example.com', primary: true }],
        },
      });

      const result = await connector.healthCheck();
      expect(result).toEqual({ ok: true, account: 'user@example.com' });
    });

    it('falls back to config account when no primary calendar', async () => {
      await connector.connect(TEST_CONFIG);
      mockCalendar.calendarList.list.mockResolvedValue({
        data: { items: [] },
      });

      const result = await connector.healthCheck();
      expect(result).toEqual({ ok: true, account: 'user@example.com' });
    });
  });

  // ── sync() full mode ──────────────────────────────────────────────

  describe('sync() full mode', () => {
    it('returns CalendarEventRecords with parsed fields', async () => {
      await connector.connect(TEST_CONFIG);

      mockCalendar.events.list.mockResolvedValue({
        data: {
          items: [
            {
              id: 'evt-1',
              summary: 'Team standup',
              description: 'Daily sync',
              location: 'Room A',
              start: { dateTime: '2024-01-15T09:00:00-05:00', timeZone: 'America/New_York' },
              end: { dateTime: '2024-01-15T09:30:00-05:00' },
              status: 'confirmed',
              organizer: { email: 'organizer@example.com' },
              attendees: [
                { email: 'a@example.com', displayName: 'Alice', responseStatus: 'accepted' },
                { email: 'b@example.com', responseStatus: 'tentative' },
              ],
              htmlLink: 'https://calendar.google.com/event/evt-1',
            },
            {
              id: 'evt-2',
              summary: 'All-day offsite',
              start: { date: '2024-01-20' },
              end: { date: '2024-01-21' },
              status: 'confirmed',
              organizer: { email: 'boss@example.com' },
              attendees: [],
            },
          ],
          nextSyncToken: 'sync-token-abc',
        },
      });

      const result = await connector.sync();

      expect(result.records).toHaveLength(2);
      expect(result.cursor).toBe('sync-token-abc');
      expect(result.errors).toEqual([]);

      // Timed event
      const e1 = result.records[0];
      expect(e1.googleEventId).toBe('evt-1');
      expect(e1.calendarId).toBe('primary');
      expect(e1.account).toBe('user@example.com');
      expect(e1.title).toBe('Team standup');
      expect(e1.description).toBe('Daily sync');
      expect(e1.location).toBe('Room A');
      expect(e1.allDay).toBe(false);
      expect(e1.timezone).toBe('America/New_York');
      expect(e1.organizerEmail).toBe('organizer@example.com');
      expect(e1.attendees).toEqual([
        { email: 'a@example.com', displayName: 'Alice', responseStatus: 'accepted' },
        { email: 'b@example.com', displayName: undefined, responseStatus: 'tentative' },
      ]);
      expect(e1.htmlLink).toBe('https://calendar.google.com/event/evt-1');

      // All-day event
      const e2 = result.records[1];
      expect(e2.allDay).toBe(true);
      expect(e2.title).toBe('All-day offsite');
    });

    it('omits timeMin and orderBy from the events.list request', async () => {
      // Google only emits nextSyncToken when the request contains none of
      // timeMin / timeMax / orderBy / q / updatedMin / etc. Guard the request
      // shape so a future "improvement" doesn't silently break syncToken
      // minting again.
      await connector.connect(TEST_CONFIG);

      mockCalendar.events.list.mockResolvedValue({
        data: { items: [], nextSyncToken: 'st-x' },
      });

      await connector.sync();

      expect(mockCalendar.events.list).toHaveBeenCalledTimes(1);
      const call = mockCalendar.events.list.mock.calls[0][0];
      expect(call).toEqual(
        expect.objectContaining({
          calendarId: 'primary',
          singleEvents: true,
        }),
      );
      expect(call).not.toHaveProperty('timeMin');
      expect(call).not.toHaveProperty('timeMax');
      expect(call).not.toHaveProperty('orderBy');
      expect(call).not.toHaveProperty('q');
      expect(call).not.toHaveProperty('updatedMin');
    });

    it('paginates through every page and returns the final nextSyncToken', async () => {
      // syncFull MUST drain pagination — Google only attaches nextSyncToken
      // to the response on the last page. Stopping early at a records cap
      // would yield cursor: undefined and force every consumer to re-do a
      // full sync forever.
      await connector.connect(TEST_CONFIG);

      const evt = (id: string) => ({
        id,
        summary: `Event ${id}`,
        start: { dateTime: '2024-01-01T10:00:00Z' },
        end: { dateTime: '2024-01-01T11:00:00Z' },
        status: 'confirmed',
        organizer: { email: 'org@example.com' },
      });

      mockCalendar.events.list
        .mockResolvedValueOnce({
          data: { items: [evt('p1-a'), evt('p1-b')], nextPageToken: 'p2' },
        })
        .mockResolvedValueOnce({
          data: { items: [evt('p2-a')], nextPageToken: 'p3' },
        })
        .mockResolvedValueOnce({
          // Last page: no nextPageToken, syncToken attached.
          data: { items: [evt('p3-a')], nextSyncToken: 'st-final' },
        });

      const result = await connector.sync();

      expect(mockCalendar.events.list).toHaveBeenCalledTimes(3);
      // Page 1: no pageToken
      expect(mockCalendar.events.list.mock.calls[0][0]).not.toHaveProperty('pageToken');
      // Pages 2 and 3: pageToken from previous response
      expect(mockCalendar.events.list.mock.calls[1][0]).toEqual(
        expect.objectContaining({ pageToken: 'p2' }),
      );
      expect(mockCalendar.events.list.mock.calls[2][0]).toEqual(
        expect.objectContaining({ pageToken: 'p3' }),
      );

      expect(result.records).toHaveLength(4);
      expect(result.cursor).toBe('st-final');
      expect(result.hasMore).toBe(false);
    });
  });

  // ── sync() incremental mode ───────────────────────────────────────

  describe('sync() incremental mode', () => {
    it('uses syncToken in events.list call', async () => {
      await connector.connect(TEST_CONFIG);

      mockCalendar.events.list.mockResolvedValue({
        data: {
          items: [
            {
              id: 'inc-evt-1',
              summary: 'Updated meeting',
              start: { dateTime: '2024-02-01T10:00:00Z' },
              end: { dateTime: '2024-02-01T11:00:00Z' },
              status: 'confirmed',
              organizer: { email: 'org@example.com' },
            },
          ],
          nextSyncToken: 'sync-token-new',
        },
      });

      const result = await connector.sync({ cursor: 'sync-token-old' });

      expect(mockCalendar.events.list).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarId: 'primary',
          syncToken: 'sync-token-old',
        }),
      );

      expect(result.records).toHaveLength(1);
      expect(result.records[0].title).toBe('Updated meeting');
      expect(result.cursor).toBe('sync-token-new');
    });
  });

  // ── sync() 410 fallback ───────────────────────────────────────────

  describe('sync() 410 fallback', () => {
    it('falls back to full sync when syncToken is expired (410)', async () => {
      await connector.connect(TEST_CONFIG);

      const expired410 = Object.assign(new Error('Gone'), { code: 410 });

      // First call with syncToken throws 410
      mockCalendar.events.list
        .mockRejectedValueOnce(expired410)
        // Second call is the full sync fallback
        .mockResolvedValueOnce({
          data: {
            items: [
              {
                id: 'fallback-evt',
                summary: 'Recovered event',
                start: { dateTime: '2024-03-01T08:00:00Z' },
                end: { dateTime: '2024-03-01T09:00:00Z' },
                status: 'confirmed',
                organizer: { email: 'org@example.com' },
              },
            ],
            nextSyncToken: 'fresh-token',
          },
        });

      const result = await connector.sync({ cursor: 'stale-token' });

      // Should have called events.list twice: once with syncToken, once for full sync
      expect(mockCalendar.events.list).toHaveBeenCalledTimes(2);

      // First call had the stale syncToken
      expect(mockCalendar.events.list.mock.calls[0][0]).toEqual(
        expect.objectContaining({ syncToken: 'stale-token' }),
      );

      // Second call is a full sync. To mint a fresh nextSyncToken, Google
      // requires the request to omit timeMin, orderBy, etc. — see syncFull
      // doc comment. singleEvents stays on (does not block nextSyncToken).
      const fullSyncCall = mockCalendar.events.list.mock.calls[1][0];
      expect(fullSyncCall).toEqual(
        expect.objectContaining({ singleEvents: true }),
      );
      expect(fullSyncCall).not.toHaveProperty('timeMin');
      expect(fullSyncCall).not.toHaveProperty('orderBy');

      expect(result.records).toHaveLength(1);
      expect(result.records[0].title).toBe('Recovered event');
      expect(result.cursor).toBe('fresh-token');
    });

    it('re-throws non-410 errors', async () => {
      await connector.connect(TEST_CONFIG);

      const authError = Object.assign(new Error('Unauthorized'), { code: 401 });
      mockCalendar.events.list.mockRejectedValue(authError);

      await expect(
        connector.sync({ cursor: 'some-token' }),
      ).rejects.toThrow('Unauthorized');
    });
  });
});
