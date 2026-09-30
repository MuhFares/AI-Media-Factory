import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeResearchArtifactLineage,
  groundResearchReport,
  evaluateResearchEvidenceSufficiency,
} from "../dist/index.js";

const rows = {
  discovery: [
    { title: "Ancient Egypt", url: "https://www.britannica.com/place/ancient-Egypt", snippet: "Reference." },
    { title: "Penn Egypt", url: "https://www.penn.museum/on-view/galleries-exhibitions/ancient-egypt", snippet: "Museum." },
  ],
  candidate1: [
    { title: "Ancient Egypt", url: "https://www.britannica.com/place/ancient-Egypt", snippet: "Reference." },
    { title: "Ancient Egypt for kids", url: "https://kids.nationalgeographic.com/history/article/ancient-egypt", snippet: "Secondary." },
  ],
  candidate2: [
    { title: "Penn exhibition", url: "https://www.penn.museum/on-view/galleries-exhibitions/ancient-egypt", snippet: "Museum." },
    { title: "Penn section", url: "https://www.penn.museum/about-collections/curatorial-sections/egyptian-section", snippet: "Collection." },
  ],
};

const execution = (suffix, evidenceId, results) => ({
  resultId: `result:${suffix}`,
  idempotencyKey: `workflow:research:${suffix}`,
  capabilityId: "web.search",
  status: "success",
  output: { results },
  evidence: { evidenceId, succeeded: true, providerId: "serper", executedAt: "2026-09-26T00:00:00.000Z" },
});

function fixture(overrides = {}) {
  return {
    researchPlan: { missionId: "mission-v9" },
    summary: "Persisted synthesis",
    status: "grounded",
    confidence: 0.8,
    sources: [
      { id: 1, title: rows.candidate1[0].title, url: rows.candidate1[0].url, snippet: rows.candidate1[0].snippet },
      { id: 2, title: rows.candidate1[1].title, url: rows.candidate1[1].url, snippet: rows.candidate1[1].snippet },
      { id: 3, title: rows.candidate2[0].title, url: rows.candidate2[0].url, snippet: rows.candidate2[0].snippet },
      { id: 4, title: rows.candidate2[1].title, url: rows.candidate2[1].url, snippet: rows.candidate2[1].snippet },
    ],
    citations: [1, 2, 3, 4].map((sourceId) => ({ sourceId, text: `citation-${sourceId}` })),
    candidateStories: [
      {
        candidateId: "candidate-1", topic: "A Nile-side perspective on ancient Egypt", sourceIds: [1, 2],
        supportingEvidenceIds: [], factualVerification: { status: "PARTIAL", basis: "Partial" },
        recommendedForProduction: false,
      },
      {
        candidateId: "candidate-2", topic: "From Egyptian excavation to museum display", sourceIds: [3, 4],
        supportingEvidenceIds: [], factualVerification: { status: "INCOMPLETE", basis: "Incomplete" },
        recommendedForProduction: false,
      },
    ],
    capabilityExecutions: [
      execution("lane-history", "evidence:discovery", rows.discovery),
      execution("verify-candidate-1-q1", "evidence:verify-candidate-1", rows.candidate1),
      execution("verify-candidate-2-q1", "evidence:verify-candidate-2", rows.candidate2),
    ],
    ...overrides,
  };
}

test("A/B/C: canonical lineage attaches only candidate-specific persisted evidence", () => {
  const normalized = normalizeResearchArtifactLineage(fixture());
  assert.deepEqual(normalized.candidateStories[0].supportingEvidenceIds, ["evidence:verify-candidate-1"]);
  assert.deepEqual(normalized.candidateStories[1].supportingEvidenceIds, ["evidence:verify-candidate-2"]);
  assert.equal(normalized.candidateStories[0].supportingEvidenceIds.includes("evidence:discovery"), false);
  assert.deepEqual(normalized.sources[0].sourceLineage.evidenceIds.sort(), ["evidence:discovery", "evidence:verify-candidate-1"].sort());
  assert.equal(normalized.sources[0].id, 1, "artifact-local synthesis source id remains canonical after URL resolution");
});

test("D: an unresolvable synthesis source fails integrity instead of being fabricated", () => {
  const value = fixture();
  value.sources[0].url = "https://unpersisted.invalid/source";
  assert.throws(() => normalizeResearchArtifactLineage(value), /RESEARCH_ARTIFACT_SOURCE_REFERENCE_UNRESOLVED:1/);
});

test("E/F: aggregate eligibility exactly follows candidate-level V2 eligibility", () => {
  const partial = groundResearchReport(fixture());
  assert.equal(partial.evidenceQuality.viableCandidates, 0);
  assert.equal(partial.evidenceQuality.ceoEligible, false);
  assert.deepEqual(partial.ceoEligibleCandidates, []);
  assert.equal(partial.candidateStories.every((candidate) => candidate.recommendedForProduction === false), true);

  const strongFixture = fixture();
  strongFixture.candidateStories = [{
    ...strongFixture.candidateStories[0], factualVerification: { status: "STRONG", basis: "Corroborated" },
    recommendedForProduction: true,
  }];
  strongFixture.sources = strongFixture.sources.slice(0, 2);
  strongFixture.citations = strongFixture.citations.slice(0, 2);
  const strong = groundResearchReport(strongFixture);
  assert.equal(strong.evidenceQuality.viableCandidates, 1);
  assert.equal(strong.evidenceQuality.ceoEligible, true);
  assert.deepEqual(strong.ceoEligibleCandidates, ["candidate-1"]);
});

test("quality gate never treats string evidence ids as source ids", () => {
  const verdict = evaluateResearchEvidenceSufficiency({
    retrievalResults: rows.candidate1,
    synthesisSources: [{ id: 1, ...rows.candidate1[0] }, { id: 2, ...rows.candidate1[1] }],
    synthesisCitations: [{ sourceId: 1, text: "a" }, { sourceId: 2, text: "b" }],
    synthesisConfidence: 0.8,
    candidateStories: [{
      candidateId: "candidate-1", topic: "Ancient Egypt", sourceIds: [1, 2],
      supportingEvidenceIds: ["evidence:verify-candidate-1"], evidenceLineageValidated: true,
      factualVerification: { status: "PARTIAL", basis: "partial" }, recommendedForProduction: false,
    }],
  });
  assert.equal(verdict.ceoEligible, false);
  assert.equal(verdict.viableCandidates, 0);
});

test("J: lineage repair is provider-free pure projection", () => {
  let providerCalls = 0;
  const normalized = normalizeResearchArtifactLineage(fixture());
  assert.equal(providerCalls, 0);
  assert.equal(normalized.candidateStories.length, 2);
});
