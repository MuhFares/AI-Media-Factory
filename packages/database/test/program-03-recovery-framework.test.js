import test from "node:test";
import assert from "node:assert/strict";
import {
  RECOVERY_MODES, RECOVERY_MODE_REGISTRY, freezeRecoveryContext,
  assertFrozenRecoveryContext, assertRecoveryHorizon, validateDurableId,
  createArtifactRevision, authorizeAuditedInPlaceRepair, classifyRecoveryState,
  evaluateRecoveryRetryBudget,
  assertLegacyWorkRunnerDatabaseTarget,
} from "../dist/index.js";
import { assertLegacyUnsafeRunnerAllowed } from "../../../scripts/legacy-unsafe-runner-guard.mjs";

const frozenInput = {
  mode: "REVISION", authorizationId: "auth-1", idempotencyKey: "idem-1",
  projectId: "project-1", workflowId: "wf-1", sourceExecutionId: "execution-1",
  frozenArtifactIds: ["art-brief", "art-review"], authorizedBy: "owner",
  authorizedAt: "2026-09-27T00:00:00.000Z", budgetEnvelope: { text_agent: 2 },
};

test("A: all canonical modes use the shared lifecycle registry", () => {
  assert.deepEqual(Object.keys(RECOVERY_MODE_REGISTRY).sort(), [...RECOVERY_MODES].sort());
});
test("B: revision policy preserves research/planning and restarts writer", () => {
  const p = RECOVERY_MODE_REGISTRY.REVISION;
  assert.equal(p.rewindTarget, "writer"); assert.ok(p.preservedStages.includes("research"));
});
test("C: review resume preserves frozen writer/seo/brand", () => {
  assert.deepEqual(RECOVERY_MODE_REGISTRY.REVIEW_RESUME.preservedStages.slice(-3), ["writer", "seo", "brand"]);
});
test("D: media resume policy uses media preflight and forbids upstream rewinds", () => {
  const p = RECOVERY_MODE_REGISTRY.MEDIA_RESUME; assert.equal(p.preflightPolicy, "MEDIA"); assert.ok(p.forbiddenStages.includes("research"));
});
test("E: targeted verification never rewinds Research discovery", () => {
  const p = RECOVERY_MODE_REGISTRY.TARGETED_VERIFICATION; assert.equal(p.rewindTarget, null); assert.ok(p.forbiddenStages.includes("research-discovery"));
});
test("F: targeted reevaluation recovery is retrieval-free", () => {
  const p = RECOVERY_MODE_REGISTRY.TARGETED_REEVALUATION_RECOVERY; assert.ok(p.forbiddenStages.includes("web.search")); assert.equal(p.budgetCallKind, "TEXT_AGENT");
});
test("G: visual iteration preserves approved upstream lineage", () => {
  assert.ok(RECOVERY_MODE_REGISTRY.VISUAL_ITERATION.preservedStages.includes("visual-prompt"));
});
test("H: rewind horizon rejects forbidden or broader rewinds", () => {
  assert.doesNotThrow(() => assertRecoveryHorizon("REVISION", "writer", ["planner-initial", "research", "planner-synthesis"], ["writer"]));
  assert.throws(() => assertRecoveryHorizon("REVISION", "research", ["research"], ["research"]), /OUTSIDE_POLICY/);
});
test("I: frozen lineage fingerprint detects drift", () => {
  const frozen = freezeRecoveryContext(frozenInput, "recovery-1");
  assert.doesNotThrow(() => assertFrozenRecoveryContext(frozen, frozenInput));
  assert.throws(() => assertFrozenRecoveryContext(frozen, { ...frozenInput, workflowId: "wf-2" }), /FROZEN_CONTEXT_DRIFT/);
});
test("J: runtime and provider ID namespaces are distinct", () => {
  assert.doesNotThrow(() => validateDurableId("RUNTIME_OWNED_ID", "art-runtime-1"));
  assert.throws(() => validateDurableId("RUNTIME_OWNED_ID", "model-candidate-one"), /NOT_CANONICAL/);
  assert.throws(() => validateDurableId("PROVIDER_EXTERNAL_ID", "art-runtime-1"), /NAMESPACE_CONFLICT/);
});
test("K: immutable artifact revision carries parent, hash and revision identity", () => {
  const revision = createArtifactRevision({ artifactId: "art-2", revisionOf: "art-1", revisionNumber: 2, parentArtifactIds: ["art-1"], sourceArtifactIds: ["art-source"], priorPayloadHash: "old", producerExecutionId: "recovery-1", createdAt: "2026-09-27T00:00:00.000Z", payload: { ok: true } });
  assert.equal(revision.mutationMode, "IMMUTABLE_REVISION"); assert.equal(revision.revisionOf, "art-1"); assert.notEqual(revision.payloadHash, "old");
});
test("L: audited in-place repair requires complete owner receipt", () => {
  assert.doesNotThrow(() => authorizeAuditedInPlaceRepair({ authorization: "OWNER_APPROVED", repairReason: "canonical ID repair", repairExecutionId: "repair-1", oldHash: "a", newHash: "b", changedFields: ["supportingEvidenceIds"], timestamp: "2026-09-27T00:00:00.000Z" }));
  assert.throws(() => authorizeAuditedInPlaceRepair({ authorization: "OWNER_APPROVED", repairReason: "", repairExecutionId: "repair-1", oldHash: "a", newHash: "a", changedFields: [], timestamp: "bad" }), /CONTRACT_INVALID/);
});
test("M: PAUSED without action is a conflict", () => {
  const v = classifyRecoveryState({ workflowState: "PAUSED", submissionStatus: "bounded_stop", jobStatus: "succeeded", ownerActionCount: 0 });
  assert.equal(v.classification, "STATE_CONFLICT"); assert.ok(v.codes.includes("PAUSED_WITHOUT_OWNER_ACTION"));
});
test("N: completed step with invalid artifact is a conflict", () => {
  assert.ok(classifyRecoveryState({ workflowState: "PAUSED", submissionStatus: null, jobStatus: null, ownerActionCount: 1, completedStepArtifactValid: false }).codes.includes("COMPLETED_STEP_INVALID_ARTIFACT"));
});
test("O: authorization without dispatch is detectable", () => {
  assert.ok(classifyRecoveryState({ workflowState: "PAUSED", submissionStatus: null, jobStatus: null, ownerActionCount: 1, authorizationExists: true, dispatchExists: false }).codes.includes("AUTHORIZATION_WITHOUT_DISPATCH"));
});
test("P: terminal job with running workflow is a conflict", () => {
  assert.ok(classifyRecoveryState({ workflowState: "RUNNING", submissionStatus: "running", jobStatus: "failed", ownerActionCount: 0 }).codes.includes("TERMINAL_JOB_RUNNING_WORKFLOW"));
});
test("Q: running job with terminal workflow is a conflict", () => {
  assert.ok(classifyRecoveryState({ workflowState: "COMPLETED", submissionStatus: "completed", jobStatus: "running", ownerActionCount: 0 }).codes.includes("RUNNING_JOB_TERMINAL_WORKFLOW"));
});
test("R: revision without lifecycle reconciliation is a conflict", () => {
  assert.ok(classifyRecoveryState({ workflowState: "PAUSED", submissionStatus: null, jobStatus: null, ownerActionCount: 1, revisionExists: true, lifecycleReconciled: false }).codes.includes("REVISION_WITHOUT_LIFECYCLE_RECONCILIATION"));
});
test("W: insufficient retry capacity requires explicit Owner action", () => {
  assert.deepEqual(evaluateRecoveryRetryBudget({ required: 2, remaining: 1, sameExecutionReplay: false, ambiguousExternalSideEffect: false }).action, "OWNER_CAPACITY_AUTHORIZATION_REQUIRED");
});
test("X: exact replay does not reserve or double consume", () => {
  assert.equal(evaluateRecoveryRetryBudget({ required: 1, remaining: 0, sameExecutionReplay: true, ambiguousExternalSideEffect: false }).action, "NO_BUDGET_REQUIRED");
});
test("Y: ambiguous external side effect never auto-retries", () => {
  const v = evaluateRecoveryRetryBudget({ required: 1, remaining: 9, sameExecutionReplay: false, ambiguousExternalSideEffect: true });
  assert.equal(v.allowed, false); assert.match(v.reason, /RECONCILIATION_REQUIRED/);
});
test("Z: legacy unsafe runner is fail-closed and test-only", () => {
  assert.throws(() => assertLegacyUnsafeRunnerAllowed("legacy", {}), /QUARANTINED/);
  assert.throws(() => assertLegacyUnsafeRunnerAllowed("legacy", { AMF_ALLOW_LEGACY_UNSAFE_RUNNER: "YES", DATABASE_URL: "postgresql://localhost/amf" }), /PRODUCTION_DATABASE_FORBIDDEN/);
  assert.doesNotThrow(() => assertLegacyUnsafeRunnerAllowed("legacy", { AMF_ALLOW_LEGACY_UNSAFE_RUNNER: "YES", TEST_DATABASE_URL: "postgresql://localhost/amf_test" }));
  assert.throws(() => assertLegacyWorkRunnerDatabaseTarget("D:/repo/work/direct-writer.mjs", "postgresql://localhost/amf", {}), /QUARANTINED/);
  assert.throws(() => assertLegacyWorkRunnerDatabaseTarget("D:/repo/work/direct-writer.mjs", "postgresql://localhost/amf", { AMF_ALLOW_LEGACY_UNSAFE_RUNNER: "YES" }), /PRODUCTION_DATABASE_FORBIDDEN/);
  assert.doesNotThrow(() => assertLegacyWorkRunnerDatabaseTarget("D:/repo/work/direct-writer.mjs", "postgresql://localhost/amf_test", { AMF_ALLOW_LEGACY_UNSAFE_RUNNER: "YES" }));
  assert.doesNotThrow(() => assertLegacyWorkRunnerDatabaseTarget("D:/repo/apps/worker/dist/cli.js", "postgresql://localhost/amf", {}));
});
