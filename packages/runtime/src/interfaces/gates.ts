/**
 * Human approval gate contracts.
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Whether a gate is required is driven by the agent's config.yaml
 * (e.g. Brand safety holds, CEO one-way doors) — never hardcoded per agent.
 */

import type { AgentId, Json, Uuid } from "./common.js";

export interface ApprovalRequest {
  turnId: Uuid;
  agent: AgentId;
  reason: string;
  payload: Json;
}

export type ApprovalOutcome = "approved" | "rejected";

export interface ApprovalDecision {
  outcome: ApprovalOutcome;
  approver: string;
  note: string | null;
  decidedAt: string;
}

/**
 * Pauses a turn for human approval where policy requires it, then resumes.
 * The runtime checkpoints before awaiting so a pending gate survives restarts.
 */
export interface ApprovalGate {
  /** Does this turn require a human gate at this point? (driven by config/policy) */
  isRequired(request: ApprovalRequest): boolean;
  /** Await a decision (may be long-lived; the turn is checkpointed meanwhile). */
  await(request: ApprovalRequest): Promise<ApprovalDecision>;
}
