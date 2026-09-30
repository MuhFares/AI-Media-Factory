/**
 * @ai-media-factory/planner-agent — public contract surface.
 */

export type {
  PlannerInput,
  PlannerStage,
  InitialContentPlan,
  ResearchResultForSynthesis,
  EvidenceBackedClaim,
  EvidenceBackedContentBrief,
  PlannerConstraints,
  PlannerContext,
  AgentCapability,
  PlanTask,
  ExecutionPlan,
  PlanMetadata,
  PlannerConfig,
  PlannerExecutionInput,
  PlannerExecutionOutput,
} from "./planner-types.js";

export {
  PlannerAgent,
  createPlannerAgent,
  DEFAULT_PLANNER_SYSTEM_PROMPT,
  diagnosePlannerSynthesisStructure,
  StructuredOutputValidationError,
  plannerSynthesisContractInstructions,
} from "./planner-agent.js";
