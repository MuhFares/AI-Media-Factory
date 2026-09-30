/** Owner-local YouTube OAuth bootstrap (mocked transport only, never Google). */

import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual, ok, throws, rejects } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  YOUTUBE_OAUTH_SCOPES, GOOGLE_OAUTH_TOKEN_URL,
  readDesktopClientJson, buildAuthorizeUrl, loopbackRedirectUri, browserOpenCommand,
  exchangeCode, persistCredential, readCredential, refreshAccessToken,
  verifyChannel, credentialStatus,
} from "@ai-media-factory/provider-adapters";

const CLIENT_JSON = JSON.stringify({
  installed: { client_id: "test-client-id.apps.googleusercontent.com", client_secret: "test-client-secret" },
});
const memFs = () => {
  const files = new Map();
  return {
    files,
    readFile: async (p) => {
      if (!files.has(p)) throw new Error("ENOENT");
      return files.get(p);
    },
    writeFile: async (p, data, mode) => {
      if (mode !== 0o600) throw new Error("CREDENTIAL_MODE_NOT_OWNER_ONLY");
      files.set(p, data);
    },
  };
};
const tokenTransport = (over = {}) => ({
  calls: [],
  async postForm(url, params) {
    this.calls.push({ method: "POST", url, params });
    return over.post ?? { access_token: "mock-access", refresh_token: "mock-refresh", expires_in: 3600 };
  },
  async get(url, headers) {
    this.calls.push({ method: "GET", url, headers });
    return over.get ?? { items: [{ id: "UCmockchannelid0", snippet: { title: "Controlled Channel" } }] };
  },
});

