/**
 * The top-level runtime contract: one entry point that executes a single
 * agent turn end-to-end through the fixed pipeline (see ../README.md §3).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * AgentRuntime is generic. It takes an AgentId and an input event and runs
 * the SAME pipeline for all 13 agents. It contains no agent-specific branching.
 */

import type { AgentId, Uuid } from "./common";
import type { RuntimeEvent } from "./events";
import type { RuntimeError } from "./errors";

/** The terminal outcome of one agent turn. */
export type TurnStatus =
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "ESCALATED"
  | "TIMED_OUT";

export interface RuntimeInput {
  agent: AgentId;
  event: RuntimeEvent;
  /** Optional resume: continue a checkpointed turn. */
  resumeTurnId?: Uuid;
}

export interface RuntimeResult {
  turnId: Uuid;
  status: TurnStatus;
  /** The output event emitted on success (absent on non-COMPLETED outcomes). */
  emitted?: RuntimeEvent;
  error?: RuntimeError;
  costUsd: number;
  durationMs: number;
}

/**
 * The one entry point. Implementations wire together the loaders, context
 * builder, validator, executor, provider registry, memory store, event
 * consumer/emitter, gates, resilience, and observability collaborators.
 */
export interface AgentRuntime {
  run(input: RuntimeInput): Promise<RuntimeResult>;
}
