import { describe, it } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert";
import { boundSocialResults, DEFAULT_SOCIAL_REGISTRATIONS, SocialCapabilityRouter, deduplicateSocialEvidence, normalizeSocialEvidence, parseSocialReferenceUrl, socialReferenceFallback, type SocialResearchResponse } from "../dist/index.js";

describe("Social Intelligence contracts", () => {
  it("bounds results and canonicalizes supported references", () => {
    strictEqual(boundSocialResults(100), 10);
    deepStrictEqual(parseSocialReferenceUrl("https://www.instagram.com/reel/ABC123/?utm_source=x"), { platform: "INSTAGRAM", canonicalUrl: "https://www.instagram.com/reel/ABC123/", contentId: "ABC123" });
    deepStrictEqual(parseSocialReferenceUrl("https://www.tiktok.com/@demo/video/12345?is_from_webapp=1"), { platform: "TIKTOK", canonicalUrl: "https://www.tiktok.com/@demo/video/12345", contentId: "12345" });
  });
  it("keeps unknown metrics absent and deduplicates by content id", () => {
    const one = normalizeSocialEvidence({ platform: "INSTAGRAM", provider: "APIFY", platformContentId: "p1", canonicalUrl: "https://instagram.com/p/p1/", title: "x", retrievedAt: "2026-09-01T00:00:00Z", accessMethod: "API" });
    const two = normalizeSocialEvidence({ platform: "INSTAGRAM", provider: "APIFY", platformContentId: "p1", canonicalUrl: "https://instagram.com/p/p1/", title: "x", retrievedAt: "2026-09-01T00:00:00Z", accessMethod: "API" });
    strictEqual(one.engagement && Object.keys(one.engagement).length, 0);
    strictEqual(deduplicateSocialEvidence([one, two]).length, 1);
  });
  it("fails closed to upload fallback without direct access", () => {
    const result = socialReferenceFallback("https://www.instagram.com/p/ABC123/");
    strictEqual(result.status, "UPLOAD_VIDEO_REQUIRED");
  });
  it("selects Apify for Instagram discovery and excludes Bright Data", () => {
    const router = new SocialCapabilityRouter(DEFAULT_SOCIAL_REGISTRATIONS, {});
    strictEqual(router.eligibleProviders("SOCIAL_CONTENT_DISCOVERY", "INSTAGRAM").map((entry) => entry.provider).join(","), "APIFY");
  });
  it("permits Bright Data only as policy fallback after a known terminal failure", async () => {
    const calls: string[] = [];
    const response: SocialResearchResponse = { provider: "BRIGHT_DATA", status: "SUCCEEDED", results: [], requestsMade: 1, cost: { classification: "UNKNOWN" }, limitations: [] };
    const router = new SocialCapabilityRouter(
      DEFAULT_SOCIAL_REGISTRATIONS,
      {
        APIFY: { research: async () => { calls.push("APIFY"); throw Object.assign(new Error("bad request"), { category: "VALIDATION", statusCode: 400, retryable: false }); } },
        BRIGHT_DATA: { research: async () => { calls.push("BRIGHT_DATA"); return response; } },
      },
    );
    const result = await router.research({ mode: "REFERENCE_ANALYSIS", platforms: ["INSTAGRAM"], capability: "SOCIAL_REEL_METADATA", referenceUrl: "https://www.instagram.com/reel/x/" });
    strictEqual(result.provider, "BRIGHT_DATA");
    strictEqual(calls.join(","), "APIFY,BRIGHT_DATA");
  });
  it("does not fall back after an uncertain submission timeout", async () => {
    const calls: string[] = [];
    const router = new SocialCapabilityRouter(DEFAULT_SOCIAL_REGISTRATIONS, {
      APIFY: { research: async () => { calls.push("APIFY"); throw Object.assign(new Error("unknown"), { category: "TIMEOUT", retryable: false, reconciliationRequired: true }); } },
      BRIGHT_DATA: { research: async () => { calls.push("BRIGHT_DATA"); return { provider: "BRIGHT_DATA", status: "SUCCEEDED", results: [], requestsMade: 1, limitations: [] }; } },
    });
    await import("node:assert").then(({ rejects }) => rejects(router.research({ mode: "REFERENCE_ANALYSIS", platforms: ["INSTAGRAM"], capability: "SOCIAL_REEL_METADATA", referenceUrl: "https://www.instagram.com/reel/x/" })));
    strictEqual(calls.join(","), "APIFY");
  });
});
