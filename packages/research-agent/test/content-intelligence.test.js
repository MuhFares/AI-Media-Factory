import { describe, it } from "node:test";
import { deepStrictEqual, strictEqual, throws } from "node:assert";
import { assertProjectLocalPath, canonicalizeResearchUrl, freshnessSatisfied, normalizeEvidence, normalizeSearchEvidence, newsEvidenceEligible, researchSurfacePlan } from "../dist/index.js";

describe("content intelligence contracts", () => {
  it("canonicalizes URLs and removes tracking parameters", () => strictEqual(canonicalizeResearchUrl("https://example.com/a?utm_source=x&id=7#section"), "https://example.com/a?id=7"));
  it("enforces freshness without treating old evidence as recent", () => {
    const now = new Date("2026-09-01T12:00:00Z");
    strictEqual(freshnessSatisfied("2026-09-01T11:00:00Z", "LAST_24_HOURS", now), true);
    strictEqual(freshnessSatisfied("2026-08-01T11:00:00Z", "LAST_24_HOURS", now), false);
  });
  it("normalizes evidence while retaining unknown fields", () => {
    const e = normalizeEvidence({ evidenceId: "e1", sourceType: "REFERENCE_URL", platform: "YOUTUBE", accessMethod: "PUBLIC", retrievedAt: "2026-09-01T00:00:00Z", sourceUrl: "https://youtube.com/watch?v=1#x" });
    strictEqual(e.canonicalUrl, "https://youtube.com/watch?v=1");
    strictEqual(e.kind, "UNKNOWN");
  });
  it("rejects paths outside the project and relative paths", () => {
    throws(() => assertProjectLocalPath("D:/repo", "D:/other/video.mp4"), /inside the project/);
    throws(() => assertProjectLocalPath("D:/repo", "video.mp4"), /inside the project/);
  });
  it("routes modes centrally and enforces dated news freshness", () => {
    deepStrictEqual(researchSurfacePlan("TREND_RESEARCH"), ["GENERIC_WEB", "YOUTUBE"]);
    const e = normalizeSearchEvidence({ evidenceId: "n1", title: "News", url: "https://example.com/news", platform: "GENERIC_WEB", sourceType: "NEWS", publishedAt: "2026-09-01T11:00:00Z" });
    strictEqual(newsEvidenceEligible(e, "LAST_24_HOURS", new Date("2026-09-01T12:00:00Z")), true);
    strictEqual(newsEvidenceEligible(e, "LAST_24_HOURS", new Date("2026-09-03T12:00:00Z")), false);
  });
});
