/**
 * Step model (req #4) — the union of every control-flow node.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { Json, StepId } from "../core/common.js";

// Re-export StepId for convenience
export type { StepId } from "../core/common.js";

export type StepKind =
  | "agent"        // run one agent turn via the Runtime (#4)
  | "branch"       // conditional next-edge selection (#5)
  | "parallel"     // fan-out + join (#6)
  | "gate"         // human approval gate (#16)
  | "compensation";// saga rollback of a prior step (#15)

interface StepBase {
  id: StepId;
  kind: StepKind;
  /** Next step(s) on success; a single id for sequential (#7). */
  next?: StepId | StepId[];
  /** Per-step deadline seconds (#13). */
  timeoutSeconds?: number;
  /** Per-step retry override (#8). */
  maxAttempts?: number;
  /** The compensation step that undoes this step, if any (#15). */
  compensatedBy?: StepId;
}

/** Runs one agent turn. The executor dispatches it to the Runtime. */
export interface AgentStep extends StepBase {
  kind: "agent";
  agent: string;            // agent id (e.g. "research")
  /** Event type this step emits on completion (advances the workflow). */
  emits: string;
}

/** Conditional branch: pick the next edge from a predicate over context. */
export interface BranchStep extends StepBase {
  kind: "branch";
  cases: Array<{ when: Json; goto: StepId }>; // declarative predicate → target
  otherwise: StepId;
}

/** Fan out branches; join when all complete (#6). */
export interface ParallelStep extends StepBase {
  kind: "parallel";
  branches: StepId[];
  /** The step to run once all branches have joined. */
  join: StepId;
}

/** Human approval gate (#16). */
export interface GateStep extends StepBase {
  kind: "gate";
  approver: string;         // e.g. "ceo" | "brand" | "human_operator"
  reason: string;
}

/** Saga compensation node (#15). */
export interface CompensationStep extends StepBase {
  kind: "compensation";
  undoes: StepId;
}

export type Step = AgentStep | BranchStep | ParallelStep | GateStep | CompensationStep;
