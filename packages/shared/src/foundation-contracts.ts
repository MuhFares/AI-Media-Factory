import type { AgentArtifactKind, CollaborationArtifact } from "./collaboration.js";

export type StageExecutionType = "DETERMINISTIC" | "LLM" | "HYBRID" | "CAPABILITY" | "OWNER_GATE";
export type RecoveryPolicy = "REPLAY_SAFE" | "RESUME_FROM_ARTIFACT" | "OWNER_REAUTHORIZE" | "NOT_APPLICABLE";
export type ArtifactAuthority = "CANONICAL" | "LEGACY_READ_ONLY";

export interface CanonicalStageDefinition {
  readonly stageId: string;
  readonly canonicalAgentOrRuntimeRole: string;
  readonly executionType: StageExecutionType;
  readonly inputArtifactKinds: readonly AgentArtifactKind[];
  readonly outputArtifactKind: AgentArtifactKind | null;
  readonly runtimeSchemaId: string | null;
  readonly budgetCallKind: "text_agent" | "research" | "image" | "video" | "voice" | null;
  readonly routingRole: string | null;
  readonly ownerGate: boolean;
  readonly recoveryPolicy: RecoveryPolicy;
  readonly enabledForDirectives: readonly ("produce" | "produce-pre-media")[];
}

const stage = (definition: CanonicalStageDefinition): CanonicalStageDefinition => Object.freeze(definition);

/**
 * Program-1 authority for every stage emitted by an operational production
 * directive. Historical coding/documentation templates are deliberately not
 * represented: their directives are rejected before submission.
 */
