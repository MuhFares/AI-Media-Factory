/**
 * @ai-media-factory/ceo-agent — executive decision layer.
 *
 * The CEO produces validated, deterministic ExecutiveDirectives for the existing
 * Orchestrator. It is a decision layer only: it never executes agents,
 * capabilities, or tools, and imports no concrete agents.
 */

export { CEOAgent, createCEOAgent, deriveId, DEFAULT_CEO_SYSTEM_PROMPT } from "./ceo-agent.js";
export type { CEOAgentOptions, StrategyCouncilSynthesisV2 } from "./types.js";
export { diagnoseStrategyCouncilSynthesisV2, validateStrategyCouncilSynthesisV2, validateStrategyCouncilV2Manifest, StrategyCouncilV2StructuralError, STRATEGY_COUNCIL_V2_OUTPUT_INSTRUCTIONS, STRATEGY_COUNCIL_V2_SYSTEM_PROMPT, STRATEGY_COUNCIL_V2_RESPONSE_SCHEMA, STRATEGY_COUNCIL_V2_EXAMPLE, STRATEGY_COUNCIL_V2_SPECIALISTS } from "./strategy-council-v2.js";
export type {
  DecisionEvidence,
  ExecutiveConstraints,
  ExecutiveDirective,
  ExecutiveObjectiveInput,
  Priority,
  SourceArtifactReference,
  WorkflowIntent,
} from "./types.js";
export {
  assertAgentsAvailable,
  isWorkflowIntent,
  normalizeConstraints,
  templateAgentsFor,
} from "./policy.js";
export {
  executiveContext,
  planExecutive,
  produceExecutive,
  toOrchestratorDirective,
} from "./orchestrator-bridge.js";
export type { ExecutiveRunTarget } from "./orchestrator-bridge.js";
export {
  decideBusinessCycle,
  validateBusinessFeedback,
} from "./business-decision.js";
export type {
  BusinessFeedbackArtifact,
  BusinessFeedbackDecision,
  BusinessFeedbackInput,
  FeedbackDecisionStatus,
} from "./business-decision.js";
