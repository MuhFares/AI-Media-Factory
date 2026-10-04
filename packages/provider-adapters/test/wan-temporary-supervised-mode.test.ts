import { describe, it } from "node:test";
import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import {
  AUDITED_OWNER_MP4_IMPORT_POLICY,
  TEMPORARY_WAN_TIMING,
  classifyGenerationWait,
  classifySubmissionAck,
  evaluateTemporaryWanGenerateGate,
  ownerSuppliedWanJobEvidence,
} from "@ai-media-factory/provider-adapters";

const eligible = () => ({
  authenticatedOwner: true,
  projectId: "morroway",
  sceneId: "scene-1",
  sourceVisualApproved: true,
  executionAuthorizationId: "auth-scene-1",
  workerHealthy: true,
  workerBuildMatches: true,
  submissionAckTimeoutMs: 300_000,
  generationTimeoutMs: 900_000,
  unresolvedExecutionForScene: false,
  batchRequested: false,
});

describe("temporary supervised Wan policy", () => {
  it("A ACK arrives in 10 seconds", () => strictEqual(classifySubmissionAck(10_000, "job-a"), "ACKNOWLEDGED"));
  it("B ACK arrives after 45 seconds without a false 30s timeout", () => strictEqual(classifySubmissionAck(45_000, "job-b"), "ACKNOWLEDGED"));
  it("C ACK arrives after 180 seconds", () => strictEqual(classifySubmissionAck(180_000, "job-c"), "ACKNOWLEDGED"));
  it("D ACK arrives at 290 seconds", () => strictEqual(classifySubmissionAck(290_000, "job-d"), "ACKNOWLEDGED"));
  it("E ACK exceeds 300 seconds and requires manual reconciliation", () => strictEqual(classifySubmissionAck(300_001), "MANUAL_RECONCILIATION_REQUIRED"));
  it("F generation continues for 3.5 minutes after ACK", () => strictEqual(classifyGenerationWait(210_000, false), "GENERATING"));
  it("G generation at 10 minutes remains within the 15-minute limit", () => strictEqual(classifyGenerationWait(600_000, false), "GENERATING"));
  it("H ambiguous ACK policy allows one POST and no retry", () => {
    strictEqual(classifySubmissionAck(300_001), "MANUAL_RECONCILIATION_REQUIRED");
    const gate = evaluateTemporaryWanGenerateGate({ ...eligible(), unresolvedExecutionForScene: true });
    strictEqual(gate.maxNewVideoPosts, 1); strictEqual(gate.automaticRetryAllowed, false); strictEqual(gate.allowed, false);
  });
  it("I Owner Job-ID reconciliation issues no POST and preserves honest proof", () => {
    deepStrictEqual(ownerSuppliedWanJobEvidence("rp-job-1"), {
      classification: "OWNER_SUPPLIED_PROVIDER_JOB_ID",
      providerIdentityProof: "OWNER_ATTESTED_NOT_PROVIDER_VERIFIED",
      providerJobId: "rp-job-1",
      newVideoPosts: 0,
      additionalGenerationBudget: 0,
    });
    throws(() => ownerSuppliedWanJobEvidence(" "), /PROVIDER_JOB_ID_REQUIRED/);
  });
  it("J audited MP4 import consumes no second generation budget", () => {
    strictEqual(AUDITED_OWNER_MP4_IMPORT_POLICY.newVideoPosts, 0);
    strictEqual(AUDITED_OWNER_MP4_IMPORT_POLICY.additionalGenerationBudget, 0);
    ok(AUDITED_OWNER_MP4_IMPORT_POLICY.requiredEvidence.includes("SHA256"));
    ok(AUDITED_OWNER_MP4_IMPORT_POLICY.requiredEvidence.includes("SOURCE_VISUAL_LINEAGE"));
  });
  it("K duplicate Generate is blocked by an unresolved scene execution", () => {
    const result = evaluateTemporaryWanGenerateGate({ ...eligible(), unresolvedExecutionForScene: true });
    strictEqual(result.allowed, false); ok(result.reasons.includes("UNRESOLVED_SCENE_EXECUTION"));
  });
  it("L batch and unattended execution remain prohibited", () => {
    const result = evaluateTemporaryWanGenerateGate({ ...eligible(), batchRequested: true });
    strictEqual(result.allowed, false); ok(result.reasons.includes("BATCH_GENERATION_NOT_ALLOWED"));
    strictEqual(TEMPORARY_WAN_TIMING.submissionAckTimeoutMs, 300_000);
    strictEqual(TEMPORARY_WAN_TIMING.generationTimeoutMs, 900_000);
  });
});
