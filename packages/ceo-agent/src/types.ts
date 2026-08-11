/**
 * Executive decision contracts (ARCHITECTURE ONLY — type declarations).
 *
 * The CEO is a decision layer: it consumes an executive objective and produces a
 * validated ExecutiveDirective for the existing Orchestrator. It never executes
 * agents, capabilities, or tools.
 */

import type { OrchestratorDirective, RegistryLookup } from "@ai-media-factory/orchestrator";
import type { Timestamp, Uuid } from "@ai-media-factory/shared";

/**
 * Supported workflow intents. These map 1:1 to the existing Orchestrator
 * templates. Any other intent is rejected, never guessed.
 */
export type WorkflowIntent = OrchestratorDirective;

/** Supported executive priorities. Invalid priorities are rejected. */
export type Priority = "low" | "medium" | "high" | "urgent";

/** Constraints accepted by the decision policy. Unknown keys are rejected. */
export interface ExecutiveConstraints {
  readonly requiredCapabilities?: readonly string[];
  readonly forbiddenCapabilities?: readonly string[];
  readonly maxStages?: number;
  readonly deterministic?: boolean;
}

/** Decision input from an executive caller. */
export interface ExecutiveObjectiveInput {
  readonly objective: string;
  readonly intent: WorkflowIntent;
  readonly priority?: Priority;
  readonly constraints?: unknown;
}

/**
 * CEO decision evidence. Deliberately distinct from capability execution
 * evidence — it records a decision, not an execution. It must never be
 * represented as a CapabilityResult.
 */
export interface DecisionEvidence {
  readonly kind: "executive_decision";
  readonly evidenceId: Uuid;
  readonly directiveId: Uuid;
  readonly objective: string;
  readonly selectedWorkflow: WorkflowIntent;
  readonly selectedAgents: readonly string[];
  readonly decisionSource: string;
  readonly decidedAt: Timestamp;
}

/** The validated directive the CEO forwards to the Orchestrator. */
export interface ExecutiveDirective {
  readonly directiveId: Uuid;
  readonly objective: string;
  readonly workflowIntent: WorkflowIntent;
  readonly priority: Priority;
  readonly requestedStages: readonly string[];
  readonly constraints: Readonly<Record<string, unknown>>;
  readonly createdAt: Timestamp;
  readonly decisionEvidence: DecisionEvidence;
}

/** Options to construct a CEOAgent. */
export interface CEOAgentOptions {
  /** Restricts requested stages to registered agents; never invents agents. */
  readonly registry?: RegistryLookup;
  /** Deterministic timestamp provider. Defaults to current UTC time. */
  readonly clock?: () => Timestamp;
  /** Stable policy identifier recorded in decision evidence. */
  readonly decisionSource?: string;
}

export type { RegistryLookup, OrchestratorDirective };