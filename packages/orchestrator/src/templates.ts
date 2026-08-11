/**
 * Deterministic directive → collaboration-plan template table.
 *
 * This is the orchestrator's single source of facts. Templates are plain
 * objects (no classes, no hidden state, no runtime behavior). The same
 * directive always compiles to the same agent sequence, emitting the same
 * artifact kinds — the mapping is fully round-trippable.
 *
 * The orchestrator depends on the Workflow Engine (CollaborationStage) and the
 * Shared canonical artifact kinds. It never imports a concrete agent: agent ids
 * are plain strings resolved at execution time by the injected AgentExecutorPort.
 */

import type {
  AgentArtifactKind,
} from "@ai-media-factory/shared";
import type { CollaborationStage } from "@ai-media-factory/workflow-engine";
import type { OrchestratorDirective, OrchestratorOptions, OrchestratorOutput } from "./types.js";

interface StageSpec {
  readonly id: string;
  readonly agent: string;
  readonly emits: string;
  readonly artifactKind: AgentArtifactKind;
}

const PLAN: readonly StageSpec[] = [
  { id: "planner", agent: "planner", emits: "plan", artifactKind: "execution_plan" },
];

const RESEARCH: readonly StageSpec[] = [
  ...PLAN,
  { id: "research", agent: "research", emits: "research", artifactKind: "research_report" },
];

const IMPLEMENT: readonly StageSpec[] = [
  ...RESEARCH,
  { id: "coding", agent: "coding", emits: "coding", artifactKind: "coding_report" },
  { id: "reviewer", agent: "reviewer", emits: "review", artifactKind: "review_report" },
];

const VERIFY: readonly StageSpec[] = [
  ...IMPLEMENT,
  { id: "qa", agent: "qa", emits: "qa", artifactKind: "qa_report" },
];

const SHIP: readonly StageSpec[] = [
  ...VERIFY,
  { id: "documentation", agent: "documentation", emits: "documentation", artifactKind: "documentation_report" },
];

/** Plain-object fact table keyed by canonical directive. */
export const DIRECTIVE_TEMPLATES: Readonly<Record<OrchestratorDirective, readonly StageSpec[]>> = {
  plan: PLAN,
  research: RESEARCH,
  implement: IMPLEMENT,
  verify: VERIFY,
  ship: SHIP,
};

export function isDirective(value: unknown): value is OrchestratorDirective {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DIRECTIVE_TEMPLATES, value);
}

export function listAgents(specs: readonly StageSpec[]): readonly string[] {
  return specs.map((spec) => spec.agent);
}

export function listOutputs(specs: readonly StageSpec[]): readonly OrchestratorOutput[] {
  return specs.map((spec) => ({ stepId: spec.id, agent: spec.agent, emits: spec.emits, artifactKind: spec.artifactKind }));
}

export function makeStages(specs: readonly StageSpec[], options: OrchestratorOptions): readonly CollaborationStage[] {
  return specs.map(
    (spec): CollaborationStage => ({
      step: {
        id: spec.id,
        kind: "agent",
        agent: spec.agent,
        emits: spec.emits,
        ...(options.timeoutSeconds !== undefined ? { timeoutSeconds: options.timeoutSeconds } : {}),
        ...(options.maxAttempts !== undefined ? { maxAttempts: options.maxAttempts } : {}),
      },
      artifactKind: spec.artifactKind,
    }),
  );
}

export type { StageSpec };
export type { AgentArtifactKind };