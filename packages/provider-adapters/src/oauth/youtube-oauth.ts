/**
 * Owner-local YouTube OAuth bootstrap (Desktop / Installed-App flow).
 *
 * SECURITY MODEL — read carefully:
 * - The Google Desktop client JSON is read by explicit file path and is
 *   NEVER copied into the repository, logged, printed, or committed.
 * - Durable credential material (refresh token + OAuth client identity
 *   required to refresh it) lives OUTSIDE the repository in an
 *   Owner-chosen file with owner-only filesystem permissions.
 * - No OS keychain integration exists in this repository; the file model
 *   below is the documented minimum, protected by path + permissions.
 * - Access tokens are short-lived, held in memory, and handed to the
 *   existing adapters (which already accept raw accessToken strings).
 *   They are NEVER written to .env or committed configuration.
 * - This module performs network I/O ONLY through the injectable
 *   transport (Google OAuth + YouTube endpoints). Tests inject fakes;
 *   no test in this repository may contact Google.
 */

export const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const YOUTUBE_CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels";

/** Exact minimal scopes for the M4 proof boundary. Never widen silently. */
export const YOUTUBE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
] as const;

export interface DesktopClientConfig {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface DurableCredential {
  readonly provider: "google";
  readonly type: "youtube-oauth-desktop";
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  readonly scopes: readonly string[];
  readonly obtainedAt: string;
}

/** Minimal injectable transport. Production default uses global fetch. */
export interface OAuthTransport {
  postForm(url: string, params: Record<string, string>): Promise<unknown>;
  get(url: string, headers: Record<string, string>): Promise<unknown>;
}

export class OAuthError extends Error {}

/** Read a Google Desktop client JSON by path WITHOUT logging its contents. */
export async function readDesktopClientJson(
  deps: { readFile(path: string): Promise<string> },
  clientPath: string,
): Promise<DesktopClientConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await deps.readFile(clientPath));
  } catch {
    throw new OAuthError("OAUTH_CLIENT_JSON_UNREADABLE");
  }
  const installed = typeof parsed === "object" && parsed !== null
    ? (parsed as Record<string, unknown>).installed
    : undefined;
  if (typeof installed !== "object" || installed === null) {
    throw new OAuthError("OAUTH_CLIENT_JSON_NOT_DESKTOP");
  }
  const rec = installed as Record<string, unknown>;
  if (typeof rec.client_id !== "string" || rec.client_id.length === 0
    || typeof rec.client_secret !== "string" || rec.client_secret.length === 0) {
    throw new OAuthError("OAUTH_CLIENT_JSON_MISSING_FIELDS");
  }
  return { clientId: rec.client_id, clientSecret: rec.client_secret };
}

