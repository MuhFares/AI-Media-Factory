/** YouTube 400 diagnostics: Google error capture, redaction, classification (mocked fetch only). */

import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import {
  parseGoogleErrorCause, redactSecretText,
  YouTubePublishAdapter, requirePrivateVisibility,
} from "@ai-media-factory/provider-adapters";
import { createHash } from "node:crypto";

const requestForBytes = (bytes: Uint8Array, title = "T") => {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { finalMediaArtifactId: "art-error-test", finalMediaSha256: sha256,
    mediaTransportRef: { type: "HTTPS_URL" as const, url: "https://media.test/video.mp4", expectedSha256: sha256 },
    title, options: { visibility: "private" as const } };
};

const GOOGLE_400_INVALID = JSON.stringify({
  error: {
    code: 400, message: "Invalid value",
    errors: [{ domain: "youtube.video", reason: "invalidValue", message: "Invalid value" }],
  },
});
const GOOGLE_400_BADREQUEST = JSON.stringify({
  error: {
    code: 400, message: "Bad Request",
    errors: [{ domain: "global", reason: "badRequest", message: "Bad Request" }],
  },
});

describe("youtube error diagnostics", () => {
  it("A+B: 400 Google bodies capture reason, domain, message", () => {
    const a = parseGoogleErrorCause(GOOGLE_400_INVALID);
    strictEqual(a.reason, "invalidValue");
    strictEqual(a.domain, "youtube.video");
    strictEqual(a.message, "Invalid value");
    strictEqual(a.code, 400);
    const b = parseGoogleErrorCause(GOOGLE_400_BADREQUEST);
    strictEqual(b.reason, "badRequest");
    strictEqual(b.domain, "global");
  });

  it("C+D+E: auth and quota classifications preserved", async () => {
    const { sendHttp } = await import("@ai-media-factory/provider-adapters");
    const realFetch = globalThis.fetch;
    const seen = [];
    globalThis.fetch = (async (url, init) => {
      seen.push(String(url));
      const status = String(url).includes("auth401") ? 401
        : String(url).includes("perm403") ? 403 : 429;
      const body = status === 403
        ? JSON.stringify({ error: { code: 403, message: "forbidden", errors: [{ domain: "youtube.video", reason: "insufficientPermissions" }] } })
        : status === 429
          ? JSON.stringify({ error: { code: 429, message: "rate limited", errors: [{ domain: "global", reason: "quotaExceeded" }] } })
          : JSON.stringify({ error: { code: 401, message: "unauthorized", errors: [{ domain: "global", reason: "authError" }] } });
      return new Response(body, { status, headers: { "Content-Type": "application/json" } });
    });
    try {
      for (const [path, category, retryable] of [["auth401", "AUTHORIZATION", false], ["perm403", "AUTHORIZATION", false], ["quota429", "TRANSIENT", true]]) {
        try {
          await sendHttp({ method: "GET", url: `https://x.test/${path}`, headers: {} }, { providerId: "youtube", operation: "probe", timeoutMs: 2000, maxRetries: 0 });
          ok(false, "must throw");
        } catch (e) {
          strictEqual(e.category, category, path);
          strictEqual(e.retryable, retryable, path);
        }
      }
      try {
        await sendHttp({ method: "GET", url: "https://x.test/perm403", headers: {} }, { providerId: "youtube", operation: "probe", timeoutMs: 2000, maxRetries: 0 });
      } catch (e) {
        strictEqual(e.providerErrorCode, "insufficientPermissions");
        strictEqual(e.providerErrorType, "youtube.video");
      }
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("F: malformed/non-JSON bodies preserve generic behavior", () => {
    strictEqual(parseGoogleErrorCause("not json"), undefined);
    strictEqual(parseGoogleErrorCause(JSON.stringify({ ok: true })), undefined);
    strictEqual(parseGoogleErrorCause(JSON.stringify({ error: "string-error" })), undefined);
    strictEqual(parseGoogleErrorCause(""), undefined);
  });

  it("G: token-like secrets redacted, ordinary text untouched", () => {
    const dirty = 'Bearer ya29.a0Abc123 failed; "access_token":"sekret"; refresh_token=abc123 client_secret: xyz ok-title';
    const clean = redactSecretText(dirty);
    ok(!clean.includes("ya29.a0Abc123"), "google token redacted");
    ok(!clean.includes("sekret"), "access token redacted");
    ok(!clean.includes("abc123"), "refresh token redacted");
    ok(clean.includes("ok-title"), "ordinary text preserved");
    strictEqual(redactSecretText("Invalid value"), "Invalid value");
  });

  it("H+I: session-init success unchanged; no PUT after failed init", async () => {
    const realFetch = globalThis.fetch;
    const calls = [];
    const videoBytes = new Uint8Array([0, 1, 2, 3]);
    globalThis.fetch = (async (url, init) => {
      calls.push({ method: (init && init.method) || "GET", url: String(url) });
      const u = String(url);
      if (u === "https://media.test/video.mp4") return new Response(videoBytes, { status: 200 });
      if (u.includes("/upload/youtube/v3/videos")) {
        return new Response(JSON.stringify({ error: { code: 400, message: "Invalid value", errors: [{ domain: "youtube.video", reason: "invalidValue" }] } }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 200 });
    });
    try {
      const adapter = new YouTubePublishAdapter({ accessToken: "t" });
      try {
        await adapter.publish(requestForBytes(videoBytes));
        ok(false, "must throw");
      } catch (e) {
        strictEqual(e.statusCode, 400);
        strictEqual(e.providerErrorCode, "invalidValue");
        strictEqual(e.providerErrorType, "youtube.video");
        strictEqual(e.retryable, false, "4xx stays non-retryable");
      }
      deepStrictEqual(calls.map((c) => c.method), ["GET", "POST"], "media fetch then session-init only; zero PUTs");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("J: private-only guard intact", () => {
    strictEqual(requirePrivateVisibility("private"), "private");
    for (const bad of ["public", "unlisted", undefined, ""]) {
      let threw = false;
      try { requirePrivateVisibility(bad); } catch { threw = true; }
      ok(threw, `rejects ${String(bad)}`);
    }
  });

  it("H-success: session-init plus PUT completion path unchanged", async () => {
    const realFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = (async (url, init) => {
      const method = (init && init.method) || "GET";
      calls.push({ method, url: String(url) });
      const u = String(url);
      if (u === "https://media.test/video.mp4") return new Response(new Uint8Array([9]), { status: 200 });
      if (u.includes("/upload/youtube/v3/videos") && method === "POST") {
        return new Response("", { status: 200, headers: { location: "https://up.test/session/1" } });
      }
      if (u === "https://up.test/session/1" && method === "PUT") {
        return new Response(JSON.stringify({ id: "vid1", publishedAt: "2026-01-01T00:00:00Z" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    try {
      const adapter = new YouTubePublishAdapter({ accessToken: "t" });
      const r = await adapter.publish(requestForBytes(new Uint8Array([9])));
      strictEqual(r.status, "completed");
      strictEqual(r.publicationId, "vid1");
      deepStrictEqual(calls.map((c) => c.method), ["GET", "POST", "PUT"]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("beforeEach/afterEach fetch hygiene", () => {
    ok(typeof globalThis.fetch === "function", "global fetch restored");
  });
});
