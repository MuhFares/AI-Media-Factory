/**
 * Shared primitives for the workflow engine.
 * ARCHITECTURE ONLY — type declarations, no logic.
 */

import type {
  Uuid,
  Timestamp,
  StepId,
  Json,
} from "@ai-media-factory/shared";

export type { Uuid, Timestamp, StepId, Json };

export type WorkflowId = Uuid;

/** The per-workflow execution states (owned by the workflow engine). */
export type WorkflowState =
  | "PENDING"
  | "RUNNING"
  | "PAUSED"
  | "AWAITING_APPROVAL"
  | "RETRYING"
  | "COMPENSATING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "ESCALATED";

/** A state transition rule. */
export interface StateTransition {
  from: WorkflowState;
  to: WorkflowState;
  on: string;
}

/** Validates and applies workflow state transitions. */
export interface WorkflowStateMachine {
  can(from: WorkflowState, on: string): boolean;
  next(from: WorkflowState, on: string): WorkflowState;
  isTerminal(state: WorkflowState): boolean;
}