export const CANONICAL_STAGE_CATALOG = Object.freeze({
  "planner-initial": stage({ stageId: "planner-initial", canonicalAgentOrRuntimeRole: "planner", executionType: "LLM", inputArtifactKinds: [], outputArtifactKind: "execution_plan", runtimeSchemaId: "amf.execution-plan.v1", budgetCallKind: "text_agent", routingRole: "planner", ownerGate: false, recoveryPolicy: "RESUME_FROM_ARTIFACT", enabledForDirectives: ["produce"] }),
  orchestrator: stage({ stageId: "orchestrator", canonicalAgentOrRuntimeRole: "orchestrator", executionType: "LLM", inputArtifactKinds: [], outputArtifactKind: "execution_plan", runtimeSchemaId: "amf.execution-plan.v1", budgetCallKind: "text_agent", routingRole: "orchestrator", ownerGate: false, recoveryPolicy: "RESUME_FROM_ARTIFACT", enabledForDirectives: ["produce-pre-media"] }),
  research: stage({ stageId: "research", canonicalAgentOrRuntimeRole: "research", executionType: "HYBRID", inputArtifactKinds: ["execution_plan"], outputArtifactKind: "research_report", runtimeSchemaId: "amf.research-report.v2", budgetCallKind: "research", routingRole: "research", ownerGate: false, recoveryPolicy: "OWNER_REAUTHORIZE", enabledForDirectives: ["produce", "produce-pre-media"] }),
  "ceo-recommendation": stage({ stageId: "ceo-recommendation", canonicalAgentOrRuntimeRole: "ceo", executionType: "LLM", inputArtifactKinds: ["research_report"], outputArtifactKind: "ceo_recommendation", runtimeSchemaId: "amf.ceo-recommendation.v1", budgetCallKind: "text_agent", routingRole: "ceo", ownerGate: false, recoveryPolicy: "OWNER_REAUTHORIZE", enabledForDirectives: ["produce", "produce-pre-media"] }),
  "planner-synthesis": stage({ stageId: "planner-synthesis", canonicalAgentOrRuntimeRole: "planner", executionType: "LLM", inputArtifactKinds: ["research_report", "ceo_recommendation"], outputArtifactKind: "evidence_backed_content_brief", runtimeSchemaId: "amf.evidence-backed-content-brief.v1", budgetCallKind: "text_agent", routingRole: "planner", ownerGate: false, recoveryPolicy: "RESUME_FROM_ARTIFACT", enabledForDirectives: ["produce", "produce-pre-media"] }),
  writer: stage({ stageId: "writer", canonicalAgentOrRuntimeRole: "writer", executionType: "LLM", inputArtifactKinds: ["evidence_backed_content_brief"], outputArtifactKind: "writer_report", runtimeSchemaId: "amf.writer-report.v1", budgetCallKind: "text_agent", routingRole: "writer", ownerGate: false, recoveryPolicy: "OWNER_REAUTHORIZE", enabledForDirectives: ["produce", "produce-pre-media"] }),
  seo: stage({ stageId: "seo", canonicalAgentOrRuntimeRole: "seo", executionType: "LLM", inputArtifactKinds: ["writer_report"], outputArtifactKind: "seo_report", runtimeSchemaId: "amf.seo-report.v1", budgetCallKind: "text_agent", routingRole: "seo", ownerGate: false, recoveryPolicy: "RESUME_FROM_ARTIFACT", enabledForDirectives: ["produce"] }),
  brand: stage({ stageId: "brand", canonicalAgentOrRuntimeRole: "brand", executionType: "LLM", inputArtifactKinds: ["seo_report"], outputArtifactKind: "brand_report", runtimeSchemaId: "amf.brand-report.v1", budgetCallKind: "text_agent", routingRole: "brand", ownerGate: false, recoveryPolicy: "RESUME_FROM_ARTIFACT", enabledForDirectives: ["produce"] }),
  review: stage({ stageId: "review", canonicalAgentOrRuntimeRole: "review", executionType: "LLM", inputArtifactKinds: ["writer_report"], outputArtifactKind: "review_report", runtimeSchemaId: "amf.review-report.v1", budgetCallKind: "text_agent", routingRole: "review", ownerGate: false, recoveryPolicy: "OWNER_REAUTHORIZE", enabledForDirectives: ["produce", "produce-pre-media"] }),
  scenes: stage({ stageId: "scenes", canonicalAgentOrRuntimeRole: "director", executionType: "LLM", inputArtifactKinds: ["writer_report"], outputArtifactKind: "scene_plan", runtimeSchemaId: "amf.scene-plan.v1", budgetCallKind: "text_agent", routingRole: "director", ownerGate: false, recoveryPolicy: "RESUME_FROM_ARTIFACT", enabledForDirectives: ["produce-pre-media"] }),
  director: stage({ stageId: "director", canonicalAgentOrRuntimeRole: "director", executionType: "DETERMINISTIC", inputArtifactKinds: ["writer_report", "review_report"], outputArtifactKind: "scene_plan", runtimeSchemaId: "amf.scene-plan.v1", budgetCallKind: null, routingRole: null, ownerGate: false, recoveryPolicy: "REPLAY_SAFE", enabledForDirectives: ["produce"] }),
  "visual-direction": stage({ stageId: "visual-direction", canonicalAgentOrRuntimeRole: "visual-director", executionType: "LLM", inputArtifactKinds: ["scene_plan"], outputArtifactKind: "visual_direction_contract", runtimeSchemaId: "amf.visual-direction-contract.v2", budgetCallKind: "text_agent", routingRole: "visual-director", ownerGate: false, recoveryPolicy: "OWNER_REAUTHORIZE", enabledForDirectives: ["produce", "produce-pre-media"] }),
  "phase1-qa": stage({ stageId: "phase1-qa", canonicalAgentOrRuntimeRole: "qa", executionType: "LLM", inputArtifactKinds: ["research_report", "ceo_recommendation", "evidence_backed_content_brief", "writer_report", "scene_plan", "visual_direction_contract", "review_report"], outputArtifactKind: "qa_report", runtimeSchemaId: "amf.qa-report.v1", budgetCallKind: "text_agent", routingRole: "qa", ownerGate: false, recoveryPolicy: "OWNER_REAUTHORIZE", enabledForDirectives: ["produce-pre-media"] }),
  "owner-pre-media-gate": stage({ stageId: "owner-pre-media-gate", canonicalAgentOrRuntimeRole: "owner", executionType: "OWNER_GATE", inputArtifactKinds: ["qa_report"], outputArtifactKind: null, runtimeSchemaId: null, budgetCallKind: null, routingRole: null, ownerGate: true, recoveryPolicy: "OWNER_REAUTHORIZE", enabledForDirectives: ["produce-pre-media"] }),
  "pre-production-owner-gate": stage({ stageId: "pre-production-owner-gate", canonicalAgentOrRuntimeRole: "owner", executionType: "OWNER_GATE", inputArtifactKinds: ["review_report"], outputArtifactKind: null, runtimeSchemaId: null, budgetCallKind: null, routingRole: null, ownerGate: true, recoveryPolicy: "OWNER_REAUTHORIZE", enabledForDirectives: ["produce"] }),
  tts: stage({ stageId: "tts", canonicalAgentOrRuntimeRole: "tts", executionType: "CAPABILITY", inputArtifactKinds: ["scene_plan"], outputArtifactKind: "narration_artifact", runtimeSchemaId: "amf.narration.v1", budgetCallKind: "voice", routingRole: null, ownerGate: false, recoveryPolicy: "OWNER_REAUTHORIZE", enabledForDirectives: ["produce"] }),
  timeline: stage({ stageId: "timeline", canonicalAgentOrRuntimeRole: "timeline", executionType: "DETERMINISTIC", inputArtifactKinds: ["scene_plan", "narration_artifact"], outputArtifactKind: "timeline_plan", runtimeSchemaId: "amf.timeline.v1", budgetCallKind: null, routingRole: null, ownerGate: false, recoveryPolicy: "REPLAY_SAFE", enabledForDirectives: ["produce"] }),
  "scene-image": stage({ stageId: "scene-image", canonicalAgentOrRuntimeRole: "scene-image", executionType: "CAPABILITY", inputArtifactKinds: ["scene_plan", "visual_direction_contract"], outputArtifactKind: "scene_visual_artifact", runtimeSchemaId: "amf.scene-visual.v2", budgetCallKind: "image", routingRole: null, ownerGate: false, recoveryPolicy: "OWNER_REAUTHORIZE", enabledForDirectives: ["produce"] }),
  "visual-semantic-review": stage({ stageId: "visual-semantic-review", canonicalAgentOrRuntimeRole: "visual-semantic-review", executionType: "DETERMINISTIC", inputArtifactKinds: ["scene_visual_artifact", "visual_direction_contract"], outputArtifactKind: "visual_semantic_review", runtimeSchemaId: "amf.visual-semantic-review.v1", budgetCallKind: null, routingRole: null, ownerGate: false, recoveryPolicy: "REPLAY_SAFE", enabledForDirectives: ["produce"] }),
  "visual-technical-qa": stage({ stageId: "visual-technical-qa", canonicalAgentOrRuntimeRole: "visual-technical-qa", executionType: "DETERMINISTIC", inputArtifactKinds: ["scene_visual_artifact"], outputArtifactKind: "visual_technical_qa", runtimeSchemaId: "amf.visual-technical-qa.v1", budgetCallKind: null, routingRole: null, ownerGate: false, recoveryPolicy: "REPLAY_SAFE", enabledForDirectives: ["produce"] }),
  "visual-human-gate": stage({ stageId: "visual-human-gate", canonicalAgentOrRuntimeRole: "owner", executionType: "OWNER_GATE", inputArtifactKinds: ["visual_semantic_review", "visual_technical_qa"], outputArtifactKind: null, runtimeSchemaId: null, budgetCallKind: null, routingRole: null, ownerGate: true, recoveryPolicy: "OWNER_REAUTHORIZE", enabledForDirectives: ["produce"] }),
  "wan-authorization": stage({ stageId: "wan-authorization", canonicalAgentOrRuntimeRole: "wan-authorization", executionType: "DETERMINISTIC", inputArtifactKinds: ["visual_semantic_review", "visual_technical_qa"], outputArtifactKind: "wan_authorization", runtimeSchemaId: "amf.wan-authorization.v1", budgetCallKind: null, routingRole: null, ownerGate: false, recoveryPolicy: "REPLAY_SAFE", enabledForDirectives: ["produce"] }),
  video: stage({ stageId: "video", canonicalAgentOrRuntimeRole: "video", executionType: "CAPABILITY", inputArtifactKinds: ["wan_authorization", "scene_visual_artifact"], outputArtifactKind: "scene_video_clip", runtimeSchemaId: "amf.scene-video.v1", budgetCallKind: "video", routingRole: null, ownerGate: false, recoveryPolicy: "OWNER_REAUTHORIZE", enabledForDirectives: ["produce"] }),
  composer: stage({ stageId: "composer", canonicalAgentOrRuntimeRole: "composer", executionType: "DETERMINISTIC", inputArtifactKinds: ["scene_video_clip", "narration_artifact", "timeline_plan"], outputArtifactKind: "final_media_artifact", runtimeSchemaId: "amf.final-media.v1", budgetCallKind: null, routingRole: null, ownerGate: false, recoveryPolicy: "REPLAY_SAFE", enabledForDirectives: ["produce"] }),
  qa: stage({ stageId: "qa", canonicalAgentOrRuntimeRole: "qa", executionType: "LLM", inputArtifactKinds: ["final_media_artifact"], outputArtifactKind: "final_technical_qa", runtimeSchemaId: "amf.final-technical-qa.v1", budgetCallKind: "text_agent", routingRole: "qa", ownerGate: false, recoveryPolicy: "OWNER_REAUTHORIZE", enabledForDirectives: ["produce"] }),
  "final-product-review": stage({ stageId: "final-product-review", canonicalAgentOrRuntimeRole: "review", executionType: "LLM", inputArtifactKinds: ["final_media_artifact", "final_technical_qa"], outputArtifactKind: "final_product_review", runtimeSchemaId: "amf.final-product-review.v1", budgetCallKind: "text_agent", routingRole: "review", ownerGate: false, recoveryPolicy: "OWNER_REAUTHORIZE", enabledForDirectives: ["produce"] }),
  "final-human-gate": stage({ stageId: "final-human-gate", canonicalAgentOrRuntimeRole: "owner", executionType: "OWNER_GATE", inputArtifactKinds: ["final_product_review"], outputArtifactKind: null, runtimeSchemaId: null, budgetCallKind: null, routingRole: null, ownerGate: true, recoveryPolicy: "OWNER_REAUTHORIZE", enabledForDirectives: ["produce"] }),
  "publisher-authorization": stage({ stageId: "publisher-authorization", canonicalAgentOrRuntimeRole: "publisher-authorization", executionType: "DETERMINISTIC", inputArtifactKinds: ["final_product_review"], outputArtifactKind: "publisher_authorization", runtimeSchemaId: "amf.publisher-authorization.v1", budgetCallKind: null, routingRole: null, ownerGate: false, recoveryPolicy: "REPLAY_SAFE", enabledForDirectives: ["produce"] }),
  publisher: stage({ stageId: "publisher", canonicalAgentOrRuntimeRole: "publisher", executionType: "CAPABILITY", inputArtifactKinds: ["publisher_authorization", "final_media_artifact"], outputArtifactKind: "published_report", runtimeSchemaId: "amf.published-report.v1", budgetCallKind: null, routingRole: null, ownerGate: false, recoveryPolicy: "OWNER_REAUTHORIZE", enabledForDirectives: ["produce"] }),
  analytics: stage({ stageId: "analytics", canonicalAgentOrRuntimeRole: "analytics", executionType: "CAPABILITY", inputArtifactKinds: ["published_report"], outputArtifactKind: "analytics_report", runtimeSchemaId: "amf.analytics-report.v1", budgetCallKind: null, routingRole: null, ownerGate: false, recoveryPolicy: "OWNER_REAUTHORIZE", enabledForDirectives: ["produce"] }),
} satisfies Record<string, CanonicalStageDefinition>);

