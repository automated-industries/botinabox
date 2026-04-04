/**
 * Google OAuth2 helpers.
 *
 * Uses dynamic `import('googleapis')` so the package is only required
 * at runtime by consumers who actually use the Google connectors.
 */

import type { GoogleOAuthConfig, GoogleServiceAccountConfig, GoogleTokens } from './types.js';

// ── Lazy googleapis import ─────────────────────────────────────────

let _google: typeof import('googleapis')['google'] | undefined;

async function getGoogle() {
  if (!_google) {
    try {
      const mod = await import('googleapis');
      _google = mod.google;
    } catch {
      throw new Error(
        'googleapis is required for Google connectors. Install it: npm install googleapis',
      );
    }
  }
  return _google;
}

// We type the client loosely to avoid requiring googleapis at compile time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OAuth2Client = any;

// ── Public helpers ─────────────────────────────────────────────────

/**
 * Create a Google OAuth2 client from app credentials.
 */
export async function createOAuth2Client(
  config: GoogleOAuthConfig,
): Promise<OAuth2Client> {
  const google = await getGoogle();
  return new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri,
  );
}

/**
 * Generate the consent screen URL for the given scopes.
 */
export function getAuthUrl(client: OAuth2Client, scopes: string[]): string {
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes,
  });
}

/**
 * Exchange an authorization code for tokens.
 */
export async function exchangeCode(
  client: OAuth2Client,
  code: string,
): Promise<GoogleTokens> {
  const { tokens } = await client.getToken(code);
  return tokens as GoogleTokens;
}

// ── Service account auth ──────────────────────────────────────────

/**
 * Create an authenticated client using a service account with
 * domain-wide delegation (impersonation). No browser flow needed.
 */
export async function createServiceAccountClient(
  config: GoogleServiceAccountConfig,
  scopes: string[],
): Promise<OAuth2Client> {
  const google = await getGoogle();
  const auth = new google.auth.GoogleAuth({
    ...(config.keyFile ? { keyFile: config.keyFile } : {}),
    ...(config.credentials ? { credentials: config.credentials } : {}),
    scopes,
    clientOptions: { subject: config.subject },
  });
  return auth.getClient();
}

// ── Token persistence ──────────────────────────────────────────────

/**
 * Load persisted tokens via a generic getter callback.
 *
 * @param getter  Reads a string value by key (e.g. SecretStore.get)
 * @param accountKey  Unique key prefix for this account
 */
export async function loadTokens(
  getter: (key: string) => Promise<string | null>,
  accountKey: string,
): Promise<GoogleTokens | null> {
  const raw = await getter(`google_tokens:${accountKey}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GoogleTokens;
  } catch {
    return null;
  }
}

/**
 * Persist tokens via a generic setter callback.
 *
 * @param setter  Writes a string value by key (e.g. SecretStore.set)
 * @param accountKey  Unique key prefix for this account
 * @param tokens  Tokens to persist
 */
export async function saveTokens(
  setter: (key: string, value: string) => Promise<void>,
  accountKey: string,
  tokens: GoogleTokens,
): Promise<void> {
  await setter(`google_tokens:${accountKey}`, JSON.stringify(tokens));
}

/**
 * Refresh the access token if it has expired (or is about to within 60 s).
 *
 * If the token was refreshed and a `saver` callback is provided, the new
 * tokens are persisted automatically.
 */
export async function refreshIfNeeded(
  client: OAuth2Client,
  tokens: GoogleTokens,
  saver?: (tokens: GoogleTokens) => Promise<void>,
): Promise<GoogleTokens> {
  const buffer = 60_000; // 60 seconds
  const isExpired =
    tokens.expiry_date != null && Date.now() >= tokens.expiry_date - buffer;

  if (!isExpired) return tokens;

  client.setCredentials(tokens);
  const { credentials } = await client.refreshAccessToken();
  const refreshed: GoogleTokens = {
    access_token: credentials.access_token!,
    refresh_token: credentials.refresh_token ?? tokens.refresh_token,
    expiry_date: credentials.expiry_date ?? undefined,
    token_type: credentials.token_type ?? 'Bearer',
  };

  if (saver) {
    await saver(refreshed);
  }

  return refreshed;
}
