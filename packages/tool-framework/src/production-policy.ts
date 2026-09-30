/**
 * Durable, provider-neutral production policy guards learned from the first
 * full media pilot. These are deliberately pure: orchestration, persistence,
 * and providers remain responsible for execution and evidence.
 */

export type ClosureDisposition = "PREVENTED" | "DETECTED_FAIL_CLOSED" | "HUMAN_GATED";

export interface ResearchEvidenceContract {
  claim: string;
  sourceIds: readonly string[];
  evidenceStatus: "VERIFIED" | "INSUFFICIENT" | "UNKNOWN";
  scientificReviewer: "PASS" | "FAIL" | "HUMAN_REVIEW_REQUIRED";
}

export interface SceneContract {
  sceneId: string;
  startMs: number;
  endMs: number;
  narrationText: string;
  visualPurpose: string;
  semanticAction: string;
  sourceArtifactIds: readonly string[];
  sourceProvenance: string;
  referenceContinuity: "PASS" | "FAIL" | "HUMAN_REVIEW_REQUIRED";
  motionReview: "PASS" | "FAIL" | "HUMAN_REVIEW_REQUIRED";
}

export interface FinalDeliveryContract {
  videoDurationMs: number;
  narrationDurationMs: number;
  narrationComplete: boolean;
  captions: "BURNED_IN" | "SIDECAR_ONLY" | "NONE";
  technicalQa: "PASS" | "FAIL";
  productReview: "PASS" | "CONDITIONAL" | "FAIL" | "HUMAN_REVIEW_REQUIRED";
  humanGate: "APPROVED" | "REJECTED" | "AWAITING_APPROVAL";
  publishingAuthorization: "AUTHORIZED" | "BLOCKED";
}

export interface ProviderAccountingContract {
  provider: string | null;
  model: string | null;
  costKind: "ACTUAL" | "ESTIMATED" | "FREE" | "UNKNOWN";
  costUsd: number | null;
  providerCallCount: number;
  duplicatePaidCalls: number;
  submissionState?: "CONFIRMED" | "UNKNOWN" | "RECONCILIATION_REQUIRED";
}

export function assertResearchEvidence(contract: ResearchEvidenceContract): void {
  if (!contract.claim.trim() || contract.sourceIds.length === 0 || contract.evidenceStatus !== "VERIFIED") {
    throw new Error("RESEARCH_EVIDENCE_INSUFFICIENT");
  }
  if (contract.scientificReviewer === "FAIL") throw new Error("RESEARCH_SCIENTIFIC_REVIEW_FAILED");
}

export function assertSceneContract(contract: SceneContract): void {
  if (!contract.sceneId.trim() || !contract.narrationText.trim() || !contract.visualPurpose.trim() || !contract.semanticAction.trim()) {
    throw new Error("SCENE_CONTRACT_INCOMPLETE");
  }
  if (!Number.isSafeInteger(contract.startMs) || !Number.isSafeInteger(contract.endMs) || contract.startMs < 0 || contract.endMs <= contract.startMs) {
    throw new Error("SCENE_TIMING_INVALID");
  }
  if (contract.sourceArtifactIds.length === 0 || !contract.sourceProvenance.trim()) throw new Error("SCENE_LINEAGE_INCOMPLETE");
  if (contract.referenceContinuity === "FAIL" || contract.motionReview === "FAIL") throw new Error("SCENE_REVIEW_FAILED");
}

export function assertProviderAccounting(contract: ProviderAccountingContract): void {
  if (contract.providerCallCount < 0 || contract.duplicatePaidCalls < 0 || contract.duplicatePaidCalls > contract.providerCallCount) throw new Error("PROVIDER_CALL_ACCOUNTING_INVALID");
  if (contract.costKind === "UNKNOWN" && contract.costUsd !== null) throw new Error("UNKNOWN_COST_MUST_BE_NULL");
  if (contract.costKind !== "UNKNOWN" && (contract.costUsd === null || !Number.isFinite(contract.costUsd) || contract.costUsd < 0)) throw new Error("KNOWN_COST_REQUIRED");
  if (contract.submissionState === "UNKNOWN" || contract.submissionState === "RECONCILIATION_REQUIRED") throw new Error("PROVIDER_RECONCILIATION_REQUIRED");
}

export function evaluateFinalDelivery(contract: FinalDeliveryContract): ClosureDisposition {
  if (!contract.narrationComplete || contract.narrationDurationMs <= 0 || contract.videoDurationMs <= 0) return "DETECTED_FAIL_CLOSED";
  if (contract.captions !== "BURNED_IN" || contract.technicalQa === "FAIL") return "DETECTED_FAIL_CLOSED";
  if (contract.productReview === "FAIL" || contract.humanGate === "REJECTED" || contract.publishingAuthorization !== "BLOCKED") return "DETECTED_FAIL_CLOSED";
  if (contract.productReview === "HUMAN_REVIEW_REQUIRED" || contract.humanGate === "AWAITING_APPROVAL") return "HUMAN_GATED";
  return "PREVENTED";
}

export function assertNoExternalCalls(actual: { research: number; image: number; tts: number; wan: number; composer: number; publishing: number }): void {
  if (Object.values(actual).some((count) => !Number.isSafeInteger(count) || count < 0)) throw new Error("CALL_COUNT_INVALID");
}