export type CanonicalStageId = keyof typeof CANONICAL_STAGE_CATALOG;

export const CANONICAL_DIRECTIVE_STAGE_IDS = Object.freeze({
  produce: ["planner-initial", "research", "ceo-recommendation", "planner-synthesis", "writer", "seo", "brand", "review", "director", "visual-direction", "tts", "timeline", "scene-image", "visual-semantic-review", "visual-technical-qa", "wan-authorization", "video", "composer", "qa", "final-product-review", "publisher-authorization", "publisher", "analytics"],
  "produce-pre-media": ["orchestrator", "research", "ceo-recommendation", "planner-synthesis", "writer", "scenes", "visual-direction", "review", "phase1-qa"],
} as const satisfies Record<string, readonly CanonicalStageId[]>);

export const DIRECTIVE_OPERATIONAL_STATUS = Object.freeze({
  plan: "DIRECTIVE_RETIRED",
  research: "DIRECTIVE_RETIRED",
  implement: "DIRECTIVE_UNSUPPORTED",
  verify: "DIRECTIVE_UNSUPPORTED",
  ship: "DIRECTIVE_UNSUPPORTED",
  produce: "OPERATIONAL",
  "produce-pre-media": "OPERATIONAL",
} as const);

export function assertDirectiveOperational(directive: string): asserts directive is keyof typeof CANONICAL_DIRECTIVE_STAGE_IDS {
  const status = (DIRECTIVE_OPERATIONAL_STATUS as Record<string, string>)[directive];
  if (status !== "OPERATIONAL") throw new Error(`${status ?? "DIRECTIVE_NOT_OPERATIONAL"}:${directive}`);
}

