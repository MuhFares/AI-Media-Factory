/**
 * Temporary Owner-supervised Wan governance.
 *
 * This module is deliberately provider-free. It describes the policy that a
 * product action must satisfy before it is allowed to call the RunPod adapter;
 * it does not grant execution authority or persist an execution ledger.
 */

export const TEMPORARY_WAN_MODE = "TEMPORARY_GOVERNED_LEGACY_ENDPOINT" as const;
export const TEMPORARY_WAN_ENDPOINT = "ry49lc45y50ldy" as const;

export const TEMPORARY_WAN_TIMING = Object.freeze({
  submissionAckTimeoutMs: 300_000,
  generationTimeoutMs: 900_000,
  pollIntervalMs: 4_000,
  statusRequestTimeoutMs: 30_000,
  resultDownloadTimeoutMs: 120_000,
});

export type TemporaryWanExecutionState =
  | "SUBMITTED"
  | "ACKNOWLEDGED"
  | "GENERATING"
  | "COMPLETED"
  | "FAILED"
  | "MANUAL_RECONCILIATION_REQUIRED";

export interface TemporaryWanGenerateGate {
  authenticatedOwner: boolean;
  projectId?: string;
  sceneId?: string;
  sourceVisualApproved: boolean;
  executionAuthorizationId?: string;
  workerHealthy: boolean;
  workerBuildMatches: boolean;
  submissionAckTimeoutMs: number;
  generationTimeoutMs: number;
  unresolvedExecutionForScene: boolean;
  batchRequested: boolean;
}

export interface TemporaryWanGateResult {
  allowed: boolean;
  reasons: string[];
  maxNewVideoPosts: 1;
  automaticRetryAllowed: false;
}

export function evaluateTemporaryWanGenerateGate(input: TemporaryWanGenerateGate): TemporaryWanGateResult {
  const reasons: string[] = [];
  if (!input.authenticatedOwner) reasons.push("OWNER_AUTH_REQUIRED");
  if (!input.projectId?.trim()) reasons.push("PROJECT_REQUIRED");
  if (!input.sceneId?.trim()) reasons.push("EXACT_SCENE_REQUIRED");
  if (!input.sourceVisualApproved) reasons.push("SOURCE_VISUAL_APPROVAL_REQUIRED");
  if (!input.executionAuthorizationId?.trim()) reasons.push("EXECUTION_AUTHORIZATION_REQUIRED");
  if (!input.workerHealthy) reasons.push("WORKER_HEALTH_REQUIRED");
  if (!input.workerBuildMatches) reasons.push("WORKER_BUILD_PARITY_REQUIRED");
  if (input.submissionAckTimeoutMs < TEMPORARY_WAN_TIMING.submissionAckTimeoutMs) reasons.push("ACK_TIMEOUT_HARDENING_REQUIRED");
  if (input.generationTimeoutMs < TEMPORARY_WAN_TIMING.generationTimeoutMs) reasons.push("GENERATION_TIMEOUT_HARDENING_REQUIRED");
  if (input.unresolvedExecutionForScene) reasons.push("UNRESOLVED_SCENE_EXECUTION");
  if (input.batchRequested) reasons.push("BATCH_GENERATION_NOT_ALLOWED");
  return Object.freeze({ allowed: reasons.length === 0, reasons, maxNewVideoPosts: 1, automaticRetryAllowed: false });
}

/** Classifies time spent waiting for the POST response, not generation time. */
export function classifySubmissionAck(elapsedMs: number, jobId?: string): TemporaryWanExecutionState {
  if (elapsedMs > TEMPORARY_WAN_TIMING.submissionAckTimeoutMs || !jobId?.trim()) return "MANUAL_RECONCILIATION_REQUIRED";
  return "ACKNOWLEDGED";
}

/** Classifies time after a durable provider job id has been received. */
export function classifyGenerationWait(elapsedMs: number, completed: boolean): TemporaryWanExecutionState {
  if (completed) return "COMPLETED";
  return elapsedMs <= TEMPORARY_WAN_TIMING.generationTimeoutMs ? "GENERATING" : "FAILED";
}

export interface OwnerSuppliedWanJobEvidence {
  classification: "OWNER_SUPPLIED_PROVIDER_JOB_ID";
  providerIdentityProof: "OWNER_ATTESTED_NOT_PROVIDER_VERIFIED" | "PROVIDER_VERIFIED";
  providerJobId: string;
  newVideoPosts: 0;
  additionalGenerationBudget: 0;
}

export function ownerSuppliedWanJobEvidence(providerJobId: string, providerLookupSucceeded = false): OwnerSuppliedWanJobEvidence {
  if (!providerJobId.trim()) throw new Error("PROVIDER_JOB_ID_REQUIRED");
  return Object.freeze({
    classification: "OWNER_SUPPLIED_PROVIDER_JOB_ID",
    providerIdentityProof: providerLookupSucceeded ? "PROVIDER_VERIFIED" : "OWNER_ATTESTED_NOT_PROVIDER_VERIFIED",
    providerJobId: providerJobId.trim(),
    newVideoPosts: 0,
    additionalGenerationBudget: 0,
  });
}

export const AUDITED_OWNER_MP4_IMPORT_POLICY = Object.freeze({
  requiredEvidence: ["SHA256", "DIMENSIONS", "CODEC_CONTAINER", "DURATION", "SOURCE_VISUAL_LINEAGE", "OWNER_ATTESTED_JOB_ID"],
  newVideoPosts: 0,
  additionalGenerationBudget: 0,
});
