import test from "node:test";
import assert from "node:assert/strict";
import {
  ARTIFACT_CONTRACT_REGISTRY,
  CANONICAL_DIRECTIVE_STAGE_IDS,
  CANONICAL_STAGE_CATALOG,
  ArtifactContractError,
  assertCanonicalStageCatalog,
  assertDirectiveOperational,
  decideCeoResearchMode,
  validateArtifactContract,
} from "../dist/index.js";

const artifact = (kind, payload, overrides = {}) => ({
  artifactId: `art-${kind}`, kind, producerAgent: "fixture", workflowId: "wf-foundation",
  correlationId: "corr-foundation", status: "completed", payload,
  contentType: "application/json", schemaVersion: "1", createdAt: "2026-09-27T00:00:00.000Z",
  parentArtifact: { artifactId: "art-parent", kind: "research_report" }, ...overrides,
});

test("A/B/C: catalog is consistent, every operational stage resolves, and critical kinds have runtime contracts", () => {
  assert.doesNotThrow(assertCanonicalStageCatalog);
  for (const ids of Object.values(CANONICAL_DIRECTIVE_STAGE_IDS)) for (const id of ids) assert.ok(CANONICAL_STAGE_CATALOG[id]);
  for (const definition of Object.values(CANONICAL_STAGE_CATALOG)) if (definition.outputArtifactKind) assert.equal(ARTIFACT_CONTRACT_REGISTRY[definition.outputArtifactKind]?.authority, "CANONICAL", `${definition.stageId} output has a canonical runtime contract`);
  for (const kind of ["research_report", "ceo_recommendation", "evidence_backed_content_brief", "hook_concepts", "writer_report", "scene_plan", "visual_direction_contract"]) assert.ok(ARTIFACT_CONTRACT_REGISTRY[kind]);
});

test("D: adjacent canonical producer outputs validate for their declared consumers", () => {
  validateArtifactContract({ artifact: artifact("research_report", { summary: "Grounded", candidateStories: [] }, { parentArtifact: undefined }), consumerStage: "ceo-recommendation" });
  validateArtifactContract({ artifact: artifact("ceo_recommendation", { decision: "ADVANCE", rationale: "Strong evidence", eligibleCandidateIds: ["c1"], warnings: [] }), consumerStage: "planner-synthesis" });
  validateArtifactContract({ artifact: artifact("evidence_backed_content_brief", { objective: "Produce", finalAngle: "Angle", claims: [], evidenceRefs: [], hookDirection: "Lead with the verified contrast", writerInstructions: [] }), consumerStage: "writer" });
  validateArtifactContract({ artifact: artifact("writer_report", { title: "Title", content: "Body" }), consumerStage: "scenes" });
  validateArtifactContract({ artifact: artifact("scene_plan", { scenes: [{ sceneId: "scene-1" }] }), consumerStage: "visual-direction" });
  validateArtifactContract({ artifact: artifact("visual_direction_contract", { scenes: [{ sceneId: "scene-1" }] }), consumerStage: "scene-image" });
});

test("E/F/K: Hooks and visual plan are legacy-read-only; canonical visual output is the contract; legacy media cannot be newly validated", () => {
  assert.equal(ARTIFACT_CONTRACT_REGISTRY.hook_concepts.authority, "LEGACY_READ_ONLY");
  assert.equal(ARTIFACT_CONTRACT_REGISTRY.visual_direction_plan.authority, "LEGACY_READ_ONLY");
  assert.equal(CANONICAL_STAGE_CATALOG["visual-direction"].outputArtifactKind, "visual_direction_contract");
  for (const kind of ["hook_concepts", "visual_direction_plan", "thumbnail_report", "video_report"]) assert.throws(() => validateArtifactContract({ artifact: artifact(kind, { scenes: [] }) }), /LEGACY_READ_ONLY/);
});

test("G/H/I: CEO research modes distinguish strong, partial, and honest-empty evidence", () => {
  assert.deepEqual(decideCeoResearchMode({ candidateStories: [{ candidateId: "c1", factualVerification: "STRONG", recommendedForProduction: true, supportingEvidenceIds: ["e1"], evidenceLineageValidated: true }] }), { decision: "ADVANCE", eligibleCandidateIds: ["c1"] });
  assert.deepEqual(decideCeoResearchMode({ candidateStories: [{ candidateId: "c1", factualVerification: "PARTIAL", recommendedForProduction: false, supportingEvidenceIds: ["e1"] }] }), { decision: "RETURN_TO_OWNER", eligibleCandidateIds: [] });
  assert.deepEqual(decideCeoResearchMode({ evidenceStatus: "INSUFFICIENT_EVIDENCE", candidateStories: [] }), { decision: "NO_PRODUCTION_CANDIDATE", eligibleCandidateIds: [] });
});

test("J: unsupported or retired directives fail before submission", () => {
  for (const directive of ["plan", "research", "implement", "verify", "ship", "unknown"]) assert.throws(() => assertDirectiveOperational(directive), /DIRECTIVE_(?:RETIRED|UNSUPPORTED|NOT_OPERATIONAL)/);
  assert.doesNotThrow(() => assertDirectiveOperational("produce"));
  assert.doesNotThrow(() => assertDirectiveOperational("produce-pre-media"));
});

test("L: conflicting runtime identity fails closed and semantic fields are never repaired", () => {
  assert.throws(() => validateArtifactContract({ artifact: artifact("writer_report", { workflowId: "wrong", title: "T", content: "B" }) }), (error) => error instanceof ArtifactContractError && /RUNTIME_IDENTITY_CONFLICT/.test(error.message));
  assert.throws(() => validateArtifactContract({ artifact: artifact("writer_report", { title: "", content: "B" }) }), /MISSING_SEMANTIC_FIELD/);
});