export interface ArtifactContractDefinition {
  readonly kind: AgentArtifactKind;
  readonly schemaVersion: string;
  readonly producerStages: readonly string[];
  readonly validConsumers: readonly string[];
  readonly runtimeOwnedIdentityFields: readonly string[];
  readonly modelOwnedSemanticFields: readonly string[];
  readonly statusSemantics: readonly string[];
  readonly lineageRequired: boolean;
  readonly authority: ArtifactAuthority;
}

const runtimeIdentity = ["artifactId", "workflowId", "projectId", "contentId", "stage", "taskId", "correlationId", "revisionId", "createdAt"] as const;
const contract = (value: ArtifactContractDefinition): ArtifactContractDefinition => Object.freeze(value);
const simpleContract = (kind: AgentArtifactKind, producerStages: readonly string[], validConsumers: readonly string[], schemaVersion = "1"): ArtifactContractDefinition => contract({ kind, schemaVersion, producerStages, validConsumers, runtimeOwnedIdentityFields: runtimeIdentity, modelOwnedSemanticFields: [], statusSemantics: ["completed", "blocked", "failed"], lineageRequired: producerStages[0] !== "planner-initial" && producerStages[0] !== "orchestrator", authority: "CANONICAL" });

export const ARTIFACT_CONTRACT_REGISTRY = Object.freeze({
  execution_plan: simpleContract("execution_plan", ["planner-initial", "orchestrator"], ["research"]),
  research_report: contract({ kind: "research_report", schemaVersion: "2", producerStages: ["research"], validConsumers: ["ceo-recommendation", "planner-synthesis"], runtimeOwnedIdentityFields: runtimeIdentity, modelOwnedSemanticFields: ["summary", "candidateStories", "sources", "evidenceStatus"], statusSemantics: ["COMPLETED", "FAILED", "INSUFFICIENT_EVIDENCE", "USABLE"], lineageRequired: true, authority: "CANONICAL" }),
  ceo_recommendation: contract({ kind: "ceo_recommendation", schemaVersion: "1", producerStages: ["ceo-recommendation"], validConsumers: ["planner-synthesis"], runtimeOwnedIdentityFields: runtimeIdentity, modelOwnedSemanticFields: ["decision", "rationale", "eligibleCandidateIds", "warnings"], statusSemantics: ["ADVANCE", "HOLD", "RETURN_TO_OWNER", "NO_PRODUCTION_CANDIDATE"], lineageRequired: true, authority: "CANONICAL" }),
  evidence_backed_content_brief: contract({ kind: "evidence_backed_content_brief", schemaVersion: "1", producerStages: ["planner-synthesis"], validConsumers: ["writer"], runtimeOwnedIdentityFields: runtimeIdentity, modelOwnedSemanticFields: ["objective", "finalAngle", "claims", "evidenceRefs", "hookDirection", "writerInstructions"], statusSemantics: ["completed", "blocked"], lineageRequired: true, authority: "CANONICAL" }),
  writer_report: contract({ kind: "writer_report", schemaVersion: "1", producerStages: ["writer"], validConsumers: ["seo", "review", "scenes", "director"], runtimeOwnedIdentityFields: runtimeIdentity, modelOwnedSemanticFields: ["title", "content", "summary", "sourceReferences"], statusSemantics: ["completed", "blocked", "failed"], lineageRequired: true, authority: "CANONICAL" }),
  scene_plan: contract({ kind: "scene_plan", schemaVersion: "1", producerStages: ["scenes", "director"], validConsumers: ["visual-direction", "tts", "timeline", "scene-image"], runtimeOwnedIdentityFields: runtimeIdentity, modelOwnedSemanticFields: ["scenes", "sceneIds"], statusSemantics: ["completed", "blocked", "failed"], lineageRequired: true, authority: "CANONICAL" }),
  visual_direction_contract: contract({ kind: "visual_direction_contract", schemaVersion: "2", producerStages: ["visual-direction"], validConsumers: ["scene-image", "visual-semantic-review"], runtimeOwnedIdentityFields: runtimeIdentity, modelOwnedSemanticFields: ["storyVisualIdentity", "globalContinuity", "characters", "scenes"], statusSemantics: ["completed", "blocked", "failed"], lineageRequired: true, authority: "CANONICAL" }),
  seo_report: simpleContract("seo_report", ["seo"], ["brand"]),
  brand_report: simpleContract("brand_report", ["brand"], ["review"]),
  review_report: simpleContract("review_report", ["review"], ["director", "phase1-qa", "pre-production-owner-gate"]),
  qa_report: simpleContract("qa_report", ["phase1-qa"], ["owner-pre-media-gate"]),
  narration_artifact: simpleContract("narration_artifact", ["tts"], ["timeline", "composer"]),
  timeline_plan: simpleContract("timeline_plan", ["timeline"], ["scene-image", "composer"]),
  scene_visual_artifact: simpleContract("scene_visual_artifact", ["scene-image"], ["visual-semantic-review", "visual-technical-qa", "video"]),
  visual_semantic_review: simpleContract("visual_semantic_review", ["visual-semantic-review"], ["visual-human-gate", "wan-authorization"]),
  visual_technical_qa: simpleContract("visual_technical_qa", ["visual-technical-qa"], ["visual-human-gate", "wan-authorization"]),
  wan_authorization: simpleContract("wan_authorization", ["wan-authorization"], ["video"]),
  scene_video_clip: simpleContract("scene_video_clip", ["video"], ["composer"]),
  final_media_artifact: simpleContract("final_media_artifact", ["composer"], ["qa", "final-product-review", "publisher"]),
  final_technical_qa: simpleContract("final_technical_qa", ["qa"], ["final-product-review"]),
  final_product_review: simpleContract("final_product_review", ["final-product-review"], ["final-human-gate", "publisher-authorization"]),
  publisher_authorization: simpleContract("publisher_authorization", ["publisher-authorization"], ["publisher"]),
  published_report: simpleContract("published_report", ["publisher"], ["analytics"]),
  analytics_report: simpleContract("analytics_report", ["analytics"], []),
  hook_concepts: contract({ kind: "hook_concepts", schemaVersion: "1", producerStages: [], validConsumers: [], runtimeOwnedIdentityFields: runtimeIdentity, modelOwnedSemanticFields: ["concepts"], statusSemantics: ["completed"], lineageRequired: true, authority: "LEGACY_READ_ONLY" }),
  visual_direction_plan: contract({ kind: "visual_direction_plan", schemaVersion: "1", producerStages: [], validConsumers: [], runtimeOwnedIdentityFields: runtimeIdentity, modelOwnedSemanticFields: ["scenes"], statusSemantics: ["completed"], lineageRequired: true, authority: "LEGACY_READ_ONLY" }),
  thumbnail_report: contract({ kind: "thumbnail_report", schemaVersion: "1", producerStages: [], validConsumers: [], runtimeOwnedIdentityFields: runtimeIdentity, modelOwnedSemanticFields: ["imageId", "imageUrl"], statusSemantics: ["completed"], lineageRequired: true, authority: "LEGACY_READ_ONLY" }),
  video_report: contract({ kind: "video_report", schemaVersion: "1", producerStages: [], validConsumers: [], runtimeOwnedIdentityFields: runtimeIdentity, modelOwnedSemanticFields: ["videoId", "videoUrl"], statusSemantics: ["completed"], lineageRequired: true, authority: "LEGACY_READ_ONLY" }),
} satisfies Partial<Record<AgentArtifactKind, ArtifactContractDefinition>>);

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const array = (value: unknown): value is unknown[] => Array.isArray(value);

