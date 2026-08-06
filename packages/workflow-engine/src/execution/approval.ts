/**
 * Human approval gates (req #16).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * A GateStep puts the workflow into AWAITING_APPROVAL and checkpoints; the
 * decision is delivered via WorkflowEngine.signalApproval. Same approval shape
 * the runtime uses, so gates are consistent across layers.
 */

import type { Timestamp, Uuid } from "../core/common.js";

export type ApprovalOutcome = "approved" | "rejected";

export interface ApprovalDecision {
  workflowId: Uuid;
  stepId: string;
  outcome: ApprovalOutcome;
  approver: string;
  note: string | null;
  decidedAt: Timestamp;
}

export interface ApprovalCoordinator {
  /** Raise an approval request (emits an event; checkpoints the workflow). */
  request(workflowId: Uuid, stepId: string, approver: string, reason: string): Promise<void>;
  /** Apply a decision to a gate-blocked workflow. */
  apply(decision: ApprovalDecision): Promise<void>;
}
