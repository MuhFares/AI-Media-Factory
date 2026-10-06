import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeResearchArtifactLineage,
  evaluateResearchEvidenceSufficiency,
} from "../dist/index.js";
import {
  CANARY14_SYNTHESIS,
  CANARY14_CAPABILITY_EXECUTIONS,
  canary14LineageInput,
} from "../../../packages/research-agent/test/fixtures/canary-14-evidence-lineage.js";

test("Canary-14 frozen replay reproduces unresolved candidate evidence lineage", () => {
  const normalized = normalizeResearchArtifactLineage(canary14LineageInput());
  const candidate = normalized.candidateStories[0];
  assert.equal(CANARY14_SYNTHESIS.candidateStories[0].recommendedForProduction, true);
  assert.equal(CANARY14_SYNTHESIS.candidateStories[0].factualVerification.status, "STRONG");
  assert.deepEqual(CANARY14_SYNTHESIS.candidateStories[0].supportingEvidenceIds, ["evidence-1", "evidence-2"]);
  assert.deepEqual(candidate.supportingEvidenceIds, []);
  assert.equal(candidate.evidenceLineageValidated, false);

  const results = CANARY14_CAPABILITY_EXECUTIONS.flatMap((entry) => entry.output.results);
  const verdict = evaluateResearchEvidenceSufficiency({
    retrievalResults: results,
    synthesisSources: normalized.sources,
    synthesisConfidence: normalized.confidence,
    synthesisCitations: normalized.citations,
    candidateStories: normalized.candidateStories,
    synthesisStatus: normalized.status,
  });
  assert.equal(verdict.viableCandidates, 0);
  assert.equal(verdict.ceoEligible, false);
  assert.ok(verdict.reasons.includes("CANDIDATE_WITHOUT_VALIDATED_EVIDENCE_LINEAGE"));
});

test("Canary-14 model-authored supporting evidence ids do not resolve to persisted evidence", () => {
  const available = new Set(CANARY14_CAPABILITY_EXECUTIONS.map((entry) => entry.evidence.evidenceId));
  assert.deepEqual(
    CANARY14_SYNTHESIS.candidateStories[0].supportingEvidenceIds.filter((id) => available.has(id)),
    [],
  );
});

function matrixFixture({ candidateCount = 1, verification = "valid", duplicate = false } = {}) {
  const sourceA = { id: 1, title: "Museum", url: "https://museum.example/item", snippet: "Primary record" };
  const sourceB = { id: 2, title: "University", url: "https://university.example/item", snippet: "Scholarly record" };
  const candidate = (index) => ({
    candidateId: `candidate-${index}`, topic: `Candidate ${index}`, sourceIds: [1, 2],
    supportingEvidenceIds: verification === "missing" ? [] : [verification === "url" ? sourceA.url : `evidence:verify-${index}`],
    factualVerification: { status: "STRONG", basis: "Corroborated" }, recommendedForProduction: true,
  });
  const executions = [{
    resultId: "result:discovery", idempotencyKey: "discovery", capabilityId: "web.search", status: "success",
    output: { results: [sourceA, sourceB] }, evidence: { evidenceId: "evidence:discovery", succeeded: true },
  }];
  if (verification !== "none") {
    for (let index = 1; index <= candidateCount; index += 1) {
      executions.push({
        resultId: `result:verification-candidate-${index}`,
        idempotencyKey: `verification-candidate-${index}`,
        capabilityId: "web.search", status: "success",
        output: { results: verification === "wrong-source" ? [{ url: "https://other.example/item" }] : [sourceA, sourceB] },
        evidence: { evidenceId: `evidence:verify-${index}`, succeeded: true },
      });
      if (duplicate) executions.push(structuredClone(executions.at(-1)));
    }
  }
  return {
    researchPlan: { missionId: "matrix" }, status: "grounded", confidence: 0.9,
    sources: [sourceA, sourceB], citations: [{ sourceId: 1, text: "a" }, { sourceId: 2, text: "b" }],
    candidateStories: Array.from({ length: candidateCount }, (_, i) => candidate(i + 1)), capabilityExecutions: executions,
  };
}

test("adversarial A-L lineage normalization remains exact and fail-closed", () => {
  const valid = normalizeResearchArtifactLineage(matrixFixture());
  assert.equal(valid.candidateStories[0].evidenceLineageValidated, true, "A one valid evidence id");

  const multipleFixture = matrixFixture();
  multipleFixture.capabilityExecutions.push({
    resultId: "result:verification-candidate-1:second", idempotencyKey: "verification-candidate-1:second",
    capabilityId: "web.search", status: "success", output: { results: multipleFixture.sources },
    evidence: { evidenceId: "evidence:verify-1-second", succeeded: true },
  });
  assert.deepEqual(normalizeResearchArtifactLineage(multipleFixture).candidateStories[0].supportingEvidenceIds.sort(), ["evidence:verify-1", "evidence:verify-1-second"].sort(), "B multiple valid ids");

  for (const [label, fixture] of [
    ["C invalid id/no persisted verification", matrixFixture({ verification: "none" })],
    ["G valid id but wrong source", matrixFixture({ verification: "wrong-source" })],
    ["H missing model ids does not fabricate lineage", matrixFixture({ verification: "none" })],
    ["I evidence associated to another source", matrixFixture({ verification: "wrong-source" })],
    ["K URL is not an evidence identity", matrixFixture({ verification: "none" })],
  ]) {
    const normalized = normalizeResearchArtifactLineage(fixture);
    assert.equal(normalized.candidateStories[0].evidenceLineageValidated, false, label);
  }

  const duplicated = normalizeResearchArtifactLineage(matrixFixture({ duplicate: true }));
  assert.deepEqual(duplicated.candidateStories[0].supportingEvidenceIds, ["evidence:verify-1"], "E duplicate persisted identity is deterministically deduplicated");

  const sharedSources = normalizeResearchArtifactLineage(matrixFixture({ candidateCount: 2 }));
  assert.equal(sharedSources.candidateStories.every((candidate) => candidate.evidenceLineageValidated), true, "L candidates may share sources but retain distinct verification evidence identities");
});