export class ArtifactContractError extends Error {
  constructor(readonly code: string, readonly path: string) { super(`${code}:${path}`); this.name = "ArtifactContractError"; }
}

function validateSemanticPayload(kind: AgentArtifactKind, payload: Record<string, unknown>): void {
  switch (kind) {
    case "research_report":
      if (!nonEmpty(payload.summary) && !array(payload.candidateStories)) throw new ArtifactContractError("MISSING_SEMANTIC_FIELD", "payload.summary|candidateStories");
      break;
    case "ceo_recommendation":
      if (!["ADVANCE", "HOLD", "RETURN_TO_OWNER", "NO_PRODUCTION_CANDIDATE"].includes(String(payload.decision ?? ""))) throw new ArtifactContractError("INVALID_STATUS", "payload.decision");
      if (!array(payload.eligibleCandidateIds)) throw new ArtifactContractError("MISSING_SEMANTIC_FIELD", "payload.eligibleCandidateIds");
      break;
    case "evidence_backed_content_brief":
      for (const field of ["objective", "finalAngle", "hookDirection"] as const) if (!nonEmpty(payload[field])) throw new ArtifactContractError("MISSING_SEMANTIC_FIELD", `payload.${field}`);
      for (const field of ["claims", "evidenceRefs", "writerInstructions"] as const) if (!array(payload[field])) throw new ArtifactContractError("MISSING_SEMANTIC_FIELD", `payload.${field}`);
      break;
    case "writer_report":
      if (!nonEmpty(payload.title) || !nonEmpty(payload.content)) throw new ArtifactContractError("MISSING_SEMANTIC_FIELD", "payload.title|content");
      break;
    case "scene_plan":
      if (!array(payload.scenes) && !array(payload.sceneIds)) throw new ArtifactContractError("MISSING_SEMANTIC_FIELD", "payload.scenes|sceneIds");
      break;
    case "visual_direction_contract":
      if (!array(payload.scenes)) throw new ArtifactContractError("MISSING_SEMANTIC_FIELD", "payload.scenes");
      break;
  }
}

