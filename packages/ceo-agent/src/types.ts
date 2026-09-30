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

/** Reference to an upstream collaboration artifact a decision is grounded in. */
export interface SourceArtifactReference {
  readonly artifactId: Uuid;
  readonly kind: string;
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
  /** Optional business-cycle metadata present on CEO business feedback directives. */
  readonly successCriteria?: readonly string[];
  readonly rationale?: string;
  readonly sourceArtifactReferences?: readonly SourceArtifactReference[];
  readonly cycle?: number;
}

/** V2-only, owner-review synthesis. It deliberately does not replace ExecutiveDirective. */
export interface StrategyCouncilSynthesisV2 {
  readonly contract: "STRATEGY_COUNCIL_SYNTHESIS_V2";
  readonly status: "AWAITING_OWNER_APPROVAL";
  readonly executiveSummary: { readonly recommendation: string; readonly tradeoffs: readonly string[]; readonly launchDecision: string; readonly ownerDecisions: readonly string[]; readonly deferredDecisions: readonly string[] };
  readonly strategicRecommendation: { readonly territory: string; readonly rationale: string; readonly targetAudience: string; readonly audiencePromise: string; readonly differentiation: string; readonly flagshipProposition: string };
  readonly contentSystem: { readonly primaryPillars: readonly string[]; readonly deferredPillars: readonly string[]; readonly formats: readonly string[]; readonly flagshipFormat: string; readonly productionModel: string };
  readonly platforms: readonly { readonly platform: "Instagram Reels" | "YouTube Shorts" | "TikTok"; readonly role: string; readonly priority: number; readonly launchTiming: string; readonly reuseApproach: string; readonly rationale: string }[];
  readonly identity: { readonly recommendation: "FACELESS" | "PERSONAL_BRAND" | "HYBRID"; readonly rationale: string };
  readonly channelPortfolio: { readonly recommendation: "ONE_CHANNEL" | "MULTIPLE_CHANNELS" | "PHASED_PORTFOLIO"; readonly launchArchitecture: string; readonly launchesFirst: string; readonly deferred: readonly string[]; readonly expansionTrigger: string; readonly rationale: string };
  readonly monetization: { readonly initialRoutes: readonly string[]; readonly laterRoutes: readonly string[]; readonly dependencies: readonly string[]; readonly assumptions: readonly string[]; readonly risks: readonly string[] };
  readonly costAndReinvestment: { readonly startingModel: string; readonly requiredPaidComponents: readonly string[]; readonly lowCostComponents: readonly string[]; readonly reinvestmentPriorities: readonly string[]; readonly costControlGates: readonly string[]; readonly unknownCosts: readonly string[] };
  readonly revenueMilestones: readonly { readonly monthlyUsd: 100 | 1000 | 10000; readonly objective: string; readonly mechanism: string; readonly operationalRequirement: string; readonly scaleTrigger: string; readonly majorRisk: string }[];
  readonly productionFeasibility: { readonly difficulty: string; readonly workflowComplexity: string; readonly aiDependency: string; readonly humanReview: string; readonly scalabilityConstraints: readonly string[] };
  readonly videoConcepts: readonly { readonly concept: string; readonly pillar: string; readonly hook: string; readonly platformFit: readonly string[]; readonly rationale: string }[];
  readonly risks: readonly { readonly category: string; readonly impact: string; readonly mitigation: string }[];
  readonly evidenceNotes: readonly { readonly label: string; readonly classification: "KNOWN" | "OBSERVED" | "INFERRED" | "ASSUMED" | "UNKNOWN"; readonly rationale: string }[];
  readonly disagreements: readonly { readonly specialists: readonly string[]; readonly positions: readonly string[]; readonly resolution: string; readonly rationale: string }[];
  readonly namingCriteria: readonly string[];
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