/** Build the loopback authorization URL (Desktop flow; never OOB). */
export function buildAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const url = new URL(GOOGLE_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("scope", [...YOUTUBE_OAUTH_SCOPES].join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

/** Loopback redirect for the Desktop flow (ephemeral 127.0.0.1 port). */
export function loopbackRedirectUri(port: number): string {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new OAuthError("OAUTH_LOOPBACK_PORT_INVALID");
  return `http://127.0.0.1:${port}/callback`;
}

/**
 * Browser-launch command for an authorization URL.
 *
 * Windows root cause (hotfix): `cmd /c start` re-parses its command line
 * and treats an unquoted `&` as a command separator, truncating the
 * authorization URL after `client_id` — Google then reports
 * `response_type` missing. The URL must therefore travel as ONE quoted
 * argument on win32. Other platforms receive argv directly (no shell),
 * so the bare URL is safe there.
 */
export function browserOpenCommand(platform: string, url: string): { command: string; args: string[] } {
  if (!url) throw new OAuthError("OAUTH_AUTHORIZE_URL_REQUIRED");
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", `"${url}"`] };
  if (platform === "darwin") return { command: "open", args: [url] };
  return { command: "xdg-open", args: [url] };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

/** Exchange an authorization code. Returns tokens WITHOUT logging them. */
export async function exchangeCode(
  transport: OAuthTransport,
  client: DesktopClientConfig,
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  if (!code) throw new OAuthError("OAUTH_CODE_REQUIRED");
  const res = asRecord(await transport.postForm(GOOGLE_OAUTH_TOKEN_URL, {
    code, client_id: client.clientId, client_secret: client.clientSecret,
    redirect_uri: redirectUri, grant_type: "authorization_code",
  }));
  const access = res !== null && typeof res.access_token === "string" ? res.access_token : "";
  const refresh = res !== null && typeof res.refresh_token === "string" ? res.refresh_token : "";
  const expires = res !== null && typeof res.expires_in === "number" ? res.expires_in : 0;
  if (!access || !refresh) throw new OAuthError("OAUTH_CODE_EXCHANGE_INCOMPLETE");
  return { accessToken: access, refreshToken: refresh, expiresIn: expires };
}

/** Persist ONLY the minimum durable credential (refresh path). */
export async function persistCredential(
  deps: { writeFile(path: string, data: string, mode: number): Promise<void> },
  credentialPath: string,
  cred: DurableCredential,
): Promise<void> {
  if (!cred.refreshToken || !cred.clientId || !cred.clientSecret) throw new OAuthError("OAUTH_CREDENTIAL_INCOMPLETE");
  await deps.writeFile(credentialPath, JSON.stringify({
    provider: cred.provider, type: cred.type, clientId: cred.clientId,
    clientSecret: cred.clientSecret, refreshToken: cred.refreshToken,
    scopes: [...cred.scopes], obtainedAt: cred.obtainedAt,
  }, null, 2), 0o600);
}

export async function readCredential(
  deps: { readFile(path: string): Promise<string> },
  credentialPath: string,
): Promise<DurableCredential> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await deps.readFile(credentialPath));
  } catch {
    throw new OAuthError("OAUTH_CREDENTIAL_UNREADABLE");
  }
  const r = asRecord(parsed);
  if (!r || r.provider !== "google" || r.type !== "youtube-oauth-desktop"
    || typeof r.refreshToken !== "string" || !r.refreshToken
    || typeof r.clientId !== "string" || !r.clientId
    || typeof r.clientSecret !== "string" || !r.clientSecret
    || !Array.isArray(r.scopes)) {
    throw new OAuthError("OAUTH_CREDENTIAL_INVALID");
  }
  return {
    provider: "google", type: "youtube-oauth-desktop",
    clientId: r.clientId, clientSecret: r.clientSecret, refreshToken: r.refreshToken,
    scopes: (r.scopes as unknown[]).filter((s): s is string => typeof s === "string"),
    obtainedAt: typeof r.obtainedAt === "string" ? r.obtainedAt : "unknown",
  };
}

/** Mint a fresh short-lived access token. The token is RETURNED, never logged. */
export async function refreshAccessToken(
  transport: OAuthTransport,
  cred: DurableCredential,
): Promise<{ accessToken: string; expiresIn: number }> {
  const res = asRecord(await transport.postForm(GOOGLE_OAUTH_TOKEN_URL, {
    client_id: cred.clientId, client_secret: cred.clientSecret,
    refresh_token: cred.refreshToken, grant_type: "refresh_token",
  }));
  const access = res !== null && typeof res.access_token === "string" ? res.access_token : "";
  const expires = res !== null && typeof res.expires_in === "number" ? res.expires_in : 0;
  if (!access) throw new OAuthError("OAUTH_REFRESH_INCOMPLETE");
  return { accessToken: access, expiresIn: expires };
}

export interface ChannelVerification {
  readonly channelId: string;
  readonly channelTitle: string;
  readonly uploadCapable: false;
}

/**
 * Read-only controlled-channel verification: exactly one
 * channels.list(mine=true) GET. This path CANNOT upload — it has no
 * reference to any publishing adapter or upload endpoint.
 */
export async function verifyChannel(
  transport: OAuthTransport,
  accessToken: string,
): Promise<ChannelVerification> {
  const url = new URL(YOUTUBE_CHANNELS_URL);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("mine", "true");
  url.searchParams.set("maxResults", "1");
  const res = asRecord(await transport.get(url.toString(), { Authorization: `Bearer ${accessToken}` }));
  const items = res !== null && Array.isArray(res.items) ? res.items : [];
  const first = items.length > 0 ? asRecord(items[0]) : null;
  const snippet = first !== null ? asRecord(first.snippet) : null;
  const id = first !== null && typeof first.id === "string" ? first.id : "";
  const title = snippet !== null && typeof snippet.title === "string" ? snippet.title : "";
  if (!id) throw new OAuthError("OAUTH_CHANNEL_UNRESOLVED");
  return { channelId: id, channelTitle: title, uploadCapable: false };
}

/** Status report containing metadata ONLY — never secrets. */
export function credentialStatus(cred: DurableCredential | null): {
  present: boolean; scopes: readonly string[]; obtainedAt: string;
} {
  if (!cred) return { present: false, scopes: [], obtainedAt: "unknown" };
  return { present: true, scopes: cred.scopes, obtainedAt: cred.obtainedAt };
}
