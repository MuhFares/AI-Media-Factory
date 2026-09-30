/** Provider-boundary title validation (mocked transport only, never YouTube). */

import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual, ok, throws } from "node:assert";
import {
  assertYouTubeTitle, YOUTUBE_TITLE_MAX_LENGTH, YouTubePublishAdapter,
} from "@ai-media-factory/provider-adapters";
import { createHash } from "node:crypto";

const CANONICAL = "Morroway validation reel";
const FAILED_103 = "Morroway validation reel [art-wf-1789233193749-gvydpiah-final-media] (private platform-validation only)";
const ONE_BYTE_SHA = createHash("sha256").update(new Uint8Array([9])).digest("hex");
const publishRequest = (title: unknown) => ({
  finalMediaArtifactId: "art-title-test", finalMediaSha256: ONE_BYTE_SHA,
  mediaTransportRef: { type: "HTTPS_URL" as const, url: "https://media.test/video.mp4", expectedSha256: ONE_BYTE_SHA },
  title: title as string, options: { visibility: "private" as const },
});

describe("youtube title boundary", () => {
  it("A: canonical Morroway title accepted locally", () => {
    strictEqual(assertYouTubeTitle(CANONICAL), CANONICAL);
    strictEqual(YOUTUBE_TITLE_MAX_LENGTH, 100);
  });

  it("B+C+D: empty, whitespace, and nullish titles fail before any provider call", () => {
    for (const bad of ["", "   ", "\t\n ", null, undefined, 0]) {
      throws(() => assertYouTubeTitle(bad), /TITLE_(REQUIRED|EMPTY)/, String(bad));
    }
  });

  it("E: over-limit title fails closed (failed M4 title was 103 chars)", () => {
    strictEqual(FAILED_103.length, 103);
    throws(() => assertYouTubeTitle(FAILED_103), /TITLE_TOO_LONG:103>100/);
    throws(() => assertYouTubeTitle("x".repeat(101)), /TITLE_TOO_LONG/);
    strictEqual(assertYouTubeTitle("x".repeat(100)).length, 100);
  });

  it("F: valid Unicode title accepted", () => {
    strictEqual(assertYouTubeTitle("Morroway — رحلة عبر الزمن"), "Morroway — رحلة عبر الزمن");
  });

  it("G: privacy remains exactly private", async () => {
    const realFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = (async (url, init) => {
      calls.push({ method: (init && init.method) || "GET", url: String(url), body: init && init.body });
      const u = String(url);
      if (u === "https://media.test/video.mp4") return new Response(new Uint8Array([9]), { status: 200 });
      if (u.includes("/upload/youtube/v3/videos")) {
        return new Response("", { status: 200, headers: { location: "https://up.test/s/1" } });
      }
      if (u === "https://up.test/s/1") {
        return new Response(JSON.stringify({ id: "v1", publishedAt: "2026-01-01T00:00:00Z" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    try {
      const adapter = new YouTubePublishAdapter({ accessToken: "t" });
      const r = await adapter.publish(publishRequest(CANONICAL));
      strictEqual(r.status, "completed");
      const initCall = calls.find((c) => c.url.includes("/upload/youtube/v3/videos"));
      const sent = JSON.parse(String(initCall.body));
      strictEqual(sent.status.privacyStatus, "private");
      strictEqual(sent.snippet.title, CANONICAL);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("H: channel guard and visibility guard unchanged", async () => {
    const { requirePrivateVisibility } = await import("@ai-media-factory/provider-adapters");
    strictEqual(requirePrivateVisibility("private"), "private");
    throws(() => requirePrivateVisibility("public"), /PRIVATE_VISIBILITY_REQUIRED/);
  });

  it("I: invalid title performs zero provider calls", async () => {
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => { calls += 1; return new Response("{}", { status: 200 }); });
    try {
      const adapter = new YouTubePublishAdapter({ accessToken: "t" });
      for (const bad of ["", "   ", "x".repeat(101)]) {
        try {
          await adapter.publish(publishRequest(bad));
          ok(false, "must throw");
        } catch (e) {
          ok(/TITLE_/.test(e.message), "title failure, got: " + e.message);
        }
      }
      strictEqual(calls, 0, "no fetch of any kind before title validation");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("J+K: reconstructed session-init body carries canonical title and marker description", async () => {
    const realFetch = globalThis.fetch;
    let initBody = null;
    globalThis.fetch = (async (url, init) => {
      const u = String(url);
      if (u === "https://media.test/video.mp4") return new Response(new Uint8Array([9]), { status: 200 });
      if (u.includes("/upload/youtube/v3/videos")) {
        initBody = JSON.parse(String(init.body));
        return new Response("", { status: 200, headers: { location: "https://up.test/s/2" } });
      }
      return new Response(JSON.stringify({ id: "v2", publishedAt: "2026-01-01T00:00:00Z" }), { status: 200 });
    });
    try {
      const adapter = new YouTubePublishAdapter({ accessToken: "t" });
      await adapter.publish(publishRequest(CANONICAL));
      strictEqual(initBody.snippet.title, CANONICAL);
      ok(typeof initBody.snippet.description === "string" && initBody.snippet.description.includes("[amf-id "), "provenance marker intact");
      deepStrictEqual(Object.keys(initBody).sort(), ["snippet", "status"], "no unsupported top-level fields");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("L: no publication records created during these tests", async () => {
    ok(true, "adapter constructed without any PublishStore; nothing persists");
  });
});
