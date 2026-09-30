/**
 * Human approval gates (req #16).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * A GateStep puts the workflow into AWAITING_APPROVAL and checkpoints; the
 * decision is delivered via WorkflowEngine.signalApproval. Same approval shape
 * the runtime uses, so gates are consistent across layers.
 */

import type { Json, Timestamp, Uuid } from "../core/common.js";

export type ApprovalOutcome = "approved" | "rejected" | "iteration_requested" | "policy_bypass";

/**
 * Authority granted by an approval is independent from the decision itself.
 * Missing scope is intentionally legacy/ambiguous and must fail closed at
 * authority-consuming boundaries.
 */
export type ApprovalScope =
  | "VALIDATION"
  | "PRODUCTION"
  | "PUBLICATION_INTEGRATION_VALIDATION"
  | "PUBLIC_PUBLISH";

export interface ApprovalAuthorityBinding {
  projectId: string;
  workflowId: Uuid;
  projectMode: string;
  finalMediaArtifactId?: string;
  finalMediaSha256?: string;
  finalProductReviewId?: string;
  targetPlatform?: string;
  targetAccountId?: string;
  publicationPayloadHash?: string;
  publicationIdentity?: string;
}

export interface ApprovalDecision {
  /** Stable durable decision identity; optional only for historical callers. */
  approvalId?: string;
  workflowId: Uuid;
  stepId: string;
  outcome: ApprovalOutcome;
  approver: string;
  note: string | null;
  decidedAt: Timestamp;
  /** Explicit authority granted by this decision. Omission is legacy and grants no new authority. */
  scope?: ApprovalScope;
  /** Exact resources to which the scoped authority applies. */
  authorityBinding?: ApprovalAuthorityBinding;
  /** Optional per-scene decisions for a batch visual gate. */
  sceneDecisions?: Record<string, "APPROVED" | "REJECTED" | "REQUEST_REGENERATION">;
  /** Exact final-media identity for the durable publication gate. */
  finalMediaArtifactId?: string;
  finalTechnicalQAReportId?: string;
  finalProductReviewId?: string;
  /** Explicitly keep an approved gate paused; omitted preserves auto-resume. */
  disposition?: "resume" | "pause";
  /**
   * Governance snapshot for a policy-based gate bypass: the effective human-
   * gate configuration that authorized skipping the human approval. Only
   * valid with outcome "policy_bypass"; never a substitute for a human
   * approval decision.
   */
  gatePolicy?: Json;
}

export interface ApprovalCoordinator {
  /** Raise an approval request (emits an event; checkpoints the workflow). */
  request(workflowId: Uuid, stepId: string, approver: string, reason: string): Promise<void>;
  /** Apply a decision to a gate-blocked workflow. */
  apply(decision: ApprovalDecision): Promise<void>;
}
