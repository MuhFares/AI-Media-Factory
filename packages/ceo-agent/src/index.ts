/**
 * @ai-media-factory/ceo-agent — executive decision layer.
 *
 * The CEO produces validated, deterministic ExecutiveDirectives for the existing
 * Orchestrator. It is a decision layer only: it never executes agents,
 * capabilities, or tools, and imports no concrete agents.
 */

export { CEOAgent, createCEOAgent, deriveId } from "./ceo-agent.js";
export type { CEOAgentOptions } from "./types.js";
export type {
  DecisionEvidence,
  ExecutiveConstraints,
  ExecutiveDirective,
  ExecutiveObjectiveInput,
  Priority,
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