/**
 * Default WorkflowStateMachine implementation.
 */

import type { WorkflowState, StateTransition, WorkflowStateMachine } from "../core/common.js";

/** Valid state transitions for the workflow engine. */
const TRANSITIONS: StateTransition[] = [
  // From PENDING
  { from: "PENDING", to: "RUNNING", on: "start" },
  { from: "PENDING", to: "CANCELLED", on: "cancel" },

  // From RUNNING
  { from: "RUNNING", to: "PAUSED", on: "pause" },
  { from: "RUNNING", to: "AWAITING_APPROVAL", on: "await_approval" },
  { from: "RUNNING", to: "RETRYING", on: "retry" },
  { from: "RUNNING", to: "COMPENSATING", on: "compensate" },
  { from: "RUNNING", to: "COMPLETED", on: "complete" },
  { from: "RUNNING", to: "FAILED", on: "fail" },
  { from: "RUNNING", to: "CANCELLED", on: "cancel" },
  { from: "RUNNING", to: "ESCALATED", on: "escalate" },

  // From PAUSED
  { from: "PAUSED", to: "RUNNING", on: "resume" },
  { from: "PAUSED", to: "CANCELLED", on: "cancel" },

  // From AWAITING_APPROVAL
  { from: "AWAITING_APPROVAL", to: "RUNNING", on: "approve" },
  { from: "AWAITING_APPROVAL", to: "FAILED", on: "reject" },
  { from: "AWAITING_APPROVAL", to: "CANCELLED", on: "cancel" },

  // From RETRYING
  { from: "RETRYING", to: "RUNNING", on: "retry_ready" },
  { from: "RETRYING", to: "FAILED", on: "retries_exhausted" },
  { from: "RETRYING", to: "CANCELLED", on: "cancel" },

  // From COMPENSATING
  { from: "COMPENSATING", to: "RUNNING", on: "compensation_complete" },
  { from: "COMPENSATING", to: "FAILED", on: "compensation_failed" },
  { from: "COMPENSATING", to: "CANCELLED", on: "cancel" },
];

export class DefaultWorkflowStateMachine implements WorkflowStateMachine {
  private readonly transitionMap = new Map<string, Map<string, WorkflowState>>();

  constructor() {
    for (const t of TRANSITIONS) {
      if (!this.transitionMap.has(t.from)) {
        this.transitionMap.set(t.from, new Map());
      }
      this.transitionMap.get(t.from)!.set(t.on, t.to);
    }
  }

  can(from: WorkflowState, on: string): boolean {
    return this.transitionMap.get(from)?.has(on) ?? false;
  }

  next(from: WorkflowState, on: string): WorkflowState {
    const to = this.transitionMap.get(from)?.get(on);
    if (!to) {
      throw new Error(`Invalid transition: ${from} --${on}-->`);
    }
    return to;
  }

  isTerminal(state: WorkflowState): boolean {
    return ["COMPLETED", "FAILED", "CANCELLED", "ESCALATED"].includes(state);
  }
}