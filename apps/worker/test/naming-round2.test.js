import assert from "node:assert/strict";
import test from "node:test";
import {
  NAMING_ROUND2_BATCH_MAX, NAMING_ROUND2_MODEL_ROUTES, ROUND1_REFERENCE_NAMES,
  assertRequestedModel, createIndependentStrategistInput, mergeRound2Candidates,
  planCrossEvaluationBatches, planLinguisticBatches, stableFingerprint,
  createRound2ArtifactEnvelope, nextRound2LifecycleStage, verifyRound2ArtifactReload,
  validateEvaluationBatch, validateLinguisticBatch, validateRound2Synthesis,
  validateStrategistCandidates, weightedScore,
} from "../dist/naming-round2.js";

// Synthetic fixtures only; these are not generated consumer-facing names.
const candidate = (model, n, name = `fixture-${model}-${n}`) => ({
  candidateId: `${model}-${n}`, name, territory: "fixture-territory", pronunciationHint: "fixture",
  oneLineRationale: "fixture", strategicConnection: "fixture", historicalPillarFit: "fixture",
  fantasyPillarFit: "fixture", masterBrandScalability: "fixture", knownConcern: "fixture",
  generationAgent: model === "CLAUDE" ? "NAMING_STRATEGIST_CLAUDE" : "NAMING_STRATEGIST_SOL",
  generationExecutionId: `execution-${model}-${n}`,
  generationModel: NAMING_ROUND2_MODEL_ROUTES[model].model,
});
const candidates = (model, count = 12) => Array.from({ length: count }, (_, index) => candidate(model, index + 1));
const scores = Object.freeze({ strategicFit: 10, memorability: 9, distinctiveness: 8, scalability: 7, pronunciationSpelling: 6, emotionalResonance: 5, visualBrandability: 4, crossPlatformSuitability: 3, discoverability: 2 });
const evaluation = (id) => ({ candidateId: id, name: "fixture", scores, hardFail: false, hardFailReason: null, primaryStrength: "compact fixture strength", primaryConcern: "compact fixture concern", benchmarkComparison: "COMPARABLE_TO_ROUND1_REFERENCE", benchmarkReason: "fixture comparison" });
const linguistic = (id) => ({ candidateId: id, pronunciationConcern: "none known", spellingConcern: "none known", culturalConcern: "none known", internationalUsability: "preliminary usable", semanticAssociation: "fixture", hardFail: false, hardFailReason: null });

test("exact authorized model identity and no substitution", () => {
  assert.equal(assertRequestedModel("CLAUDE", "claude-opus-4-8", "claude-opus-4-8").provider, "agentrouter-anthropic");
  assert.equal(assertRequestedModel("SOL", "gpt-5.6-sol", "gpt-5.6-sol").provider, "agentrouter-openai");
  assert.throws(() => assertRequestedModel("SOL", "gpt-5.6-sol", "other-model"), /ACTUAL_MODEL_MISMATCH/);
});

test("strategist input is independent and contains no peer candidate data", () => {
  const input = createIndependentStrategistInput({ workflowId: "workflow", correlationId: "correlation", namingBriefArtifactId: "brief", upstreamArtifactIds: ["ceo"], round1BenchmarkArtifactId: "r1", modelKey: "CLAUDE" });
  assert.equal(input.role, "NAMING_STRATEGIST_CLAUDE");
  assert.equal("candidateSet" in input, false);
  assert.deepEqual(input.benchmarkNames, [...ROUND1_REFERENCE_NAMES]);
});

test("strategist contracts bound volume, provenance, and hidden reasoning", () => {
  assert.equal(validateStrategistCandidates(candidates("CLAUDE"), "CLAUDE").length, 12);
  assert.throws(() => validateStrategistCandidates(candidates("CLAUDE", 11), "CLAUDE"), /candidate count/);
  const invalid = candidates("SOL"); invalid[0] = { ...invalid[0], reasoning_content: "forbidden" };
  assert.throws(() => validateStrategistCandidates(invalid, "SOL"), /hidden reasoning/);
});

test("merge removes Round 1 collisions, dedupes only normalized matches, and preserves convergence", () => {
  const claude = candidates("CLAUDE"); claude[0] = candidate("CLAUDE", 1, "Aeon"); claude[1] = candidate("CLAUDE", 2, "Shared Fixture");
  const sol = candidates("SOL"); sol[0] = candidate("SOL", 1, "shared-fixture");
  const merged = mergeRound2Candidates(claude, sol);
  assert.equal(merged.round1CollisionsRemoved, 1);
  assert.equal(merged.crossModelDuplicatesRemoved, 1);
  assert.deepEqual(merged.independentConvergenceNames, ["Shared Fixture"]);
  assert.equal(merged.candidates.find((item) => item.name === "Shared Fixture").independentConvergence, true);
});

test("Round 1 references are read-only inputs and merge never mutates them", () => {
  const before = [...ROUND1_REFERENCE_NAMES];
  mergeRound2Candidates(candidates("CLAUDE"), candidates("SOL"));
  assert.deepEqual(ROUND1_REFERENCE_NAMES, before);
  assert.throws(() => { ROUND1_REFERENCE_NAMES.push("mutate"); }, TypeError);
});