export function validateArtifactContract(input: {
  readonly artifact: Pick<CollaborationArtifact, "artifactId" | "kind" | "producerAgent" | "workflowId" | "correlationId" | "status" | "payload" | "createdAt" | "parentArtifact">;
  readonly expectedWorkflowId?: string;
  readonly expectedKind?: AgentArtifactKind;
  readonly consumerStage?: string;
}): void {
  const { artifact } = input;
  const definition = (ARTIFACT_CONTRACT_REGISTRY as Partial<Record<AgentArtifactKind, ArtifactContractDefinition>>)[artifact.kind];
  if (definition === undefined) throw new ArtifactContractError("UNREGISTERED_ARTIFACT_KIND", artifact.kind);
  if (definition.authority !== "CANONICAL") throw new ArtifactContractError("LEGACY_READ_ONLY", artifact.kind);
  if (input.expectedKind !== undefined && artifact.kind !== input.expectedKind) throw new ArtifactContractError("ARTIFACT_KIND_MISMATCH", artifact.kind);
  if (input.expectedWorkflowId !== undefined && artifact.workflowId !== input.expectedWorkflowId) throw new ArtifactContractError("RUNTIME_IDENTITY_CONFLICT", "workflowId");
  if (!nonEmpty(artifact.artifactId) || !nonEmpty(artifact.workflowId) || !nonEmpty(artifact.createdAt)) throw new ArtifactContractError("MISSING_RUNTIME_IDENTITY", "artifact");
  if (input.consumerStage !== undefined && !definition.validConsumers.includes(input.consumerStage)) throw new ArtifactContractError("INVALID_CONSUMER", input.consumerStage);
  if (definition.lineageRequired && artifact.parentArtifact === undefined && definition.producerStages[0] !== "research") throw new ArtifactContractError("MISSING_LINEAGE", "parentArtifact");
  if (!isRecord(artifact.payload)) throw new ArtifactContractError("INVALID_PAYLOAD", "payload");
  const payload = artifact.payload as Record<string, unknown>;
  for (const field of runtimeIdentity) {
    const supplied = payload[field];
    if (supplied === undefined) continue;
    const canonical = field === "workflowId" ? artifact.workflowId : field === "artifactId" ? artifact.artifactId : field === "correlationId" ? artifact.correlationId : undefined;
    if (canonical !== undefined && supplied !== canonical) throw new ArtifactContractError("RUNTIME_IDENTITY_CONFLICT", `payload.${field}`);
  }
  validateSemanticPayload(artifact.kind, payload);
}