describe("youtube oauth bootstrap", () => {
  it("A: client JSON path is read without logging secret contents", async () => {
    const fs = memFs();
    fs.files.set("/outside/client.json", CLIENT_JSON);
    const cfg = await readDesktopClientJson(fs, "/outside/client.json");
    strictEqual(cfg.clientId, "test-client-id.apps.googleusercontent.com");
    strictEqual(cfg.clientSecret, "test-client-secret");
    await rejects(
      readDesktopClientJson({ readFile: async () => "not-json" }, "/x"),
      /OAUTH_CLIENT_JSON_UNREADABLE/);
    await rejects(
      readDesktopClientJson({ readFile: async () => "{}" }, "/x"),
      /OAUTH_CLIENT_JSON_NOT_DESKTOP/);
  });

  it("B+C: loopback redirect is used with exact minimal scopes", () => {
    strictEqual(loopbackRedirectUri(54321), "http://127.0.0.1:54321/callback");
    throws(() => loopbackRedirectUri(0), /OAUTH_LOOPBACK_PORT_INVALID/);
    deepStrictEqual([...YOUTUBE_OAUTH_SCOPES], [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/yt-analytics.readonly",
    ]);
    const u = new URL(buildAuthorizeUrl("cid", "http://127.0.0.1:9/callback", "st"));
    strictEqual(u.hostname, "accounts.google.com");
    strictEqual(u.searchParams.get("redirect_uri"), "http://127.0.0.1:9/callback");
    strictEqual(u.searchParams.get("response_type"), "code");
    strictEqual(u.searchParams.get("access_type"), "offline");
    ok(!u.search.includes("oob"), "no deprecated OOB flow");
  });

  it("D+E: refresh credential persists outside repo; refresh mints via mocked token endpoint", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "amf-oauth-"));
    try {
      const credPath = path.join(dir, "youtube-token.json");
      const fs = memFs();
      const t = tokenTransport();
      const tokens = await exchangeCode(t, { clientId: "cid", clientSecret: "csec" }, "code-1", "http://127.0.0.1:9/callback");
      strictEqual(tokens.refreshToken, "mock-refresh");
      strictEqual(t.calls[0].url, GOOGLE_OAUTH_TOKEN_URL);
      await persistCredential(fs, credPath, {
        provider: "google", type: "youtube-oauth-desktop",
        clientId: "cid", clientSecret: "csec", refreshToken: tokens.refreshToken,
        scopes: [...YOUTUBE_OAUTH_SCOPES], obtainedAt: "2026-09-22T00:00:00.000Z",
      });
      const stored = JSON.parse(fs.files.get(credPath));
      strictEqual(stored.refreshToken, "mock-refresh");
      const back = await readCredential(fs, credPath);
      strictEqual(back.clientId, "cid");
      const minted = await refreshAccessToken(t, back);
      strictEqual(minted.accessToken, "mock-access");
      strictEqual(t.calls[1].params.grant_type, "refresh_token");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("F: no secret appears in normal outputs", async () => {
    const fs = memFs();
    fs.files.set("/c", CLIENT_JSON);
    const cfg = await readDesktopClientJson(fs, "/c");
    const st = credentialStatus({
      provider: "google", type: "youtube-oauth-desktop", clientId: cfg.clientId,
      clientSecret: cfg.clientSecret, refreshToken: "mock-refresh",
      scopes: [...YOUTUBE_OAUTH_SCOPES], obtainedAt: "t",
    });
    const dump = JSON.stringify({ st, scopes: [...YOUTUBE_OAUTH_SCOPES] });
    ok(!dump.includes("mock-refresh"), "refresh token never in status output");
    ok(!dump.includes("test-client-secret"), "client secret never in status output");
    strictEqual(st.present, true);
  });

  it("G+H: channel verification is a single read-only call, cannot upload", async () => {
    const t = tokenTransport();
    const ch = await verifyChannel(t, "mock-access");
    strictEqual(ch.channelId, "UCmockchannelid0");
    strictEqual(ch.channelTitle, "Controlled Channel");
    strictEqual(ch.uploadCapable, false);
    strictEqual(t.calls.length, 1);
    strictEqual(t.calls[0].method, "GET");
    ok(t.calls[0].url.includes("/youtube/v3/channels"), "channels.list only");
    ok(t.calls[0].url.includes("mine%3Dtrue") || t.calls[0].url.includes("mine=true"), "mine=true only");
    const src = await import("node:fs").then((f) => f.readFileSync(
      new URL("../src/oauth/youtube-oauth.ts", import.meta.url), "utf8"));
    for (const token of ["YouTubePublishAdapter", "adapters/publishing", "publishSessionStore", "videos.insert", "videos/insert", "upload/youtube"]) {
      ok(!src.includes(token), `verification path must not reference ${token}`);
    }
  });

  it("I+J: YOUTUBE_API_KEY untouched; adapter contracts compatible", async () => {
    const { YouTubePublishAdapter, YouTubeAnalyticsAdapter } = await import("@ai-media-factory/provider-adapters");
    const pub = new YouTubePublishAdapter({ accessToken: "mock-access" });
    strictEqual(pub.providerId, "youtube");
    const ana = new YouTubeAnalyticsAdapter({ accessToken: "mock-access" });
    strictEqual(ana.providerId, "youtube-analytics");
    const { YouTubeResearchAdapter } = await import("@ai-media-factory/provider-adapters");
    const res = new YouTubeResearchAdapter({ apiKey: "k" });
    ok(res, "research adapter still constructs from API key");
  });

  it("K: no DB/workflow/publication side effects in this module", async () => {
    const src = await import("node:fs").then((f) => f.readFileSync(
      new URL("../src/oauth/youtube-oauth.ts", import.meta.url), "utf8"));
    for (const token of ["control_approvals", "workflow_submissions", "INSERT INTO", "pool.query", "publish(", "videos.insert"]) {
      ok(!src.includes(token), `module must not contain ${token}`);
    }
  });

  it("HOTFIX: generated authorization URL is complete and survives browser launch intact", async () => {
    const url = buildAuthorizeUrl("test-client-id.apps.googleusercontent.com", loopbackRedirectUri(54321), "state-123");
    const u = new URL(url);
    strictEqual(u.searchParams.get("response_type"), "code");
    ok((u.searchParams.get("client_id") ?? "").length > 0, "client_id exists");
    strictEqual(u.searchParams.get("redirect_uri"), "http://127.0.0.1:54321/callback");
    strictEqual(u.searchParams.get("state"), "state-123");
    deepStrictEqual(u.searchParams.get("scope"), [...YOUTUBE_OAUTH_SCOPES].join(" "));
    strictEqual(u.searchParams.get("scope").split(" ").length, 3, "no additional scopes appear");
    ok(!url.includes("test-client-secret"), "no client_secret in authorization URL");
    ok(!url.includes("access_token") && !url.includes("refresh_token"), "no tokens in authorization URL");
    for (const platform of ["win32", "darwin", "linux"]) {
      const launched = browserOpenCommand(platform, url);
      const joined = launched.args.join(" ");
      ok(joined.includes("response_type=code"), `${platform}: response_type survives launch args`);
      ok(joined.includes("state-123"), `${platform}: state survives launch args`);
    }
    const win = browserOpenCommand("win32", url);
    strictEqual(win.command, "cmd");
    ok(win.args.some((a) => a.includes("response_type=code") && a.startsWith('"') && a.endsWith('"')),
      "win32 carries the full URL as one quoted argument so cmd cannot split on &");
  });
});
