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
  type GateStep,
} from "@ai-media-factory/workflow-engine";
import { Orchestrator } from "./orchestrator.js";
import type { OrchestratorDirective, OrchestratorOptions } from "./types.js";
import { assertDirectiveOperational } from "@ai-media-factory/shared";

const DEFAULT_TIMEOUT_SECONDS = 300;

/** Durable owner gate between Review and Director (PRE_PRODUCTION_OWNER_GATE). */
export const PRE_PRODUCTION_OWNER_GATE_STEP_ID = "pre-production-owner-gate";
export const PILOT_PROVIDER_AUTHORITY_GATE_STEP_ID = "pilot-provider-authority-gate";
export const OWNER_PRE_MEDIA_GATE_STEP_ID = "owner-pre-media-gate";
const PRE_PRODUCTION_OWNER_GATE_REASON =
  "Owner approval of the reviewed content package is required before media production (director, TTS, timeline, scene-image) begins.";

/**
 * Resolve a canonical directive into a sequential, durable engine definition.
 * Stages are chained in template order (each agent step advances to the next).
 */
export function directiveToWorkflowDefinition(
  directive: OrchestratorDirective,
  options?: OrchestratorOptions
): WorkflowDefinition {
  assertDirectiveOperational(directive);
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
    const visualGateId = "visual-human-gate";
    const finalGateId = "final-human-gate";
    const preProductionGateId = PRE_PRODUCTION_OWNER_GATE_STEP_ID;
    const preMediaGateId = OWNER_PRE_MEDIA_GATE_STEP_ID;
    const nextStep = directive === "produce-pre-media" && step.id === "phase1-qa" ? preMediaGateId
      : directive === "produce" && step.id === "review" ? preProductionGateId
      : directive === "produce" && step.id === "visual-technical-qa" ? visualGateId
      : directive === "produce" && step.id === "final-product-review" ? finalGateId : next;
    builder.addAgentStep({
      id: step.id,
      agent: step.agent,
      emits: step.emits,
      ...(nextStep !== undefined ? { next: nextStep } : {}),
    });
    if (directive === "produce-pre-media" && step.id === "phase1-qa") {
      builder.addGateStep({
        id: preMediaGateId,
        approver: "human_operator",
        reason: "Owner review of the complete pre-media package is required. Media authority is not granted.",
      });
    }
    if (directive === "produce" && step.id === "review") {
      builder.addGateStep({
        id: preProductionGateId,
        approver: "human_operator",
        reason: PRE_PRODUCTION_OWNER_GATE_REASON,
        next,
      });
    }
    if (directive === "produce" && step.id === "visual-technical-qa") {
      builder.addGateStep({
        id: visualGateId,
        approver: "human_operator",
        reason: "Visual semantic review, technical QA, and human approval are required before Wan execution.",
        next: next,
      });
    }
    if (directive === "produce" && step.id === "final-product-review") {
      builder.addGateStep({
        id: finalGateId,
        approver: "human_operator",
        reason: "Final Technical QA and Final Product Review require explicit human approval before publication.",
        next,
      });
    }
  }

  return builder.build();
}

/**
 * Upgrade a persisted workflow definition with the PRE_PRODUCTION_OWNER_GATE.
 *
 * Legacy produce submissions were persisted before the gate existed; their
 * stored definition routes `review` straight to `director`. The durable worker
 * applies this narrow, idempotent upgrade before resume so a recovered
 * workflow stops for owner approval before any media production begins.
 * Definitions that already contain the gate — or that have no sequentially
 * chained `review` step — are returned unchanged.
 */
export function withPreProductionOwnerGate(definition: WorkflowDefinition): WorkflowDefinition {
  if (definition.steps.some((step) => step.id === PRE_PRODUCTION_OWNER_GATE_STEP_ID)) return definition;
  const reviewIndex = definition.steps.findIndex((step) => step.id === "review" && step.kind === "agent");
  if (reviewIndex < 0) return definition;
  const review = definition.steps[reviewIndex];
  if (review.next === undefined || Array.isArray(review.next)) return definition;
  // A review that already flows into a human gate retains its existing owner
  // stop; the pre-production gate is only inserted before ungated production
  // stages (e.g. legacy review → director).
  const downstream = definition.steps.find((step) => step.id === review.next);
  if (downstream?.kind === "gate") return definition;
  const gate: GateStep = {
    id: PRE_PRODUCTION_OWNER_GATE_STEP_ID,
    kind: "gate",
    approver: "human_operator",
    reason: PRE_PRODUCTION_OWNER_GATE_REASON,
    next: review.next,
  };
  const steps = [...definition.steps];
  steps[reviewIndex] = { ...review, next: PRE_PRODUCTION_OWNER_GATE_STEP_ID };
  steps.splice(reviewIndex + 1, 0, gate);
  return { ...definition, steps };
}

/** Create a real workflow that pauses before its first provider-capable step. */
export function withInitialProviderAuthorityGate(definition: WorkflowDefinition): WorkflowDefinition {
  if (definition.steps.some((step) => step.id === PILOT_PROVIDER_AUTHORITY_GATE_STEP_ID)) return definition;
  const gate: GateStep = {
    id: PILOT_PROVIDER_AUTHORITY_GATE_STEP_ID,
    kind: "gate",
    approver: "human_operator",
    reason: "Explicit Owner authority is required before Pilot 1 may make any external provider call or consume its hard call budgets.",
    next: definition.entryStep,
  };
  return { ...definition, entryStep: PILOT_PROVIDER_AUTHORITY_GATE_STEP_ID, steps: [gate, ...definition.steps] };
}
