/**
 * @ai-media-factory/orchestrator — public contract surface.
 *
 * Deterministic, directive-driven orchestration over the Workflow Engine.
 * The Orchestrator depends on the Shared contracts and the Workflow Engine
 * (CollaborationRunner). It never imports concrete agents; agent ids are
 * resolved at execution time by the injected AgentExecutorPort.
 */

export { Orchestrator } from "./orchestrator.js";
export type { OrchestratorDeps } from "./orchestrator.js";
export * from "./templates.js";
export type {
  OrchestratorDirective,
  OrchestratorOptions,
  OrchestratorOutput,
  OrchestratorPlan,
  RegistryLookup,
} from "./types.js";