import { describe, it } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert";
import { YouTubeResearchAdapter, parseYouTubeVideoId } from "../../dist/index.js";

describe("YouTube research adapter", () => {
  it("parses supported URL forms safely", () => {
    strictEqual(parseYouTubeVideoId("https://www.youtube.com/watch?v=abcdefghijk"), "abcdefghijk");
    strictEqual(parseYouTubeVideoId("https://youtu.be/abcdefghijk?t=2"), "abcdefghijk");
    strictEqual(parseYouTubeVideoId("https://www.youtube.com/shorts/abcdefghijk"), "abcdefghijk");
    strictEqual(parseYouTubeVideoId("https://example.com/watch?v=abcdefghijk"), null);
  });
  it("normalizes search plus metadata with official quota accounting", async () => {
    const original = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = String(input); urls.push(url);
      if (url.includes("/search?")) return new Response(JSON.stringify({ items: [{ id: { videoId: "abcdefghijk" }, snippet: { title: "Video", description: "Desc" } }] }), { status: 200 });
      return new Response(JSON.stringify({ items: [{ id: "abcdefghijk", snippet: { title: "Video", description: "Desc", channelId: "c", channelTitle: "Channel", publishedAt: "2026-09-01T00:00:00Z", thumbnails: {} }, contentDetails: { duration: "PT1M2S" }, statistics: { viewCount: "10" } }] }), { status: 200 });
    }) as typeof fetch;
    try {
      const result = await new YouTubeResearchAdapter({ apiKey: "test", baseUrl: "https://mock" }).search({ query: "topic", maxResults: 1 });
      strictEqual(result.results[0].videoId, "abcdefghijk");
      strictEqual(result.results[0].durationSeconds, 62);
      strictEqual(result.results[0].viewCount, 10);
      strictEqual(result.quotaEstimate, 2);
      strictEqual(result.quotaModel, "GRANULAR_METHOD_BUCKETS");
      strictEqual(result.quotaBuckets.search.name, "SEARCH_QUERIES");
      strictEqual(result.requestsMade, 2);
      strictEqual(urls.length, 2);
    } finally { globalThis.fetch = original; }
  });
});
