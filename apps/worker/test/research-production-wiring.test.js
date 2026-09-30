import { describe, it } from "node:test";
import { deepStrictEqual, strictEqual, rejects } from "node:assert";
import { createProductionResearchSourceRouter } from "../dist/production-executor.js";

const evidence = (provider, id) => ({
  evidenceId: `${provider}-${id}`,
  kind: "SOURCE_CLAIM",
  sourceType: "SOCIAL_PLATFORM",
  platform: "INSTAGRAM",
  canonicalUrl: `https://www.instagram.com/reel/${id}/`,
  retrievedAt: "2026-09-02T00:00:00Z",
  accessMethod: "API",
  provenance: `${provider}-fixture`,
  confidence: "MEDIUM",
  provider,
  platformContentId: id,
  limitations: ["RESEARCH_REFERENCE_ONLY"],
});

const socialPort = (provider, resultId = "abc") => ({
  research: async () => ({ provider, status: "SUCCEEDED", results: [evidence(provider, resultId)], requestsMade: 1, limitations: [] }),
});

describe("production research intelligence wiring", () => {
  it("injects the source router and selects Apify for discovery", async () => {
    const router = createProductionResearchSourceRouter({ socialProviders: { APIFY: socialPort("APIFY"), BRIGHT_DATA: socialPort("BRIGHT_DATA") } });
    const result = await router.execute({ mode: "CONTENT_DISCOVERY", topic: "Egypt travel", platforms: ["INSTAGRAM"] });
    strictEqual(result.sources[0].provider, "APIFY");
    deepStrictEqual(result.sourceCoverage, ["SOCIAL"]);
  });

  it("routes an Instagram reference to the Apify primary", async () => {
    const router = createProductionResearchSourceRouter({ socialProviders: { APIFY: socialPort("APIFY") } });
    const result = await router.execute({ mode: "REFERENCE_ANALYSIS", referenceUrls: ["https://www.instagram.com/reel/CigMSGeD4Hd/"], platforms: ["INSTAGRAM"] });
    strictEqual(result.sources[0].provider, "APIFY");
  });

  it("allows only a governed fallback after a known terminal failure", async () => {
    const calls = [];
    const router = createProductionResearchSourceRouter({ socialProviders: {
      APIFY: { research: async () => { calls.push("APIFY"); throw Object.assign(new Error("known failure"), { category: "VALIDATION", statusCode: 400, retryable: false }); } },
      BRIGHT_DATA: { research: async () => { calls.push("BRIGHT_DATA"); return { provider: "BRIGHT_DATA", status: "SUCCEEDED", results: [evidence("BRIGHT_DATA", "fallback")], requestsMade: 1, limitations: [] }; } },
    } });
    const result = await router.execute({ mode: "REFERENCE_ANALYSIS", referenceUrls: ["https://www.instagram.com/reel/CigMSGeD4Hd/"], platforms: ["INSTAGRAM"] });
    strictEqual(result.sources[0].provider, "BRIGHT_DATA");
    strictEqual(calls.join(","), "APIFY,BRIGHT_DATA");
  });

  it("does not invoke Bright Data after an ambiguous Apify state", async () => {
    const calls = [];
    const router = createProductionResearchSourceRouter({ socialProviders: {
      APIFY: { research: async () => { calls.push("APIFY"); throw Object.assign(new Error("reconcile"), { category: "TIMEOUT", retryable: false, reconciliationRequired: true }); } },
      BRIGHT_DATA: { research: async () => { calls.push("BRIGHT_DATA"); return { provider: "BRIGHT_DATA", status: "SUCCEEDED", results: [], requestsMade: 1, limitations: [] }; } },
    } });
    await rejects(router.execute({ mode: "REFERENCE_ANALYSIS", referenceUrls: ["https://www.instagram.com/reel/CigMSGeD4Hd/"], platforms: ["INSTAGRAM"] }));
    strictEqual(calls.join(","), "APIFY");
  });

  it("aggregates YouTube and Social evidence for HYBRID without leaking provider payloads", async () => {
    const youtube = { search: async () => ({ results: [{ videoId: "yt1", canonicalUrl: "https://www.youtube.com/watch?v=yt1", title: "YouTube fixture", description: "fixture", publishedAt: "2026-09-01T00:00:00Z", retrievedAt: "2026-09-02T00:00:00Z", query: "Egypt travel", quotaEstimate: 1 }], requestsMade: 0, quotaEstimate: 0, quotaSource: "fixture" }) };
    const router = createProductionResearchSourceRouter({ youtube, socialProviders: { APIFY: socialPort("APIFY", "ig1") } });
    const result = await router.execute({ mode: "HYBRID", query: "Egypt travel", platforms: ["YOUTUBE", "INSTAGRAM"] });
    strictEqual(result.sources.length, 2);
    strictEqual(result.sources.some((item) => item.provider === "APIFY"), true);
    strictEqual(Object.prototype.hasOwnProperty.call(result.sources[0], "actorId"), false);
    strictEqual(result.trendVerdict, "CANDIDATE_SIGNALS_ONLY");
  });
});
