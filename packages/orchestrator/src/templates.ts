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
import { CANONICAL_STAGE_CATALOG } from "@ai-media-factory/shared";
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

/**
 * Production media chain (Phase 2). Each stage is a real production agent and
 * runs behind the durable engine through the worker's production executor.
 * Order is dictated by the agents' own gates (thumbnail/video derive from the
 * writer content, publishing requires a passing QA gate, analytics requires a
 * completed publication).
 */
const PRODUCE: readonly StageSpec[] = [
  { id: "planner-initial", agent: "planner", emits: "initial-content-plan", artifactKind: "execution_plan" },
  { id: "research", agent: "research", emits: "research", artifactKind: "research_report" },
  { id: "ceo-recommendation", agent: "ceo", emits: "strategy-recommendation", artifactKind: "ceo_recommendation" },
  { id: "planner-synthesis", agent: "planner", emits: "evidence-backed-content-brief", artifactKind: "evidence_backed_content_brief" },
  { id: "writer", agent: "writer", emits: "writer", artifactKind: "writer_report" },
  { id: "seo", agent: "seo", emits: "seo", artifactKind: "seo_report" },
  { id: "brand", agent: "brand", emits: "brand", artifactKind: "brand_report" },
  { id: "review", agent: "review", emits: "review", artifactKind: "review_report" },
  { id: "director", agent: "director", emits: "scene-plan", artifactKind: "scene_plan" },
  { id: "visual-direction", agent: "visual-director", emits: "visual-direction", artifactKind: "visual_direction_contract" },
  { id: "tts", agent: "tts", emits: "narration", artifactKind: "narration_artifact" },
  { id: "timeline", agent: "timeline", emits: "timeline", artifactKind: "timeline_plan" },
  { id: "scene-image", agent: "scene-image", emits: "scene-visual", artifactKind: "scene_visual_artifact" },
  { id: "visual-semantic-review", agent: "visual-semantic-review", emits: "visual-semantic-review", artifactKind: "visual_semantic_review" },
  { id: "visual-technical-qa", agent: "visual-technical-qa", emits: "visual-technical-qa", artifactKind: "visual_technical_qa" },
  { id: "wan-authorization", agent: "wan-authorization", emits: "wan-authorization", artifactKind: "wan_authorization" },
  { id: "video", agent: "video", emits: "video", artifactKind: "scene_video_clip" },
  { id: "composer", agent: "composer", emits: "final-media", artifactKind: "final_media_artifact" },
  { id: "qa", agent: "qa", emits: "final-technical-qa", artifactKind: "final_technical_qa" },
  { id: "final-product-review", agent: "review", emits: "final-product-review", artifactKind: "final_product_review" },
  { id: "publisher-authorization", agent: "publisher-authorization", emits: "publisher-authorization", artifactKind: "publisher_authorization" },
  { id: "publisher", agent: "publisher", emits: "publisher", artifactKind: "published_report" },
  { id: "analytics", agent: "analytics", emits: "analytics", artifactKind: "analytics_report" },
];

/**
 * Bounded Pilot-1 Phase 1. Every stage is textual/research work and the
 * definition terminates at a durable Owner gate. Media-capable agents are
 * deliberately absent; Phase 2 is a separately authorized execution.
 */
const PRODUCE_PRE_MEDIA: readonly StageSpec[] = [
  { id: "orchestrator", agent: "orchestrator", emits: "phase-plan", artifactKind: "execution_plan" },
  { id: "research", agent: "research", emits: "research", artifactKind: "research_report" },
  { id: "ceo-recommendation", agent: "ceo", emits: "strategy-recommendation", artifactKind: "ceo_recommendation" },
  { id: "planner-synthesis", agent: "planner", emits: "production-brief", artifactKind: "evidence_backed_content_brief" },
  { id: "writer", agent: "writer", emits: "script", artifactKind: "writer_report" },
  { id: "scenes", agent: "director", emits: "scene-plan", artifactKind: "scene_plan" },
  { id: "visual-direction", agent: "visual-director", emits: "visual-direction", artifactKind: "visual_direction_contract" },
  { id: "review", agent: "review", emits: "textual-review", artifactKind: "review_report" },
  { id: "phase1-qa", agent: "qa", emits: "pre-media-qa", artifactKind: "qa_report" },
];

/** Plain-object fact table keyed by canonical directive. */
export const DIRECTIVE_TEMPLATES: Readonly<Record<OrchestratorDirective, readonly StageSpec[]>> = {
  plan: PLAN,
  research: RESEARCH,
  implement: IMPLEMENT,
  verify: VERIFY,
  ship: SHIP,
  produce: PRODUCE,
  "produce-pre-media": PRODUCE_PRE_MEDIA,
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

/** Fail closed if a production template drifts from the shared stage authority. */
export function assertDirectiveTemplateCatalogConsistency(): void {
  for (const directive of ["produce", "produce-pre-media"] as const) {
    for (const spec of DIRECTIVE_TEMPLATES[directive]) {
      const canonical = (CANONICAL_STAGE_CATALOG as Record<string, { canonicalAgentOrRuntimeRole: string; outputArtifactKind: AgentArtifactKind | null; enabledForDirectives: readonly string[] }>)[spec.id];
      if (canonical === undefined) throw new Error(`UNRESOLVED_WORKFLOW_STAGE:${directive}:${spec.id}`);
      if (canonical.canonicalAgentOrRuntimeRole !== spec.agent || canonical.outputArtifactKind !== spec.artifactKind || !canonical.enabledForDirectives.includes(directive)) {
        throw new Error(`STAGE_CATALOG_DRIFT:${directive}:${spec.id}`);
      }
    }
  }
}

export type { StageSpec };
export type { AgentArtifactKind };
