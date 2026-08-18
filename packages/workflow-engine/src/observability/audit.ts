/**
 * Audit trail (req #20).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Append-only record of every workflow decision: which step ran, which branch
 * was taken, approvals, compensations, terminal outcome. Backed by workflow
 * memory (Memory Engine) + the Event Store. Answers "why did this workflow do
 * what it did?" for enterprise governance.
 */

import type { Json, StepId, Timestamp, Uuid } from "../core/common.js";

export type AuditEventKind =
  | "workflow_started"
  | "step_completed"
  | "step_failed"
  | "branch_taken"
  | "parallel_joined"
  | "approval_requested"
  | "approval_decided"
  | "retry"
  | "compensation"
  | "paused"
  | "resumed"
  | "cancelled"
  | "dead_lettered"
  | "workflow_completed";

export interface AuditEntry {
  workflowId: Uuid;
  kind: AuditEventKind;
  stepId: StepId | null;
  detail: Json;
  at: Timestamp;
}

/** Append-only audit sink; entries are never mutated or deleted. */
export interface AuditTrail {
  append(entry: AuditEntry): Promise<void>;
  /** Full ordered history of a workflow for governance/review. */
  history(workflowId: Uuid): Promise<AuditEntry[]>;
}
