import { describe, it } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert";
import { ApifySocialIntelligenceAdapter } from "../../dist/index.js";

describe("ApifySocialIntelligenceAdapter", () => {
  it("normalizes official Instagram-shaped fields without fabricating optional data", async () => {
    const original = globalThis.fetch; let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify([{ id: "123", shortCode: "ABC", url: "https://www.instagram.com/p/ABC/", ownerUsername: "demo", caption: "hello", likesCount: 7, commentsCount: 2, timestamp: "2026-09-01T00:00:00Z", musicInfo: { audio_id: "a1", song_name: "Original audio" } }]), { status: 200, headers: { "content-type": "application/json" } }); };
    try {
      const adapter = new ApifySocialIntelligenceAdapter({ apiToken: "test-token", instagramActorId: "apify/instagram-scraper" });
      const result = await adapter.research({ mode: "CONTENT_DISCOVERY", platforms: ["INSTAGRAM"], capability: "SOCIAL_DISCOVERY", query: "travel", maxResults: 3 });
      strictEqual(calls, 1); strictEqual(result.results.length, 1); strictEqual(result.results[0].platformContentId, "ABC"); strictEqual(result.results[0].engagement?.likeCount, 7); strictEqual(result.results[0].engagement?.viewCount, undefined); strictEqual(result.results[0].audioId, "a1");
    } finally { globalThis.fetch = original; }
  });
  it("does not auto-paginate and rejects missing Actor configuration", async () => {
    const adapter = new ApifySocialIntelligenceAdapter({ apiToken: "test-token" });
    await import("node:assert").then(({ rejects }) => rejects(adapter.research({ mode: "CONTENT_DISCOVERY", platforms: ["INSTAGRAM"], capability: "SOCIAL_DISCOVERY", query: "x" }), /No configured Actor/));
  });
  it("maps content discovery to the specialized popular-reels keyword contract", async () => {
    const original = globalThis.fetch; let body: any;
    globalThis.fetch = async (_url, init) => { body = JSON.parse(String(init?.body)); return new Response("[]", { status: 200 }); };
    try {
      const adapter = new ApifySocialIntelligenceAdapter({ apiToken: "test-token", instagramSearchActorId: "DrF9mzPPEuVizVF4l" });
      await adapter.research({ mode: "CONTENT_DISCOVERY", platforms: ["INSTAGRAM"], capability: "SOCIAL_CONTENT_DISCOVERY", query: "Egypt travel", maxResults: 3 });
      deepStrictEqual(body, { search: "Egypt travel", searchType: "popular", searchLimit: 3 });
    } finally { globalThis.fetch = original; }
  });
  it("does not count Apify no_items envelopes as social records", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify([{ error: "no_items", errorDescription: "Empty or private data for provided input" }]), { status: 200 });
    try {
      const adapter = new ApifySocialIntelligenceAdapter({ apiToken: "test-token", instagramActorId: "apify/instagram-scraper" });
      const result = await adapter.research({ mode: "CONTENT_DISCOVERY", platforms: ["INSTAGRAM"], capability: "SOCIAL_DISCOVERY", query: "travel", maxResults: 3 });
      strictEqual(result.results.length, 0); strictEqual(result.normalizationWarnings?.[0], "NO_ITEMS_ENVELOPE");
    } finally { globalThis.fetch = original; }
  });
});
