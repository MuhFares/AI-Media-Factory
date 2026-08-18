/**
 * directiveToWorkflowDefinition — compile a canonical directive into a durable
 * Workflow Engine definition.
 *
 * Phase 1: an async worker submits a directive through the Orchestrator to
 * obtain the executable plan, then materialises it as an engine WorkflowDefinition
 * so execution is handled by the durable engine (persistence + checkpoints +
 * resume). Keeping the directive→definition compile inside the Orchestrator
 * guarantees the async path does not bypass the Orchestrator.
 */

import {
  workflow,
  type WorkflowDefinition,
  type CollaborationStage,
} from "@ai-media-factory/workflow-engine";
import { Orchestrator } from "./orchestrator.js";
import type { OrchestratorDirective, OrchestratorOptions } from "./types.js";

const DEFAULT_TIMEOUT_SECONDS = 300;

/**
 * Resolve a canonical directive into a sequential, durable engine definition.
 * Stages are chained in template order (each agent step advances to the next).
 */
export function directiveToWorkflowDefinition(
  directive: OrchestratorDirective,
  options?: OrchestratorOptions
): WorkflowDefinition {
  const plan = new Orchestrator().stub(directive, options);
  const stages: readonly CollaborationStage[] = plan.stages;
  if (stages.length === 0) {
    throw new Error("Directive produced no stages");
  }

  const builder = workflow()
    .id("content-factory")
    .version(1)
    .trigger("event", "ExecutiveDirective")
    .entryStep(stages[0].step.id)
    .timeoutSeconds(options?.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS);

  for (let i = 0; i < stages.length; i++) {
    const step = stages[i].step;
    const next = i + 1 < stages.length ? stages[i + 1].step.id : undefined;
    builder.addAgentStep({
      id: step.id,
      agent: step.agent,
      emits: step.emits,
      ...(next !== undefined ? { next } : {}),
    });
  }

  return builder.build();
}