test("cross evaluation is opposite-model only and batches at ten", () => {
  const merged = mergeRound2Candidates(candidates("CLAUDE", 20), candidates("SOL", 20));
  const plan = planCrossEvaluationBatches(merged.candidates, "merged-artifact");
  assert.equal(plan.batches.length, 4);
  for (const batch of plan.batches) {
    assert.ok(batch.candidates.length <= NAMING_ROUND2_BATCH_MAX);
    assert.ok(batch.candidates.every((item) => !item.generationModels.includes(batch.evaluatorModel)));
  }
});

test("evaluation exact coverage rejects missing, duplicate, and unknown IDs", () => {
  const merged = mergeRound2Candidates(candidates("CLAUDE"), candidates("SOL")); const batch = planCrossEvaluationBatches(merged.candidates, "merged").batches[0];
  assert.equal(validateEvaluationBatch(batch, batch.expectedCandidateIds.map(evaluation)).length, batch.expectedCandidateIds.length);
  assert.throws(() => validateEvaluationBatch(batch, batch.expectedCandidateIds.slice(1).map(evaluation)), /coverage mismatch/);
  assert.throws(() => validateEvaluationBatch(batch, [...batch.expectedCandidateIds, batch.expectedCandidateIds[0]].map(evaluation)), /duplicates/);
  assert.throws(() => validateEvaluationBatch(batch, [...batch.expectedCandidateIds.slice(0, -1), "unknown"].map(evaluation)), /coverage mismatch/);
});

test("weighting is deterministic and JSONB-safe fingerprint ignores key order", () => {
  assert.equal(weightedScore(scores), 70.2);
  assert.equal(stableFingerprint({ b: [2, { z: 1, a: 3 }], a: 1 }), stableFingerprint({ a: 1, b: [2, { a: 3, z: 1 }] }));
});

test("artifact envelope validates immutable lineage, reload equality, and lifecycle gates", () => {
  const artifact = createRound2ArtifactEnvelope({ artifactId: "artifact", kind: "NamingRound2MergedCandidateSet", workflowId: "workflow", correlationId: "correlation", role: "NAMING_STRATEGIST_CLAUDE", executionId: "execution", provider: "agentrouter-anthropic", requestedModel: "claude-opus-4-8", actualModel: "claude-opus-4-8", parentArtifactIds: ["brief"], createdAt: "2026-09-09T00:00:00.000Z", payload: { z: 1, a: 2 } });
  verifyRound2ArtifactReload(artifact, { ...artifact, payload: { a: 2, z: 1 } });
  assert.throws(() => verifyRound2ArtifactReload(artifact, { ...artifact, correlationId: "other" }), /reload mismatch/);
  assert.throws(() => createRound2ArtifactEnvelope({ ...artifact, actualModel: "substituted-model" }), /ACTUAL_MODEL_MISMATCH/);
  assert.equal(nextRound2LifecycleStage("ROUND_2_PREPARED", "START_STRATEGISTS"), "ROUND_2_STRATEGISTS_RUNNING");
  assert.throws(() => nextRound2LifecycleStage("ROUND_2_PREPARED", "OWNER_GATE"), /invalid/);
});

test("linguistic coverage is batched exactly and has no external behavior", () => {
  const merged = mergeRound2Candidates(candidates("CLAUDE"), candidates("SOL")); const batches = planLinguisticBatches(merged.candidates);
  assert.equal(batches.length, 3); assert.ok(batches.every((batch) => batch.candidates.length <= 10));
  assert.equal(validateLinguisticBatch(batches[0], batches[0].expectedCandidateIds.map(linguistic)).length, 10);
  assert.throws(() => validateLinguisticBatch(batches[0], batches[0].expectedCandidateIds.slice(1).map(linguistic)), /coverage mismatch/);
});

test("synthesis limits outputs and preserves owner review authority", () => {
  const item = (sourceRound, index) => ({ name: `fixture-${index}`, ...(sourceRound === 2 ? { candidateId: `id-${index}` } : {}), sourceRound, generationModel: "fixture-model", territory: "fixture", weightedScore: 10, benchmarkComparison: "COMPARABLE_TO_ROUND1_REFERENCE", majorStrength: "fixture", majorConcern: "fixture", historicalFit: "fixture", fantasyFit: "fixture", masterBrandFit: "fixture", ownerStatus: "NOT_REVIEWED" });
  validateRound2Synthesis(Array.from({ length: 10 }, (_, index) => item(2, index)), Array.from({ length: 8 }, (_, index) => item(1, index)));
  assert.throws(() => validateRound2Synthesis(Array.from({ length: 11 }, (_, index) => item(2, index)), []), /at most 10/);
  assert.throws(() => validateRound2Synthesis([], [{ ...item(2, 1), ownerStatus: "APPROVED" }]), /NOT_REVIEWED/);
});
