/**
 * Dead Letter Queue (req #14) — workflow-level.
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * A workflow that exhausts retries and cannot be compensated is dead-lettered
 * with full context, and an EscalationRequired event is emitted. Reuses the
 * Event Bus DLQ semantics; records the workflow-level dead-letter.
 */

import type { StepId, Timestamp, Uuid } from "../core/common";

export interface WorkflowDeadLetter {
  workflowId: Uuid;
  definitionId: string;
  definitionVersion: number;
  failedStep: StepId;
  reason: "retries_exhausted" | "compensation_failed" | "unrecoverable";
  lastError: string;
  checkpointRef: string | null;
  deadLetteredAt: Timestamp;
}

export interface DeadLetterSink {
  deadLetter(entry: WorkflowDeadLetter): Promise<void>;
  /** Replay a corrected workflow (a new instance supersedes the dead one). */
  replay(workflowId: Uuid): Promise<void>;
}
