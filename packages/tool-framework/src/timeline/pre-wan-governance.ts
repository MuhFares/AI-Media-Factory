/** Provider-neutral, fail-closed pre-Wan governance contracts. */

export interface GeneratedVisualArtifact {
  artifactId: string;
  sceneId: string;
  artifactPathOrReference: string;
  provider: string;
  generationId: string;
  sha256?: string;
  width?: number;
  height?: number;
  integrityStatus: "VALID" | "INVALID" | "UNKNOWN";
}

export interface VisualSemanticReview {
  artifactId: string;
  sceneId: string;
  verdict: "PASS" | "FAIL" | "HUMAN_REVIEW_REQUIRED" | "UNAVAILABLE";
  automated: boolean;
  alignment: "PASS" | "FAIL" | "UNKNOWN";
  reviewer: string;
}

export interface VisualTechnicalQA {
  artifactId: string;
  sceneId: string;
  verdict: "PASS" | "FAIL" | "HUMAN_REVIEW_REQUIRED" | "UNAVAILABLE";
  fileExists: boolean;
  decodable: boolean;
  dimensionsValid: boolean;
  advancedChecks: "NOT_AUTOMATED" | "PASS" | "FAIL";
}

export interface HumanVisualApproval {
  approvalId: string;
  workflowId: string;
  sceneId: string;
  artifactId: string;
  artifactSha256?: string;
  outcome: "APPROVED" | "REJECTED" | "REQUEST_REGENERATION";
  decidedAt: string;
  approver: string;
}

export interface WanAuthorization {
  authorizationId: string;
  workflowId: string;
  sceneId: string;
  artifactId: string;
  artifactSha256?: string;
  semanticVerdict: "PASS";
  technicalVerdict: "PASS";
  humanApprovalId: string;
  authorizedAt: string;
  policyVersion: string;
}

export type PreWanDecision = "WAN_AUTHORIZED" | "HUMAN_REVIEW_REQUIRED" | "BLOCKED";

export function evaluatePreWanGovernance(
  semantic: VisualSemanticReview,
  technical: VisualTechnicalQA,
  human?: HumanVisualApproval,
): PreWanDecision {
  if (semantic.verdict === "FAIL" || technical.verdict === "FAIL") return "BLOCKED";
  if (semantic.verdict !== "PASS" || technical.verdict !== "PASS") return "HUMAN_REVIEW_REQUIRED";
  if (human === undefined) return "HUMAN_REVIEW_REQUIRED";
  return human.outcome === "APPROVED" ? "WAN_AUTHORIZED" : "BLOCKED";
}

export function issueWanAuthorization(input: {
  workflowId: string; artifact: GeneratedVisualArtifact; semantic: VisualSemanticReview;
  technical: VisualTechnicalQA; human: HumanVisualApproval;
}): WanAuthorization {
  if (input.artifact.sceneId !== input.semantic.sceneId || input.artifact.sceneId !== input.technical.sceneId || input.artifact.sceneId !== input.human.sceneId) throw new Error("WAN authorization scene identity mismatch");
  if (input.semantic.artifactId !== input.artifact.artifactId || input.technical.artifactId !== input.artifact.artifactId || input.human.artifactId !== input.artifact.artifactId) throw new Error("WAN authorization artifact identity mismatch");
  if (input.semantic.verdict !== "PASS" || input.technical.verdict !== "PASS" || input.human.outcome !== "APPROVED") throw new Error("WAN authorization requires semantic PASS, technical PASS, and human approval");
  return { authorizationId: `wan-auth-${input.workflowId}-${input.artifact.sceneId}-${input.artifact.artifactId}`, workflowId: input.workflowId, sceneId: input.artifact.sceneId, artifactId: input.artifact.artifactId, ...(input.artifact.sha256 === undefined ? {} : { artifactSha256: input.artifact.sha256 }), semanticVerdict: "PASS", technicalVerdict: "PASS", humanApprovalId: input.human.approvalId, authorizedAt: new Date().toISOString(), policyVersion: "pre-wan-v1" };
}

export function validateWanAuthorization(input: { workflowId: string; artifact: GeneratedVisualArtifact; authorization?: WanAuthorization }): { ok: true } | { ok: false; code: "MISSING_WAN_AUTHORIZATION" | "BLOCKED_STALE_APPROVAL" | "INVALID_WAN_AUTHORIZATION"; reason: string } {
  const auth = input.authorization;
  if (auth === undefined) return { ok: false, code: "MISSING_WAN_AUTHORIZATION", reason: "Wan authorization is required before video generation." };
  if (auth.workflowId !== input.workflowId || auth.sceneId !== input.artifact.sceneId || auth.artifactId !== input.artifact.artifactId || (auth.artifactSha256 !== undefined && auth.artifactSha256 !== input.artifact.sha256)) return { ok: false, code: "BLOCKED_STALE_APPROVAL", reason: "Wan authorization does not match the current visual artifact identity." };
  if (auth.semanticVerdict !== "PASS" || auth.technicalVerdict !== "PASS" || auth.humanApprovalId.trim() === "") return { ok: false, code: "INVALID_WAN_AUTHORIZATION", reason: "Wan authorization contains an invalid review or approval state." };
  return { ok: true };
}
