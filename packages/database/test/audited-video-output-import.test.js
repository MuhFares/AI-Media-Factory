import test from "node:test";
import assert from "node:assert/strict";
import {
  AUDITED_VIDEO_RECOVERY_STATUS,
  InMemoryAuditedVideoOutputImportLedger,
  OWNER_ATTESTED_PROVIDER_PROOF,
  VERIFIED_LOCAL_OUTPUT_PROOF,
  validateAuditedVideoOutputImport,
} from "../dist/index.js";

const sha = "7da769d5b0f22cec1dc2e6c8e1b817822a9e6a550faa6047bdd753c538639c0e";
const outputSha = "b".repeat(64);
const input = {
  videoExecutionId: "video-canary-2f94234d481cefe0a56d09a2",
  filePath: "D:\\Owner\\wan-output.mp4",
  expectedProjectId: "morroway",
  expectedContentId: "content-mulk44ho-kih3gg",
  expectedWorkflowId: "wf-p4-canary-2b0da0ba762b65477107",
  expectedSceneId: "scene-001",
  expectedSourceVisualArtifactId: "art-scene-visual-b6796e3e71f4d8f7ce473bdf",
  expectedSourceVisualSha256: sha,
  ownerSuppliedProviderJobId: "a926f991-076f-4e36-bdb7-03cefc223cd8-e1",
  ownerAuthorizationRef: "owner-auth-future-explicit-import",
  ambiguityAcknowledgement: OWNER_ATTESTED_PROVIDER_PROOF,
};
const source = {
  workflowId: input.expectedWorkflowId, correlationId: "corr-p4-canary-91a7723e93f4253c0309",
  projectId: input.expectedProjectId, contentId: input.expectedContentId, sceneId: input.expectedSceneId,
  videoExecutionId: input.videoExecutionId, sourceVisualArtifactId: input.expectedSourceVisualArtifactId,
  sourceVisualSha256: sha, provider: "self-hosted-video", model: "wan2.2",
  providerJobId: input.ownerSuppliedProviderJobId, configurationFingerprint: "f".repeat(64),
  width: 480, height: 832, frameCount: 81, steps: 10, cfg: 2,
  originalSubmissionCount: 1, originalState: "RECONCILIATION_REQUIRED",
  videoBudgetLimit: 3, videoBudgetUsed: 1,
};
const technical = { path: input.filePath, bytes: 1024, sha256: outputSha, width: 480, height: 832, durationMs: 3375, codec: "h264", container: "mp4" };

test("A/H/I/J: valid owner-authorized output yields explicit ambiguity and local-only proof", () => {
  const receipt = validateAuditedVideoOutputImport(input, source, technical);
  assert.equal(receipt.recoveryStatus, AUDITED_VIDEO_RECOVERY_STATUS);
  assert.equal(receipt.providerIdentityProof, OWNER_ATTESTED_PROVIDER_PROOF);
  assert.equal(receipt.localOutputTechnicalProof, VERIFIED_LOCAL_OUTPUT_PROOF);
  assert.equal(receipt.videoBudgetAdditionalConsumption, 0);
});
test("B: wrong source visual hash fails closed", () => assert.throws(() => validateAuditedVideoOutputImport({ ...input, expectedSourceVisualSha256: "c".repeat(64) }, source, technical), /SOURCE_HASH_MISMATCH/));
test("C: wrong workflow or content fails closed", () => {
  assert.throws(() => validateAuditedVideoOutputImport({ ...input, expectedWorkflowId: "wrong" }, source, technical), /WORKFLOW_CONTENT_MISMATCH/);
  assert.throws(() => validateAuditedVideoOutputImport({ ...input, expectedContentId: "wrong" }, source, technical), /WORKFLOW_CONTENT_MISMATCH/);
});
test("C2: frozen Wan configuration drift fails closed", () => assert.throws(() => validateAuditedVideoOutputImport(input, { ...source, steps: 11 }, technical), /FROZEN_CONFIG_MISMATCH/));
test("D: corrupt or unprobed video fails closed", () => assert.throws(() => validateAuditedVideoOutputImport(input, source, { ...technical, bytes: 0, durationMs: 0 }), /TECHNICAL_PROOF_INVALID/));
test("E: exact replay is idempotent", () => { const ledger = new InMemoryAuditedVideoOutputImportLedger(); assert.equal(ledger.import(input, source, technical).outcome, "IMPORTED"); assert.equal(ledger.import(input, source, technical).outcome, "ALREADY_IMPORTED"); });
test("F: a different output for the same execution is blocked", () => { const ledger = new InMemoryAuditedVideoOutputImportLedger(); ledger.import(input, source, technical); assert.throws(() => ledger.import(input, source, { ...technical, sha256: "d".repeat(64) }), /IDEMPOTENCY_CONFLICT/); });
test("G: original accounting must be exactly one of three and import consumes zero", () => {
  assert.throws(() => validateAuditedVideoOutputImport(input, { ...source, videoBudgetUsed: 2 }, technical), /BUDGET_HISTORY_INVALID/);
  assert.equal(validateAuditedVideoOutputImport(input, source, technical).videoBudgetAdditionalConsumption, 0);
});
test("I: an import can never claim provider-verified identity", () => assert.notEqual(validateAuditedVideoOutputImport(input, source, technical).providerIdentityProof, "PROVIDER_VERIFIED"));
test("J: technical proof is mandatory before semantic review", () => assert.throws(() => validateAuditedVideoOutputImport(input, source, { ...technical, codec: "" }), /TECHNICAL_PROOF_INVALID/));
