import { describe, it } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert";
import { BrightDataSocialIntelligenceAdapter } from "../../dist/index.js";

describe("BrightDataSocialIntelligenceAdapter", () => {
  it("maps a URL-oriented Instagram Reel response without fabricating fields", async () => {
    const original = globalThis.fetch; let request: any;
    globalThis.fetch = async (url, init) => { request = { url, body: JSON.parse(String(init?.body)) }; return new Response(JSON.stringify([{ url: "https://www.instagram.com/reel/ABC/", shortcode: "ABC", user_posted: "creator", description: "caption", likes: 9, num_comments: 2, views: 100 }]), { status: 200 }); };
    try {
      const adapter = new BrightDataSocialIntelligenceAdapter({ apiToken: "test", instagramReelDatasetId: "gd_reel" });
      const result = await adapter.research({ mode: "REFERENCE_ANALYSIS", platforms: ["INSTAGRAM"], capability: "SOCIAL_REEL_METADATA", referenceUrl: "https://www.instagram.com/reel/ABC/", maxResults: 3 });
      strictEqual(result.results.length, 1); strictEqual(result.results[0].platformContentId, "ABC"); strictEqual(result.results[0].engagement?.viewCount, 100); strictEqual(result.results[0].engagement?.shareCount, undefined); deepStrictEqual(request.body, [{ url: "https://www.instagram.com/reel/ABC/" }]);
    } finally { globalThis.fetch = original; }
  });
  it("requires explicit configured credentials and does not accept discovery by guess", async () => {
    const adapter = new BrightDataSocialIntelligenceAdapter({ apiToken: "test", instagramPostDatasetId: "gd_post" });
    await import("node:assert").then(({ rejects }) => rejects(adapter.research({ mode: "CONTENT_DISCOVERY", platforms: ["INSTAGRAM"], capability: "SOCIAL_CONTENT_DISCOVERY", query: "travel" }), /reference URL/));
  });
  it("preserves a bounded sanitized diagnostic for JSON and text errors", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ code: "BAD_INPUT", message: "invalid dataset input", token: "must-not-be-reported" }), { status: 400, statusText: "Bad Request", headers: { "content-type": "application/json", "x-request-id": "req-1" } });
    try {
      const adapter = new BrightDataSocialIntelligenceAdapter({ apiToken: "secret", instagramReelDatasetId: "gd_reel" });
      await import("node:assert").then(async ({ rejects }) => rejects(adapter.research({ mode: "REFERENCE_ANALYSIS", platforms: ["INSTAGRAM"], capability: "SOCIAL_REEL_METADATA", referenceUrl: "https://www.instagram.com/reel/ABC/" }), (error: any) => { strictEqual(error.statusCode, 400); strictEqual(error.detail.includes("BAD_INPUT"), true); strictEqual(error.detail.includes("secret"), false); strictEqual(error.detail.includes("must-not-be-reported"), false); strictEqual(error.detail.includes("[REDACTED]"), true); return true; }));
    } finally { globalThis.fetch = original; }
  });
});
