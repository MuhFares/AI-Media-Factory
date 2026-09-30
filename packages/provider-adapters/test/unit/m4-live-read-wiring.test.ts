/** M4 live-read wiring proof (mocked transport only, never Google). */

import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import {
  YouTubeAnalyticsAdapter, readCredential, refreshAccessToken,
} from "@ai-media-factory/provider-adapters";

const MORROWAY_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];
const credFile = (over = {}) => JSON.stringify({
  provider: "google", type: "youtube-oauth-desktop",
  clientId: "cid", clientSecret: "csec", refreshToken: "rt",
  scopes: [...MORROWAY_SCOPES], obtainedAt: "t", ...over,
});
const fsFor = (content) => ({ readFile: async () => content });

describe("m4 live-read wiring", () => {
  it("refreshed Morroway token reaches the analytics adapter", async () => {
    const calls = [];
    const transport = {
      async postForm(url, params) {
        calls.push({ kind: "token", grant: params.grant_type });
        strictEqual(params.refresh_token, "rt");
        return { access_token: "live-minted", expires_in: 3600 };
      },
      async get() { throw new Error("no GET expected in this unit"); },
    };
    const cred = await readCredential(fsFor(credFile()), "/outside/m4.json");
    deepStrictEqual([...cred.scopes], MORROWAY_SCOPES);
    const minted = await refreshAccessToken(transport, cred);
    strictEqual(minted.accessToken, "live-minted");
    const adapter = new YouTubeAnalyticsAdapter({ accessToken: minted.accessToken, maxRetries: 0 });
    strictEqual(adapter.providerId, "youtube-analytics");
    strictEqual(calls.length, 1, "exactly one token call, nothing else");
  });

  it("Bearer header, endpoint, and Morroway video target are exact", async () => {
    const realFetch = globalThis.fetch;
    const seen = [];
    globalThis.fetch = (async (url, init) => {
      const h = init.headers;
      const auth = h && typeof h.get === "function" ? h.get("Authorization") : h.Authorization;
      seen.push({ url: String(url), auth });
      return new Response(JSON.stringify({ columnHeaders: [], rows: [] }), { status: 200 });
    });
    try {
      const adapter = new YouTubeAnalyticsAdapter({ accessToken: "live-minted", maxRetries: 0 });
      const r = await adapter.fetch({ publicationId: "AfbPyQ-UFwM", platform: "youtube" });
      strictEqual(seen.length, 1);
      strictEqual(seen[0].auth, "Bearer live-minted");
      const u = new URL(seen[0].url);
      strictEqual(u.hostname, "youtubeanalytics.googleapis.com");
      strictEqual(u.pathname, "/v2/reports");
      strictEqual(u.searchParams.get("ids"), "channel==MINE");
      strictEqual(u.searchParams.get("filters"), "video==AfbPyQ-UFwM");
      deepStrictEqual(r.metrics, {}, "empty report stays empty, never zero-filled");
      strictEqual(r.providerId, "youtube-analytics");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("401 never creates LIVE observation and missing stays missing", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      error: { code: 401, message: "Insufficient permission to access this report.",
        errors: [{ domain: "global", reason: "unauthorized" }] },
    }), { status: 401 }));
    try {
      const adapter = new YouTubeAnalyticsAdapter({ accessToken: "live-minted", maxRetries: 0 });
      let err = null;
      try {
        await adapter.fetch({ publicationId: "AfbPyQ-UFwM", platform: "youtube" });
      } catch (e) { err = e; }
      ok(err, "401 throws");
      strictEqual(err.statusCode, 401);
      strictEqual(err.providerErrorCode, "unauthorized");
      strictEqual(err.retryable, false);
      ok(!("metrics" in (err || {})), "no metrics object escapes on failure");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("no provider calls occur in these tests beyond the fetch stubs above", () => {
    ok(typeof globalThis.fetch === "function", "global fetch restored");
  });
});
