/**
 * Canonical capability directives supported by the orchestrator.
 *
 * The orchestrator compiles a directive into a deterministic, reusable
 * collaboration plan. Directives are finite and canonical — the orchestrator
 * rejects any value outside this set rather than guessing.
 */
export type OrchestratorDirective = "plan" | "research" | "implement" | "verify" | "ship";

/** A single expected downstream output produced by a plan stage. */
export interface OrchestratorOutput {
  readonly stepId: string;
  readonly agent: string;
  readonly emits: string;
  readonly artifactKind: import("@ai-media-factory/shared").AgentArtifactKind;
}

/** A deterministic, reusable execution plan compiled from a directive. */
export interface OrchestratorPlan {
  readonly directive: OrchestratorDirective;
  readonly workflowId: import("@ai-media-factory/shared").Uuid | null;
  readonly correlationId: string | null;
  readonly agents: readonly string[];
  readonly outputs: readonly OrchestratorOutput[];
  readonly stages: readonly import("@ai-media-factory/workflow-engine").CollaborationStage[];
}

/** Supported option allowlist. Any other key is rejected, never ignored. */
export interface OrchestratorOptions {
  readonly timeoutSeconds?: number;
  readonly maxAttempts?: number;
}

/**
 * The only registry surface the orchestrator depends on.
 * Deliberately a structural subset of AgentRegistry exposing just `has`.
 * No capability discovery, no listing, no agent construction.
 */
export interface RegistryLookup {
  has(agentId: string): boolean;
}