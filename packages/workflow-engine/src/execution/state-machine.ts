/**
 * Workflow-level state machine (req #3).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Owns the per-workflow states. Distinct from the runtime's per-turn machine,
 * which runs INSIDE an AgentStep.
 */

import type { WorkflowState } from "../core/common";

export interface StateTransition {
  from: WorkflowState;
  to: WorkflowState;
  on: string; // trigger: step_completed, step_failed, pause, resume, approve, reject, cancel, exhausted, ...
}

/** Validates and applies workflow state transitions. */
export interface WorkflowStateMachine {
  /** Is a transition permitted from the current state on a trigger? */
  can(from: WorkflowState, on: string): boolean;
  /** The resulting state for a permitted transition. */
  next(from: WorkflowState, on: string): WorkflowState;
  isTerminal(state: WorkflowState): boolean;
}