export type CeoResearchDecision = "ADVANCE" | "HOLD" | "RETURN_TO_OWNER" | "NO_PRODUCTION_CANDIDATE";
export function decideCeoResearchMode(researchPayload: unknown): { readonly decision: CeoResearchDecision; readonly eligibleCandidateIds: readonly string[] } {
  if (!isRecord(researchPayload)) throw new ArtifactContractError("INVALID_PAYLOAD", "research_report.payload");
  const candidates = array(researchPayload.candidateStories) ? researchPayload.candidateStories.filter(isRecord) : [];
  const factualStatus = (candidate: Record<string, unknown>): string => isRecord(candidate.factualVerification)
    ? String(candidate.factualVerification.status ?? "")
    : String(candidate.factualVerification ?? candidate.factualEligibility ?? "");
  const eligible = candidates.filter((candidate) => factualStatus(candidate) === "STRONG"
    && candidate.recommendedForProduction === true
    && candidate.evidenceLineageValidated === true
    && array(candidate.supportingEvidenceIds) && candidate.supportingEvidenceIds.length > 0)
    .map((candidate) => String(candidate.candidateId ?? "")).filter(Boolean);
  if (eligible.length > 0) return { decision: "ADVANCE", eligibleCandidateIds: eligible };
  if (researchPayload.ownerFinalDecision === "CLOSE_WITH_NO_PRODUCTION_CANDIDATE" || researchPayload.evidenceStatus === "INSUFFICIENT_EVIDENCE" || candidates.length === 0) return { decision: "NO_PRODUCTION_CANDIDATE", eligibleCandidateIds: [] };
  if (candidates.some((candidate) => ["PARTIAL", "INCOMPLETE"].includes(factualStatus(candidate)))) return { decision: "RETURN_TO_OWNER", eligibleCandidateIds: [] };
  return { decision: "HOLD", eligibleCandidateIds: [] };
}

export function assertCanonicalStageCatalog(): void {
  for (const [stageId, definition] of Object.entries(CANONICAL_STAGE_CATALOG)) {
    if (stageId !== definition.stageId) throw new Error(`STAGE_CATALOG_ID_MISMATCH:${stageId}`);
    if (definition.outputArtifactKind !== null) {
      const artifact = (ARTIFACT_CONTRACT_REGISTRY as Partial<Record<AgentArtifactKind, ArtifactContractDefinition>>)[definition.outputArtifactKind];
      if (artifact === undefined) throw new Error(`ARTIFACT_CONTRACT_MISSING:${definition.outputArtifactKind}`);
      if (artifact?.authority === "LEGACY_READ_ONLY") throw new Error(`CANONICAL_STAGE_WRITES_LEGACY_KIND:${stageId}`);
    }
  }
  for (const [directive, stageIds] of Object.entries(CANONICAL_DIRECTIVE_STAGE_IDS)) {
    for (const stageId of stageIds) if (!CANONICAL_STAGE_CATALOG[stageId].enabledForDirectives.includes(directive as "produce" | "produce-pre-media")) throw new Error(`DIRECTIVE_STAGE_DRIFT:${directive}:${stageId}`);
  }
}
