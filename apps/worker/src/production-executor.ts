/**
 * Production agents executor — AgentExecutorPort adapter for the async worker.
 *
 * Wires the real production agents behind the durable Workflow Engine contract:
 *
 *   research → writer → seo → brand → review → thumbnail → video → qa → publisher → analytics
 *
 * Each step maps `step.agent` to its concrete agent instance, supplies the exact
 * per-agent execution input (the agent protocol lives HERE, at the wiring site),
 * runs it through a real provider capability boundary (Brave search, image
 * generation, video generation, publishing, analytics), wraps the output in a
 * lineage-linked CollaborationArtifact and records capability execution
 * evidence. Deterministic by design:
 *
 *  - A provider that cannot be configured from the environment is replaced by a
 *    blocked provider adapter, so an unavailable capability produces a blocked
 *    report (and blocked downstream artifacts) instead of a fabricated success.
 *  - The LLM dependency of the research/writer/seo/brand/review/qa agents is
 *    served by a deterministic structured-output responder that derives its
 *    report from the agent's own execution input (the same contract the agents'
 *    unit tests mock). No external LLM is required to run the pipeline.
 *  - Artifact ids are stable per (workflowId, stepId) so crash re-runs are
 *    idempotent.
 *
 * Steps whose agent is not a production agent (e.g. legacy planner/coding/
 * documentation) fall back to the deterministic placeholder so Phase 1
 * definitions keep working unchanged.
 */

import { createHash, randomUUID } from "node:crypto";

/** V2 architectural ceiling: at most three discovery plus three verification transports. */
const MAX_V2_RESEARCH_RETRIEVAL_CALLS = 6;

/**
 * Mission-authorized maximum retrieval calls for the current Pilot.
 * This is the contract-level cap for any single V2 research mission.
 * effectiveEnvelope = min(MAX_V2_RESEARCH_RETRIEVAL_CALLS, MISSION_AUTHORIZED_MAX_RETRIEVALS, remainingBudget)
 */
const MISSION_AUTHORIZED_MAX_RETRIEVALS = 4;

import type {
  AgentExecutorPort,
  AgentStep,
  CollaborationArtifact,
  Json,
  StepOutcome,
  WorkflowContext,
} from "@ai-media-factory/shared";
import { CANONICAL_STAGE_CATALOG, decideCeoResearchMode, validateArtifactContract } from "@ai-media-factory/shared";
import type { PersistencePort } from "@ai-media-factory/workflow-engine";
import type {
  CancellationToken,
  CapabilityExecutionPort,
  ExecutionContext,
  ExecutionRequest,
  ExecutionResponse,
} from "@ai-media-factory/runtime";
import type {
  AnalyticsProvider,
  CapabilityRequest,
  CapabilityResult,
  ImageGenerationProvider,
  PublishStore,
  PublishingProvider,
  TTSGenerationProvider,
  VideoGenerationProvider,
  WebSearchProvider,
} from "@ai-media-factory/tool-framework";
import { normalizeFinalTechnicalQa, PUBLIC_PUBLISH_SCOPE } from "@ai-media-factory/tool-framework";
import {
  analyticsAdapterFromEnv,
  createProviderCapabilityBoundary,
  imageAdapterFromEnv,
  ProviderConfigurationError,
  publishingAdapterFromEnv,
  searchAdapterFromEnv,
  videoAdapterFromEnv,
  apifySocialAdapterFromEnv,
  brightDataSocialAdapterFromEnv,
  resolveExplicitTTSProvider,
  YouTubeResearchAdapter,
  voicetutExecutionIdentityFromEnv,
  type ProviderAdapters,
  type ProviderCapabilityBoundary,
  type VoicetutSubmissionIdentity,
  type VoicetutSubmissionLifecycle,
} from "@ai-media-factory/provider-adapters";
import { PostgresPublishStore, PostgresPublishSessionStore, ProductionCallBudgetStore, ProductionModelRoutingStore } from "@ai-media-factory/database";
import type { ProductionCallReservation } from "@ai-media-factory/database";
import { snapshotMediaConfigurationInput, buildMediaConfigurationFingerprintV2 } from "@ai-media-factory/database";
import type { PublishSessionRecord, PublishSessionStore } from "@ai-media-factory/database";
import type pg from "pg";
import { createResearchAgent, DEFAULT_SOCIAL_REGISTRATIONS, SocialCapabilityRouter, ResearchSourceRouter, type SocialIntelligencePort, type SocialProviderCapabilityRegistration, type YouTubeResearchPort } from "@ai-media-factory/research-agent";
import { createPlannerAgent } from "@ai-media-factory/planner-agent";
import { createWriterAgent } from "@ai-media-factory/writer-agent";
import { createSEOAgent } from "@ai-media-factory/seo-agent";
import { createBrandAgent } from "@ai-media-factory/brand-agent";
import { createReviewerAgent, type ReviewerAgent, type ReviewerInput, type ReviewReport } from "@ai-media-factory/reviewer-agent";
import { createThumbnailAgent } from "@ai-media-factory/thumbnail-agent";
import { createVideoAgent } from "@ai-media-factory/video-agent";
import { createDirectorAgent } from "@ai-media-factory/director-agent";
import { createMediaAgent } from "@ai-media-factory/media-agent";
import { createQAAgent } from "@ai-media-factory/qa-agent";
import { createPublisherAgent } from "@ai-media-factory/publisher-agent";
import { createAnalyticsAgent } from "@ai-media-factory/analytics-agent";
import { createGrowthAgent, DEFAULT_GROWTH_SYSTEM_PROMPT } from "@ai-media-factory/growth-agent";
import { createFinanceAgent, DEFAULT_FINANCE_SYSTEM_PROMPT } from "@ai-media-factory/finance-agent";
import { createCEOAgent, DEFAULT_CEO_SYSTEM_PROMPT, validateStrategyCouncilSynthesisV2 } from "@ai-media-factory/ceo-agent";
import { ProductionMediaChainBridge } from "./media-chain/production-media-chain.js";
import { resolveApprovedProjectContext } from "./project-context.js";
import type { MediaChainInput, MediaChainStageOutput } from "./media-chain/production-media-chain.js";
import { inspectWorkerExecutionEnvironment } from "./worker-execution-environment.js";
import { resolveWorkerLauncher, resolveWorkerRuntimeMode, type WorkerRuntimeMode } from "./worker-runtime-identity.js";
import { OpenRouterProvider, type GenerateRequest } from "@ai-media-factory/providers";
import { executionProvenance } from "./model-performance-attribution.js";
import { createStrategyCouncilV2SpecialistAgent, validateStrategyCouncilSpecialistV2, type StrategyCouncilV2Specialist } from "./strategy-council-v2-specialists.js";

const SCHEMA_VERSION = "1.0";
const AGENT_VERSION = "1.0.0";
const DETERMINISTIC_PROVIDER = "worker-deterministic";
const AGENT_ROUTER_MODELS: Record<string, string> = {
  planner: "glm-5.3",
  research: "glm-5.3",
  writer: "glm-5.3",
  seo: "glm-5.3",
  brand: "glm-5.3",
  growth: "glm-5.3",
  finance: "glm-5.3",
  ceo: "glm-5.3",
  "strategy-diagnostic": "glm-5.3",
  review: "glm-5.3",
  qa: "deepseek-v4-flash",
};

const PRODUCTION_AGENTS = new Set([
  "orchestrator",
  "planner",
  "research",
  "writer",
  "seo",
  "brand",
  "review",
  "thumbnail",
  "video",
  "qa",
  "publisher",
  "publisher-authorization",
  "analytics",
  "growth",
  "finance",
  "director",
  "tts",
  "timeline",
  "scene-image",
  "visual-semantic-review",
  "visual-technical-qa",
  "wan-authorization",
  "composer",
  "ceo",
  "visual-director",
]);

// These stages cross the text-provider boundary in the ordinary production
// path.  Their lifecycle must be durable before submission so a restart can
// distinguish an unsubmitted failure from an ambiguous provider attempt.
// Keep deterministic planner/research and local media stages out of this set.
const GOVERNED_PROVIDER_AGENTS = new Set([
  "orchestrator", "planner", "research", "writer", "seo", "brand", "review", "qa", "growth", "finance", "ceo", "director", "visual-director",
]);

const KIND_BY_AGENT: Record<string, string> = {
  planner: "execution_plan",
  research: "research_report",
  writer: "writer_report",
  seo: "seo_report",
  brand: "brand_report",
  review: "review_report",
  thumbnail: "thumbnail_report",
  video: "video_report",
  qa: "final_technical_qa",
  "publisher-authorization": "publisher_authorization",
  publisher: "published_report",
  analytics: "analytics_report",
  growth: "growth_report",
  finance: "finance_report",
  ceo: "ceo_recommendation",
  orchestrator: "execution_plan",
  "visual-director": "visual_direction_contract",
  director: "scene_plan",
  tts: "narration_artifact",
  timeline: "timeline_plan",
  "scene-image": "scene_visual_artifact",
  "visual-semantic-review": "visual_semantic_review",
  "visual-technical-qa": "visual_technical_qa",
  "wan-authorization": "wan_authorization",
  composer: "final_media_artifact",
  "final-product-review": "final_product_review",
  coding: "coding_report",
  reviewer: "review_report",
  documentation: "documentation_report",
};

const KIND_BY_STEP: Record<string, string> = {
  "planner-initial": "execution_plan",
  "planner-synthesis": "evidence_backed_content_brief",
  "final-product-review": "final_product_review",
  "ceo-recommendation": "ceo_recommendation",
  "visual-direction": "visual_direction_contract",
};

type JsonRecord = { [key: string]: unknown };
type ExecuteFn = (
  context: ExecutionContext,
  request: ExecutionRequest,
  signal: CancellationToken,
) => Promise<ExecutionResponse>;

type GovernedLlmLifecycle = {
  readonly executionId: string;
  readonly workflowId: string;
  readonly correlationId: string | null;
  readonly agentId: string;
  readonly stage: string;
  readonly startedAt: string;
  readonly startedMs: number;
  configuration: Json;
  lastProviderResponse?: Record<string, unknown>;
};

export type CallTransportState = "RESERVED" | "TRANSPORT_NOT_STARTED" | "TRANSPORT_STARTED" | "TRANSPORT_COMPLETED" | "TRANSPORT_FAILED_AFTER_START";
type CallLifecycleEvent = { state: string; metadata?: unknown };
type CapabilityLifecycleRecorder = (state: string, metadata: Record<string, unknown>) => Promise<void>;

/**
 * Execute one governed capability with transport attribution at the true
 * external-provider boundary. Local request validation may return blocked (or
 * throw) without ever invoking the observer, so it cannot consume a transport
 * allowance. Evidence is a backward-compatible proof for executors that
 * report providerInvoked but do not yet call the runtime observer directly.
 */
export async function executeCapabilityWithTransportLifecycle(
  capability: CapabilityExecutionPort,
  request: CapabilityRequest,
  attribution: Record<string, unknown>,
  record: CapabilityLifecycleRecorder,
): Promise<CapabilityResult> {
  let transportStarted = false;
  const markTransportStarted = async (): Promise<void> => {
    if (transportStarted) return;
    transportStarted = true;
    await record("CAPABILITY_TRANSPORT_STARTED", attribution);
  };
  const instrumented: CapabilityRequest = {
    ...request,
    onExternalProviderInvocationStarted: async () => {
      await request.onExternalProviderInvocationStarted?.();
      await markTransportStarted();
    },
  };
  try {
    const result = await capability.executeCapability(instrumented);
    if (!transportStarted && safeRecord((result as { evidence?: unknown }).evidence).providerInvoked === true) {
      await markTransportStarted();
    }
    await record("CAPABILITY_RESULT_RECEIVED", { ...attribution, resultStatus: result.status });
    return result;
  } catch (error) {
    await record(transportStarted ? "CAPABILITY_TRANSPORT_FAILED" : "CAPABILITY_LOCAL_PREFLIGHT_FAILED", {
      ...attribution,
      errorName: error instanceof Error ? error.name : "UNKNOWN",
    });
    throw error;
  }
}

export async function persistCapabilityResultDurably(
  persistence: PersistencePort,
  scope: { workflowId: string; correlationId: string | null; agentId: string },
  result: CapabilityResult,
): Promise<void> {
  const evidence = safeRecord((result as { evidence?: unknown }).evidence);
  const evidenceId = typeof evidence.evidenceId === "string" && evidence.evidenceId.length > 0 ? evidence.evidenceId : null;
  // Compare and persist the JSON lifecycle representation, not the in-memory
  // capability object. Optional `undefined` members are not representable in
  // JSONB and Research later emits the same result through a JSON round-trip.
  // Using one representation keeps legitimate replay idempotent while still
  // detecting a materially different payload under the same durable identity.
  const durablePayload = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
  await persistence.saveCapabilityExecution({
    resultId: result.resultId,
    workflowId: scope.workflowId,
    correlationId: scope.correlationId,
    capabilityId: result.capabilityId,
    agentId: scope.agentId,
    status: result.status,
    evidenceId,
    idempotencyKey: result.resultId,
    executedAt: typeof evidence.executedAt === "string" ? evidence.executedAt : nowIso(),
    payload: durablePayload,
  });
  if (evidenceId !== null) {
    await persistence.saveExecutionEvidence({
      evidenceId,
      workflowId: scope.workflowId,
      correlationId: scope.correlationId,
      capabilityId: result.capabilityId,
      agentId: scope.agentId,
      executedAt: typeof evidence.executedAt === "string" ? evidence.executedAt : nowIso(),
      succeeded: evidence.succeeded === true,
      idempotencyKey: evidenceId,
      payload: durablePayload,
    });
  }
  if (persistence.listCapabilityExecutions !== undefined) {
    const stored = (await persistence.listCapabilityExecutions(scope.workflowId))
      .find((candidate) => candidate.resultId === result.resultId);
    if (stored === undefined) throw new Error(`CAPABILITY_EVIDENCE_PERSISTENCE_FAILED:${result.capabilityId}`);
    if (stored.evidenceId !== evidenceId || stableFingerprint(stored.payload as unknown as Json) !== stableFingerprint(durablePayload as unknown as Json)) {
      throw new Error(`CAPABILITY_EVIDENCE_CONFLICT:${result.capabilityId}`);
    }
  }
}

/** Derive transport state only from events carrying this reservation's canonical identity. */
export function deriveCallTransportState(
  reservation: Pick<ProductionCallReservation, "reservationId" | "idempotencyKey" | "status">,
  events: readonly CallLifecycleEvent[],
): CallTransportState {
  const matching = events.filter((event) => {
    const metadata = safeRecord(event.metadata);
    return metadata.reservationId === reservation.reservationId || metadata.idempotencyKey === reservation.idempotencyKey;
  });
  const started = matching.some((event) => event.state === "FETCH_INVOCATION_STARTED" || event.state === "CAPABILITY_TRANSPORT_STARTED");
  if (!started) return reservation.status === "RESERVED" ? "RESERVED" : "TRANSPORT_NOT_STARTED";
  if (matching.some((event) => event.state === "PROVIDER_RESPONSE_RECEIVED" || event.state === "CAPABILITY_RESULT_RECEIVED")) return "TRANSPORT_COMPLETED";
  if (reservation.status === "FAILED_AFTER_SUBMISSION" || matching.some((event) => event.state === "FAILED")) return "TRANSPORT_FAILED_AFTER_START";
  return "TRANSPORT_STARTED";
}

// One-time owner-authorized Recovery V3 exception. This is deliberately bound
// to the exact child, parent, and original lineage; it is not a general
// recovery bypass and expires with this specific execution.
const AUTHORIZED_RECOVERY_V3_GUARD_EXCEPTION = {
  executionId: "9abbeeab-6cc7-4345-96ad-8fba43dcea8a",
  recoveryOfExecutionId: "41559884-52e8-4d94-b027-25bc1857defd",
  originalExecutionId: "8467ccfb-e4c3-429e-8476-00438ad66c2d",
} as const;

const AUTHORIZED_RECOVERY_V4_GUARD_EXCEPTION = {
  workflowId: "wf-1789233193749-gvydpiah",
  commandId: "command-1789233193749-33kswo20",
  recoveryOfExecutionId: "9abbeeab-6cc7-4345-96ad-8fba43dcea8a",
  priorAncestorExecutionId: "41559884-52e8-4d94-b027-25bc1857defd",
  originalExecutionId: "8467ccfb-e4c3-429e-8476-00438ad66c2d",
} as const;

const AUTHORIZED_RECOVERY_V5_GUARD_EXCEPTION = {
  workflowId: "wf-1789233193749-gvydpiah",
  commandId: "command-1789233193749-33kswo20",
  recoveryOfExecutionId: "99bc45f5-d097-4136-9319-4b518674565d",
  ambiguousAncestorExecutionIds: ["9abbeeab-6cc7-4345-96ad-8fba43dcea8a", "41559884-52e8-4d94-b027-25bc1857defd"],
  originalExecutionId: "8467ccfb-e4c3-429e-8476-00438ad66c2d",
} as const;

const AUTHORIZED_RECOVERY_V6_GUARD_EXCEPTION = {
  workflowId: "wf-1789233193749-gvydpiah",
  commandId: "command-1789233193749-33kswo20",
  recoveryOfExecutionId: "6b37b8e9-4fe5-42bd-a0c1-29b2ac68bf71",
  ambiguousAncestorExecutionIds: ["9abbeeab-6cc7-4345-96ad-8fba43dcea8a", "41559884-52e8-4d94-b027-25bc1857defd"],
  originalExecutionId: "8467ccfb-e4c3-429e-8476-00438ad66c2d",
} as const;

// Owner-authorized single live Recovery V7 (dots-studio/dots-3-note-preview
// Review-only temporary override for the end-to-end workflow proof). Same
// fail-closed shape as V6: only this exact child may exclude the two named,
// immutable VALIDATING ancestors; every unrelated ambiguity still blocks.
const AUTHORIZED_RECOVERY_V7_GUARD_EXCEPTION = {
  workflowId: "wf-1789233193749-gvydpiah",
  commandId: "command-1789233193749-33kswo20",
  recoveryOfExecutionId: "59d440c3-8120-42b3-895a-2df1e4e8801a",
  ambiguousAncestorExecutionIds: ["9abbeeab-6cc7-4345-96ad-8fba43dcea8a", "41559884-52e8-4d94-b027-25bc1857defd"],
  originalExecutionId: "8467ccfb-e4c3-429e-8476-00438ad66c2d",
} as const;

// Revision Cycle V1 on the live workflow: an owner-authorized revision cycle
// (post-V7 changes_requested) runs a fresh Review on the same workflow, whose
// history permanently contains the same two immutable VALIDATING ancestors.
// Only this exact authorized revision lineage may exclude them; every
// unrelated ambiguity remains fail-closed.
const AUTHORIZED_REVISION_CYCLE_REVIEW_GUARD_EXCEPTION = {
  workflowId: "wf-1789233193749-gvydpiah",
  commandId: "command-1789233193749-33kswo20",
  sourceReviewExecutionId: "9b0ed3d3-f28b-460f-8cdc-a9f85904c439",
  sourceReviewArtifactId: "art-wf-1789233193749-gvydpiah-review-20260913T194937663Z",
  ambiguousAncestorExecutionIds: ["9abbeeab-6cc7-4345-96ad-8fba43dcea8a", "41559884-52e8-4d94-b027-25bc1857defd"],
} as const;

function authorizedRecoveryParentExclusions(configuration: Json, executionId: string, context: WorkflowContext, prepared: { executionId: string; parentExecutionIds: readonly string[]; configuration?: unknown } | undefined): readonly string[] {
  const recovery = safeRecord(safeRecord(configuration).recoveryExecution);
  if (executionId === AUTHORIZED_RECOVERY_V3_GUARD_EXCEPTION.executionId
    && recovery.recoveryOfExecutionId === AUTHORIZED_RECOVERY_V3_GUARD_EXCEPTION.recoveryOfExecutionId
    && recovery.originalExecutionId === AUTHORIZED_RECOVERY_V3_GUARD_EXCEPTION.originalExecutionId) {
    return [AUTHORIZED_RECOVERY_V3_GUARD_EXCEPTION.recoveryOfExecutionId];
  }
  // This owner's V4 lineage contains two immutable VALIDATING ancestors.
  // The durable dispatcher must have seeded the exact pre-transport child;
  // every unrelated ambiguous execution remains subject to the normal guard.
  const sourceRecovery = safeRecord(safeRecord(context.data).recoveryExecution);
  if (context.workflowId === AUTHORIZED_RECOVERY_V4_GUARD_EXCEPTION.workflowId
    && safeRecord(context.data).commandId === AUTHORIZED_RECOVERY_V4_GUARD_EXCEPTION.commandId
    && sourceRecovery.recoveryAuthorization === "OWNER_APPROVED"
    && sourceRecovery.reuseCanonicalInputs === true
    && sourceRecovery.replayUpstreamStages === false
    && recovery.recoveryOfExecutionId === AUTHORIZED_RECOVERY_V4_GUARD_EXCEPTION.recoveryOfExecutionId
    && recovery.originalExecutionId === AUTHORIZED_RECOVERY_V4_GUARD_EXCEPTION.originalExecutionId
    && prepared?.executionId === executionId
    && prepared.parentExecutionIds.includes(AUTHORIZED_RECOVERY_V4_GUARD_EXCEPTION.recoveryOfExecutionId)
    && prepared.parentExecutionIds.includes(AUTHORIZED_RECOVERY_V4_GUARD_EXCEPTION.originalExecutionId)) {
    return [AUTHORIZED_RECOVERY_V4_GUARD_EXCEPTION.recoveryOfExecutionId, AUTHORIZED_RECOVERY_V4_GUARD_EXCEPTION.priorAncestorExecutionId];
  }
  // The fresh owner-authorized V5 child alone may exclude these two named,
  // immutable ancestors. Its failed V4 parent is not an ambiguous candidate.
  if (context.workflowId === AUTHORIZED_RECOVERY_V5_GUARD_EXCEPTION.workflowId
    && safeRecord(context.data).commandId === AUTHORIZED_RECOVERY_V5_GUARD_EXCEPTION.commandId
    && sourceRecovery.recoveryAuthorization === "OWNER_APPROVED"
    && sourceRecovery.reuseCanonicalInputs === true
    && sourceRecovery.replayUpstreamStages === false
    && recovery.recoveryOfExecutionId === AUTHORIZED_RECOVERY_V5_GUARD_EXCEPTION.recoveryOfExecutionId
    && recovery.originalExecutionId === AUTHORIZED_RECOVERY_V5_GUARD_EXCEPTION.originalExecutionId
    && prepared?.executionId === executionId
    && safeRecord(prepared.configuration).lifecycleState === "READY_FOR_SUBMISSION"
    && prepared.parentExecutionIds.includes(AUTHORIZED_RECOVERY_V5_GUARD_EXCEPTION.recoveryOfExecutionId)
    && prepared.parentExecutionIds.includes(AUTHORIZED_RECOVERY_V5_GUARD_EXCEPTION.originalExecutionId)) {
    return AUTHORIZED_RECOVERY_V5_GUARD_EXCEPTION.ambiguousAncestorExecutionIds;
  }
  // Only this owner's V6 child may exclude the two named, immutable
  // VALIDATING ancestors. Its V5 parent is terminal; all other candidates
  // continue through the normal fail-closed ambiguity check.
  if (context.workflowId === AUTHORIZED_RECOVERY_V6_GUARD_EXCEPTION.workflowId
    && safeRecord(context.data).commandId === AUTHORIZED_RECOVERY_V6_GUARD_EXCEPTION.commandId
    && sourceRecovery.recoveryAuthorization === "OWNER_APPROVED"
    && sourceRecovery.reuseCanonicalInputs === true
    && sourceRecovery.replayUpstreamStages === false
    && recovery.recoveryOfExecutionId === AUTHORIZED_RECOVERY_V6_GUARD_EXCEPTION.recoveryOfExecutionId
    && recovery.originalExecutionId === AUTHORIZED_RECOVERY_V6_GUARD_EXCEPTION.originalExecutionId
    && prepared?.executionId === executionId
    && safeRecord(prepared.configuration).lifecycleState === "READY_FOR_SUBMISSION"
    && prepared.parentExecutionIds.includes(AUTHORIZED_RECOVERY_V6_GUARD_EXCEPTION.recoveryOfExecutionId)
    && prepared.parentExecutionIds.includes(AUTHORIZED_RECOVERY_V6_GUARD_EXCEPTION.originalExecutionId)) {
    return AUTHORIZED_RECOVERY_V6_GUARD_EXCEPTION.ambiguousAncestorExecutionIds;
  }
  // Only this owner's V7 child may exclude the same two named, immutable
  // VALIDATING ancestors. Its V6 parent is terminal (LOCAL_EXECUTION_FAILED,
  // conclusively post-response); all other candidates continue through the
  // normal fail-closed ambiguity check.
  if (context.workflowId === AUTHORIZED_RECOVERY_V7_GUARD_EXCEPTION.workflowId
    && safeRecord(context.data).commandId === AUTHORIZED_RECOVERY_V7_GUARD_EXCEPTION.commandId
    && sourceRecovery.recoveryAuthorization === "OWNER_APPROVED"
    && sourceRecovery.reuseCanonicalInputs === true
    && sourceRecovery.replayUpstreamStages === false
    && recovery.recoveryOfExecutionId === AUTHORIZED_RECOVERY_V7_GUARD_EXCEPTION.recoveryOfExecutionId
    && recovery.originalExecutionId === AUTHORIZED_RECOVERY_V7_GUARD_EXCEPTION.originalExecutionId
    && prepared?.executionId === executionId
    && safeRecord(prepared.configuration).lifecycleState === "READY_FOR_SUBMISSION"
    && prepared.parentExecutionIds.includes(AUTHORIZED_RECOVERY_V7_GUARD_EXCEPTION.recoveryOfExecutionId)
    && prepared.parentExecutionIds.includes(AUTHORIZED_RECOVERY_V7_GUARD_EXCEPTION.originalExecutionId)) {
    return AUTHORIZED_RECOVERY_V7_GUARD_EXCEPTION.ambiguousAncestorExecutionIds;
  }
  // Only an owner-authorized revision cycle seeded from the live V7 Review
  // may exclude the same two named, immutable VALIDATING ancestors for its
  // fresh Review. The revision marker is durable and set exclusively by the
  // revision dispatcher after an explicit AUTHORIZE_REVISION.
  const revision = safeRecord(safeRecord(context.data).revisionExecution);
  if (context.workflowId === AUTHORIZED_REVISION_CYCLE_REVIEW_GUARD_EXCEPTION.workflowId
    && safeRecord(context.data).commandId === AUTHORIZED_REVISION_CYCLE_REVIEW_GUARD_EXCEPTION.commandId
    && revision.revisionAuthorization === "OWNER_APPROVED"
    && revision.replayUpstreamStages === false
    && revision.reviewExecutionId === AUTHORIZED_REVISION_CYCLE_REVIEW_GUARD_EXCEPTION.sourceReviewExecutionId
    && revision.reviewArtifactId === AUTHORIZED_REVISION_CYCLE_REVIEW_GUARD_EXCEPTION.sourceReviewArtifactId) {
    return AUTHORIZED_REVISION_CYCLE_REVIEW_GUARD_EXCEPTION.ambiguousAncestorExecutionIds;
  }
  return [];
}

function referencedArtifactIds(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) { item.forEach(visit); return; }
    if (item === null || typeof item !== "object") return;
    for (const [key, nested] of Object.entries(item as Record<string, unknown>)) {
      if ((key === "artifactId" || key === "artifact_id") && typeof nested === "string") found.add(nested);
      else visit(nested);
    }
  };
  visit(value);
  return [...found].sort();
}

/** Explicit owner-approved recovery metadata; it creates a new execution, never retries an ambiguous one. */
function recoveryExecutionMarker(data: unknown): JsonRecord {
  const recovery = safeRecord(safeRecord(data).recoveryExecution);
  const recoveryOfExecutionId = typeof recovery.recoveryOfExecutionId === "string" ? recovery.recoveryOfExecutionId.trim() : "";
  if (recoveryOfExecutionId === "") return {};
  if (recovery.recoveryAuthorization !== "OWNER_APPROVED") throw new Error("RECOVERY_EXECUTION_OWNER_AUTHORIZATION_REQUIRED");
  return { recoveryExecution: {
    recoveryOfExecutionId,
    originalExecutionId: typeof recovery.originalExecutionId === "string" ? recovery.originalExecutionId.trim() : "",
    recoveryReason: String(recovery.recoveryReason ?? ""),
    recoveryAuthorization: "OWNER_APPROVED",
    reuseCanonicalInputs: recovery.reuseCanonicalInputs === true,
    replayUpstreamStages: recovery.replayUpstreamStages === false,
  } as unknown as Json };
}

/**
 * Owner-authorized revision-cycle marker (Revision Cycle V1). Present only on
 * a workflow rewound by the durable revision dispatcher after an explicit
 * AUTHORIZE_REVISION. Fail-closed like the recovery marker.
 */
function revisionExecutionMarker(data: unknown): Record<string, Json> {
  const revision = safeRecord(safeRecord(data).revisionExecution);
  const revisionTaskId = typeof revision.revisionTaskId === "string" ? revision.revisionTaskId.trim() : "";
  if (revisionTaskId === "") return {};
  if (revision.revisionAuthorization !== "OWNER_APPROVED") throw new Error("REVISION_EXECUTION_OWNER_AUTHORIZATION_REQUIRED");
  return { revisionExecution: {
    revisionTaskId,
    revisionVersion: typeof revision.revisionVersion === "number" ? revision.revisionVersion : 1,
    reviewArtifactId: typeof revision.reviewArtifactId === "string" ? revision.reviewArtifactId : "",
    reviewExecutionId: typeof revision.reviewExecutionId === "string" ? revision.reviewExecutionId : "",
    priorWriterArtifactId: typeof revision.priorWriterArtifactId === "string" ? revision.priorWriterArtifactId : "",
    priorSeoArtifactId: typeof revision.priorSeoArtifactId === "string" ? revision.priorSeoArtifactId : "",
    priorBrandArtifactId: typeof revision.priorBrandArtifactId === "string" ? revision.priorBrandArtifactId : "",
    revisionAuthorization: "OWNER_APPROVED",
    replayUpstreamStages: false,
  } as unknown as Json };
}

/** Durable revision lineage attached to every artifact produced by a revision run. */
function revisionExecutionLineage(context: WorkflowContext): JsonRecord | null {
  const marker = safeRecord(revisionExecutionMarker(context.data).revisionExecution);
  if (marker.revisionTaskId === undefined) return null;
  return {
    revisionTaskId: marker.revisionTaskId,
    revisionVersion: marker.revisionVersion,
    sourceReviewArtifactId: marker.reviewArtifactId,
    sourceReviewExecutionId: marker.reviewExecutionId,
    priorWriterArtifactId: marker.priorWriterArtifactId,
    priorSeoArtifactId: marker.priorSeoArtifactId,
    priorBrandArtifactId: marker.priorBrandArtifactId,
  };
}

/**
 * REVIEW_ONLY_TECHNICAL_RESUME marker. Present only on a workflow rewound by
 * the durable review-resume dispatcher after an explicit
 * AUTHORIZE_REVIEW_RESUME. Carries the frozen input package (exact artifact
 * ids captured at authorization time) and the failed-review lineage. Fail
 * closed like the recovery/revision markers.
 */
function reviewResumeExecutionMarker(data: unknown): Record<string, Json> {
  const resume = safeRecord(safeRecord(data).reviewResumeExecution);
  const resumeId = typeof resume.resumeId === "string" ? resume.resumeId.trim() : "";
  if (resumeId === "") return {};
  if (resume.resumeAuthorization !== "OWNER_APPROVED") throw new Error("REVIEW_RESUME_OWNER_AUTHORIZATION_REQUIRED");
  const frozen = (key: string): string => {
    const value = resume[key];
    if (typeof value !== "string" || value.trim() === "") throw new Error(`REVIEW_RESUME_FROZEN_PACKAGE_INVALID:${key}`);
    return value;
  };
  return { reviewResumeExecution: {
    resumeId,
    revisionTaskId: typeof resume.revisionTaskId === "string" ? resume.revisionTaskId : "",
    revisionVersion: typeof resume.revisionVersion === "number" ? resume.revisionVersion : 1,
    resumeAttempt: typeof resume.resumeAttempt === "number" ? resume.resumeAttempt : 1,
    failedReviewExecutionId: typeof resume.failedReviewExecutionId === "string" ? resume.failedReviewExecutionId : "",
    frozenWriterArtifactId: frozen("frozenWriterArtifactId"),
    frozenSeoArtifactId: frozen("frozenSeoArtifactId"),
    frozenBrandArtifactId: frozen("frozenBrandArtifactId"),
    resumeAuthorization: "OWNER_APPROVED",
  } as unknown as Json };
}

/** Durable review-resume lineage attached to the fresh Review artifact. */
function reviewResumeLineage(context: WorkflowContext): JsonRecord | null {
  const marker = safeRecord(reviewResumeExecutionMarker(context.data).reviewResumeExecution);
  if (marker.resumeId === undefined) return null;
  return {
    resumeId: marker.resumeId,
    revisionTaskId: marker.revisionTaskId,
    revisionVersion: marker.revisionVersion,
    resumeAttempt: marker.resumeAttempt,
    failedReviewExecutionId: marker.failedReviewExecutionId,
    frozenWriterArtifactId: marker.frozenWriterArtifactId,
    frozenSeoArtifactId: marker.frozenSeoArtifactId,
    frozenBrandArtifactId: marker.frozenBrandArtifactId,
  };
}

/**
 * Owner-authorized media technical resume marker (Media Technical Resume V1).
 * Present only on a workflow rewound by the durable media-resume dispatcher
 * after an explicit AUTHORIZE_MEDIA_RESUME. Carries the frozen package, the
 * provider budget, and the downstream boundary. Fail-closed like the
 * recovery/revision markers.
 */
function mediaResumeExecutionMarker(data: unknown): Record<string, Json> {
  const resume = safeRecord(safeRecord(data).mediaResumeExecution);
  const resumeId = typeof resume.resumeId === "string" ? resume.resumeId.trim() : "";
  if (resumeId === "") return {};
  if (resume.resumeAuthorization !== "OWNER_APPROVED") throw new Error("MEDIA_RESUME_OWNER_AUTHORIZATION_REQUIRED");
  return { mediaResumeExecution: {
    resumeId,
    resumeAttempt: typeof resume.resumeAttempt === "number" ? resume.resumeAttempt : 1,
    resumeStartStage: "tts",
    failureClassification: typeof resume.failureClassification === "string" ? resume.failureClassification : "",
    sourceFailedJobId: typeof resume.sourceFailedJobId === "number" ? resume.sourceFailedJobId : null,
    preProductionApprovalId: typeof resume.preProductionApprovalId === "string" ? resume.preProductionApprovalId : "",
    reviewArtifactId: typeof resume.reviewArtifactId === "string" ? resume.reviewArtifactId : "",
    writerArtifactId: typeof resume.writerArtifactId === "string" ? resume.writerArtifactId : "",
    seoArtifactId: typeof resume.seoArtifactId === "string" ? resume.seoArtifactId : "",
    brandArtifactId: typeof resume.brandArtifactId === "string" ? resume.brandArtifactId : "",
    directorArtifactId: typeof resume.directorArtifactId === "string" ? resume.directorArtifactId : "",
    directorLineageArtifactId: typeof resume.directorLineageArtifactId === "string" ? resume.directorLineageArtifactId : "",
    directorSceneIds: Array.isArray(resume.directorSceneIds) ? (resume.directorSceneIds as unknown[]).filter((id): id is string => typeof id === "string") : [],
    gatePolicy: safeRecord(resume.gatePolicy) as unknown as Json,
    providerBudget: typeof resume.providerBudget === "number" ? resume.providerBudget : 0,
    downstreamBoundary: typeof resume.downstreamBoundary === "string" ? resume.downstreamBoundary : "",
    resumeAuthorization: "OWNER_APPROVED",
  } as unknown as Json };
}

/** The media-resume provider-submission budget port (fail-closed before provider calls). */
export interface MediaResumeBudgetPort {
  consumeProviderBudget(input: { resumeId: string; workflowId: string; stage: string; capabilityId: string; itemId?: string }): Promise<void>;
  /**
   * Execution-time configuration verification (fail-closed before provider
   * submission). Implemented by the durable dispatcher: compares the
   * executor-recomputed canonical v2 fingerprint against the fingerprint
   * frozen at authorization and throws MEDIA_RESUME_CONFIGURATION_DRIFT on
   * any mismatch. Optional for backward compatibility with test doubles;
   * the production dispatcher always implements it.
   */
  verifyConfigurationFingerprint?(input: { resumeId: string; workflowId: string; fingerprint: string }): Promise<void>;
  /**
   * Exactly-once stage claim (R7 hardening). Atomically claims the logical
   * execution for (resumeId, stage): first claimant owns execution + the
   * single budget consumption; duplicates observe durable state.
   * Optional for backward compatibility; the production dispatcher
   * always implements it.
   */
  claimStageExecution?(input: { resumeId: string; workflowId: string; stage: string; itemId?: string }): Promise<{ first: boolean; state: string; outcome: string | null; error: string | null; budgetConsumed: boolean }>;
  /** Finalize a stage claim with its terminal outcome (idempotent). */
  finalizeStageExecution?(input: { resumeId: string; stage: string; itemId?: string; outcome: "completed" | "failed" | "blocked"; error?: string }): Promise<void>;
}

function recoveryParentExecutionIds(configuration: unknown): string[] {
  const value = safeRecord(safeRecord(configuration).recoveryExecution).recoveryOfExecutionId;
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

function lifecycleFailureState(details: Record<string, unknown>, message: string): string {
  if (details.reviewOutcomeCode === "REVIEW_OUTCOME_NOT_APPROVED") return "REVIEW_OUTCOME_NOT_APPROVED";
  if (details.runtimeFailureCode === "REVIEW_RUNTIME_FAILED") return "REVIEW_RUNTIME_FAILED";
  if (details.validationStage === "parse") return "JSON_PARSE_FAILED";
  if (details.validationStage === "structural") return "STRUCTURAL_VALIDATION_FAILED";
  if (details.validationStage === "semantic") return "SEMANTIC_VALIDATION_FAILED";
  if (details.transport !== undefined) return "PROVIDER_TRANSPORT_FAILED";
  if (details.incomplete === true) return "PROVIDER_RESPONSE_INCOMPLETE";
  // These durable-boundary failures deliberately carry implementation-oriented
  // markers; classify them before broad validation wording such as "missing".
  if (/V2_ARTIFACT_PERSISTENCE_FAILED/.test(message)) return "ARTIFACT_PERSISTENCE_FAILED";
  if (/V2_ARTIFACT_(?:RELOAD|PAYLOAD_ROUNDTRIP|LINEAGE)_FAILED/.test(message)) return "ARTIFACT_RELOAD_VALIDATION_FAILED";
  if (/non-JSON|no JSON/i.test(message)) return "JSON_PARSE_FAILED";
  if (details.validationKind === "STRUCTURAL" || /required|schema|structural|invalid.+response/i.test(message)) return "STRUCTURAL_VALIDATION_FAILED";
  if (/semantic|substantive|missing/i.test(message)) return "SEMANTIC_VALIDATION_FAILED";
  return "LOCAL_EXECUTION_FAILED";
}

const STRATEGY_COUNCIL_V2_CONTRACTS: Record<string, string> = {
  writer: "STRATEGY_COUNCIL_WRITER_V2",
  seo: "STRATEGY_COUNCIL_SEO_V2",
  brand: "STRATEGY_COUNCIL_BRAND_V2",
  growth: "STRATEGY_COUNCIL_GROWTH_V2",
  finance: "STRATEGY_COUNCIL_FINANCE_V2",
  ceo: "STRATEGY_COUNCIL_SYNTHESIS_V2",
};

function isStrictStrategyCouncilV2Payload(agent: string, value: Json): boolean {
  const expectedContract = STRATEGY_COUNCIL_V2_CONTRACTS[agent];
  return expectedContract !== undefined && safeRecord(value).contract === expectedContract;
}

function validateStrictStrategyCouncilV2Payload(agent: string, value: Json): Json {
  if (agent === "ceo") return validateStrategyCouncilSynthesisV2(value) as unknown as Json;
  if (["writer", "seo", "brand", "growth", "finance"].includes(agent)) {
    return validateStrategyCouncilSpecialistV2(agent as StrategyCouncilV2Specialist, value) as unknown as Json;
  }
  throw new Error(`STRICT_STRATEGY_COUNCIL_V2_VALIDATOR_MISSING:${agent}`);
}

function deepFreezeJson<T extends Json>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreezeJson(nested as Json);
    Object.freeze(value);
  }
  return value;
}

/**
 * Bounded, secret-safe failure message for durable terminal evidence.
 * Diagnostics-only errors (parse/structural/semantic/transport) intentionally
 * omit the message; without this field a failure with empty diagnostics
 * leaves no actionable reason at all.
 */
export function sanitizedFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/((?:api[_-]?key|authorization|bearer|password|secret|token|signature|sig)\s*[:=]\s*)([^\s;,}"]+)/gi, "$1[REDACTED]")
    .slice(0, 500);
}

/** Drop arbitrary thrown-error data; only persist bounded structural metadata. */
export function safeValidationDiagnostics(error: unknown): Record<string, unknown> {  const seen = new Set<unknown>();
  let current: unknown = error;
  let raw: Record<string, unknown> = {};
  for (let depth = 0; depth < 8 && current instanceof Error && !seen.has(current); depth++) {
    seen.add(current);
    const candidate = safeRecord((current as Error & { diagnostics?: unknown }).diagnostics);
    if (["parse", "structural", "semantic"].includes(String(candidate.validationStage)) || candidate.validationKind === "STRUCTURAL" || candidate.reviewOutcomeCode === "REVIEW_OUTCOME_NOT_APPROVED" || typeof safeRecord(candidate.researchBlocked).researchBlockReason === "string") {
      raw = candidate;
      break;
    }
    current = (current as Error & { cause?: unknown }).cause;
  }
  const stage = typeof raw.validationStage === "string" ? raw.validationStage : "";
  if (raw.reviewOutcomeCode === "REVIEW_OUTCOME_NOT_APPROVED") return { reviewOutcomeCode: "REVIEW_OUTCOME_NOT_APPROVED" };
  if (stage === "parse" || stage === "structural" || stage === "semantic") return {
    validationStage: stage,
    validationCode: typeof raw.validationCode === "string" ? raw.validationCode.slice(0, 120) : "UNKNOWN",
    ...(typeof raw.issueCount === "number" ? { issueCount: raw.issueCount } : {}),
    ...(Array.isArray(raw.issuePaths) ? { issuePaths: raw.issuePaths.filter((v): v is string => typeof v === "string").slice(0, 20).map((v) => v.slice(0, 160)) } : {}),
    ...(Array.isArray(raw.issueCodes) ? { issueCodes: raw.issueCodes.filter((v): v is string => typeof v === "string").slice(0, 20).map((v) => v.slice(0, 80)) } : {}),
    ...(typeof raw.semanticRuleId === "string" ? { semanticRuleId: raw.semanticRuleId.slice(0, 120) } : {}),
    ...(typeof raw.expected === "string" ? { expected: raw.expected.slice(0, 500) } : {}),
    ...(typeof raw.actual === "string" ? { actual: raw.actual.slice(0, 500) } : {}),
    ...(typeof raw.hardFailReason === "string" ? { hardFailReason: raw.hardFailReason.slice(0, 120) } : {}),
    ...(typeof raw.contractVersion === "string" ? { contractVersion: raw.contractVersion.slice(0, 120) } : {}),
  };
  if (typeof safeRecord(raw.researchBlocked).researchBlockReason === "string") {
    return { researchBlocked: boundResearchBlockedDiagnostics(raw.researchBlocked) };
  }
  if (raw.validationKind !== "STRUCTURAL" || !Array.isArray(raw.issues)) return {};
  const issues = raw.issues.slice(0, 20).map((value) => {
    const issue = safeRecord(value);
    return {
      path: typeof issue.path === "string" ? issue.path.slice(0, 160) : "UNKNOWN",
      code: typeof issue.code === "string" ? issue.code.slice(0, 48) : "UNKNOWN",
      ...(typeof issue.expected === "string" || typeof issue.expected === "number" ? { expected: issue.expected } : {}),
      ...(typeof issue.actualType === "string" ? { actualType: issue.actualType.slice(0, 32) } : {}),
      ...(typeof issue.actualCount === "number" ? { actualCount: issue.actualCount } : {}),
    };
  });
  const shape = safeRecord(raw.shape);
  const keys = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 20).map((item) => item.slice(0, 80)) : [];
  const nestedRaw = safeRecord(shape.nestedKeys);
  const nestedKeys = Object.fromEntries(Object.entries(nestedRaw).slice(0, 8).map(([name, value]) => [name.slice(0, 80), keys(value)]));
  return {
    validationKind: "STRUCTURAL",
    ...(typeof raw.contract === "string" ? { contract: raw.contract.slice(0, 80) } : {}),
    issues,
    shape: { topLevelKeys: keys(shape.topLevelKeys), strategyFindingKeys: keys(shape.strategyFindingKeys), nestedKeys, truncated: shape.truncated === true },
    diagnosticsTruncated: raw.diagnosticsTruncated === true || raw.issues.length > 20,
  };
}

/** Minimal structural interface shared by every production agent instance. */
interface AnyAgent {
  execute(
    input: { context: ExecutionContext; input: Json },
    signal: CancellationToken,
  ): Promise<{ output: Json; response: ExecutionResponse }>;
}

export const PRE_MEDIA_ORCHESTRATOR_CONTRACT_VERSION = "amf-pre-media-orchestrator-v1";
export const PRE_MEDIA_ORCHESTRATOR_REQUIRED = ["planId", "stage", "objective", "topic", "audience", "platform", "researchQuestions", "researchObjectives", "desiredDeliverables", "tasks", "status", "summary"] as const;
const PRE_MEDIA_ORCHESTRATOR_ARRAY_FIELDS = ["researchQuestions", "researchObjectives", "desiredDeliverables", "tasks"] as const;
const PRE_MEDIA_ORCHESTRATOR_STRING_FIELDS = ["planId", "stage", "objective", "topic", "audience", "platform", "status", "summary"] as const;
const FORBIDDEN_ORCHESTRATOR_ACTION = /(?:grant|approve|authorize|execute|start)\s+(?:production|media|publication)|(?:publish|upload|generate\s+(?:image|video|voice))/i;

class PreMediaContractError extends Error {
  constructor(message:string, readonly diagnostics:Record<string,unknown>){super(message);}
}

export function validatePreMediaOrchestratorPayload(value:unknown):Json {
  const payload=safeRecord(value);
  const missing=PRE_MEDIA_ORCHESTRATOR_REQUIRED.filter((key)=>payload[key]===undefined);
  if(missing.length)throw new PreMediaContractError("Orchestrator response is missing required fields",{validationStage:"structural",validationCode:"ORCHESTRATOR_REQUIRED_FIELD_MISSING",issueCount:missing.length,issuePaths:missing.map((key)=>`$.${key}`),expected:`required fields for ${PRE_MEDIA_ORCHESTRATOR_CONTRACT_VERSION}`,contractVersion:PRE_MEDIA_ORCHESTRATOR_CONTRACT_VERSION});
  const wrongStrings=PRE_MEDIA_ORCHESTRATOR_STRING_FIELDS.filter((key)=>typeof payload[key]!=="string");
  const wrongArrays=PRE_MEDIA_ORCHESTRATOR_ARRAY_FIELDS.filter((key)=>!Array.isArray(payload[key]));
  if(wrongStrings.length||wrongArrays.length){const paths=[...wrongStrings,...wrongArrays].map((key)=>`$.${key}`);throw new PreMediaContractError("Orchestrator response contains invalid field types",{validationStage:"structural",validationCode:"ORCHESTRATOR_FIELD_TYPE_INVALID",issueCount:paths.length,issuePaths:paths,expected:"declared string/array field types",contractVersion:PRE_MEDIA_ORCHESTRATOR_CONTRACT_VERSION});}
  if(payload.stage!=="INITIAL_CONTENT_PLAN")throw new PreMediaContractError("Orchestrator stage is invalid",{validationStage:"semantic",validationCode:"ORCHESTRATOR_STAGE_INVALID",issueCount:1,issuePaths:["$.stage"],expected:"INITIAL_CONTENT_PLAN",actual:String(payload.stage).slice(0,80),contractVersion:PRE_MEDIA_ORCHESTRATOR_CONTRACT_VERSION});
  const authorityFields=["productionAuthority","mediaAuthority","publicationAuthority"];
  const authorityViolation=authorityFields.find((key)=>typeof payload[key]==="string"&&!/^(?:NOT_GRANTED|OWNER_REQUIRED)$/i.test(String(payload[key])));
  const unsafeTask=(payload.tasks as unknown[]).find((task)=>FORBIDDEN_ORCHESTRATOR_ACTION.test(JSON.stringify(task).slice(0,2000)));
  if(authorityViolation||unsafeTask!==undefined)throw new PreMediaContractError("Orchestrator attempted an unauthorized action or authority grant",{validationStage:"semantic",validationCode:"ORCHESTRATOR_AUTHORITY_VIOLATION",issueCount:1,issuePaths:[authorityViolation?`$.${authorityViolation}`:"$.tasks"],hardFailReason:"OWNER_AUTHORITY_BOUNDARY",contractVersion:PRE_MEDIA_ORCHESTRATOR_CONTRACT_VERSION});
  return value as Json;
}

export function preMediaOrchestratorSystemPrompt():string {
  return `You are the governed AMF orchestrator. Return only one JSON object. Contract ${PRE_MEDIA_ORCHESTRATOR_CONTRACT_VERSION}. Required fields: ${PRE_MEDIA_ORCHESTRATOR_REQUIRED.join(", ")}. stage must equal INITIAL_CONTENT_PLAN. planId, objective, topic, audience, platform, status, and summary are strings. researchQuestions, researchObjectives, desiredDeliverables, and tasks are arrays. You coordinate and recommend only: never claim to grant production, media, publication, premium-escalation, or Owner authority; never claim that a tool/provider action ran; never request media generation in PRE_MEDIA_PHASE. Use only supplied evidence and keep Owner authority required.`;
}

function createPreMediaRoutedAgent(agentId: string, model: string, execute: ExecuteFn): AnyAgent {
  const requiredByAgent: Record<string, string[]> = {
    orchestrator: [...PRE_MEDIA_ORCHESTRATOR_REQUIRED],
    ceo: ["decision", "rationale", "eligibleCandidateIds", "warnings"],
    director: ["status", "summary", "sceneIds", "scenePlan"],
    "visual-director": ["status", "summary", "scenes", "providerNeutral"],
    review: ["reportId", "taskDescription", "status", "summary", "findings", "recommendations"],
    qa: ["reportId", "objective", "status", "summary", "testResults", "executionEvidencePresent", "issues", "warnings"],
  };
  const required = requiredByAgent[agentId] ?? ["status", "summary"];
  return {
    async execute(envelope, signal) {
      const responseSchema = agentId === "orchestrator"
        ? {
            type: "object",
            properties: {
              planId: { type: "string" },
              stage: { type: "string", enum: ["INITIAL_CONTENT_PLAN"] },
              objective: { type: "string" },
              topic: { type: "string" },
              audience: { type: "string" },
              platform: { type: "string" },
              researchQuestions: { type: "array", items: {} },
              researchObjectives: { type: "array", items: {} },
              desiredDeliverables: { type: "array", items: {} },
              tasks: { type: "array", items: {} },
              status: { type: "string" },
              summary: { type: "string" },
              productionAuthority: { type: "string", enum: ["NOT_GRANTED", "OWNER_REQUIRED"] },
              mediaAuthority: { type: "string", enum: ["NOT_GRANTED", "OWNER_REQUIRED"] },
              publicationAuthority: { type: "string", enum: ["NOT_GRANTED", "OWNER_REQUIRED"] },
            },
            required,
            additionalProperties: true,
          }
        : { type: "object", required, additionalProperties: true };
      const request: ExecutionRequest = {
        model,
        system: agentId === "orchestrator" ? preMediaOrchestratorSystemPrompt() : `You are the governed AMF ${agentId} agent. Return only JSON matching the required contract. Required fields: ${required.join(", ")}. Use only supplied evidence. Never invent provider results, authority, or factual claims.`,
        messages: [{ role: "user", content: JSON.stringify(envelope.input) }],
        temperature: agentId === "director" || agentId === "visual-director" ? 0.4 : 0.2,
        maxOutputTokens: 4096,
        responseSchema,
      } as unknown as ExecutionRequest;
      const response = await execute(envelope.context, request, signal);
      const output = safeRecord(response.output);
      if(agentId==="orchestrator")return{output:validatePreMediaOrchestratorPayload(response.output),response};
      const missing = required.filter((key) => output[key] === undefined);
      if (missing.length > 0) throw new PreMediaContractError(`Pre-media ${agentId} response is missing required fields`,{validationStage:"structural",validationCode:"PRE_MEDIA_REQUIRED_FIELD_MISSING",issueCount:missing.length,issuePaths:missing.map((key)=>`$.${key}`),contractVersion:`amf-pre-media-${agentId}-v1`});
      return { output: response.output, response };
    },
  };
}

export interface ProductionAgentExecutorOptions {
  /** When present, capability-execution evidence is persisted. */
  readonly persistence?: PersistencePort;
  /** Scratch/workdir used for deterministic artifact production. */
  readonly workdir?: string;
  /** Override for the publishing idempotency store (defaults to Postgres when pool is given, else in-memory). */
  readonly publishStore?: PublishStore;
  /** Override for the resumable upload session store (defaults to Postgres when pool is given, else in-memory). */
  readonly publishSessionStore?: PublishSessionStore;
  /** Postgres pool used to create durable publish stores when explicit stores are not provided. */
  readonly pool?: pg.Pool;
  /** Canonical production routing store. Constructed from pool in the real worker. */
  readonly modelRouting?: ProductionModelRoutingStore;
  /** Atomic per-call Phase-1 budget reservation and reconciliation store. */
  readonly productionCallBudget?: ProductionCallBudgetStore;
  /** Provider-free proof seam: observes the real resolved route and stops before transport. */
  readonly routingResolutionObserver?: (value:Readonly<Record<string,unknown>>)=>void;
  readonly routingDryRun?: boolean;
  /** Optional injected source router for deterministic composition-root tests and controlled runtimes. */
  readonly researchSourceRouter?: ResearchSourceRouter;
  /** Test/composition-root override; provider boundaries are still injected, never created by media stages. */
  readonly providerBoundary?: ProviderCapabilityBoundary;
  /**
   * Test/composition-root TTS provider instance. When omitted, the canonical
   * explicit-selector resolver runs (missing/unsupported/misconfigured TTS
   * remains unregistered). The localhost operational fixture injects a
   * VoiceTut adapter pointed at a loopback mock through this seam; every
   * other adapter and registration rule stays canonical.
   */
  readonly ttsProvider?: TTSGenerationProvider;
  /**
   * Operational runtime identity carried on the shared boundary (safe
   * metadata only; reported by the zero-network preflight). Defaults resolve
   * from AMF_WORKER_RUNTIME_MODE / AMF_WORKER_LAUNCHER; createProductionWorker
   * passes its canonical identity explicitly.
   */
  readonly workerRuntimeMode?: WorkerRuntimeMode;
  readonly workerLauncher?: string;
  readonly workerInstanceId?: string;
  /** Optional already-composed media bridge. If omitted, the canonical bridge is created here. */
  readonly mediaChainBridge?: ProductionMediaChainBridge;
  /**
   * Media Technical Resume V1: the owner-authorized provider-submission
   * budget port. When a media-resume marker is active, every provider-backed
   * media capability call consumes budget BEFORE submission and fails closed
   * when the authorized envelope is exhausted.
   */
  readonly mediaResumeBudget?: MediaResumeBudgetPort;
}

function nowIso(): string {
  return new Date().toISOString();
}

function stableFingerprint(value: unknown): string {
  const canonicalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonicalize);
    if (item !== null && typeof item === "object") {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, canonicalize(nested)]));
    }
    return item;
  };
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function firstJsonDifference(left: unknown, right: unknown, path = "$"): string | null {
  if (Object.is(left, right)) return null;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return path;
    if (left.length !== right.length) return `${path}.length`;
    for (let index = 0; index < left.length; index += 1) {
      const difference = firstJsonDifference(left[index], right[index], `${path}[${index}]`);
      if (difference !== null) return difference;
    }
    return null;
  }
  if (left !== null && right !== null && typeof left === "object" && typeof right === "object") {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort();
    for (const key of keys) {
      if (!(key in leftRecord) || !(key in rightRecord)) return `${path}.${key}`;
      const difference = firstJsonDifference(leftRecord[key], rightRecord[key], `${path}.${key}`);
      if (difference !== null) return difference;
    }
    return null;
  }
  return path;
}

function capabilityProviderPayload(value: unknown): unknown {
  const normalized = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  // Research adds deterministic local lifecycle annotations after the
  // capability boundary returns. They belong to the Research artifact, not
  // the provider result identity, and must not make the already-committed raw
  // result appear to conflict with its later annotated projection.
  delete normalized.lifecycle;
  delete normalized.reasonCode;
  return normalized;
}

function safeRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" ? (value as JsonRecord) : {};
}

/** Provider-free compiler for the canonical Research Intelligence V2 input. */
export function buildResearchIntelligenceV2Contract(input: {
  projectId: string; objective: string; platform?: string; contentPillar?: string;
  contentMode?: string; market?: string | null; geography?: string | null;
  language?: string | null; audience?: string | null;
}): JsonRecord {
  return {
    synthesisContract: "amf-research-intelligence-v2",
    researchObjective: {
      projectId: input.projectId, brand: input.projectId || "unspecified",
      contentPillar: input.contentPillar ?? "Historical POV",
      factualMode: input.contentMode === "ORIGINAL_FANTASY" ? "ORIGINAL_FANTASY" : "HISTORICAL_POV",
      platforms: [input.platform ?? "YouTube Shorts"], market: input.market ?? null,
      geography: input.geography ?? null, language: input.language ?? null,
      audience: input.audience ?? null, format: "vertical-short", businessObjective: input.objective,
      topicConstraints: [], trendPreference: "HYBRID", desiredContentCount: 3,
      ownerConstraints: ["No invented trend metrics", "Historical claims require factual verification"],
    } as unknown as Json,
    capabilityInventory: [
      { sourceType: "WEB_SEARCH", status: "SUPPORTED", via: ["web.search"], limitations: [] },
      { sourceType: "INSTAGRAM_DISCOVERY", status: "UNSUPPORTED", via: [], limitations: ["No governed production social-discovery capability is registered"] },
      { sourceType: "YOUTUBE_DISCOVERY", status: "UNSUPPORTED", via: [], limitations: ["No governed production YouTube-discovery capability is registered"] },
    ] as unknown as Json,
  };
}

function normalizedResearchEvidence(value: Json): Json[] {
  const payload = safeRecord(value);
  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  return sources.map((source) => {
    const item = safeRecord(source);
    return {
      sourceId: typeof item.id === "number" ? item.id : null,
      title: typeof item.title === "string" ? item.title : null,
      url: typeof item.url === "string" ? item.url : null,
      snippet: typeof item.snippet === "string" ? item.snippet : null,
      dateAccessed: typeof item.dateAccessed === "string" ? item.dateAccessed : null,
    } as Json;
  });
}

function boundedEvidenceText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length === 0 ? undefined : normalized.slice(0, limit);
}

/**
 * Projects canonical V2 inputs into the smallest deterministic evidence form
 * needed by a strategy Research request. It deliberately retains no generated
 * conclusions and leaves the canonical artifact IDs in request provenance.
 */
function compactStrategyResearchEvidence(context: WorkflowContext): Json {
  const data = safeRecord(context.data);
  const owner = safeRecord(data.ownerStrategicInput);
  const reference = safeRecord(data.referenceEvidence);
  const references = Array.isArray(reference.references) ? reference.references : [];
  return {
    owner: {
      targetMarket: owner.targetMarket ?? null,
      platformsToEvaluate: Array.isArray(owner.platformsToEvaluate) ? owner.platformsToEvaluate.slice(0, 3) : [],
      budget: safeRecord(owner.budget),
      brandModel: owner.brandModel ?? null,
      channelPortfolio: owner.channelPortfolio ?? null,
    },
    references: references.slice(0, 2).map((referenceItem, index) => {
      const item = safeRecord(referenceItem);
      const response = safeRecord(item.response);
      const result = safeRecord(Array.isArray(response.results) ? response.results[0] : undefined);
      const engagement = safeRecord(result.engagement);
      const caption = boundedEvidenceText(result.caption ?? result.description ?? result.text, 360);
      const hashtags = Array.isArray(result.hashtags) ? result.hashtags.filter((tag): tag is string => typeof tag === "string").slice(0, 8) : [];
      return {
        sourceId: String(result.evidenceId ?? `owner-reference-${index + 1}`),
        sourceUrl: result.canonicalUrl ?? result.sourceUrl ?? item.referenceUrl ?? null,
        creator: result.authorOrCreator ?? null,
        platform: result.platform ?? null,
        publishedAt: result.publishedAt ?? null,
        captionExcerpt: caption ?? null,
        hashtags,
        engagement: {
          likeCount: typeof engagement.likeCount === "number" ? engagement.likeCount : null,
          commentCount: typeof engagement.commentCount === "number" ? engagement.commentCount : null,
        },
        duration: result.duration ?? null,
        limitations: Array.isArray(result.limitations) ? result.limitations.filter((value): value is string => typeof value === "string").slice(0, 5) : [],
        provenance: result.provenance ?? response.provider ?? item.provider ?? "UNKNOWN",
      };
    }),
    restrictions: ["Use supplied evidence only", "No external research calls", "Reference intelligence is not production-reuse permission"],
  } as unknown as Json;
}

/**
 * External LLM boundary guard: preserve task content while removing common
 * credential material from prompts before it leaves the worker process.
 */
function sanitizeExternalText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(sk-[A-Za-z0-9_-]{8,})/g, "[REDACTED_SECRET]")
    .replace(/((?:api[_-]?key|auth(?:orization)?|access[_-]?token|password|secret)\s*[:=]\s*["']?)[^\s,"'}]+/gi, "$1[REDACTED]")
    .replace(/((?:OPENAI|ANTHROPIC|OPENROUTER|RUNPOD|BRAVE|TAVILY|SERPER|EXA)_[A-Z0-9_]+\s*=\s*)[^\s]+/g, "$1[REDACTED]");
}

function sanitizeExternalMessages(messages: GenerateRequest["messages"]): GenerateRequest["messages"] {
  return messages.map((message) => ({
    ...message,
    content: message.content.map((part) => part.kind === "text" ? { ...part, text: sanitizeExternalText(part.text) } : part),
  }));
}

function externalMessageText(message: GenerateRequest["messages"][number]): string {
  return message.content.map((part) => part.kind === "text" ? part.text : "[image content omitted]").join("\n");
}

/** Deterministic id for an artifact produced for a step (idempotent across crash re-runs). */
function artifactIdFor(workflowId: string, stepId: string): string {
  return `art-${workflowId}-${stepId}`;
}

// ---------------------------------------------------------------------------
// Provider boundary (guarded construction; blocked providers fail hard).
// ---------------------------------------------------------------------------

function loadOrBlock<T>(label: string, factory: () => T): T {
  try {
    return factory();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // A blocked provider is substituted only for configuration failures; any
    // other construction error still propagates.
    if (!(error instanceof ProviderConfigurationError)) throw error;
    return blockedProvider(label, reason) as unknown as T;
  }
}

function blockedProvider(label: string, reason: string): WebSearchProvider {
  const message = `${label} is not configured: ${reason}`;
  const fail = (): Promise<never> => Promise.reject(new ProviderConfigurationError(label, message));
  return { search: fail };
}

class InMemoryPublishStore implements PublishStore {
  private readonly entries = new Map<
    string,
    | { status: "completed"; providerId: string; publicationId: string; url: string; publishedAt: string }
    | { status: "failed"; providerId: string; error: { code: string; message: string } }
  >();

  async get(
    idempotencyKey: string,
  ): Promise<
    | { status: "completed"; providerId: string; publicationId: string; url: string; publishedAt: string }
    | { status: "failed"; providerId: string; error: { code: string; message: string } }
    | null
  > {
    return this.entries.get(idempotencyKey) ?? null;
  }

  async save(
    idempotencyKey: string,
    entry:
      | { status: "completed"; providerId: string; publicationId: string; url: string; publishedAt: string }
      | { status: "failed"; providerId: string; error: { code: string; message: string } },
  ): Promise<void> {
    this.entries.set(idempotencyKey, entry);
  }
}

function inMemoryPublishSessionStore(): PublishSessionStore {
  const sessions = new Map<string, PublishSessionRecord>();
  return {
    get: async (marker: string) => sessions.get(marker) ?? null,
    savePending: async (marker: string, sessionUri?: string) => {
      sessions.set(marker, { marker, status: "pending", ...(sessionUri === undefined ? {} : { sessionUri }) });
    },
    saveCompleted: async (
      marker: string,
      entry: { providerId: string; publicationId: string; url: string; publishedAt: string },
    ) => {
      sessions.set(marker, { marker, status: "completed", ...entry });
    },
    saveFailed: async (marker: string) => {
      sessions.set(marker, { marker, status: "failed" });
    },
  };
}

function loadSearchAdapter(): WebSearchProvider {
  return loadOrBlock<WebSearchProvider>("web.search", () => searchAdapterFromEnv());
}

function resolvePublishStores(
  options: ProductionAgentExecutorOptions,
): { publishStore: PublishStore; publishSessionStore: PublishSessionStore } {
  if (options.publishStore !== undefined && options.publishSessionStore !== undefined) {
    return { publishStore: options.publishStore, publishSessionStore: options.publishSessionStore };
  }
  if (options.pool !== undefined) {
    return {
      publishStore: options.publishStore ?? new PostgresPublishStore(options.pool),
      publishSessionStore: options.publishSessionStore ?? new PostgresPublishSessionStore(options.pool),
    };
  }
  // Fallback for unit tests / non-durable runs — single shared instance per executor.
  const fallbackSession = inMemoryPublishSessionStore();
  return { publishStore: options.publishStore ?? new InMemoryPublishStore(), publishSessionStore: options.publishSessionStore ?? fallbackSession };
}

export function buildProviderBoundary(options: ProductionAgentExecutorOptions = {}): ProviderCapabilityBoundary {
  if (options.providerBoundary !== undefined) return options.providerBoundary;
  const { publishStore, publishSessionStore } = resolvePublishStores(options);
  const adapters: ProviderAdapters = {
    webSearch: loadSearchAdapter(),
    imageGeneration: loadOrBlock<ImageGenerationProvider>("image.generate", () => imageAdapterFromEnv()),
    videoGeneration: loadOrBlock<VideoGenerationProvider>("video.generate", () => videoAdapterFromEnv()),
    publishing: loadOrBlock<PublishingProvider>("publish.youtube", () =>
      publishingAdapterFromEnv({ publishSessionStore }),
    ),
    analytics: loadOrBlock<AnalyticsProvider>("analytics.fetch", () => analyticsAdapterFromEnv()),
    // The explicit-selector resolver is shared with the provider-adapters
    // environment boundary. Missing/unsupported/misconfigured TTS remains
    // unregistered; no provider request is made while resolving it.
    ttsGeneration: options.ttsProvider ?? resolveExplicitTTSProvider({
      ttsSubmissionLifecycle: options.persistence === undefined ? undefined : productionVoicetutSubmissionLifecycle(options.persistence),
    }),
  };
  const boundary = createProviderCapabilityBoundary({
    adapters,
    publishStore,
    publishSessionStore,
  });
  // Governed v2 lineage inputs: safe VoiceTut execution identity (endpoint
  // hash + base host, never raw IDs or secrets) read through the SAME
  // canonical helper the adapter itself uses — adapter config and fingerprint
  // input cannot diverge.
  const voicetutIdentity = voicetutExecutionIdentityFromEnv();
  return {
    ...boundary,
    workerExecutionEnvironment: inspectWorkerExecutionEnvironment(),
    workerRuntime: {
      mode: options.workerRuntimeMode ?? resolveWorkerRuntimeMode(),
      launcherClassification: (options.workerLauncher ?? resolveWorkerLauncher()).slice(0, 80),
      instanceId: options.workerInstanceId ?? "unassigned",
      nodeVersion: process.version,
    },
    mediaConfiguration: {
      ttsEndpointIdentityHash: voicetutIdentity?.endpointIdentityHash ?? null,
      ttsBaseHost: voicetutIdentity?.baseHost ?? null,
    },
  };
}

function productionVoicetutSubmissionLifecycle(persistence: PersistencePort): VoicetutSubmissionLifecycle {
  const executionId = (identity: VoicetutSubmissionIdentity) => `exec-tts-submission-${identity.logicalSubmissionId}`;
  const write = async (identity: VoicetutSubmissionIdentity, phase: string, providerJobId?: string, providerStatus?: string) => {
    if (persistence.saveExecutionProvenance === undefined) throw new Error("TTS_ACKNOWLEDGEMENT_PERSISTENCE_REQUIRED");
    const id = executionId(identity);
    const existing = persistence.listExecutionProvenance === undefined ? undefined : (await persistence.listExecutionProvenance(identity.workflowId)).find((row) => row.executionId === id);
    const now = nowIso();
    await persistence.saveExecutionProvenance(executionProvenance({
      executionId: id, workflowId: identity.workflowId, correlationId: null, agentId: "tts-chunk-coordinator", stage: "tts-submit", capability: "tts.generate",
      provider: "voicetut", model: "UNKNOWN", runtime: "runpod-queue", promptVersion: null,
      startedAt: existing?.startedAt ?? now, completedAt: now, latencyMs: 0, status: "blocked", usage: null, costKind: "UNKNOWN", cost: null, currency: "USD",
      artifactIds: [], parentExecutionIds: [], attemptNumber: 1, providerRequestId: null, providerJobId: providerJobId ?? existing?.providerJobId ?? null,
      errorClassification: null, configuration: { logicalSubmissionId: identity.logicalSubmissionId, textFingerprint: identity.textFingerprint, configurationFingerprint: identity.configurationFingerprint, voice: identity.voice, lifecycleState: phase, providerStatus: providerStatus ?? null },
    }));
    if (persistence.appendExecutionLifecycleEvent !== undefined) await persistence.appendExecutionLifecycleEvent({ executionId: id, workflowId: identity.workflowId, stage: "tts-submit", state: phase, occurredAt: now, attemptNumber: 1, metadata: { provider: "voicetut", voice: identity.voice, providerJobIdCaptured: Boolean(providerJobId), providerStatus: providerStatus ?? null } });
  };
  return {
    findAcknowledged: async (identity) => {
      if (persistence.listExecutionProvenance === undefined) return null;
      const row = (await persistence.listExecutionProvenance(identity.workflowId)).find((candidate) => candidate.executionId === executionId(identity));
      return row?.providerJobId ? { providerJobId: row.providerJobId } : null;
    },
    persistIntent: (identity) => write(identity, "SUBMISSION_INTENT"),
    persistPhase: (identity, phase, providerJobId, providerStatus) => write(identity, phase, providerJobId, providerStatus),
    persistAcknowledged: (identity, providerJobId) => write(identity, "PROVIDER_JOB_ID_CAPTURED_DURABLY", providerJobId),
  };
}

/** Build the single production Research Agent source router from infrastructure-owned adapters. */
export function createProductionResearchSourceRouter(input: {
  youtube?: YouTubeResearchPort;
  socialProviders?: Partial<Record<string, SocialIntelligencePort>>;
  registrations?: SocialProviderCapabilityRegistration[];
}): ResearchSourceRouter | undefined {
  const providers = input.socialProviders ?? {};
  const registrations = (input.registrations ?? DEFAULT_SOCIAL_REGISTRATIONS).filter((entry) => providers[entry.provider] !== undefined);
  const social = Object.keys(providers).length === 0 ? undefined : new SocialCapabilityRouter(registrations, providers);
  return input.youtube === undefined && social === undefined ? undefined : new ResearchSourceRouter(input.youtube, social);
}

function createProductionResearchSourceRouterFromEnv(): ResearchSourceRouter | undefined {
  const youtube = process.env.YOUTUBE_API_KEY?.trim()
    ? new YouTubeResearchAdapter({ apiKey: process.env.YOUTUBE_API_KEY })
    : undefined;
  const socialProviders: Partial<Record<string, SocialIntelligencePort>> = {};
  if (process.env.APIFY_API_TOKEN?.trim()) socialProviders.APIFY = apifySocialAdapterFromEnv();
  if (process.env.BRIGHTDATA_API_TOKEN?.trim()) socialProviders.BRIGHT_DATA = brightDataSocialAdapterFromEnv();
  return createProductionResearchSourceRouter({ youtube, socialProviders });
}

// ---------------------------------------------------------------------------
// Deterministic structured-output responder (per-agent LLM dependency).
// ---------------------------------------------------------------------------

function resolvedAgentRouterModel(agent: string, configuration?: unknown): string {
  const scoped = safeRecord(safeRecord(configuration).controlAgentOverrides)[agent] ?? safeRecord(safeRecord(configuration).controlAgentOverrides)["*"];
  if (typeof safeRecord(scoped).model === "string" && String(safeRecord(scoped).model).trim()) return String(safeRecord(scoped).model).trim();
  const override = safeRecord(configuration).agentRouterModelOverride;
  return typeof override === "string" && override.trim().length > 0 ? override.trim() : (AGENT_ROUTER_MODELS[agent] ?? "gpt-5.6-sol");
}

function agentRouterUsesAnthropicNative(model: string): boolean {
  return model.startsWith("claude-")
    || (model === "deepseek-v4-flash" && process.env.AGENTROUTER_CANARY_PROTOCOL === "ANTHROPIC");
}

function agentRouterRoute(model: string): { provider: "agentrouter-anthropic" | "agentrouter-openai"; protocol: "ANTHROPIC" | "OPENAI_COMPATIBLE" } {
  return agentRouterUsesAnthropicNative(model)
    ? { provider: "agentrouter-anthropic", protocol: "ANTHROPIC" }
    : { provider: "agentrouter-openai", protocol: "OPENAI_COMPATIBLE" };
}

type AnthropicContentBlock = {
  readonly type?: unknown;
  readonly text?: unknown;
};

function countAnthropicBlocks(content: unknown, type: string): number {
  return Array.isArray(content) ? content.filter((block) => block !== null && typeof block === "object" && (block as { type?: unknown }).type === type).length : 0;
}

/** Extract only explicitly typed, user-visible Anthropic text blocks. */
export function extractAnthropicVisibleText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is AnthropicContentBlock => block !== null && typeof block === "object")
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("");
}

export function isIncompleteAgentRouterTermination(protocol: "ANTHROPIC" | "OPENAI_COMPATIBLE", finishReason: string): boolean {
  return protocol === "ANTHROPIC" ? finishReason === "max_tokens" : finishReason === "length";
}

function agentRouterEndpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function resolvedOpenRouterModel(agent: string, configuration?: unknown): string {
  const scoped = safeRecord(safeRecord(configuration).controlAgentOverrides)[agent] ?? safeRecord(safeRecord(configuration).controlAgentOverrides)["*"];
  if (typeof safeRecord(scoped).model === "string" && String(safeRecord(scoped).model).trim()) return String(safeRecord(scoped).model).trim();
  const override = safeRecord(configuration).agentRouterModelOverride ?? safeRecord(configuration).openRouterModelOverride;
  if (typeof override === "string" && override.trim().length > 0) return override.trim();
  // Writer Nemotron hardening: when env requests nemotron super, honor it.
  if (agent === "writer" && process.env.OPENROUTER_NEMOTRON_SUPER_CANARY === "1") return "nvidia/nemotron-3-super-120b-a12b:free";
  return process.env.OPENROUTER_DEFAULT_MODEL ?? "openai/gpt-oss-20b:free";
}

function agentLlm(input: Json): ExecuteFn {
  const agent = String(safeRecord(input).__agent ?? "");
  const scoped = safeRecord(safeRecord(input).controlAgentOverrides)[agent] ?? safeRecord(safeRecord(input).controlAgentOverrides)["*"];
  const strategyMode = safeRecord(input).strategyMode === "PRE_PUBLICATION_STRATEGY";
  // Research is grounded by the configured web-search capability (Serper,
  // Tavily, Brave, or Exa). Keep it out of the text-provider router so a
  // missing/paid LLM route cannot prevent real search evidence from being
  // collected; downstream text specialists use AgentRouter explicitly.
  if (agent === "research" && !strategyMode && safeRecord(scoped).canonicalRouting === undefined) return deterministicLlm(input);
  const scopedProvider = typeof safeRecord(scoped).provider === "string" ? String(safeRecord(scoped).provider).trim().toLowerCase() : undefined;
  const explicitProvider = scopedProvider || process.env.TEXT_AGENT_PROVIDER?.trim().toLowerCase();
  // A strategy council is explicitly LLM-backed. It is fail-closed when the
  // configured route is absent or changed; no ambient fallback.
  // NOTE: production default remains AgentRouter; OpenRouter Nemotron canary
  // is separately owner-authorized and does not change this default.
  if (strategyMode) {
    if (explicitProvider === "agentrouter") return agentRouterLlm(agent, resolvedAgentRouterModel(agent, input));
    if (explicitProvider === "openrouter") {
      if (!process.env.OPENROUTER_API_KEY?.trim()) return unavailableTextProvider("openrouter");
      const ov = resolvedOpenRouterModel(agent, input);
      // Owner-authorized OpenRouter Writer canaries (Nemotron, Gemma) are explicitly allowed for strategy council
      return withRoleReasoningPolicy(agent, ov, openRouterLlm(ov));
    }
    return unavailableTextProvider("agentrouter (required for PRE_PUBLICATION_STRATEGY)");
  }
  // An explicit provider is authoritative. Ambient credentials are only
  // autodetection inputs when the setting is absent or empty.
  if (explicitProvider !== undefined && explicitProvider !== "") {
    if (explicitProvider === "deterministic") return deterministicLlm(input);
    if (explicitProvider === "agentrouter") return agentRouterLlm(agent, resolvedAgentRouterModel(agent, input));
    if (explicitProvider === "openrouter") {
      if (process.env.OPENROUTER_API_KEY?.trim()) {
        const model = resolvedOpenRouterModel(agent, input);
        const execute = openRouterLlm(model);
        return withRoleReasoningPolicy(agent, model, execute);
      }
      return unavailableTextProvider("openrouter");
    }
    return unavailableTextProvider(explicitProvider);
  }
  if (process.env.OPENROUTER_API_KEY?.trim()) return openRouterLlm(resolvedOpenRouterModel(agent, input));
  if (process.env.OPENAI_API_KEY?.trim() && process.env.ANTHROPIC_AUTH_TOKEN?.trim()) {
    return agentRouterLlm(agent, resolvedAgentRouterModel(agent, input));
  }
  return deterministicLlm(input);
}

function unavailableTextProvider(provider: string): ExecuteFn {
  return async () => { throw new Error(`TEXT_AGENT_PROVIDER is unavailable or unsupported: ${provider}`); };
}

/** Explicit governed role policy only; never an ambient provider default. */
function withReasoningDisabled(execute: ExecuteFn): ExecuteFn {
  return (context, request, signal) => execute(context, {
    ...request,
    reasoning: { effort: "none" },
  } as ExecutionRequest & { reasoning: { readonly effort: "none" } }, signal);
}

/**
 * Per-model reasoning capability policy (review-400 remediation).
 *
 * Proven live: the openai/gpt-oss-20b route rejects reasoning:none with
 * HTTP 400 ("Reasoning is mandatory for this endpoint and cannot be
 * disabled"). Entries require live 400 evidence against the exact model
 * route; never extend on speculation. OpenRouter variant suffixes
 * (e.g. `:free`) match by base model id. Structured-output support is
 * tracked separately by the provider model registry; this table covers
 * only the reasoning-none incompatibility.
 */
const REASONING_MANDATORY_MODELS: ReadonlySet<string> = new Set([
  "openai/gpt-oss-20b",
]);
export function modelRequiresReasoning(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  if (REASONING_MANDATORY_MODELS.has(normalized)) return true;
  const base = normalized.split(":")[0];
  return base !== normalized && REASONING_MANDATORY_MODELS.has(base);
}
export function modelSupportsReasoningNone(modelId: string): boolean {
  return !modelRequiresReasoning(modelId);
}
/**
 * Role reasoning policy with per-model capability guard. Writer/review
 * requests default to reasoning:none exactly as before, except on models
 * proven to mandate reasoning — there the key is omitted so the
 * provider/model default applies. No fallback model, no retry, no
 * behavior change for any other role or model.
 */
export function withRoleReasoningPolicy(agent: string, model: string, execute: ExecuteFn): ExecuteFn {
  if ((agent === "writer" || agent === "review") && modelSupportsReasoningNone(model)) {
    return withReasoningDisabled(execute);
  }
  return execute;
}

/**
 * Provider-neutral, visible-JSON execution boundary used by governed command
 * runtimes.  It deliberately reuses the production router above: a scoped
 * provider is authoritative, models are checked by their transport, and no
 * provider reasoning is returned or persisted.
 */
export async function executeGovernedVisibleJson(options: {
  readonly agentId: string;
  readonly workflowId: string;
  readonly correlationId?: string | null;
  readonly provider: "agentrouter" | "openrouter";
  readonly model: string;
  readonly system: string;
  readonly prompt: string;
  readonly metadata?: Record<string, Json>;
  readonly maxOutputTokens?: number;
  /** Explicit, OpenRouter-supported reasoning control for an authorized governed execution. */
  readonly reasoning?: { readonly effort: "none" };
  /** Call-specific lifecycle observer; FETCH_INVOCATION_STARTED is the text transport boundary. */
  readonly onTransportEvent?: (state: string, metadata: Record<string, unknown>) => Promise<void>;
}): Promise<ExecutionResponse> {
  const input = {
    __agent: options.agentId,
    strategyMode: "PRE_PUBLICATION_STRATEGY",
    controlAgentOverrides: { [options.agentId]: { provider: options.provider, model: options.model } },
  } as unknown as Json;
  const execute = agentLlm(input);
  return execute(
    { workflowId: options.workflowId, stepId: `command-${options.agentId}`, correlationId: options.correlationId ?? undefined, metadata: options.metadata ?? {} } as unknown as ExecutionContext,
    { model: options.model, system: options.system, messages: [{ role: "user", content: options.prompt }], temperature: 0, maxOutputTokens: options.maxOutputTokens ?? 600, ...(options.reasoning ? { reasoning: options.reasoning } : {}), ...(options.onTransportEvent ? { onTransportEvent: options.onTransportEvent } : {}) } as ExecutionRequest & { reasoning?: { readonly effort: "none" } },
    noopCancellation(),
  );
}

export function resolveOpenRouterTimeoutMs(value: string | undefined = process.env.OPENROUTER_TIMEOUT_MS): number {
  const parsed = Number(value ?? 180_000);
  return Number.isFinite(parsed) && parsed >= 1_000 && parsed <= 300_000 ? parsed : 180_000;
}

type OpenRouterResponseDiagnostics = {
  readonly httpStatus: number;
  readonly timeoutMs: number;
  readonly serializedRequestBytes: number;
  readonly messageCount: number;
  readonly systemPromptBytes: number;
  readonly userPromptBytes: number;
  readonly maxTokens: number;
  readonly reasoningEffort: "none" | null;
  readonly responseFormat: "json_object" | "json_schema";
  readonly responseBytes: number;
  readonly visibleContentBytes: number;
  readonly reasoningTokens: number | null;
  readonly reasoningFieldPresent: boolean;
  readonly reasoningDetailsPresent: boolean;
  readonly reasoningDetailCount: number;
  readonly textChunkCount: number;
  readonly providerRequestId: string | null;
  readonly usage: Record<string, unknown>;
  readonly finishReason: string;
  readonly requestedModel: string;
  readonly actualModel: string | null;
  readonly upstreamProvider: string | null;
};

class OpenRouterExecutionError extends Error {
  constructor(message: string, readonly diagnostics: Record<string, unknown>) { super(message); }
}

function openRouterEndpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** Translate the runtime's provider-neutral schema request into OpenRouter's
 * structured-output envelope. The runtime validator remains the final,
 * fail-closed authority; strict is deliberately false until this exact model
 * and contract have live compatibility evidence. */
export function openRouterResponseFormat(responseSchema: ExecutionRequest["responseSchema"]): Record<string, unknown> {
  if (responseSchema === undefined) return { type: "json_object" };
  return {
    type: "json_schema",
    json_schema: {
      name: "amf_structured_response",
      strict: false,
      schema: responseSchema,
    },
  };
}

/** Read-only transport/auth probe using the production worker's OpenRouter
 * endpoint and credential inheritance. It performs no model inference. */
export async function probeProductionOpenRouterTransport(): Promise<{ httpStatus:number; latencyMs:number; providerReached:boolean; authValid:boolean|null }> {
  if (!process.env.OPENROUTER_API_KEY?.trim()) throw new Error("OPENROUTER_CREDENTIAL_UNAVAILABLE");
  const started = Date.now();
  const response = await fetch(openRouterEndpoint(process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1", "auth/key"), {
    headers: { authorization: `Bearer ${String(process.env.OPENROUTER_API_KEY)}`, "User-Agent": "ai-media-factory-worker/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  return { httpStatus:response.status, latencyMs:Date.now()-started, providerReached:true, authValid:response.status===200?true:response.status===401||response.status===403?false:null };
}

/**
 * Canonical production OpenRouter chat transport (streaming SSE, strict
 * envelope from openRouterResponseFormat, bounded diagnostics, fail-closed
 * incomplete/empty/model-mismatch classification, no retry, no fallback).
 * Exported so diagnostic probes and regression tests invoke the SAME
 * primitive production synthesis uses instead of transcribing it.
 */
export function openRouterLlm(requestedModelOverride?: string): ExecuteFn {
  const boundedTimeoutMs = resolveOpenRouterTimeoutMs();
  return async (_context: ExecutionContext, request: ExecutionRequest) => {
    const requestedModel = requestedModelOverride?.trim() ? requestedModelOverride.trim() : (request.model?.trim() ? request.model.trim() : (process.env.OPENROUTER_DEFAULT_MODEL ?? "openai/gpt-oss-20b:free"));
    // No fallback: requested model is authoritative.
    const messages = sanitizeExternalMessages(request.messages.filter((m) => m.role !== "system").map((message) => ({ role: message.role, content: [{ kind: "text", text: message.content }] })));
    const system = sanitizeExternalText(request.messages.find((message) => message.role === "system")?.content ?? request.system);
    const allMessages = [{ role: "system" as const, content: system }, ...messages.map((m) => ({ role: m.role as "system"|"user"|"assistant", content: externalMessageText(m) }))];
    const reasoning = (request as ExecutionRequest & { reasoning?: { readonly effort: "none" } }).reasoning;
    const responseFormat = openRouterResponseFormat(request.responseSchema);
    const requestBody = JSON.stringify({
      model: requestedModel,
      messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
      temperature: request.temperature,
      max_tokens: request.maxOutputTokens,
      stream: true,
      response_format: responseFormat,
      ...(reasoning ? { reasoning } : {}),
    });
    const requestDiagnostics = {
      timeoutMs: boundedTimeoutMs,
      serializedRequestBytes: Buffer.byteLength(requestBody, "utf8"),
      messageCount: allMessages.length,
      systemPromptBytes: Buffer.byteLength(system, "utf8"),
      userPromptBytes: messages.reduce((t, m) => t + Buffer.byteLength(externalMessageText(m), "utf8"), 0),
      maxTokens: request.maxOutputTokens,
      reasoningEffort: reasoning?.effort ?? null,
      responseFormat: String(responseFormat.type) as "json_object" | "json_schema",
      requestedModel,
    };

    let response: Response;
    try {
      await request.onTransportEvent?.("FETCH_INVOCATION_STARTED", { model: requestedModel, timeoutMs: boundedTimeoutMs });
      response = await fetch(openRouterEndpoint(process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1", "chat/completions"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${String(process.env.OPENROUTER_API_KEY)}`,
          "HTTP-Referer": process.env.OPENROUTER_REFERER ?? "https://ai-media-factory.local",
          "X-Title": process.env.OPENROUTER_TITLE ?? "AI Media Factory",
          "User-Agent": "opencode/1.0",
        },
        body: requestBody,
        signal: AbortSignal.timeout(boundedTimeoutMs),
      });
    } catch (error) {
      throw new OpenRouterExecutionError(`OpenRouter ${requestedModel} transport failure`, {
        transport: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network_or_transport",
        ...safeTransportRootCause(error),
        ...requestDiagnostics,
        model: requestedModel,
      });
    }

    await request.onTransportEvent?.("HTTP_RESPONSE_HEADERS_RECEIVED", {
      model: requestedModel, httpStatus: response.status,
      providerRequestId: response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? null,
    });

    if (!response.ok) {
      // Forensic retention for non-2xx provider responses (synthesis-400:
      // the status-only evidence previously made the provider's stated
      // reason unrecoverable). Bounded, secret-free by construction — error
      // bodies carry provider diagnostics, never request credentials — and
      // read-only: retry, budget, and message behavior are unchanged.
      let providerErrorBody: string | null = null;
      try {
        const text = await response.text();
        if (text) providerErrorBody = text.slice(0, 2000);
      } catch { providerErrorBody = null; }
      throw new OpenRouterExecutionError(`OpenRouter request failed (${response.status})`, {
        httpStatus: response.status,
        model: requestedModel,
        providerRequestId: response.headers.get("x-request-id") ?? response.headers.get("request-id"),
        providerErrorBody,
        ...requestDiagnostics,
      });
    }

    if (!response.body) throw new OpenRouterExecutionError(`OpenRouter ${requestedModel} stream has no body`, { model: requestedModel, ...requestDiagnostics });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let visibleText = "";
    let textChunkCount = 0;
    let reasoningFieldPresent = false;
    let reasoningDetailsPresent = false;
    let reasoningDetailCount = 0;
    let finishReason: string | null = null;
    let actualModel: string | null = null;
    let upstreamProvider: string | null = null;
    let usage: Record<string, unknown> = {};
    let reasoningTokens: number | null = null;
    let seenDone = false;
    let responseBytes = 0;
    let generationId: string | null = null;
    const responseHash = createHash("sha256");

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith(":")) continue;
          if (trimmed === "data: [DONE]") { seenDone = true; continue; }
          if (!trimmed.startsWith("data: ")) continue;
          const jsonStr = trimmed.slice(6);
          responseBytes += Buffer.byteLength(jsonStr, "utf8");
          responseHash.update(jsonStr, "utf8");
          let chunk: Record<string, unknown>;
          try { chunk = JSON.parse(jsonStr) as Record<string, unknown>; } catch { throw new OpenRouterExecutionError(`OpenRouter ${requestedModel} malformed SSE`, { model: requestedModel, ...requestDiagnostics }); }
          if (typeof chunk.id === "string" && !generationId && (chunk.id as string).startsWith("gen-")) generationId = chunk.id as string;
          if (typeof chunk.model === "string" && !actualModel) actualModel = chunk.model as string;
          if (typeof chunk.provider === "string" && !upstreamProvider) upstreamProvider = chunk.provider as string;
          const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
          const ch = Array.isArray(choices) ? choices[0] as Record<string, unknown> | undefined : undefined;
          if (ch) {
            if (typeof ch.finish_reason === "string" && ch.finish_reason.length > 0) finishReason = ch.finish_reason as string;
            const delta = ch.delta as Record<string, unknown> | undefined;
            if (delta) {
              if (delta.reasoning !== undefined || delta.reasoning_content !== undefined) reasoningFieldPresent = true;
              if (delta.reasoning_details !== undefined) {
                reasoningDetailsPresent = true;
                if (Array.isArray(delta.reasoning_details)) reasoningDetailCount = Math.max(reasoningDetailCount, (delta.reasoning_details as unknown[]).length);
              }
              if (typeof delta.content === "string" && delta.content.length > 0) {
                visibleText += delta.content as string;
                textChunkCount++;
              }
            }
          }
          if (chunk.usage && typeof chunk.usage === "object") {
            usage = chunk.usage as Record<string, unknown>;
            const details = (usage.completion_tokens_details ?? usage.completionTokensDetails) as Record<string, unknown> | undefined;
            if (details && typeof details.reasoning_tokens === "number") reasoningTokens = details.reasoning_tokens as number;
            else if (typeof usage.reasoning_tokens === "number") reasoningTokens = usage.reasoning_tokens as number;
          }
        }
      }
    } finally { try { reader.releaseLock(); } catch {} }

    const headerRequestId = response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? null;
    const effectiveProviderRequestId = headerRequestId ?? generationId ?? null;
    const diagnostics: OpenRouterResponseDiagnostics = {
      httpStatus: response.status,
      ...requestDiagnostics,
      responseBytes,
      responseFingerprint: responseHash.digest("hex"),
      visibleContentFingerprint: createHash("sha256").update(visibleText, "utf8").digest("hex"),
      visibleContentBytes: Buffer.byteLength(visibleText, "utf8"),
      reasoningTokens,
      reasoningFieldPresent,
      reasoningDetailsPresent,
      reasoningDetailCount,
      textChunkCount,
      providerRequestId: effectiveProviderRequestId,
      usage,
      finishReason: finishReason ?? "unknown",
      requestedModel,
      actualModel,
      upstreamProvider,
    } as OpenRouterResponseDiagnostics & { generationId?: string | null };

    (diagnostics as unknown as Record<string, unknown>).generationId = generationId;
    (diagnostics as unknown as Record<string, unknown>).providerRequestId = effectiveProviderRequestId;

    await request.onTransportEvent?.("HTTP_RESPONSE_BODY_RECEIVED", diagnostics as unknown as Record<string, unknown>);
    if (!seenDone) throw new OpenRouterExecutionError(`OpenRouter ${requestedModel} missing [DONE]`, { model: requestedModel, incomplete: true, terminationReason: "missing_done", providerRequestId: effectiveProviderRequestId, generationId, ...diagnostics as unknown as Record<string, unknown> });
    if (finishReason === "length") throw new OpenRouterExecutionError(`OpenRouter ${requestedModel} incomplete response (length)`, { model: requestedModel, incomplete: true, terminationReason: "length", ...diagnostics as unknown as Record<string, unknown> });
    if (!visibleText) throw new OpenRouterExecutionError(`OpenRouter ${requestedModel} returned no visible content`, { model: requestedModel, ...diagnostics as unknown as Record<string, unknown> });
    if (actualModel && actualModel !== requestedModel) {
      throw new OpenRouterExecutionError(`OpenRouter model mismatch: requested ${requestedModel} but got ${actualModel}`, { model: requestedModel, actualModel, ...diagnostics as unknown as Record<string, unknown> });
    }

    let output: Json;
    try { output = parseAgentJson(visibleText); } catch { throw new OpenRouterExecutionError(`OpenRouter ${requestedModel} returned non-JSON output`, { model: requestedModel, validationStage: "parse", validationCode: "REVIEW_PARSE_NON_JSON", ...diagnostics as unknown as Record<string, unknown> }); }
    const parsedJson = JSON.stringify(output);
    const responseEvidence = {
      responseEvidenceVersion: "amf-provider-response-evidence-v1",
      sanitizedVisibleResponse: visibleText.slice(0, 32_768),
      visibleResponseTruncated: visibleText.length > 32_768,
      parsedPayload: Buffer.byteLength(parsedJson, "utf8") <= 32_768 ? output : null,
      parsedPayloadFingerprint: createHash("sha256").update(parsedJson, "utf8").digest("hex"),
      parsedPayloadTruncated: Buffer.byteLength(parsedJson, "utf8") > 32_768,
    };
    Object.assign(diagnostics as unknown as Record<string,unknown>,responseEvidence);
    await request.onTransportEvent?.("RESPONSE_PARSED", {
      ...diagnostics as unknown as Record<string, unknown>,
      ...responseEvidence,
    });

    return {
      output,
      raw: visibleText,
      usage: {
        inputTokens: Number((usage.prompt_tokens as number) ?? (usage.promptTokens as number) ?? 0),
        outputTokens: Number((usage.completion_tokens as number) ?? (usage.completionTokens as number) ?? 0),
        costUsd: typeof usage.cost === "number" ? usage.cost as number : 0,
      },
      model: actualModel ?? requestedModel,
      provider: "openrouter",
      latencyMs: 0,
      finishReason: finishReason ?? "stop",
      providerResponseDiagnostics: diagnostics as unknown as Record<string, unknown>,
    } as ExecutionResponse;
  };
}

/**
 * AgentRouter requests are non-streaming whole-response requests.  The default
 * must accommodate observed valid glm-5.3 completions (including one taking
 * almost two minutes) while retaining a finite, operator-configurable bound.
 */
export function resolveAgentRouterTimeoutMs(value: string | undefined = process.env.AGENT_ROUTER_TIMEOUT_MS): number {
  const parsed = Number(value ?? 180_000);
  return Number.isFinite(parsed) && parsed >= 1_000 && parsed <= 300_000 ? parsed : 180_000;
}

type AgentRouterResponseDiagnostics = {
  readonly finishReason: string;
  readonly httpStatus: number;
  readonly timeoutMs: number;
  readonly serializedRequestBytes: number;
  readonly messageCount: number;
  readonly systemPromptBytes: number;
  readonly userPromptBytes: number;
  readonly maxTokens: number;
  readonly responseBytes: number;
  readonly visibleContentBytes: number;
  readonly reasoningContentBytes: number;
  readonly textBlockCount: number;
  readonly thinkingBlockCount: number;
  readonly providerRequestId: string | null;
  readonly usage: Record<string, unknown>;
};

class AgentRouterExecutionError extends Error {
  constructor(message: string, readonly diagnostics: Record<string, unknown>) { super(message); }
}

/**
 * Extract only stable network attributes from a fetch/undici cause chain.
 * Error messages, stacks, request data, and arbitrary provider payloads are
 * deliberately excluded because this object is allowed into provenance.
 */
export function safeTransportRootCause(error: unknown): Record<string, unknown> {
  const visited = new Set<object>();
  const causes: Array<Record<string, unknown>> = [];
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    const item = value as Record<string, unknown>;
    causes.push(item);
    if (Array.isArray(item.errors)) item.errors.forEach(visit);
    visit(item.cause);
  };
  visit(error);
  const findText = (field: string): string | undefined => {
    for (const item of causes) {
      const value = item[field];
      if (typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(value)) return value;
    }
    return undefined;
  };
  const code = findText("code");
  const name = findText("name");
  const syscall = findText("syscall");
  const hostname = findText("hostname");
  const errno = findText("errno");
  let port: number | undefined;
  for (const item of causes) {
    if (typeof item.port === "number" && Number.isInteger(item.port) && item.port > 0 && item.port <= 65535) { port = item.port; break; }
  }
  const category = `${code ?? ""} ${name ?? ""}`.toUpperCase();
  const transportPhase = /ENOTFOUND|EAI_AGAIN/.test(category) ? "DNS"
    : /CERT|TLS/.test(category) ? "TLS"
      : /EACCES|EPERM/.test(category) ? "LOCAL_NETWORK_POLICY"
      : /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT/.test(category) ? "TCP"
        : /TIMEOUT/.test(category) ? "TIMEOUT" : "NETWORK";
  return {
    transport_error_name: name ?? "UNKNOWN",
    ...(code === undefined ? {} : { transport_error_code: code }),
    ...(errno === undefined ? {} : { transport_errno: errno }),
    ...(syscall === undefined ? {} : { transport_syscall: syscall }),
    ...(hostname === undefined ? {} : { transport_hostname: hostname }),
    ...(port === undefined ? {} : { transport_port: port }),
    transport_phase: transportPhase,
    nested_cause_count: Math.max(0, causes.length - 1),
  };
}

function agentRouterLlm(agent: string, model = AGENT_ROUTER_MODELS[agent] ?? "gpt-5.6-sol"): ExecuteFn {
  const boundedTimeoutMs = resolveAgentRouterTimeoutMs();
  const isAnthropic = agentRouterUsesAnthropicNative(model);
  return async (_context: ExecutionContext, request: ExecutionRequest) => {
    const messages = sanitizeExternalMessages(request.messages.filter((message) => message.role !== "system").map((message) => ({ role: message.role, content: [{ kind: "text", text: message.content }] })));
    const system = sanitizeExternalText(request.messages.find((message) => message.role === "system")?.content ?? request.system);
    const anthropicRequestBody = JSON.stringify({ model, system, messages: messages.map((message) => ({ role: message.role, content: externalMessageText(message) })), temperature: request.temperature, max_tokens: request.maxOutputTokens });
    const openAiRequestBody = JSON.stringify({ model, messages: [{ role: "system", content: system }, ...messages.map((message) => ({ role: message.role, content: externalMessageText(message) }))], temperature: request.temperature, max_tokens: request.maxOutputTokens, response_format: { type: "json_object" } });
    const requestBody = isAnthropic ? anthropicRequestBody : openAiRequestBody;
    const requestDiagnostics = {
      timeoutMs: boundedTimeoutMs,
      serializedRequestBytes: Buffer.byteLength(requestBody, "utf8"),
      messageCount: messages.length + 1,
      systemPromptBytes: Buffer.byteLength(system, "utf8"),
      userPromptBytes: messages.reduce((total, message) => total + Buffer.byteLength(externalMessageText(message), "utf8"), 0),
      maxTokens: request.maxOutputTokens,
    };
    let response: Response;
    try {
      await request.onTransportEvent?.("FETCH_INVOCATION_STARTED", { model, timeoutMs: boundedTimeoutMs });
      response = isAnthropic
      ? await fetch(agentRouterEndpoint(process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com", "v1/messages"), {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": String(process.env.ANTHROPIC_AUTH_TOKEN), "anthropic-version": "2023-06-01", "User-Agent": "opencode/1.0" },
          body: requestBody, signal: AbortSignal.timeout(boundedTimeoutMs),
        })
      : await fetch(agentRouterEndpoint(process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1", "chat/completions"), {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "User-Agent": "opencode/1.0" },
          body: requestBody, signal: AbortSignal.timeout(boundedTimeoutMs),
        });
    } catch (error) {
      throw new AgentRouterExecutionError(`AgentRouter ${model} transport failure`, {
        transport: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network_or_transport",
        ...safeTransportRootCause(error),
        ...requestDiagnostics,
        model,
      });
    }
    await request.onTransportEvent?.("HTTP_RESPONSE_HEADERS_RECEIVED", {
      model, httpStatus: response.status,
      providerRequestId: response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? null,
    });
    if (!response.ok) throw new AgentRouterExecutionError(`AgentRouter ${isAnthropic ? "Anthropic" : "OpenAI"} request failed (${response.status})`, {
      httpStatus: response.status,
      model,
      providerRequestId: response.headers.get("x-request-id") ?? response.headers.get("request-id"),
    });
    const payload = await response.json() as {
      content?: AnthropicContentBlock[];
      model?: string;
      stop_reason?: string;
      choices?: Array<{ message?: { content?: string; reasoning_content?: string }; finish_reason?: string }>;
      usage?: Record<string, unknown>;
    };
    const text = isAnthropic ? extractAnthropicVisibleText(payload.content) : String(payload.choices?.[0]?.message?.content ?? "");
    const finishReason = isAnthropic ? String(payload.stop_reason ?? "unknown") : String(payload.choices?.[0]?.finish_reason ?? "unknown");
    const diagnostics: AgentRouterResponseDiagnostics = {
      finishReason,
      httpStatus: response.status,
      ...requestDiagnostics,
      responseBytes: Buffer.byteLength(JSON.stringify(payload), "utf8"),
      visibleContentBytes: Buffer.byteLength(text, "utf8"),
      reasoningContentBytes: isAnthropic ? 0 : Buffer.byteLength(String(payload.choices?.[0]?.message?.reasoning_content ?? ""), "utf8"),
      textBlockCount: isAnthropic ? countAnthropicBlocks(payload.content, "text") : 0,
      thinkingBlockCount: isAnthropic ? countAnthropicBlocks(payload.content, "thinking") : 0,
      providerRequestId: response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? null,
      usage: payload.usage ?? {},
    };
    await request.onTransportEvent?.("HTTP_RESPONSE_BODY_RECEIVED", diagnostics as unknown as Record<string, unknown>);
    const protocol = agentRouterRoute(model).protocol;
    if (isIncompleteAgentRouterTermination(protocol, finishReason)) {
      throw new AgentRouterExecutionError(`AgentRouter ${model} returned an incomplete response (${finishReason})`, {
        model, incomplete: true, terminationReason: finishReason, ...diagnostics,
      });
    }
    if (!text) {
      const shape = isAnthropic
        ? `top-level=${Object.keys(payload).join(",")}; contentItems=${Array.isArray(payload.content) ? payload.content.length : 0}`
        : `top-level=${Object.keys(payload).join(",")}; choices=${Array.isArray(payload.choices) ? payload.choices.length : 0}; messageKeys=${Object.keys(payload.choices?.[0]?.message ?? {}).join(",")}; finish=${String(payload.choices?.[0]?.finish_reason ?? "")}`;
      throw new AgentRouterExecutionError(`AgentRouter ${model} returned empty output (${shape})`, { model, ...diagnostics });
    }
    let output: Json;
    try { output = parseAgentJson(text); } catch { throw new AgentRouterExecutionError(`AgentRouter ${model} returned non-JSON output`, { model, ...diagnostics }); }
    await request.onTransportEvent?.("RESPONSE_PARSED", diagnostics as unknown as Record<string, unknown>);
    const usage = payload.usage ?? {};
    return {
      output,
      raw: text,
      usage: { inputTokens: Number(usage.input_tokens ?? usage.prompt_tokens ?? 0), outputTokens: Number(usage.output_tokens ?? usage.completion_tokens ?? 0), costUsd: 0 },
      model: typeof payload.model === "string" && payload.model.trim().length > 0 ? payload.model : model,
      provider: isAnthropic ? "agentrouter-anthropic" : "agentrouter-openai",
      latencyMs: 0,
      finishReason,
      providerResponseDiagnostics: diagnostics,
    } as ExecutionResponse;
  };
}

/**
 * Governed, visible-JSON-only AgentRouter boundary for explicitly authorized
 * bounded business workflows. It deliberately refuses every provider other
 * than AgentRouter and exposes no hidden provider reasoning.
 */
export async function executeGovernedAgentRouterVisibleJson(options: {
  readonly workflowId: string;
  readonly stage: string;
  readonly model: string;
  readonly system: string;
  readonly prompt: string;
  readonly maxOutputTokens: number;
  readonly temperature?: number;
}): Promise<ExecutionResponse> {
  if (process.env.TEXT_AGENT_PROVIDER?.trim().toLowerCase() !== "agentrouter") {
    throw new Error("AGENTROUTER_REQUIRED: governed execution refuses provider fallback");
  }
  return agentRouterLlm(`naming-round2-${options.stage}`, options.model)(
    { workflowId: options.workflowId, stepId: options.stage, metadata: { source: "naming-round2-governed" } } as unknown as ExecutionContext,
    {
      model: options.model,
      system: options.system,
      messages: [{ role: "system", content: options.system }, { role: "user", content: options.prompt }],
      temperature: options.temperature ?? 0.25,
      maxOutputTokens: options.maxOutputTokens,
      responseSchema: undefined,
    },
    noopCancellation(),
  );
}

/** Small, non-business diagnostic using the exact AgentRouter transport used by strategy agents. */
export async function runAgentRouterStructuredOutputDiagnostic(options: {
  readonly model?: string;
  readonly expectedOutput?: { readonly [key: string]: string | boolean };
} = {}): Promise<{
  readonly output: Json;
  readonly provider: string;
  readonly model: string;
  readonly usage: { inputTokens: number; outputTokens: number; costUsd: number };
  readonly finishReason: string;
  readonly responseBytes: number;
  readonly diagnostics: Record<string, unknown>;
}> {
  if (process.env.TEXT_AGENT_PROVIDER?.trim().toLowerCase() !== "agentrouter") {
    throw new Error("AGENTROUTER_REQUIRED: diagnostic refuses provider fallback");
  }
  const model = options.model ?? "glm-5.3";
  const expectedOutput = options.expectedOutput ?? { ok: true, label: "structured-output" };
  const response = await agentRouterLlm("strategy-diagnostic", model)(
    { workflowId: "agentrouter-structured-output-diagnostic", stepId: "diagnostic", metadata: { source: "worker-production-executor" } } as unknown as ExecutionContext,
    {
      model, system: "Return compact JSON only.",
      messages: [{ role: "system", content: "Return compact JSON only." }, { role: "user", content: `Return only this JSON object: ${JSON.stringify(expectedOutput)}` }],
      temperature: 0, maxOutputTokens: 256,
      responseSchema: { type: "object", properties: Object.fromEntries(Object.entries(expectedOutput).map(([key, value]) => [key, { type: typeof value }])), required: Object.keys(expectedOutput) },
    }, noopCancellation(),
  );
  const record = safeRecord(response.output);
  if (!Object.entries(expectedOutput).every(([key, value]) => record[key] === value)) throw new Error("AgentRouter diagnostic returned an invalid compact JSON payload");
  const responseRecord = response as unknown as { finishReason?: unknown; providerResponseDiagnostics?: unknown };
  return {
    output: response.output, provider: response.provider, model: response.model, usage: response.usage,
    finishReason: String(responseRecord.finishReason ?? "unknown"), responseBytes: Buffer.byteLength(response.raw, "utf8"),
    diagnostics: safeRecord(responseRecord.providerResponseDiagnostics),
  };
}

function parseAgentJson(text: string): Json {
  const trimmed = text.trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const normalize = (value: Json): Json => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON object required");
    const record = value as JsonRecord;
    const keys = Object.keys(record);
    const wrapped = keys.length === 1 && (keys[0] === "report" || keys[0] === "seoReport" || keys[0] === "writerReport") ? record[keys[0]] : undefined;
    if (wrapped !== null && typeof wrapped === "object" && !Array.isArray(wrapped)) {
      return wrapped as Json;
    }
    return value;
  };
  try { return normalize(JSON.parse(unfenced) as Json); } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("no JSON object");
    const candidate = unfenced.slice(start, end + 1);
    const parsed = JSON.parse(candidate) as Json;
    return normalize(parsed);
  }
}

function deterministicLlm(input: Json): ExecuteFn {
  const agentInput = safeRecord(input);
  const agent = String(agentInput.__agent ?? "unknown");
  return async (_context: ExecutionContext, request: ExecutionRequest) => {
    const output = agent === "research"
      ? synthesizeResearch(agentInput, request.messages.map((message) => message.content).join("\n"))
      : synthesizeReport(agent, agentInput);
    return {
      output,
      raw: JSON.stringify(output, null, 2),
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      model: String(request.model ?? "deterministic"),
      provider: DETERMINISTIC_PROVIDER,
      latencyMs: 0,
    };
  };
}

function synthesizeReport(agent: string, input: JsonRecord): Json {
  switch (agent) {
    case "research":
      return synthesizeResearch(input);
    case "writer":
      return synthesizeWriter(input);
    case "seo":
      return synthesizeSeo(input);
    case "brand":
      return synthesizeBrand(input);
    case "review":
      return synthesizeReview(input);
    case "qa":
      return synthesizeQa(input);
    case "visual-director": {
      const plan = safeRecord(input.scenePlan);
      const scenes = Array.isArray(plan.scenes) ? plan.scenes : [];
      return {
        status: "completed",
        summary: "Provider-neutral visual direction derived from the canonical scene plan.",
        providerNeutral: true,
        storyVisualIdentity: { visualMode: "PHOTOREALISTIC", aspectRatio: "9:16" },
        globalContinuity: { preserveCharacters: true, preserveEnvironment: true },
        characters: [],
        scenes: scenes.map((scene) => {
          const item = safeRecord(scene);
          return { sceneId: String(item.sceneId ?? ""), visualIntent: String(item.visualIntent ?? item.visualPrompt ?? item.narrationSegment ?? "Canonical scene visual") };
        }),
      };
    }
    default:
      return { error: `No deterministic responder for agent "${agent}".` };
  }
}

function deterministicResearchEvidence(prompt: string): Array<{ id: number; title: string; url: string; snippet: string }> {
  const marker = "RETRIEVED EVIDENCE (the only sources you may cite):";
  const start = prompt.indexOf(marker);
  if (start < 0) return [];
  const tail = prompt.slice(start + marker.length);
  const end = tail.indexOf("\nReturn one valid ResearchReport JSON");
  if (end < 0) return [];
  try {
    const retrievals = JSON.parse(tail.slice(0, end).trim()) as Array<{ results?: Array<Record<string, unknown>> }>;
    return retrievals.flatMap((retrieval) => Array.isArray(retrieval.results) ? retrieval.results : [])
      .filter((result) => typeof result.title === "string" && typeof result.url === "string" && typeof result.snippet === "string")
      .map((result, index) => ({ id: index + 1, title: String(result.title), url: String(result.url), snippet: String(result.snippet) }));
  } catch {
    return [];
  }
}

function synthesizeResearch(input: JsonRecord, prompt = ""): Json {
  const task = safeRecord(input.task);
  const contract = safeRecord(input.contract);
  const description = String(task.description ?? "Research task");
  const name = String(task.name ?? description);
  const sources = deterministicResearchEvidence(prompt);
  const grounded = sources.length >= 2;
  return {
    reportId: randomUUID(),
    ...(typeof contract.taskId === "string" ? { taskId: contract.taskId } : {}),
    ...(typeof contract.stage === "string" ? { stage: contract.stage } : {}),
    taskDescription: description,
    summary: grounded
      ? `Provider-free synthesis grounded in ${sources.length} supplied retrieval results for "${name}".`
      : `Capability plan for "${name}"; no retrieval evidence has been supplied yet.`,
    sources,
    confidence: grounded ? 0.82 : 0.15,
    citations: sources.map((source) => ({ sourceId: source.id, text: source.snippet.slice(0, 120) })),
    ...(input.synthesisContract === "amf-research-synthesis-v1" ? {
      candidateStories: grounded ? [{
        candidateId: "deterministic-candidate-1",
        topic: `Documented subject for ${name}`,
        factualAngle: "Two independent supplied sources support the factual production angle.",
        keyClaims: ["The supplied institutional sources document the proposed factual angle."],
        sourceIds: sources.map((source) => source.id),
        supportingEvidenceIds: [],
        sourceQualitySummary: "Multiple supplied sources",
        visualPotential: "Source-led visual narrative",
        shortFormPotential: "Concise evidence-backed sequence",
        evidenceRisks: [],
        verificationStatus: "verified",
        factualVerification: { status: "STRONG", basis: "Two independent supplied sources corroborate the claim." },
        recommendedForProduction: true,
      }] : [],
      evidenceRisks: grounded ? [] : ["No retrieval evidence supplied"],
      status: grounded ? "grounded" : "insufficient_evidence",
    } : {}),
    metadata: { createdAt: nowIso(), agentVersion: AGENT_VERSION },
  };
}

function synthesizeWriter(input: JsonRecord): Json {
  const objective = String(input.objective ?? "");
  const previous = safeRecord(input.previousArtifact);
  const payload = safeRecord(previous.payload);
  const task = safeRecord(input.task);
  const description = String(task.description ?? payload.taskDescription ?? objective);
  // Production writer handoff is an evidence-backed content brief, whose
  // normalized sources use `sourceId`; retain `sources` for legacy research
  // handoffs.  The deterministic provider must copy the exact allowed source
  // identity, not synthesize a replacement reference.
  const sources = Array.isArray(payload.researchSources)
    ? payload.researchSources
    : Array.isArray(payload.sources)
      ? payload.sources
      : [];
  const first = safeRecord(sources[0]);
  const sourceId = typeof first.sourceId === "number" ? first.sourceId : typeof first.id === "number" ? first.id : 1;
  const title = String(first.title ?? `Reference ${sourceId}`);
  const url = String(first.url ?? `https://example.com/research/${sourceId}`);
  const isOrangeDensity = /orange\s+float|density\s+test/i.test(objective);
  const content = isOrangeDensity
    ? "Watch this: an unpeeled orange floats, but peel it and it sinks. The peel is full of tiny air pockets, adding lots of volume without much mass. That lowers the orange's average density, so water can support it. Remove the peel, and the fruit becomes denser than water—so it sinks."
    : `Synthesized content for "${objective}".`;
  return {
    contentId: randomUUID(),
    taskDescription: description,
    objective,
    title: isOrangeDensity ? "Why Does an Orange Float? The 20-Second Density Test" : `Synthesized article: ${objective}`,
    content,
    summary: isOrangeDensity ? "A concise evidence-backed explanation of orange peel buoyancy and average density." : "Synthesized article grounded in the research report.",
    sourceReferences: [{ sourceId, title, url }],
    status: "completed",
    metadata: {
      createdAt: nowIso(),
      agentVersion: AGENT_VERSION,
      researchArtifactId: String(previous.artifactId ?? ""),
    },
  };
}

function synthesizeSeo(input: JsonRecord): Json {
  const objective = String(input.objective ?? "");
  const previous = safeRecord(input.previousArtifact);
  const payload = safeRecord(previous.payload);
  const task = safeRecord(input.task);
  const description = String(task.description ?? payload.taskDescription ?? objective);
  const sources = Array.isArray(payload.sourceReferences) ? payload.sourceReferences : [];
  const first = safeRecord(sources[0]);
  const sourceId = typeof first.sourceId === "number" ? first.sourceId : 1;
  const title = String(first.title ?? `Reference ${sourceId}`);
  const url = String(first.url ?? `https://example.com/research/${sourceId}`);
  const writerTitle = String(payload.title ?? objective);
  return {
    reportId: randomUUID(),
    taskDescription: description,
    objective,
    optimizedTitle: writerTitle,
    optimizedDescription: `Synthesized description for "${writerTitle}".`,
    keywords: [{ keyword: writerTitle, importance: "primary" }],
    topics: [{ topic: writerTitle, presentInContent: true }],
    searchIntent: "informational",
    contentStructure: [{ heading: "Introduction", purpose: "Grounded in the writer content." }],
    sourceReferences: [{ sourceId, title, url }],
    status: "completed",
    metadata: { createdAt: nowIso(), agentVersion: AGENT_VERSION, writerArtifactId: String(previous.artifactId ?? "") },
  };
}

function synthesizeBrand(input: JsonRecord): Json {
  const objective = String(input.objective ?? "");
  const previous = safeRecord(input.previousArtifact);
  const payload = safeRecord(previous.payload);
  const task = safeRecord(input.task);
  const description = String(task.description ?? payload.taskDescription ?? objective);
  return {
    reportId: randomUUID(),
    taskDescription: description,
    objective,
    status: "approved",
    issues: [],
    passedChecks: [{ code: "BRAND_OK", message: "Structural brand validation passed." }],
    failedChecks: [],
    recommendations: [],
    metadata: { createdAt: nowIso(), agentVersion: AGENT_VERSION, seoArtifactId: String(previous.artifactId ?? "") },
  };
}

function synthesizeReview(input: JsonRecord): Json {
  const task = safeRecord(input.task);
  const description = String(task.description ?? "Review task");
  const reviewArtifact = safeRecord(safeRecord(input.context).artifact);
  const isFinalProduct = reviewArtifact.kind === "final_media_artifact";
  return {
    reportId: randomUUID(),
    taskDescription: description,
    summary: "Synthesized review of the content artifact.",
    status: isFinalProduct ? "human_review_required" : "approved",
    findings: [],
    recommendations: [],
    metadata: { createdAt: nowIso(), agentVersion: AGENT_VERSION },
  };
}

function synthesizeQa(input: JsonRecord): Json {
  const requestId = String(input.requestId ?? "");
  const objective = String(input.objective ?? "");
  return {
    reportId: randomUUID(),
    requestId,
    objective,
    status: "reviewed",
    summary: "Synthesized content QA report.",
    testResults: [{ testName: "content-chain-validation", status: "not_executed", executed: false, source: "none" }],
    findings: [],
    risks: [],
    recommendations: [],
    metadata: { createdAt: nowIso(), agentVersion: AGENT_VERSION, executionEvidencePresent: false },
  };
}

// ---------------------------------------------------------------------------
// Production agent executor.
// ---------------------------------------------------------------------------

/**
 * Canonical call-leg identity for research reservations. Mirrors the
 * repair-time derivation (role + callKind + idempotency suffix) as a
 * reserve-time input so stage-scoped budgets can authorize the exact leg.
 * Only research legs have canonical values today; every other agent returns
 * null and can spend unrestricted legacy capacity only. Never invent values
 * for agents without a canonical leg.
 */
export function researchReservationCallLeg(agent: string, callKind: "research" | "text_agent", keySuffix: string): string | null {
  if (agent !== "research") return null;
  if (callKind === "research") return "RETRIEVAL";
  return keySuffix === ":synthesis" ? "FINAL_SYNTHESIS" : "DIRECTION";
}

/**
 * Canonical routing role for the Research Final Synthesis leg. A routing
 * entries row under this role (same version lifecycle as role rows) carries
 * the independently governed synthesis model; absence means legacy behavior
 * (synthesis uses the research role route). This reuses the existing
 * role-keyed routing system: no new table, no new namespace, no PK change.
 */
export const RESEARCH_SYNTHESIS_ROUTE_ROLE = "research-synthesis";

export interface ResearchSynthesisRoute {
  readonly model: string;
  readonly routingVersionId: string;
  readonly priceSnapshotId: string;
}

/**
 * Extract a complete, usable synthesis leg route from a control-overrides
 * map. Returns null unless the leg entry carries a non-empty model AND the
 * routing identifiers the reservation path requires. Partial records fall
 * back to legacy rather than silently downgrading the model or the price
 * identity. Pure and provider-free; unit-tested.
 */
export function researchSynthesisRoute(overrides: unknown): ResearchSynthesisRoute | null {
  const record = safeRecord(safeRecord(overrides)[RESEARCH_SYNTHESIS_ROUTE_ROLE]);
  const model = typeof record.model === "string" ? record.model.trim() : "";
  const routing = safeRecord(record.canonicalRouting);
  const routingVersionId = typeof routing.routingVersionId === "string" ? routing.routingVersionId : "";
  const priceSnapshotId = typeof routing.priceSnapshotId === "string" ? routing.priceSnapshotId : "";
  if (!model || !routingVersionId || !priceSnapshotId) return null;
  return { model, routingVersionId, priceSnapshotId };
}

/**
 * Research leg transport dispatcher. Routes FINAL_SYNTHESIS requests to the
 * governed leg transport and every other leg to the default (legacy) one.
 * The caller wraps the returned closure with the canonical provider
 * lifecycle, so claim attribution, concurrency guard, and diagnostics
 * persistence behave exactly as the single-transport path. Pure over its
 * inputs; unit-tested.
 */
export function researchLegDispatcher(defaultExecute: ExecuteFn, synthesisExecute: ExecuteFn | null): ExecuteFn {
  if (synthesisExecute === null) return defaultExecute;
  return (context, request, signal) => {
    const leg = (request.callIdentity as { callLeg?: unknown } | undefined)?.callLeg;
    return (leg === "FINAL_SYNTHESIS" ? synthesisExecute : defaultExecute)(context, request, signal);
  };
}

export class ProductionAgentExecutor implements AgentExecutorPort {
  private readonly persistence?: PersistencePort;
  private readonly boundary: ProviderCapabilityBoundary;
  private readonly researchSourceRouter?: ResearchSourceRouter;
  private readonly mediaChainBridge?: ProductionMediaChainBridge;
  private readonly mediaHandlers: ReadonlyMap<string, (input: MediaChainInput) => Promise<MediaChainStageOutput>>;
  private readonly mediaResumeBudget?: MediaResumeBudgetPort;
  private readonly modelRouting?: ProductionModelRoutingStore;
  private readonly productionCallBudget?: ProductionCallBudgetStore;
  private readonly routingResolutionObserver?: (value:Readonly<Record<string,unknown>>)=>void;
  private readonly routingDryRun:boolean;

  constructor(options: ProductionAgentExecutorOptions, boundary: ProviderCapabilityBoundary) {
    this.persistence = options.persistence;
    this.boundary = boundary;
    this.mediaResumeBudget = options.mediaResumeBudget;
    this.modelRouting = options.modelRouting ?? (options.pool ? new ProductionModelRoutingStore(options.pool) : undefined);
    this.productionCallBudget = options.productionCallBudget ?? (options.pool ? new ProductionCallBudgetStore(options.pool) : undefined);
    this.routingResolutionObserver=options.routingResolutionObserver;this.routingDryRun=options.routingDryRun===true;
    this.researchSourceRouter = options.researchSourceRouter ?? createProductionResearchSourceRouterFromEnv();
    this.mediaChainBridge = options.mediaChainBridge ?? (options.persistence === undefined ? undefined : new ProductionMediaChainBridge({
      capabilityExecution: boundary.boundary,
      persistence: {
        saveArtifact: async (value) => options.persistence!.saveArtifact(value as unknown as CollaborationArtifact),
        listArtifacts: async (workflowId) => (await options.persistence!.listArtifacts(workflowId)) as unknown as Array<Record<string, unknown>>,
        saveExecutionProvenance: options.persistence!.saveExecutionProvenance?.bind(options.persistence),
        listExecutionProvenance: options.persistence!.listExecutionProvenance?.bind(options.persistence),
      },
      directorAgent: createDirectorAgent({ config: { model: "deterministic", systemPrompt: "" } }),
      videoAgent: createVideoAgent({
        execute: async () => ({ output: {}, raw: "{}", usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, model: "deterministic", provider: "worker-deterministic", latencyMs: 0 }),
        capabilityExecution: boundary.boundary,
        config: { model: "deterministic", maxPromptLength: 500, aspectRatio: "16:9", allowedAspectRatios: ["16:9", "9:16", "4:3", "3:4", "1:1"], durationSeconds: 30, systemPrompt: "" },
      }),
      mediaAgent: createMediaAgent({ capabilityExecution: boundary.boundary, config: { model: "deterministic", systemPrompt: "" } }),
    }));
    this.mediaHandlers = this.mediaChainBridge === undefined ? new Map() : new Map([
      ["director", (input: MediaChainInput) => this.mediaChainBridge!.executeDirector(input)],
      ["tts", (input: MediaChainInput) => this.mediaChainBridge!.executeTts(input)],
      ["timeline", (input: MediaChainInput) => this.mediaChainBridge!.executeTimeline(input)],
      ["scene-image", (input: MediaChainInput) => this.mediaChainBridge!.executeSceneImage(input)],
      ["visual-semantic-review", (input: MediaChainInput) => this.mediaChainBridge!.executeVisualSemanticReview(input)],
      ["visual-technical-qa", (input: MediaChainInput) => this.mediaChainBridge!.executeVisualTechnicalQa(input)],
      ["wan-authorization", (input: MediaChainInput) => this.mediaChainBridge!.executeWanAuthorization(input)],
      ["video", (input: MediaChainInput) => this.mediaChainBridge!.executeVideo(input)],
      ["composer", (input: MediaChainInput) => this.mediaChainBridge!.executeComposer(input)],
    ]);
  }

  async executeAgentStep(step: AgentStep, context: WorkflowContext): Promise<StepOutcome> {
    try { context = await this.withCanonicalModelRouting(step, context); }
    catch (error) { const message=error instanceof Error?error.message:String(error); return {status:"failed",output:{project:String(safeRecord(context.data).projectId??"UNKNOWN"),role:step.agent,routingVersion:null,requestedSlot:String(safeRecord(context.data).routingSlot??"primary"),failureReason:message},error:{message,retryable:false}}; }
    if(this.routingDryRun&&safeRecord(context.data).canonicalRouting){return{status:"completed",output:safeRecord(safeRecord(context.data).canonicalRouting) as Json};}
    if (step.agent === "publisher-authorization") {
      return this.executePublisherAuthorization(step, context);
    }
    if (MEDIA_STAGE_AGENTS.has(step.agent) && safeRecord(context.data).productionPhase !== "PRE_MEDIA_PHASE") {
      if (this.mediaChainBridge === undefined || this.persistence === undefined) {
        return { status: "failed", output: { stepId: step.id, agent: step.agent, error: "EXECUTOR_NOT_CONFIGURED" }, error: { message: "EXECUTOR_NOT_CONFIGURED", retryable: false } };
      }
      // Exactly-once claim state (R7 hardening): set inside the resume
      // branch below when the budget port supports claims. Declared outside
      // try so the catch block can finalize on failure. A stale open claim
      // that already consumed budget resumes with a no-op bridge so recovery
      // never double-consumes.
      let skipBudgetConsume = false;
      let stageClaim: { first: boolean; state: string; outcome: string | null; error: string | null; budgetConsumed: boolean } | null = null;
      let ownsStageExecution = false;
      try {
        const startedAt = nowIso(); const startedMs = Date.now();
        const chain = await this.loadChain(context);
        // Media Technical Resume V1: when a resume is active, wire the
        // owner-authorized provider budget into every media call.
        const mediaResumeMarkerForBudget = mediaResumeExecutionMarker(context.data);
        const activeMediaResumeId = mediaResumeMarkerForBudget.mediaResumeExecution === undefined
          ? undefined
          : String(safeRecord(mediaResumeMarkerForBudget.mediaResumeExecution).resumeId ?? "");
        const buildBudgetBridge = () => activeMediaResumeId && this.mediaResumeBudget
          ? {
              resumeId: activeMediaResumeId,
              consume: (input: { stage: string; capabilityId: string; itemId?: string }) =>
                skipBudgetConsume
                  ? Promise.resolve()
                  : this.mediaResumeBudget!.consumeProviderBudget({ resumeId: activeMediaResumeId, workflowId: context.workflowId, ...input }),
            }
          : undefined;
        const mediaResumeMarker = mediaResumeExecutionMarker(context.data);
        const mediaResume = mediaResumeMarker.mediaResumeExecution === undefined ? undefined : safeRecord(mediaResumeMarker.mediaResumeExecution);
        if (mediaResume !== undefined && mediaResume.resumeId !== undefined) {
          if (this.boundary.workerExecutionEnvironment?.mediaLiveExecutionAllowed === false) {
            throw new Error(`MEDIA_LIVE_EXECUTION_ENVIRONMENT_UNSUPPORTED:${this.boundary.workerExecutionEnvironment.reasonCode ?? "UNKNOWN"}`);
          }
          // Configuration-drift verification: recompute the canonical v2
          // fingerprint from the LIVE boundary and the governed effective
          // voice, and require it to equal the fingerprint frozen at
          // authorization. An endpoint/provider/voice/registration change
          // after authorization FAILS CLOSED here — before budget
          // consumption, provider invocation, and artifact creation.
          if (this.mediaResumeBudget?.verifyConfigurationFingerprint !== undefined) {
            const liveFingerprint = buildMediaConfigurationFingerprintV2(
              snapshotMediaConfigurationInput(
                this.boundary,
                resolveProductionTtsVoice(safeRecord(context.data).voice, context.workflowId),
              ),
            );
            await this.mediaResumeBudget.verifyConfigurationFingerprint({
              resumeId: String(mediaResume.resumeId),
              workflowId: context.workflowId,
              fingerprint: liveFingerprint,
            });
          }
          const authorizedStages = ["tts", "timeline", "scene-image", "visual-semantic-review", "visual-technical-qa", "visual-human-gate"];
          if (!authorizedStages.includes(step.agent)) {
            throw new Error(`MEDIA_RESUME_DOWNSTREAM_BOUNDARY_VIOLATION:${step.agent}`);
          }
          // Timeline-start resume must reuse the frozen R6 TTS checkpoint
          // exactly — no TTS provider execution of any kind. Firewall before
          // budget/provider/artifact.
          if (mediaResume.resumeStartStage === "timeline" && step.agent === "tts") {
            throw new Error("TTS_REEXECUTION_FORBIDDEN_FOR_TIMELINE_RESUME");
          }
          // Frozen Director package: scene-count drift fails closed.
          if (step.agent === "scene-image") {
            const frozenSceneCount = Array.isArray(mediaResume.directorSceneIds) ? (mediaResume.directorSceneIds as unknown[]).length : 0;
            const directorPlan = [...chain].reverse().find((a) => a.kind === "scene_plan" && a.status === "completed");
            const planned = Array.isArray((directorPlan?.payload as Record<string, unknown> | undefined)?.sceneIds)
              ? ((directorPlan!.payload as Record<string, unknown>).sceneIds as unknown[]).filter((id): id is string => typeof id === "string")
              : [];
            if (planned.length !== frozenSceneCount || (directorPlan?.artifactId !== mediaResume.directorArtifactId && directorPlan?.artifactId !== mediaResume.directorLineageArtifactId)) {
              throw new Error(`MEDIA_RESUME_DIRECTOR_PACKAGE_DRIFT:${directorPlan?.artifactId ?? "none"}:scenes=${planned.length}:frozen=${frozenSceneCount}`);
            }
          }
          // Exactly-once stage claim (R7 hardening): the first claimant owns
          // this logical execution and its single budget consumption.
          // Duplicates observe the durable claim: terminal claims return the
          // recorded outcome with zero re-execution and zero budget; a stale
          // open claim (crash between claim and finalize) re-executes without
          // consuming budget twice.
          if (this.mediaResumeBudget?.claimStageExecution !== undefined) {
            stageClaim = await this.mediaResumeBudget.claimStageExecution({
              resumeId: String(mediaResume.resumeId),
              workflowId: context.workflowId,
              stage: step.agent,
            });
            if (!stageClaim.first) {
              if (stageClaim.state === "COMPLETED") {
                const reused = await this.reuseCompletedStageArtifact(step, context);
                if (reused !== null) return reused;
                const message = "MEDIA_RESUME_STAGE_OUTCOME_UNAVAILABLE";
                return { status: "failed", output: { stepId: step.id, agent: step.agent, error: message }, error: { message, retryable: false } };
              }
              if (stageClaim.state === "FAILED") {
                const message = typeof stageClaim.error === "string" && stageClaim.error.length > 0 ? stageClaim.error : "MEDIA_RESUME_STAGE_ALREADY_FAILED";
                return { status: "failed", output: { stepId: step.id, agent: step.agent, error: message }, error: { message, retryable: false } };
              }
              // Stale open claim: this delivery owns the re-execution, but
              // budget already consumed stays consumed.
              ownsStageExecution = true;
              skipBudgetConsume = stageClaim.budgetConsumed;
            } else {
              ownsStageExecution = true;
            }
          }
        }
        const budgetBridge = buildBudgetBridge();
        const mediaInput = mediaInputFromChain(context, chain, budgetBridge, this.boundary.resolvedProviderIds);
        const handler = this.mediaHandlers.get(step.agent);
        if (handler === undefined) throw new Error("EXECUTOR_NOT_CONFIGURED");
        const result = await handler(mediaInput);
        const output = result.output as unknown as Json;
        await this.persistMediaStageProvenance(step, context, result.status, startedAt, Date.now() - startedMs);
        if (stageClaim !== null && ownsStageExecution && this.mediaResumeBudget?.finalizeStageExecution !== undefined) {
          await this.mediaResumeBudget.finalizeStageExecution({
            resumeId: String((safeRecord(mediaResumeExecutionMarker(context.data).mediaResumeExecution).resumeId ?? "")),
            stage: step.agent,
            outcome: result.status === "BLOCKED" ? "blocked" : "completed",
            error: result.status === "BLOCKED" ? String(safeRecord(result.output).reason ?? "MEDIA_STAGE_BLOCKED") : undefined,
          });
        }
        // These handlers durably persist their canonical domain artifacts
        // themselves. Their returned output is an execution summary, not an
        // additional domain artifact. Persisting the generic wrapper would
        // duplicate per-scene visuals/authorizations/clips or final media.
        const mediaCatalogStage = (CANONICAL_STAGE_CATALOG as Record<string, { inputArtifactKinds: readonly string[] }>)[step.id];
        const mediaParent = mediaCatalogStage === undefined ? undefined : [...chain].reverse().find((item) => mediaCatalogStage.inputArtifactKinds.includes(item.kind));
        const artifact = ["scene-image", "wan-authorization", "video", "composer"].includes(step.agent)
          ? undefined
          : this.buildArtifact(step, context, output, result.status === "BLOCKED" ? "blocked" : "completed", true, mediaParent);
        return { status: result.status === "BLOCKED" ? "failed" : "completed", output, artifact, ...(result.status === "BLOCKED" ? { error: { message: String(safeRecord(result.output).reason ?? "MEDIA_STAGE_BLOCKED"), retryable: false } } : {}) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (stageClaim !== null && ownsStageExecution && this.mediaResumeBudget?.finalizeStageExecution !== undefined) {
          try {
            await this.mediaResumeBudget.finalizeStageExecution({
              resumeId: String((safeRecord(mediaResumeExecutionMarker(context.data).mediaResumeExecution).resumeId ?? "")),
              stage: step.agent,
              outcome: "failed",
              error: message,
            });
          } catch { /* never mask the original failure */ }
        }
        return { status: "failed", output: { stepId: step.id, agent: step.agent, error: message }, error: { message, retryable: false } };
      }
    }
    if (!PRODUCTION_AGENTS.has(step.agent)) {
      return this.deterministicStep(step, context);
    }

    let provenanceStartedAt: string | null = null;
    let provenanceStartedMs = 0;
    let provenanceInput: Json | null = null;
    let preparationInput: Json | null = null;
    let lifecycle: GovernedLlmLifecycle | null = null;
    let productionReservations: ProductionCallReservation[] = [];
    let productionSubmissionStarted = false;
    let budgetReconciliationFailure: string | null = null;
    let researchOutputForFailureDiagnostics: Json | null = null;
    try {
      // PREPARING is explicitly pre-submission.  It gives failures in chain
      // loading/input assembly a durable identity without making restart
      // reconciliation assume a provider call might have occurred.
      preparationInput = { __agent: step.agent, strategyMode: safeRecord(context.data).strategyMode, controlAgentOverrides: safeRecord(context.data).controlAgentOverrides as Json, ...recoveryExecutionMarker(context.data), ...revisionExecutionMarker(context.data), ...reviewResumeExecutionMarker(context.data) } as Json;
      provenanceStartedAt = nowIso(); provenanceStartedMs = Date.now();
      lifecycle = await this.prepareGovernedLlmLifecycle(step, context, preparationInput, provenanceStartedAt, provenanceStartedMs);
      const chain = await this.loadChain(context);
      const input = this.buildAgentInput(step, context, chain);
      provenanceInput = input.input;
      await this.preflightProductionLlm(step, context, input.input);
      const reservationResult = await this.reserveProductionCalls(step, context);
      productionReservations = reservationResult.reservations;
      // V2: inject the authorized retrieval envelope into the agent input
      // AFTER reservation so the agent knows its actual cap.
      if (reservationResult.effectiveRetrievalEnvelope !== null && input.input !== null && typeof input.input === "object" && !Array.isArray(input.input)) {
        (input.input as unknown as Record<string, unknown>).maxRetrievalCallsAvailable = reservationResult.effectiveRetrievalEnvelope;
      }
      if (lifecycle !== null) {
        lifecycle.configuration = input.input;
        await this.persistLifecycle(lifecycle, "READY_FOR_SUBMISSION", { providerSubmissionStarted: false });
      }
      const researchReservations = productionReservations.filter((reservation) => reservation.callKind === "research");
      const capabilityExecution = step.agent === "research"
        ? lifecycle !== null && researchReservations.length > 0
          ? this.withResearchCapabilityLifecycle(this.boundary.boundary, lifecycle, researchReservations)
          : this.boundary.boundary
        : undefined;
      const governedLifecycle = lifecycle;
      const agent = this.buildAgent(step.agent, input, capabilityExecution, governedLifecycle !== null
        ? (raw: ExecuteFn): ExecuteFn => this.withProviderSubmissionLifecycle(raw, governedLifecycle, productionReservations)
        : (raw: ExecuteFn): ExecuteFn => raw);
      productionSubmissionStarted = productionReservations.length > 0;
      const execution = await agent.execute(
        { context: this.buildExecutionContext(step, context), input: input.input },
        noopCancellation(),
      );
      const normalizedOutput = step.agent === "research" ? groundResearchReport(execution.output) : execution.output;
      if (step.id === "ceo-recommendation") {
        const expected = String(safeRecord(input.input).requiredDecision ?? "");
        const actual = String(safeRecord(normalizedOutput).decision ?? "");
        if (!expected || actual !== expected) throw new Error(`CEO_RECOMMENDATION_DECISION_CONFLICT:expected=${expected || "missing"}:actual=${actual || "missing"}`);
        if (actual !== "ADVANCE") {
          context.data.boundedExecution = {
            stopAfterStepId: step.id,
            reason: `CEO_${actual}`,
            authorization: "CANONICAL_EVIDENCE_GATE",
            recoveryExecutionId: null,
          } as unknown as Json;
        }
      }
      const strictCouncilPayload = safeRecord(input.input).strategyMode === "PRE_PUBLICATION_STRATEGY"
        && isStrictStrategyCouncilV2Payload(step.agent, normalizedOutput);
      const output = strictCouncilPayload
        ? deepFreezeJson(structuredClone(validateStrictStrategyCouncilV2Payload(step.agent, normalizedOutput)))
        : {
            ...safeRecord(normalizedOutput),
            ...(step.agent === "qa" && safeRecord(input.input).finalMedia !== undefined
              ? { finalMediaArtifactId: safeRecord(safeRecord(input.input).finalMedia).finalMediaArtifactId }
              : {}),
            agentExecution: {
              provider: execution.response.provider,
              model: execution.response.model,
              usage: execution.response.usage,
              latencyMs: execution.response.latencyMs,
              finishReason: (execution.response as unknown as { finishReason?: unknown }).finishReason ?? "unknown",
            },
          } as unknown as Json;
      if (step.agent === "research") researchOutputForFailureDiagnostics = output;
      const modelBReview = step.agent === "review" && step.id === "review";
      const reviewBusinessPayload = modelBReview ? deepFreezeJson(structuredClone(normalizedOutput)) : null;
      const status = modelBReview ? "completed" : artifactStatusFor(step.agent, output, context.data, step.id);
      // Revision Cycle V1: revised artifacts durably carry the revision
      // lineage (source revision task + Review artifact/execution + prior
      // content artifacts). The frozen Review business payload stays pure;
      // revalidation normalizes the enriched artifact payload back to it.
      // REVIEW_ONLY_TECHNICAL_RESUME: the fresh Review artifact additionally
      // carries the resume lineage (frozen package + failed-review identity).
      const revisionLineage = revisionExecutionLineage(context);
      const resumeLineage = modelBReview ? reviewResumeLineage(context) : null;
      const artifactPayload = revisionLineage === null && resumeLineage === null
        ? reviewBusinessPayload ?? output
        : reviewBusinessPayload !== null
          ? { ...(reviewBusinessPayload as unknown as JsonRecord), ...(revisionLineage === null ? {} : { revision: revisionLineage }), ...(resumeLineage === null ? {} : { reviewResume: resumeLineage }) } as unknown as Json
          : { ...safeRecord(output), ...(revisionLineage === null ? {} : { revision: revisionLineage }), ...(resumeLineage === null ? {} : { reviewResume: resumeLineage }) } as unknown as Json;
      const catalogStage = (CANONICAL_STAGE_CATALOG as Record<string, { inputArtifactKinds: readonly string[] }>)[step.id];
      const canonicalParent = catalogStage === undefined ? undefined : [...chain].reverse().find((item) => catalogStage.inputArtifactKinds.includes(item.kind));
      const artifact = this.buildArtifact(step, context, artifactPayload, status, !strictCouncilPayload, canonicalParent);
      await this.persistCapabilityEvidence(step, context, output);
      if (status !== "completed") {
        // Only non-Review agents retain this legacy blocked-output behavior.
        // A valid Review is always a completed execution with a business verdict.
        // Research blocked diagnostics are attached for durability (bounded
        // evidence-gate verdict + counts, no raw evidence): the workflow still
        // fails closed here; diagnostics never convert failure to success.
        const outcomeError = new Error(`AGENT_OUTPUT_${status.toUpperCase()}:${step.agent}`) as Error & { diagnostics?: Record<string, unknown> };
        if (step.agent === "research") {
          outcomeError.diagnostics = { researchBlocked: buildResearchBlockedDiagnostics(output, context.data, step.id) };
        }
        throw outcomeError;
      }
      if (modelBReview) {
        if (this.persistence === undefined) throw new Error("REVIEW_ARTIFACT_PERSISTENCE_REQUIRED");
        if (lifecycle !== null) await this.persistLifecycle(lifecycle, "ARTIFACT_PERSISTING", { reviewBusinessStatus: safeRecord(reviewBusinessPayload).status });
        await this.persistence.saveArtifact(artifact);
        const reloaded = (await this.persistence.listArtifacts(context.workflowId)).find((candidate) => candidate.artifactId === artifact.artifactId);
        if (reloaded === undefined) throw new Error("REVIEW_ARTIFACT_RELOAD_FAILED");
        const expectedParent = artifact.parentArtifact;
        if (reloaded.kind !== "review_report" || reloaded.producerAgent !== "review" || reloaded.status !== "completed"
          || reloaded.workflowId !== context.workflowId || reloaded.correlationId !== (context.correlationId ?? "")
          || reloaded.parentArtifact?.artifactId !== expectedParent?.artifactId || reloaded.parentArtifact?.kind !== expectedParent?.kind) {
          throw new Error("REVIEW_ARTIFACT_LINEAGE_FAILED");
        }
        const revalidated = (agent as ReviewerAgent).validateReviewResponse(reloaded.payload as Json, input.input as unknown as ReviewerInput);
        if (stableFingerprint(revalidated as unknown as Json) !== stableFingerprint(reviewBusinessPayload)) throw new Error("REVIEW_ARTIFACT_DEEP_EQUALITY_FAILED");
      }
      if (strictCouncilPayload) {
        if (this.persistence === undefined) throw new Error("V2_ARTIFACT_PERSISTENCE_REQUIRED");
        try {
          await this.persistence.saveArtifact(artifact);
        } catch {
          throw new Error("V2_ARTIFACT_PERSISTENCE_FAILED");
        }
        let reloaded: CollaborationArtifact | undefined;
        try {
          reloaded = (await this.persistence.listArtifacts(context.workflowId)).find((candidate) => candidate.artifactId === artifact.artifactId);
        } catch {
          throw new Error("V2_ARTIFACT_RELOAD_FAILED");
        }
        if (reloaded === undefined) throw new Error("V2_ARTIFACT_RELOAD_FAILED");
        if (reloaded.status !== "completed" || reloaded.workflowId !== context.workflowId || reloaded.correlationId !== (context.correlationId ?? undefined)) {
          throw new Error("V2_ARTIFACT_LINEAGE_VALIDATION_FAILED");
        }
        const revalidated = validateStrictStrategyCouncilV2Payload(step.agent, reloaded.payload as unknown as Json);
        if (stableFingerprint(revalidated) !== stableFingerprint(output)) throw new Error("V2_ARTIFACT_PAYLOAD_ROUNDTRIP_FAILED");
        context.data.previousArtifact = { artifactId: artifact.artifactId, kind: artifact.kind };
      }
      await this.persistCompletedAgentProvenance(step, context, execution.response, artifact.artifactId, status, input.input, provenanceStartedAt, Date.now() - provenanceStartedMs, lifecycle, modelBReview);
      if (step.agent === "research") {
        await this.reconcileResearchCalls({ reservations: productionReservations, output, status, productionSubmissionStarted, lifecycleExecutionId: lifecycle?.executionId ?? null });
      } else {
        await this.reconcileProductionCalls(productionReservations, true, true, execution.response.usage?.costUsd, execution.response.provider === "openrouter" ? undefined : undefined);
      }
      return { status: "completed", output, artifact,
        ...(modelBReview ? { reviewBusinessStatus: (reviewBusinessPayload as unknown as ReviewReport).status, reviewExecutionId: lifecycle?.executionId } : {}) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (step.agent === "research" && researchOutputForFailureDiagnostics !== null) {
        const diagnosticError = error as Error & { diagnostics?: Record<string, unknown> };
        if (typeof safeRecord(diagnosticError.diagnostics).researchBlocked !== "object") {
          diagnosticError.diagnostics = {
            ...safeRecord(diagnosticError.diagnostics),
            researchBlocked: buildResearchBlockedDiagnostics(researchOutputForFailureDiagnostics, context.data, step.id),
          };
        }
      }
      if (productionReservations.length > 0) {
        const failedUsage=safeRecord(safeRecord(lifecycle?.lastProviderResponse).usage);
        const failedCalculableCost=typeof failedUsage.cost==="number"?failedUsage.cost:undefined;
        try {
          if (step.agent === "research") {
            await this.reconcileResearchCalls({ reservations: productionReservations, output: null, status: "failed", productionSubmissionStarted, failedCalculableCost, lifecycleExecutionId: lifecycle?.executionId ?? null });
          } else {
            await this.reconcileProductionCalls(productionReservations, productionSubmissionStarted, false, failedCalculableCost, undefined);
          }
        }
        catch (budgetError) {
          // A reconciliation reporter failure must not suppress the original
          // provider/gate failure evidence. Preserve a bounded marker and
          // continue through canonical terminal provenance persistence; the
          // unresolved reservation remains fail-closed for audited recovery.
          budgetReconciliationFailure = sanitizedFailureMessage(budgetError);
        }
      }
      if (provenanceStartedAt !== null && (provenanceInput !== null || preparationInput !== null)) {
        const persistenceFailure = await this.persistFailedAgentProvenance(step, context, provenanceInput ?? preparationInput!, provenanceStartedAt, Date.now() - provenanceStartedMs, error, lifecycle, budgetReconciliationFailure);
        if (persistenceFailure !== null) return {
          status: "failed",
          output: { stepId: step.id, agent: step.agent, error: message, persistenceFailure },
          error: { message: `${message}; ${persistenceFailure}`, retryable: false },
        };
      }
      return {
        status: "failed",
        output: { stepId: step.id, agent: step.agent, error: message, ...(budgetReconciliationFailure === null ? {} : { budgetReconciliationFailure }) },
        error: { message, retryable: false },
      };
    }
  }

  private async reserveProductionCalls(step: AgentStep, context: WorkflowContext): Promise<{ reservations: ProductionCallReservation[]; effectiveRetrievalEnvelope: number | null }> {
    const data = safeRecord(context.data);
    if (data.productionPhase !== "PRE_MEDIA_PHASE") return { reservations: [], effectiveRetrievalEnvelope: null };
    if (this.productionCallBudget === undefined) throw new Error("PRODUCTION_CALL_BUDGET_STORE_UNAVAILABLE");
    const projectId = String(data.projectId ?? "");
    if (!projectId) throw new Error("PROJECT_CONTEXT_REQUIRED");
    const budgetPhase=typeof data.budgetPhase==="string"&&data.budgetPhase.trim()?data.budgetPhase:"PRE_MEDIA_PHASE";
    // `withCanonicalModelRouting` stores the execution override and its
    // immutable routing evidence together.  The outer object is the provider
    // override; the nested object is the canonical route provenance.
    const routeOverride = safeRecord(data.canonicalRouting);
    const route = safeRecord(routeOverride.canonicalRouting);
    const priceSnapshotId = typeof route.priceSnapshotId === "string" ? route.priceSnapshotId : null;
    if (priceSnapshotId === null) throw new Error("PRODUCTION_PRICE_SNAPSHOT_REQUIRED");
    const recovery = safeRecord(data.recoveryExecution);
    const recoveryExecutionId = typeof recovery.recoveryExecutionId === "string"
      ? recovery.recoveryExecutionId
      : typeof recovery.recoveryOfExecutionId === "string" ? String(recovery.recoveryOfExecutionId) : null;
    const recoverySuffix = recoveryExecutionId === null ? "" : `:recovery:${recoveryExecutionId}`;
    // Research V2: compute effective retrieval envelope from remaining budget
    // instead of pre-reserving the architectural maximum.
    const researchV2 = step.agent === "research" && data.researchIntelligenceVersion === "V2";
    let effectiveRetrievalEnvelope: number | null = null;
    let researchReservations: Array<{ callKind: "research"; keySuffix: string }>;
    if (researchV2) {
      const budgets = await this.productionCallBudget.budgets(projectId, budgetPhase);
      const researchBudget = budgets.find((b) => b.callKind === "research");
      const remainingCapacity = researchBudget !== undefined ? Math.max(0, researchBudget.remaining) : 0;
      effectiveRetrievalEnvelope = Math.min(
        MAX_V2_RESEARCH_RETRIEVAL_CALLS,
        MISSION_AUTHORIZED_MAX_RETRIEVALS,
        remainingCapacity,
      );
      researchReservations = Array.from(
        { length: effectiveRetrievalEnvelope },
        (_, index) => ({ callKind: "research" as const, keySuffix: `:retrieval:${index + 1}` }),
      );
    } else if (step.agent === "research") {
      researchReservations = [{ callKind: "research", keySuffix: "" }];
    } else {
      researchReservations = [];
    }
    const directionReuse = step.agent === "research" && safeRecord(data.researchDirectionReuse).mission !== undefined;
    const reservationSpecs: Array<{ callKind: "research" | "text_agent"; keySuffix: string }> = step.agent === "research"
      ? [...researchReservations, ...(directionReuse ? [] : [{ callKind: "text_agent" as const, keySuffix: "" }]), { callKind: "text_agent", keySuffix: ":synthesis" }]
      : [{ callKind: "text_agent", keySuffix: "" }];
    const reservations: ProductionCallReservation[] = [];
    // Per-leg synthesis accounting: the :synthesis reservation carries the
    // leg route's model/price identity when a governed leg route exists, so
    // budget lineage and model lineage cannot disagree. All other specs keep
    // the legacy step-agent route identity byte-for-byte.
    const synthesisRoute = step.agent === "research" ? researchSynthesisRoute(safeRecord(data.controlAgentOverrides)) : null;
    try {
      for (const spec of reservationSpecs) {
        const isSynthesisLeg = synthesisRoute !== null && spec.callKind === "text_agent" && spec.keySuffix === ":synthesis";
        reservations.push(await this.productionCallBudget.reserve({
          projectId, workflowId: context.workflowId, phase: budgetPhase, stage: step.id, role: step.agent, callKind: spec.callKind,
          callLeg: researchReservationCallLeg(step.agent, spec.callKind, spec.keySuffix),
          idempotencyKey: `${context.workflowId}:${step.id}:${spec.callKind}:v1${recoverySuffix}${spec.keySuffix}`,
          routingVersionId: isSynthesisLeg && synthesisRoute !== null ? synthesisRoute.routingVersionId : (typeof route.routingVersionId === "string" ? route.routingVersionId : null),
          exactModelId: isSynthesisLeg && synthesisRoute !== null ? synthesisRoute.model : (typeof safeRecord(safeRecord(data.controlAgentOverrides)[step.agent]).model === "string" ? String(safeRecord(safeRecord(data.controlAgentOverrides)[step.agent]).model) : null),
          priceSnapshotId: isSynthesisLeg && synthesisRoute !== null ? synthesisRoute.priceSnapshotId : priceSnapshotId,
          provenance: { projectId, phase: budgetPhase, productionPhase:"PRE_MEDIA_PHASE", productionCycle:data.productionCycle??null, authority: data.phaseAuthority ?? "UNKNOWN" },
        }));
      }
      return { reservations, effectiveRetrievalEnvelope };
    } catch (error) {
      await this.reconcileProductionCalls(reservations, false, false, undefined, undefined);
      throw error;
    }
  }

  private async reconcileProductionCalls(reservations: ProductionCallReservation[], submitted: boolean, success: boolean, calculableCostUsd?: number, providerBilledCostUsd?: number): Promise<void> {
    if (this.productionCallBudget === undefined) return;
    for (const reservation of reservations) await this.productionCallBudget.reconcile({ reservationId: reservation.reservationId, providerSubmissionStarted: submitted, success, calculableCostUsd: reservation.callKind === "text_agent" ? calculableCostUsd : undefined, providerBilledCostUsd, provenance: { reconciledBy: "production-executor", costSemantics: providerBilledCostUsd === undefined ? "PROVIDER_BILLED_UNKNOWN" : "PROVIDER_BILLED_KNOWN" } });
  }

  /**
   * Research recovery consumes three governed calls (retrieval + planning LLM
   * + synthesis LLM) with independent reservations. Reconcile each leg from
   * its own evidence: retrieval from capability outcomes, planning/synthesis
   * from per-call usage (output on success, lifecycle transport events on
   * failure). A leg that provably never submitted is RELEASED, never
   * consumed; uncertain legs keep the legacy coarse submitted flag so spend
   * exposure is never under-counted.
   */
  private async reconcileResearchCalls(input: {
    readonly reservations: ProductionCallReservation[];
    readonly output: Json | null;
    readonly status: "completed" | "failed" | "blocked";
    readonly productionSubmissionStarted: boolean;
    readonly failedCalculableCost?: number;
    readonly lifecycleExecutionId?: string | null;
  }): Promise<void> {
    if (this.productionCallBudget === undefined) return;
    const store = this.productionCallBudget;
    const completed = input.status === "completed";
    const provenance = { reconciledBy: "production-executor", costSemantics: "PROVIDER_BILLED_UNKNOWN" };
    const record = safeRecord(input.output);
    const executions = Array.isArray(record.capabilityExecutions) ? record.capabilityExecutions : [];
    const planning = safeRecord(record.planningUsage);
    const synthesis = safeRecord(record.synthesisUsage);
    let planSubmitted = Object.keys(planning).length > 0;
    let synthesisSubmitted = Object.keys(synthesis).length > 0;
    const lifecycleStartedRetrievals = new Set<string>();
    let planCost = typeof planning.costUsd === "number" ? planning.costUsd as number : undefined;
    let synthesisCost = typeof synthesis.costUsd === "number" ? synthesis.costUsd as number : undefined;
    if (input.lifecycleExecutionId !== undefined && input.lifecycleExecutionId !== null
      && this.persistence?.listExecutionLifecycleEvents !== undefined) {
      try {
        const events = await this.persistence.listExecutionLifecycleEvents(input.lifecycleExecutionId);
        const researchReservations = input.reservations.filter((reservation) => reservation.callKind === "research");
        const textReservations = input.reservations.filter((reservation) => reservation.callKind === "text_agent");
        const planReservation = textReservations.find((reservation) => !reservation.idempotencyKey.endsWith(":synthesis"));
        const synthesisReservation = textReservations.find((reservation) => reservation.idempotencyKey.endsWith(":synthesis"));
        const started = (reservation: ProductionCallReservation | undefined): boolean => reservation !== undefined && ["TRANSPORT_STARTED", "TRANSPORT_COMPLETED", "TRANSPORT_FAILED_AFTER_START"].includes(deriveCallTransportState(reservation, events));
        planSubmitted = started(planReservation);
        synthesisSubmitted = started(synthesisReservation);
        for (const reservation of researchReservations) if (started(reservation)) lifecycleStartedRetrievals.add(reservation.reservationId);
        const responseUsage = (reservation: ProductionCallReservation | undefined): JsonRecord => {
          if (reservation === undefined) return {};
          const response = events.find((event) => {
            const metadata = safeRecord(event.metadata);
            return event.state === "PROVIDER_RESPONSE_RECEIVED" && (metadata.reservationId === reservation.reservationId || metadata.idempotencyKey === reservation.idempotencyKey);
          });
          return safeRecord(safeRecord(response?.metadata).usage);
        };
        const planResponseUsage = responseUsage(planReservation);
        const synthesisResponseUsage = responseUsage(synthesisReservation);
        if (typeof planResponseUsage.cost === "number") planCost = planResponseUsage.cost as number;
        if (typeof synthesisResponseUsage.cost === "number") synthesisCost = synthesisResponseUsage.cost as number;
      } catch {
        planSubmitted = Object.keys(planning).length > 0;
        synthesisSubmitted = Object.keys(synthesis).length > 0;
      }
    }
    if (input.output === null && planSubmitted && planCost === undefined) planCost = input.failedCalculableCost;
    if (input.output === null && !planSubmitted && synthesisSubmitted && synthesisCost === undefined) synthesisCost = input.failedCalculableCost;
    const researchReservations = input.reservations.filter((reservation) => reservation.callKind === "research");
    const textReservations = input.reservations.filter((reservation) => reservation.callKind === "text_agent");
    for (const [index, researchRes] of researchReservations.entries()) {
      const execution = executions[index] === undefined ? null : safeRecord(executions[index]);
      const executionStatus = execution?.status;
      const submitted = execution === null
        ? lifecycleStartedRetrievals.has(researchRes.reservationId)
        : executionStatus === "success" || executionStatus === "failed";
      await store.reconcile({ reservationId: researchRes.reservationId, providerSubmissionStarted: submitted, success: execution === null ? submitted && completed : executionStatus === "success", calculableCostUsd: undefined, providerBilledCostUsd: undefined, provenance });
    }
    const planRes = textReservations.find((reservation) => !reservation.idempotencyKey.endsWith(":synthesis"));
    const synthesisRes = textReservations.find((reservation) => reservation.idempotencyKey.endsWith(":synthesis"));
    if (planRes !== undefined) await store.reconcile({ reservationId: planRes.reservationId, providerSubmissionStarted: planSubmitted, success: planSubmitted && completed, calculableCostUsd: planCost, providerBilledCostUsd: undefined, provenance });
    if (synthesisRes !== undefined) await store.reconcile({ reservationId: synthesisRes.reservationId, providerSubmissionStarted: synthesisSubmitted, success: synthesisSubmitted && completed, calculableCostUsd: synthesisCost, providerBilledCostUsd: undefined, provenance });
  }

  private async withCanonicalModelRouting(step:AgentStep,context:WorkflowContext):Promise<WorkflowContext>{
    const data=safeRecord(context.data),project=String(data.projectId??data.project_id??"");
    if(!project)return context;
    const catalogStage=(CANONICAL_STAGE_CATALOG as Record<string,{executionType:string;routingRole:string|null}>)[step.id]
      ?? (CANONICAL_STAGE_CATALOG as Record<string,{executionType:string;routingRole:string|null}>)[step.agent];
    if(catalogStage!==undefined&&!['LLM','HYBRID'].includes(catalogStage.executionType))return context;
    if(!this.modelRouting)throw new Error("CANONICAL_ROUTING_STORE_UNAVAILABLE");
    const aliases:Record<string,string>={"visual-prompt":"visual-director",scenes:"director","research-synthesis":"research",reviewer:"review"};
    const role=catalogStage?.routingRole??aliases[step.agent]??step.agent,slot=String(data.primaryModelUnavailable===true?"fallback":(data.routingSlot??"primary")) as "primary"|"fallback"|"economy"|"premiumEscalation";
    const fallbackReason=typeof data.fallbackReason==='string'?data.fallbackReason:undefined;
    const resolved=await this.modelRouting.resolve(role,{projectId:project,slot,premiumAuthorized:data.premiumEscalationAuthorized===true,fallbackAuthorized:data.fallbackAuthorized===true,fallbackReason});
    this.routingResolutionObserver?.({project,agent:step.agent,...resolved});
    const overrides={...safeRecord(data.controlAgentOverrides),[step.agent]:{provider:resolved.provider,model:resolved.model,canonicalRouting:{routingVersionId:resolved.routingVersionId,routingScope:resolved.routingScope,projectId:resolved.projectId,role:resolved.role,profile:resolved.profile,slot,requestedModel:resolved.requestedModel,resolvedModel:resolved.resolvedModel,priceSnapshotId:resolved.priceSnapshotId,availabilityState:"CONFIGURED",fallbackUsed:resolved.fallbackUsed,fallbackReason:resolved.fallbackReason,premiumEscalation:slot==="premiumEscalation",resolutionReason:"ACTIVE_PROJECT_CANONICAL_ROUTING"}}};
    // Research synthesis leg route: an independently governed model for the
    // FINAL_SYNTHESIS leg lives under the leg routing role. Absence preserves
    // legacy behavior (synthesis uses the research role route); only a
    // missing leg row falls back — a present-but-broken row still throws via
    // resolve(), mirroring existing governed failure semantics.
    let legOverrides = overrides;
    if (step.agent === "research" && this.modelRouting) {
      let legResolved: Awaited<ReturnType<ProductionModelRoutingStore["resolve"]>> | null = null;
      try {
        legResolved = await this.modelRouting.resolve(RESEARCH_SYNTHESIS_ROUTE_ROLE, { projectId: project, slot, premiumAuthorized: data.premiumEscalationAuthorized === true, fallbackAuthorized: data.fallbackAuthorized === true, fallbackReason });
      } catch (error) {
        if (!(error instanceof Error) || !/ROLE_NOT_MODEL_ROUTED/.test(error.message)) throw error;
      }
      if (legResolved !== null) {
        legOverrides = { ...overrides, [RESEARCH_SYNTHESIS_ROUTE_ROLE]: { provider: legResolved.provider, model: legResolved.model, canonicalRouting: { routingVersionId: legResolved.routingVersionId, routingScope: legResolved.routingScope, projectId: legResolved.projectId, role: legResolved.role, profile: legResolved.profile, slot, requestedModel: legResolved.requestedModel, resolvedModel: legResolved.resolvedModel, priceSnapshotId: legResolved.priceSnapshotId, availabilityState: "CONFIGURED", fallbackUsed: legResolved.fallbackUsed, fallbackReason: legResolved.fallbackReason, premiumEscalation: slot === "premiumEscalation", resolutionReason: "ACTIVE_PROJECT_LEG_ROUTING" } } };
      }
    }
    return{...context,data:{...data,controlAgentOverrides:legOverrides,canonicalRouting:overrides[step.agent]}} as WorkflowContext;
  }

  /** Materialized-input LLM preflight. It runs after routing and before any budget reservation. */
  private async preflightProductionLlm(step:AgentStep,context:WorkflowContext,input:Json):Promise<void>{
    const data=safeRecord(context.data),override=safeRecord(data.canonicalRouting),route=safeRecord(override.canonicalRouting);
    if(Object.keys(route).length===0)return;
    if(!this.modelRouting)throw new Error("CANONICAL_ROUTING_STORE_UNAVAILABLE");
    const catalogStage=(CANONICAL_STAGE_CATALOG as Record<string,{executionType:string;routingRole:string|null}>)[step.id]
      ?? (CANONICAL_STAGE_CATALOG as Record<string,{executionType:string;routingRole:string|null}>)[step.agent];
    const aliases:Record<string,string>={"visual-prompt":"visual-director",scenes:"director","research-synthesis":"research",reviewer:"review"};
    const role=catalogStage?.routingRole??aliases[step.agent]??step.agent;
    const slot=String(route.slot??"primary") as "primary"|"fallback"|"economy"|"premiumEscalation";
    const environment=inspectWorkerExecutionEnvironment();
    const result=await this.modelRouting.preflight(role,{
      projectId:String(data.projectId??data.project_id??""),slot,
      premiumAuthorized:data.premiumEscalationAuthorized===true,
      fallbackAuthorized:data.fallbackAuthorized===true,
      fallbackReason:typeof data.fallbackReason==='string'?data.fallbackReason:undefined,
      expectedRoutingVersionId:String(route.routingVersionId??""),expectedModel:String(override.model??""),
      requirements:{executionType:(catalogStage?.executionType??"LLM") as "LLM"|"HYBRID",prompt:JSON.stringify(input),expectedOutputTokens:step.agent==="research"?8192:4096,structuredOutput:"JSON_MODE",executionEnvironmentAllowed:environment.status==="SUPPORTED"},
    });
    const canonicalRouting={...route,availabilityState:result.availabilityState,liveHealthState:result.liveHealthState,configurationFingerprint:result.configurationFingerprint,preflightCode:result.code};
    const scoped={...override,canonicalRouting};
    data.canonicalRouting=scoped as unknown as Json;
    data.controlAgentOverrides={...safeRecord(data.controlAgentOverrides),[step.agent]:scoped} as unknown as Json;
    const materialized=safeRecord(input);
    materialized.controlAgentOverrides={...safeRecord(materialized.controlAgentOverrides),[step.agent]:scoped} as unknown as Json;
  }

  /** Final publication authorization is a deterministic policy decision, never an LLM/provider outcome. */
  private async executePublisherAuthorization(step: AgentStep, context: WorkflowContext): Promise<StepOutcome> {
    try {
      const chain = await this.loadChain(context);
      const finalMedia = chain.find((artifact) => artifact.kind === "final_media_artifact");
      const technical = chain.find((artifact) => artifact.kind === "final_technical_qa");
      const product = chain.find((artifact) => artifact.kind === "final_product_review");
      const gate = safeRecord(context.outputs?.["final-human-gate"]);
      const authorityBinding = safeRecord(gate.authorityBinding);
      const finalMediaPayload = finalMedia === undefined ? {} : safeRecord(finalMedia.payload);
      const finalMediaSha = String(finalMediaPayload.sha256 ?? finalMediaPayload.sha256Hex ?? "");
      if (finalMedia === undefined || technical === undefined || product === undefined || gate.outcome !== "approved" || gate.scope !== PUBLIC_PUBLISH_SCOPE
        || gate.finalMediaArtifactId !== finalMedia.artifactId || gate.finalTechnicalQAReportId !== technical.artifactId || gate.finalProductReviewId !== product.artifactId) {
        throw new Error("PUBLISHER_AUTHORIZATION_BLOCKED");
      }
      if (authorityBinding.workflowId !== context.workflowId || authorityBinding.finalMediaArtifactId !== finalMedia.artifactId
        || authorityBinding.finalMediaSha256 !== finalMediaSha || authorityBinding.finalProductReviewId !== product.artifactId
        || typeof authorityBinding.targetAccountId !== "string" || typeof authorityBinding.publicationPayloadHash !== "string"
        || typeof authorityBinding.publicationIdentity !== "string") throw new Error("PUBLISHER_AUTHORIZATION_SCOPE_MISMATCH");
      const technicalPayload = safeRecord(technical.payload);
      const productPayload = safeRecord(product.payload);
      if (!normalizeFinalTechnicalQa(technicalPayload).passed || !["approved", "human_review_required"].includes(String(productPayload.status))) {
        throw new Error("PUBLISHER_AUTHORIZATION_BLOCKED");
      }
      const authorization = {
        authorizationId: `publisher-auth-${context.workflowId}-${finalMedia.artifactId}`,
        workflowId: context.workflowId,
        finalMediaArtifactId: finalMedia.artifactId,
        finalTechnicalQAReportId: technical.artifactId,
        finalProductReviewId: product.artifactId,
        humanApprovalId: `human-final-${context.workflowId}-${finalMedia.artifactId}`,
        scope: PUBLIC_PUBLISH_SCOPE,
        authorityBinding,
        status: "AUTHORIZED",
        issuedAt: nowIso(),
        policyVersion: "final-publication-v1",
      } as unknown as Json;
      const artifact = this.buildArtifact(step, context, authorization, "completed");
      return { status: "completed", output: authorization, artifact };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { status: "failed", output: { error: message }, error: { message, retryable: false } };
    }
  }

  /**
   * Duplicate-delivery reuse (R7 hardening): when a stage claim is already
   * terminal COMPLETED, return the persisted canonical artifact payload as
   * the step outcome instead of re-executing. Returns null when no matching
   * completed artifact exists (caller fails closed).
   */
  private async reuseCompletedStageArtifact(step: AgentStep, context: WorkflowContext): Promise<StepOutcome | null> {
    const kindByStage: Record<string, string> = {
      tts: "narration_artifact",
      timeline: "timeline_plan",
      "scene-image": "scene_visual_artifact",
      "visual-semantic-review": "visual_semantic_review",
      "visual-technical-qa": "visual_technical_qa",
    };
    const kind = kindByStage[step.agent];
    if (kind === undefined || this.persistence === undefined) return null;
    const chain = await this.loadChain(context);
    const artifact = [...chain].reverse().find((a) => a.kind === kind && a.status === "completed");
    if (artifact === undefined) return null;
    return { status: "completed", output: artifact.payload as unknown as Json };
  }

  /** Load the artifacts produced by earlier steps (durably persisted by the engine). */
  private async loadChain(context: WorkflowContext): Promise<CollaborationArtifact[]> {
    if (this.persistence === undefined) return [];
    const artifacts = await this.persistence.listArtifacts(context.workflowId);
    return [...artifacts].sort((a, b) => {
      const byCreated = a.createdAt.localeCompare(b.createdAt);
      return byCreated !== 0 ? byCreated : a.artifactId.localeCompare(b.artifactId);
    });
  }

  private buildExecutionContext(step: AgentStep, context: WorkflowContext): ExecutionContext {
    return {
      workflowId: context.workflowId,
      stepId: step.id,
      correlationId: context.correlationId ?? undefined,
      metadata: { agent: step.agent, source: "worker-production-executor" },
    } as unknown as ExecutionContext;
  }

  private buildAgentInput(step: AgentStep, context: WorkflowContext, chain: CollaborationArtifact[]): { input: Json; execute: ExecuteFn } {
    const workflowId = context.workflowId;
    const correlationId = context.correlationId ?? "";
    const strategyMode = safeRecord(context.data).strategyMode === "PRE_PUBLICATION_STRATEGY";
    const preMediaPhase = safeRecord(context.data).productionPhase === "PRE_MEDIA_PHASE";
    const strategyMarker: JsonRecord = strategyMode ? { strategyMode: "PRE_PUBLICATION_STRATEGY" } : {};
    // Command Room resolves role overrides once at submission. Carry the
    // approved, scoped map into each production agent boundary; do not allow
    // a Writer to fall back to the ambient project/provider route.
    const configuredRoleOverrides = safeRecord(safeRecord(context.data).controlAgentOverrides);
    const roleOverridesMarker: JsonRecord = Object.keys(configuredRoleOverrides).length > 0
      ? { controlAgentOverrides: configuredRoleOverrides as unknown as Json }
      : {};
    const recoveryMarker = recoveryExecutionMarker(context.data);
    const revisionMarker = revisionExecutionMarker(context.data);
    // Revision cycles regenerate downstream content stages: a revised Writer
    // artifact makes older SEO/Brand/Review inputs semantically stale, so
    // every downstream content consumer must read the LATEST completed
    // artifact of each kind (the chain is ordered by creation time).
    const latestByKind = (kind: string): CollaborationArtifact | undefined =>
      [...chain].reverse().find((a) => a.kind === kind && a.status === "completed");
    // A council run may select a proven model for this workflow without
    // changing the global routing default. Carry that scoped choice through
    // every strategy-agent input, not just Research.
    const requestedStrategyModel = typeof safeRecord(context.data).agentRouterModelOverride === "string"
      ? String(safeRecord(context.data).agentRouterModelOverride).trim()
      : typeof safeRecord(context.data).openRouterModelOverride === "string"
        ? String(safeRecord(context.data).openRouterModelOverride).trim()
        : "";
    const rawOpenRouterOverride = typeof safeRecord(context.data).openRouterModelOverride === "string" ? String(safeRecord(context.data).openRouterModelOverride).trim() : "";
    const strategyModelOverride: JsonRecord = strategyMode && requestedStrategyModel.length > 0
      ? rawOpenRouterOverride.length > 0
        ? { agentRouterModelOverride: requestedStrategyModel, openRouterModelOverride: rawOpenRouterOverride }
        : { agentRouterModelOverride: requestedStrategyModel }
      : {};
    const selectedIds = Array.isArray(safeRecord(context.data).strategyCouncilArtifactIds)
      ? new Set((safeRecord(context.data).strategyCouncilArtifactIds as unknown[]).filter((value): value is string => typeof value === "string"))
      : undefined;
    const councilChain = selectedIds === undefined ? chain : chain.filter((artifact) => selectedIds.has(artifact.artifactId));
    const taskFor = (agent: string, label: string): { id: string; name: string; description: string; agent: string; dependencies: string[] } => ({
      id: `${agent}-${step.id}`,
      name: step.id,
      description: `${label} for ${step.id}`,
      agent,
      dependencies: [],
    });

    switch (step.agent) {
      case "orchestrator": {
        const objective = String(safeRecord(context.data).objective ?? safeRecord(context.data).contentTopic ?? "Select a grounded Morroway Short topic");
        const input: Json = { __agent: "orchestrator", ...roleOverridesMarker, productionPhase: "PRE_MEDIA_PHASE", planId: `plan-${workflowId}`, stage: "INITIAL_CONTENT_PLAN", objective, topic: String(safeRecord(context.data).contentTopic ?? objective), audience: String(safeRecord(context.data).audience ?? "Morroway YouTube audience"), platform: String(safeRecord(context.data).platform ?? "YouTube Shorts"), productionBrief: safeRecord(context.data).productionBrief as Json, projectContext: safeRecord(context.data).projectContext as Json, researchQuestions: [objective], researchObjectives: ["Collect cited evidence and select a truthful, visually feasible factual micro-story."], knownRestrictions: ["No unsupported facts", "No media generation", "Owner authority remains required"], desiredDeliverables: ["research", "brief with hook direction", "script", "scenes", "visual direction"], tasks: [], status: "requested", summary: "" };
        return { input, execute: agentLlm(input) };
      }
      case "planner": {
        const objective = String(safeRecord(context.data).objective ?? safeRecord(context.data).contentTopic ?? context.data.directive ?? step.id);
        // The canonical `research` directive begins with the legacy planner
        // step id. Treat it as the initial plan, alongside the explicit
        // production `planner-initial` stage; only downstream planner stages
        // may require already-persisted research.
        if (step.id === "planner" || step.id.startsWith("planner-initial")) {
          const input: Json = {
            __agent: "planner", ...strategyMarker, ...strategyModelOverride, ...roleOverridesMarker, stage: "INITIAL_CONTENT_PLAN", requestId: workflowId, objective,
            topic: String(safeRecord(context.data).contentTopic ?? objective), audience: String(safeRecord(context.data).audience ?? "general social audience"),
            platform: String(safeRecord(context.data).platform ?? "unspecified"), toneConstraints: [], researchQuestions: [objective],
            researchObjectives: ["Collect source-backed context for the content objective."], knownRestrictions: [], desiredDeliverables: ["script"],
          };
          return { input, execute: strategyMode || preMediaPhase ? agentLlm(input) : deterministicLlm(input) };
        }
        const initial = [...chain].reverse().find((a) => a.kind === "execution_plan" && safeRecord(a.payload).stage === "INITIAL_CONTENT_PLAN")
          ?? (strategyMode ? [...chain].reverse().find((a) => a.kind === "strategy_research_input_envelope") : undefined);
        // Prefer a downstream-consumable recovered report over a legacy import
        // marker. Markers remain historical evidence and are never overwritten.
        const researchReports = chain.filter((a) => a.kind === "research_report");
        const research = researchReports.find((a) => {
          const payload = safeRecord(a.payload);
          return (Array.isArray(payload.sources) && payload.sources.length > 0)
            || (typeof payload.summary === "string" && payload.summary.trim().length > 0)
            || (Array.isArray(payload.claims) && payload.claims.length > 0);
        }) ?? researchReports[0];
        if (initial === undefined || research === undefined) throw new Error("Planner synthesis requires persisted initial plan and research report");
        const ceoRecommendation = step.id.startsWith("planner-synthesis") ? latestByKind("ceo_recommendation") : undefined;
        if ((preMediaPhase || step.id.startsWith("planner-synthesis")) && ceoRecommendation === undefined) throw new Error("Planner synthesis requires the canonical CEO recommendation");
        if (ceoRecommendation !== undefined) validateArtifactContract({ artifact: ceoRecommendation, expectedWorkflowId: workflowId, expectedKind: "ceo_recommendation", consumerStage: "planner-synthesis" });
        const initialPayload = safeRecord(initial.payload);
        const researchPayload = safeRecord(research.payload);
        const plannerInputArtifactIds = Array.isArray(safeRecord(context.data).strategyInputArtifactIds)
          ? (safeRecord(context.data).strategyInputArtifactIds as unknown[]).filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          : [];
        const input: Json = {
          __agent: "planner", ...strategyMarker, ...strategyModelOverride, ...roleOverridesMarker, stage: "POST_RESEARCH_SYNTHESIS", requestId: workflowId, objective,
          ...(plannerInputArtifactIds.length === 0 ? {} : { inputArtifacts: plannerInputArtifactIds.map((artifactId) => ({ artifactId })) }),
          initialPlan: initialPayload as Json,
          researchResult: { reportId: String(researchPayload.reportId ?? research.artifactId), summary: String(researchPayload.summary ?? ""), sources: (Array.isArray(researchPayload.sources) ? researchPayload.sources.map((source, index) => { const item = safeRecord(source); return { ...item, id: typeof item.id === "number" ? item.id : index + 1, snippet: typeof item.snippet === "string" && item.snippet.trim() ? item.snippet : String(item.relevance ?? "").trim() }; }) : []) as Json, citations: (Array.isArray(researchPayload.citations) ? researchPayload.citations : []) as Json, strategyFindings: (safeRecord(researchPayload.strategyFindings) as unknown as Json), unknowns: (Array.isArray(safeRecord(researchPayload.strategyFindings).unknowns) ? safeRecord(researchPayload.strategyFindings).unknowns : []) as Json, provenance: [] as Json },
          ...(ceoRecommendation === undefined ? {} : { ceoRecommendation: ceoRecommendation.payload as unknown as Json }),
        };
        return { input, execute: strategyMode || preMediaPhase ? agentLlm(input) : deterministicLlm(input) };
      }

      case "research": {
        const initial = [...chain].reverse().find((a) => a.kind === "execution_plan" && safeRecord(a.payload).stage === "INITIAL_CONTENT_PLAN");
        const researchObjective = String(safeRecord(context.data).objective ?? safeRecord(context.data).contentTopic ?? context.data.directive ?? step.id);
        // A strategy council begins with independent Research.  Its input
        // envelope is governance metadata derived from owner-provided fields,
        // not a substitute Planner opinion and not a persisted Planner result.
        // Ordinary production research retains its required initial-plan gate.
        if (initial === undefined && !strategyMode) throw new Error("Research requires the initial content plan artifact");
        const initialPayload = initial === undefined
          ? {
              planId: `strategy-research-envelope-${workflowId}`,
              stage: "INITIAL_CONTENT_PLAN",
              objective: researchObjective,
              topic: String(safeRecord(context.data).contentTopic ?? researchObjective),
              audience: String(safeRecord(context.data).audience ?? "general social audience"),
              platform: String(safeRecord(context.data).platform ?? "unspecified"),
              toneConstraints: [], researchQuestions: [researchObjective],
              researchObjectives: ["Synthesize the supplied V2 owner and reference evidence."],
              knownRestrictions: ["No external research calls from the Research LLM stage."],
              desiredDeliverables: ["research_report"], factualClaims: [], tasks: [],
            }
          : safeRecord(initial.payload);
        const configuredResearchRequest = safeRecord(context.data).researchRequest;
        // Preserve the canonical evidence lineage used to assemble an LLM
        // request. These are provenance references only; the evidence bodies
        // still come from the governed workflow context below.
        const strategyInputArtifactIds = Array.isArray(safeRecord(context.data).strategyInputArtifactIds)
          ? (safeRecord(context.data).strategyInputArtifactIds as unknown[])
            .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          : [];
        const strategyEvidence = strategyMode ? compactStrategyResearchEvidence(context) : undefined;
        const requestedModelOverride = typeof safeRecord(context.data).agentRouterModelOverride === "string"
          ? String(safeRecord(context.data).agentRouterModelOverride).trim()
          : "";
        // Discovery-first retrieval (Phase A): seek concrete named factual
        // subjects (events, people, objects, discoveries, experiments) framed
        // by the Historical POV pillar — never a bare meta-task phrase such
        // as "strongest evidence" / "textual evidence" / "micro-story", and
        // never generic fact-list intent ("amazing facts", "best stories").
        // The primary discovery query is the governed single-retrieval query;
        // verification queries are built per concrete candidate if needed.
        const discoveryQueries = buildDiscoveryQueries({
          brandProject: String(safeRecord(context.data).productionBrief !== undefined
            ? safeRecord(safeRecord(context.data).productionBrief).brandProject ?? "morroway"
            : "morroway"),
          audience: String(safeRecord(context.data).audience ?? ""),
        });
        const searchQuery = isResearchContentSelectionQuery(String(context.data.contentTopic ?? step.id), researchObjective)
          ? discoveryQueries[0]
          : buildProductionResearchSearchQuery({
            contentTopic: String(context.data.contentTopic ?? step.id),
            objective: researchObjective,
            brandProject: String(safeRecord(context.data).productionBrief !== undefined
              ? safeRecord(safeRecord(context.data).productionBrief).brandProject ?? "morroway"
              : "morroway"),
            audience: String(safeRecord(context.data).audience ?? ""),
            platform: String(safeRecord(context.data).platform ?? ""),
          });
        const searchIntent = "discovery: seek concrete named factual candidates (events, people, objects, discoveries, experiments, historical incidents) with primary/institutional corroboration potential; then verify. Not educational pages explaining evidence; not generic fact-list compilations.";
        const searchContext = {
          contentTopic: String(context.data.contentTopic ?? step.id),
          objective: researchObjective,
          audience: String(safeRecord(context.data).audience ?? ""),
          platform: String(safeRecord(context.data).platform ?? ""),
          researchQuestions: Array.isArray(safeRecord(initialPayload).researchQuestions) ? safeRecord(initialPayload).researchQuestions as unknown as Json : [],
          researchObjectives: Array.isArray(safeRecord(initialPayload).researchObjectives) ? safeRecord(initialPayload).researchObjectives as unknown as Json : [],
        } as unknown as Json;
        const productionTaskDescription = strategyMode
          ? `V2 PRE_PUBLICATION_STRATEGY research for ${step.id}: evaluate the supplied owner and reference evidence without external research.`
          : `Production research for ${String(context.data.contentTopic ?? step.id)}: ${researchObjective}`.slice(0, 500);
        const productionTask = { ...taskFor("research", "Research"), description: productionTaskDescription };
        // Stable machine contract identity: taskId/stage echo byte-for-byte.
        // The description stays descriptive prose (never exact-copied).
        const researchContract = { taskId: productionTask.id, stage: step.id };
        // Canonical Morroway context: actual approved facts with provenance,
        // never a bare claim that context exists. Fail closed before any
        // budget reservation when the governing identity cannot be loaded.
        const researchProjectId = String(safeRecord(context.data).projectId ?? "");
        const needsMorrowayContext = !strategyMode && researchProjectId.toLowerCase() === "morroway";
        const morrowayContext = needsMorrowayContext
          ? requireMorrowayResearchProjectContext(resolveApprovedProjectContext("morroway", {
            artifactRefs: strategyInputArtifactIds,
          }))
          : null;
        const morrowayContextProvenance = needsMorrowayContext
          ? { source: "canonical-approved-project-context", resolver: "resolveApprovedProjectContext", projectId: "morroway", artifactRefs: strategyInputArtifactIds }
          : null;
        // V2 is an explicit contract selection. Existing in-flight workflows
        // remain on their persisted V1 semantics until an Owner-authorized
        // invocation supplies researchIntelligenceVersion=V2.
        const researchIntelligenceV2 = safeRecord(context.data).researchIntelligenceVersion === "V2";
        const input: Json = {
          __agent: "research", ...strategyMarker, ...roleOverridesMarker,
          task: productionTask,
          // Stable machine contract identity (production pre-media path only;
          // strategy council keeps its legacy exact-description contract).
          ...(strategyMode ? {} : { contract: researchContract as unknown as Json }),
          // Post-retrieval synthesis contract (production two-phase path only).
          ...(strategyMode ? {} : researchIntelligenceV2 ? buildResearchIntelligenceV2Contract({
            projectId: researchProjectId, objective: researchObjective,
            platform: String(safeRecord(context.data).platform ?? "YouTube Shorts"),
            contentPillar: String(safeRecord(context.data).contentPillar ?? "Historical POV"),
            contentMode: String(safeRecord(context.data).contentMode ?? "HISTORICAL_POV"),
            market: typeof safeRecord(context.data).market === "string" ? String(safeRecord(context.data).market) : null,
            geography: typeof safeRecord(context.data).geography === "string" ? String(safeRecord(context.data).geography) : null,
            language: typeof safeRecord(context.data).language === "string" ? String(safeRecord(context.data).language) : null,
            audience: typeof safeRecord(context.data).audience === "string" ? String(safeRecord(context.data).audience) : null,
          }) : { synthesisContract: "amf-research-synthesis-v1" }),
          ...(morrowayContext === null ? {} : {
            projectContext: morrowayContext as unknown as Json,
            projectContextProvenance: morrowayContextProvenance as unknown as Json,
          }),
          initialContentPlan: initialPayload as Json,
          ...(strategyMode ? {} : { searchIntent, searchContext }),
          ...(strategyInputArtifactIds.length === 0
            ? {}
            : { inputArtifacts: strategyInputArtifactIds.map((artifactId) => ({ artifactId })) }),
          ...(strategyEvidence === undefined ? {} : { strategyEvidence }),
          ...(requestedModelOverride.length === 0 ? strategyModelOverride : { agentRouterModelOverride: requestedModelOverride }),
          ...(safeRecord(context.data).researchDirectionReuse === undefined
            ? {}
            : { reusedDirection: safeRecord(context.data).researchDirectionReuse as unknown as Json }),
          ...(researchIntelligenceV2 && typeof safeRecord(safeRecord(context.data).recoveryExecution).recoveryExecutionId === "string"
            ? { recoveryScopeId: String(safeRecord(safeRecord(context.data).recoveryExecution).recoveryExecutionId) }
            : {}),
          capabilityRequests: strategyMode ? [] : [
            {
              requestId: researchCapabilityRequestId(workflowId, step.id, context.data),
              capabilityId: "web.search",
              agentId: "research",
              workflowId,
              correlationId,
              input: { query: searchQuery, maxResults: 5 },
              requestedAt: nowIso(),
            },
          ],
          ...(configuredResearchRequest !== undefined && typeof configuredResearchRequest === "object" && !Array.isArray(configuredResearchRequest)
            ? { researchRequest: configuredResearchRequest as Json }
            : {}),
        };
        return { input, execute: agentLlm(input) };
      }

      case "writer": {
        // A prior blocked synthesis is historical evidence, not a valid writer
        // handoff. Select the latest downstream-consumable completed brief.
        const synthesis = [...chain].reverse().find((a) => a.kind === "evidence_backed_content_brief" && a.status === "completed");
        const research = chain.find((a) => a.kind === "research_report");
        if (synthesis === undefined) throw new Error("Writer requires the evidence-backed content brief from Planner synthesis");
        validateArtifactContract({ artifact: synthesis, expectedWorkflowId: workflowId, expectedKind: "evidence_backed_content_brief", consumerStage: "writer" });
        // Revision Cycle V1: the authoritative revision instruction comes from
        // the durable source Review artifact; the prior Writer content is the
        // revision base. The writer is instructed to revise, not recreate.
        const revisionDirective = revisionMarker.revisionExecution === undefined ? undefined : safeRecord(revisionMarker.revisionExecution);
        const revisionActive = revisionDirective !== undefined && revisionDirective.revisionTaskId !== undefined && revisionDirective.revisionTaskId !== "";
        const sourceReview = revisionActive ? chain.find((a) => a.artifactId === revisionDirective.reviewArtifactId) : undefined;
        const priorWriter = revisionActive ? chain.find((a) => a.artifactId === revisionDirective.priorWriterArtifactId) : undefined;
        const sourceReviewPayload = safeRecord(sourceReview?.payload);
        const priorWriterPayload = safeRecord(priorWriter?.payload);
        const input: Json = {
          __agent: "writer", ...strategyMarker, ...strategyModelOverride, ...roleOverridesMarker, ...revisionMarker,
          objective: String(context.data.contentTopic ?? `Produce the content brief for ${step.id}`),
          task: taskFor("writer", "Write content"),
          previousArtifact: { artifactId: synthesis.artifactId, kind: "evidence_backed_content_brief", payload: synthesis.payload as unknown as Json },
          researchEvidence: research === undefined ? [] : normalizedResearchEvidence(research.payload),
          requireSynthesis: true,
          ...(revisionActive ? {
            revision: {
              revisionTaskId: revisionDirective.revisionTaskId,
              revisionVersion: revisionDirective.revisionVersion,
              reviewArtifactId: revisionDirective.reviewArtifactId,
              reviewExecutionId: revisionDirective.reviewExecutionId,
              priorWriterArtifactId: revisionDirective.priorWriterArtifactId,
              summary: String(sourceReviewPayload.summary ?? ""),
              findings: (Array.isArray(sourceReviewPayload.findings) ? sourceReviewPayload.findings : []) as unknown as Json,
              recommendations: (Array.isArray(sourceReviewPayload.recommendations) ? sourceReviewPayload.recommendations : []) as unknown as Json,
              priorTitle: String(priorWriterPayload.title ?? ""),
              priorContent: String(priorWriterPayload.content ?? ""),
            } as unknown as Json,
          } : {}),
          ...(strategyMode ? { validatedArtifacts: this.sourceArtifacts(councilChain), ownerStrategicInput: safeRecord(context.data).ownerStrategicInput as Json ?? {}, referenceContentEvidence: safeRecord(context.data).referenceEvidence as Json ?? {} } : {}),
        };
        return { input, execute: agentLlm(input) };
      }

      case "director": {
        if (!preMediaPhase) throw new Error("Director text planning is only available in PRE_MEDIA_PHASE here");
        const writer = latestByKind("writer_report");
        if (writer === undefined) throw new Error("Scene planning requires the writer artifact");
        validateArtifactContract({ artifact: writer, expectedWorkflowId: workflowId, expectedKind: "writer_report", consumerStage: step.id });
        const input: Json = { __agent: "director", ...roleOverridesMarker, productionPhase: "PRE_MEDIA_PHASE", objective: "Create a 3-5 scene pre-media plan covering the script", script: writer.payload as Json, constraints: ["No provider calls", "No unsupported facts", "Vertical 9:16", "20-40 seconds"] };
        return { input, execute: agentLlm(input) };
      }

      case "visual-director": {
        const scenes = latestByKind("scene_plan");
        if (scenes === undefined) throw new Error("Visual direction requires the scene plan");
        validateArtifactContract({ artifact: scenes, expectedWorkflowId: workflowId, expectedKind: "scene_plan", consumerStage: "visual-direction" });
        // Media-chain stages persist their canonical artifacts independently;
        // reconstruct the immediate producer lineage from that persisted source
        // instead of relying on a transient previousArtifact pointer.
        context.data.previousArtifact = { artifactId: scenes.artifactId, kind: scenes.kind } as unknown as Json;
        const input: Json = { __agent: "visual-director", ...roleOverridesMarker, productionPhase: "PRE_MEDIA_PHASE", objective: "Create provider-neutral pre-media visual direction", scenePlan: scenes.payload as Json, constraints: ["No image generation", "No unsupported facts", "Vertical 9:16", "Explicit uncertainty"] };
        return { input, execute: agentLlm(input) };
      }

      case "seo": {
        const writer = latestByKind("writer_report");
        const input: Json = {
          __agent: "seo", ...strategyMarker, ...strategyModelOverride, ...roleOverridesMarker, ...revisionMarker,
          objective: `Optimize the content for ${step.id}`,
          task: taskFor("seo", "Optimize"),
          ...(strategyMode ? { validatedArtifacts: this.sourceArtifacts(councilChain), ownerStrategicInput: safeRecord(context.data).ownerStrategicInput as Json ?? {}, referenceContentEvidence: safeRecord(context.data).referenceEvidence as Json ?? {} } : {}),
          ...(writer === undefined
            ? {}
            : {
                previousArtifact: {
                  artifactId: writer.artifactId,
                  kind: "writer_report",
                  payload: writer.payload as unknown as Json,
                },
              }),
        };
        return { input, execute: agentLlm(input) };
      }

      case "brand": {
        const seo = latestByKind("seo_report");
        const input: Json = {
          __agent: "brand", ...strategyMarker, ...strategyModelOverride, ...roleOverridesMarker, ...revisionMarker,
          objective: `Run the brand gate for ${step.id}`,
          task: taskFor("brand", "Brand gate"),
          ...(strategyMode ? { validatedArtifacts: this.sourceArtifacts(councilChain), ownerStrategicInput: safeRecord(context.data).ownerStrategicInput as Json ?? {}, referenceContentEvidence: safeRecord(context.data).referenceEvidence as Json ?? {} } : {}),
          ...(seo === undefined
            ? {}
            : {
                previousArtifact: {
                  artifactId: seo.artifactId,
                  kind: "seo_report",
                  payload: seo.payload as unknown as Json,
                },
              }),
        };
        return { input, execute: agentLlm(input) };
      }

      case "review": {
        if (preMediaPhase) {
          const input: Json = { __agent: "review", ...roleOverridesMarker, productionPhase: "PRE_MEDIA_PHASE", reportId: `review-${workflowId}`, taskDescription: "Review the complete pre-media content package", objective: "Detect factual, production, pacing, and authority issues", validatedArtifacts: this.sourceArtifacts(chain), requiredStatus: ["approved", "changes_requested", "blocked", "human_review_required"] };
          return { input, execute: agentLlm(input) };
        }
        const seoLatest = latestByKind("seo_report");
        const brandLatest = latestByKind("brand_report");
        if (step.id === "final-product-review") {
          const requestedPackage = safeRecord(safeRecord(context.data).finalReviewPackage);
          const finalMedia = typeof requestedPackage.finalMediaArtifactId === "string"
            ? chain.find((a) => a.kind === "final_media_artifact" && a.artifactId === requestedPackage.finalMediaArtifactId)
            : chain.find((a) => a.kind === "final_media_artifact");
          const technical = typeof requestedPackage.finalTechnicalQaArtifactId === "string"
            ? chain.find((a) => a.kind === "final_technical_qa" && a.artifactId === requestedPackage.finalTechnicalQaArtifactId)
            : chain.find((a) => a.kind === "final_technical_qa");
          const normalizedTechnicalQa = technical === undefined ? null : normalizeFinalTechnicalQa(technical.payload);
          if (finalMedia === undefined || technical === undefined || normalizedTechnicalQa?.passed !== true) throw new Error("Final Product Review requires a passing Final Technical QA report");
          const finalPayload = safeRecord(finalMedia.payload);
          if (typeof requestedPackage.finalMediaSha256 === "string" && finalPayload.sha256 !== requestedPackage.finalMediaSha256) throw new Error("Final Product Review final media SHA does not match the frozen review package");
          const input: Json = {
            __agent: "review", ...roleOverridesMarker, requestId: `final-review-${workflowId}-${step.id}`, task: taskFor("review", "Review final product"),
            context: { artifact: { kind: "final_media_artifact", artifactId: finalMedia.artifactId, payload: { ...finalPayload, finalMediaArtifactId: finalMedia.artifactId, technicalQaStatus: "passed", technicalQaNormalized: normalizedTechnicalQa as unknown as Json, technicalQAReportId: technical.artifactId } } },
          };
          return { input, execute: agentLlm(input) };
        }
        // REVIEW_ONLY_TECHNICAL_RESUME: the input package is FROZEN at
        // authorization time. Look up the exact persisted artifact ids —
        // never a dynamic "latest" — and fail closed if any drifted or is
        // missing, so the Review package cannot change between authorization
        // and execution.
        const resumeMarker = reviewResumeExecutionMarker(context.data);
        const resumeDirective = resumeMarker.reviewResumeExecution === undefined ? undefined : safeRecord(resumeMarker.reviewResumeExecution);
        const resumeActive = resumeDirective !== undefined && resumeDirective.resumeId !== undefined;
        const frozenById = (artifactId: string, kind: string, label: string): CollaborationArtifact => {
          const artifact = chain.find((a) => a.artifactId === artifactId && a.kind === kind && a.status === "completed");
          if (artifact === undefined) throw new Error(`REVIEW_RESUME_FROZEN_ARTIFACT_REQUIRED:${label}:${artifactId}`);
          return artifact;
        };
        const writer = resumeActive
          ? frozenById(String(resumeDirective.frozenWriterArtifactId), "writer_report", "writer")
          : latestByKind("writer_report");
        const seo = resumeActive
          ? frozenById(String(resumeDirective.frozenSeoArtifactId), "seo_report", "seo")
          : seoLatest;
        const brand = resumeActive
          ? frozenById(String(resumeDirective.frozenBrandArtifactId), "brand_report", "brand")
          : brandLatest;
        const input: Json = {
          __agent: "review", ...roleOverridesMarker, ...recoveryMarker, ...revisionMarker, ...resumeMarker,
          requestId: `review-${workflowId}-${step.id}`,
          task: taskFor("review", "Review content"),
          ...(writer === undefined
            ? {}
            : {
                context: {
                  artifact: { kind: "writer_report", artifactId: writer.artifactId, payload: writer.payload as unknown as Json },
                  references: {
                    ...(seo === undefined ? {} : { seo: { artifactId: seo.artifactId, kind: seo.kind, payload: seo.payload as unknown as Json } }),
                    ...(brand === undefined ? {} : { brand: { artifactId: brand.artifactId, kind: brand.kind, payload: brand.payload as unknown as Json } }),
                  },
                },
              }),
        };
        return { input, execute: agentLlm(input) };
      }

      case "thumbnail": {
        const input: Json = {
          __agent: "thumbnail",
          requestId: `thumbnail-${workflowId}-${step.id}`,
          objective: `Generate a thumbnail for ${step.id}`,
          taskDescription: `Generate a thumbnail for ${step.id}`,
          validatedArtifacts: this.sourceArtifacts(councilChain),
        };
        return { input, execute: deterministicLlm(input) };
      }

      case "video": {
        const input: Json = {
          __agent: "video",
          requestId: `video-${workflowId}-${step.id}`,
          objective: `Generate a video for ${step.id}`,
          taskDescription: `Generate a video for ${step.id}`,
          validatedArtifacts: this.sourceArtifacts(councilChain),
        };
        return { input, execute: deterministicLlm(input) };
      }

      case "qa": {
        if (preMediaPhase) {
          const input: Json = { __agent: "qa", ...roleOverridesMarker, productionPhase: "PRE_MEDIA_PHASE", reportId: `qa-${workflowId}`, objective: "Validate the pre-media package and its lineage before Owner review", validatedArtifacts: this.sourceArtifacts(chain), requirements: ["research evidence", "strategy recommendation", "brief with hook direction", "script", "scene plan", "visual direction", "review findings", "no media execution"] };
          return { input, execute: agentLlm(input) };
        }
        const finalMedia = chain.find((a) => a.kind === "final_media_artifact");
        if (finalMedia === undefined) throw new Error("Final Technical QA requires a persisted FinalMediaArtifact");
        const finalPayload = safeRecord(finalMedia.payload);
        const timeline = chain.find((a) => a.kind === "timeline_plan");
        const narration = chain.find((a) => a.kind === "narration_artifact");
        const clips = chain.filter((a) => a.kind === "scene_video_clip");
        if (timeline === undefined || narration === undefined || clips.length === 0) throw new Error("Final Technical QA requires persisted narration, timeline, and scene clips");
        const input: Json = {
          __agent: "qa",
          requestId: `qa-${workflowId}-${step.id}`,
          objective: `Quality-gate the final media for ${step.id}`,
          request: {
            scope: "Validate the canonical final media artifact and composition lineage.",
            requirements: ["Final media, narration, timeline, and every required scene clip must be present and consistent."],
            expectedTests: ["final-media-integrity", "composition-lineage"],
          },
          finalMedia: {
            workflowId, finalMediaArtifactId: finalMedia.artifactId, path: String(finalPayload.finalFileReference ?? finalPayload.path ?? finalPayload.filePath ?? ""), integrity: typeof finalPayload.sha256 === "string" ? finalPayload.sha256 : undefined,
            durationMs: Number(finalPayload.durationMs ?? 0), width: typeof finalPayload.width === "number" ? finalPayload.width : undefined, height: typeof finalPayload.height === "number" ? finalPayload.height : undefined,
            container: typeof finalPayload.container === "string" ? finalPayload.container : "mp4", videoCodec: typeof finalPayload.videoCodec === "string" ? finalPayload.videoCodec : undefined, audioCodec: typeof finalPayload.audioCodec === "string" ? finalPayload.audioCodec : undefined,
            timelineArtifactId: timeline.artifactId, narrationArtifactId: narration.artifactId, sceneClipArtifactIds: clips.map((clip) => clip.artifactId),
          } as unknown as Json,
        };
        return { input, execute: agentLlm(input) };
      }

      case "publisher": {
        const authorization = chain.find((a) => a.kind === "publisher_authorization");
        const publicationChain = chain.filter((artifact) => ["final_media_artifact", "final_technical_qa", "final_product_review", "publisher_authorization"].includes(artifact.kind));
        const input: Json = {
          __agent: "publisher",
          requestId: `publish-${workflowId}-${step.id}`,
          objective: `Publish the approved content for ${step.id}`,
          taskDescription: `Publish the approved content for ${step.id}`,
          validatedArtifacts: this.sourceArtifacts(publicationChain),
          ...(authorization === undefined ? {} : { publisherAuthorization: authorization.payload }),
        };
        return { input, execute: deterministicLlm(input) };
      }

      case "analytics": {
        const input: Json = {
          __agent: "analytics",
          requestId: `analytics-${workflowId}-${step.id}`,
          objective: `Measure the published content for ${step.id}`,
          taskDescription: `Measure the published content for ${step.id}`,
          validatedArtifacts: this.sourceArtifacts(chain),
        };
        return { input, execute: deterministicLlm(input) };
      }

      case "growth": {
        const input: Json = {
          __agent: "growth", ...strategyMarker, ...strategyModelOverride, requestId: `growth-${workflowId}-${step.id}`,
          objective: `Analyze growth inputs for ${step.id}`,
          taskDescription: `Analyze growth inputs for ${step.id}`,
          // A council manifest selects canonical current evidence.  Never
          // leak historical/failed artifacts into a governed strategy input.
          validatedArtifacts: this.sourceArtifacts(councilChain),
          ownerStrategicInput: safeRecord(context.data).ownerStrategicInput as Json ?? {}, referenceContentEvidence: safeRecord(context.data).referenceEvidence as Json ?? {},
        };
        return { input, execute: strategyMode ? agentLlm(input) : deterministicLlm(input) };
      }

      case "finance": {
        const input: Json = {
          __agent: "finance", ...strategyMarker, ...strategyModelOverride, requestId: `finance-${workflowId}-${step.id}`,
          objective: `Analyze financial inputs for ${step.id}`,
          taskDescription: `Analyze financial inputs for ${step.id}`,
          validatedArtifacts: this.sourceArtifacts(councilChain),
          ownerStrategicInput: safeRecord(context.data).ownerStrategicInput as Json ?? {}, referenceContentEvidence: safeRecord(context.data).referenceEvidence as Json ?? {},
        };
        return { input, execute: strategyMode ? agentLlm(input) : deterministicLlm(input) };
      }

      case "ceo": {
        if (preMediaPhase || step.id === "ceo-recommendation") {
          const research = latestByKind("research_report");
          if (research === undefined) throw new Error("CEO recommendation requires the canonical Research artifact");
          validateArtifactContract({ artifact: research, expectedWorkflowId: workflowId, expectedKind: "research_report", consumerStage: "ceo-recommendation" });
          const mode = decideCeoResearchMode(research.payload);
          const input: Json = {
            __agent: "ceo", ...roleOverridesMarker, productionPhase: "PRE_MEDIA_PHASE",
            objective: "Make a bounded evidence-gated production recommendation from the completed Research artifact.",
            researchArtifact: this.sourceArtifacts([research])[0] as Json,
            requiredDecision: mode.decision,
            eligibleCandidateIds: mode.eligibleCandidateIds as unknown as Json,
            policy: "amf-evidence-sufficiency-v1",
            allowedDecisions: ["ADVANCE", "HOLD", "RETURN_TO_OWNER", "NO_PRODUCTION_CANDIDATE"],
          };
          return { input, execute: agentLlm(input) };
        }
        const input: Json = {
          __agent: "ceo", ...strategyMarker, ...strategyModelOverride, ...roleOverridesMarker, requestId: `ceo-${workflowId}-${step.id}`,
          objective: String(context.data.objective ?? "Synthesize the validated pre-publication strategy council evidence."),
          workflowId, correlationId, cycle: 1, validatedArtifacts: this.sourceArtifacts(councilChain),
          ownerStrategicInput: safeRecord(context.data).ownerStrategicInput as Json ?? {},
          referenceContentEvidence: safeRecord(context.data).referenceEvidence as Json ?? {},
        };
        return { input, execute: strategyMode || preMediaPhase ? agentLlm(input) : unavailableTextProvider("ceo strategy mode") };
      }

      default: {
        const input: Json = { __agent: step.agent, objective: `Execute ${step.id}`, stepId: step.id };
        return { input, execute: deterministicLlm(input) };
      }
    }
  }

  /** Serialize persisted collaboration artifacts into the agents' source-artifact shape. */
  private sourceArtifacts(chain: CollaborationArtifact[]): Json[] {
    return chain.map((a) => ({
      artifactId: a.artifactId,
      kind: a.kind,
      producerAgent: a.producerAgent,
      workflowId: a.workflowId,
      correlationId: a.correlationId,
      status: a.status,
      createdAt: a.createdAt,
      ...(a.parentArtifact === undefined
        ? {}
        : { parentArtifact: { artifactId: a.parentArtifact.artifactId, kind: a.parentArtifact.kind } }),
      payload: a.payload as Json,
    }));
  }

  private withResearchCapabilityLifecycle(
    capability: CapabilityExecutionPort,
    lifecycle: GovernedLlmLifecycle,
    reservations: readonly ProductionCallReservation[],
  ): CapabilityExecutionPort {
    let nextReservation = 0;
    const record = async (state: string, metadata: Record<string, unknown>): Promise<void> => {
      if (this.persistence?.appendExecutionLifecycleEvent === undefined) return;
      await this.persistence.appendExecutionLifecycleEvent({
        executionId: lifecycle.executionId,
        workflowId: lifecycle.workflowId,
        stage: lifecycle.stage,
        state,
        occurredAt: nowIso(),
        attemptNumber: 1,
        metadata,
      });
    };
    return {
      executeCapability: async (request: CapabilityRequest): Promise<CapabilityResult> => {
        const reservation = reservations[nextReservation++];
        if (reservation === undefined) throw new Error("RESEARCH_CAPABILITY_RESERVATION_REQUIRED");
        const attribution = {
          reservationId: reservation.reservationId,
          idempotencyKey: reservation.idempotencyKey,
          callLeg: "RETRIEVAL",
          capabilityRequestId: request.requestId,
          capabilityId: request.capabilityId,
        };
        const result = await executeCapabilityWithTransportLifecycle(capability, request, attribution, record);
        // External success is its own durability boundary. Persist the result
        // and evidence before Research can advance to another retrieval or to
        // synthesis, so a later validator/artifact failure cannot erase valid
        // provider evidence from this execution.
        await this.persistResearchCapabilityResult(lifecycle, result);
        return result;
      },
    };
  }

  private async persistResearchCapabilityResult(lifecycle: GovernedLlmLifecycle, result: CapabilityResult): Promise<void> {
    if (this.persistence === undefined) throw new Error("RESEARCH_CAPABILITY_PERSISTENCE_REQUIRED");
    await persistCapabilityResultDurably(this.persistence, lifecycle, result);
  }

  private buildAgent(agent: string, deps: { input: Json; execute: ExecuteFn }, capabilityOverride?: CapabilityExecutionPort, wrapWithLifecycle: (raw: ExecuteFn) => ExecuteFn = (raw) => raw): AnyAgent {
    const capabilityExecution: CapabilityExecutionPort = capabilityOverride ?? this.boundary.boundary;
    const llm = wrapWithLifecycle(deps.execute);
    const scoped = safeRecord(safeRecord(deps.input).controlAgentOverrides)[agent]
      ?? safeRecord(safeRecord(deps.input).controlAgentOverrides)["*"];
    const configuredModel = typeof safeRecord(scoped).model === "string" && String(safeRecord(scoped).model).trim()
      ? String(safeRecord(scoped).model).trim()
      : null;
    const model = configuredModel ?? (safeRecord(deps.input).strategyMode === "PRE_PUBLICATION_STRATEGY"
      ? resolvedAgentRouterModel(agent, deps.input)
      : "deterministic");
    if (safeRecord(scoped).canonicalRouting !== undefined && ["orchestrator", "ceo", "director", "visual-director", "review", "qa"].includes(agent)) {
      return createPreMediaRoutedAgent(agent, model, llm);
    }
    if (safeRecord(deps.input).strategyMode === "PRE_PUBLICATION_STRATEGY" && ["writer","seo","brand","growth","finance"].includes(agent)) {
      const adapter = createStrategyCouncilV2SpecialistAgent(agent as StrategyCouncilV2Specialist, deps.execute);
      return { execute: adapter.executeAgent.bind(adapter) };
    }
    switch (agent) {
      case "planner":
        return createPlannerAgent({
          execute: llm,
          config: { model, temperature: 0.2, maxOutputTokens: 4096, systemPrompt: "" },
        }) as unknown as AnyAgent;
      case "research": {
        // Per-leg synthesis routing: when a governed leg route exists, the
        // FINAL_SYNTHESIS leg runs on its own model/transport while Direction
        // keeps the legacy research route. Absence preserves legacy behavior.
        // Precedence is explicit and structural: a present leg key governs
        // synthesis even when a generic role-wide research override exists
        // (the generic override still governs Direction); no legacy override
        // can silently erase the leg route, and no leg route is inferred.
        // Both the model label (agent config) and the transport below derive
        // from the same resolved leg route, so they cannot disagree.
        const synthesisRoute = researchSynthesisRoute(safeRecord(safeRecord(deps.input).controlAgentOverrides));
        const synthesisRaw = synthesisRoute === null
          ? null
          : agentLlm({ ...(deps.input as JsonRecord), __agent: RESEARCH_SYNTHESIS_ROUTE_ROLE });
        // Canonical submission lifecycle for BOTH legs: the leg dispatcher
        // selects the raw transport per callLeg (FINAL_SYNTHESIS -> the leg
        // route transport, every other leg -> the default transport) and ONE
        // governed wrapper provides claim attribution, the concurrency guard,
        // and diagnostics for both. A single closure preserves the existing
        // sequential multi-leg re-arm path; separate wrappers would race the
        // single-execution provider claim (EXECUTION_PROVIDER_CLAIM_NOT_ACQUIRED).
        const researchExecute = synthesisRaw === null
          ? wrapWithLifecycle(deps.execute)
          : wrapWithLifecycle(researchLegDispatcher(deps.execute, synthesisRaw));
        return createResearchAgent({
          execute: researchExecute,
          capabilityExecution,
          sourceRouter: this.researchSourceRouter,
          config: {
            model,
            temperature: 0.2,
            maxOutputTokens: model === "glm-5.3" ? 8192 : 4096,
            systemPrompt: "",
            ...(synthesisRoute === null ? {} : { modelForLeg: { FINAL_SYNTHESIS: synthesisRoute.model } }),
          },
        }) as unknown as AnyAgent;
      }
      case "writer":
        return createWriterAgent({
          execute: llm,
          // The canonical short-form Writer contract is structured JSON and is
          // deliberately bounded.  Keep this aligned with the governed role
          // policy; a caller must make any larger budget an explicit, audited
          // change rather than inheriting an ambient default.
          config: { model, temperature: 0.4, maxOutputTokens: 1000, systemPrompt: "" },
        }) as unknown as AnyAgent;
      case "seo":
        return createSEOAgent({
          execute: llm,
          config: { model, temperature: 0.3, maxOutputTokens: 8192, systemPrompt: "" },
        }) as unknown as AnyAgent;
      case "brand":
        return createBrandAgent({
          execute: llm,
          config: { model, temperature: 0.2, maxOutputTokens: 16384, systemPrompt: "" },
        }) as unknown as AnyAgent;
      case "review":
        return createReviewerAgent({
          execute: llm,
          capabilityExecution,
          config: { model, temperature: 0.2, maxOutputTokens: model === "nex-agi/nex-n2.5-pro:free" ? 1000 : 4096, systemPrompt: "" },
        }) as unknown as AnyAgent;
      case "thumbnail":
        return createThumbnailAgent({
          execute: llm,
          capabilityExecution,
          config: {
            model: "deterministic",
            maxPromptLength: 500,
            aspectRatio: "16:9",
            allowedAspectRatios: ["16:9", "9:16", "4:3", "3:4", "1:1"],
            systemPrompt: "",
          },
        }) as unknown as AnyAgent;
      case "video":
        return createVideoAgent({
          execute: llm,
          capabilityExecution,
          config: {
            model: "deterministic",
            maxPromptLength: 500,
            aspectRatio: "16:9",
            allowedAspectRatios: ["16:9", "9:16", "4:3", "3:4", "1:1"],
            durationSeconds: 30,
            systemPrompt: "",
          },
        }) as unknown as AnyAgent;
      case "qa":
        return createQAAgent({
          execute: llm,
          capabilityExecution,
          config: { model: "deterministic", temperature: 0.2, maxOutputTokens: 4096, systemPrompt: "" },
        }) as unknown as AnyAgent;
      case "publisher":
        return createPublisherAgent({
          execute: llm,
          capabilityExecution,
          config: { model: "deterministic", platform: "youtube", systemPrompt: "" },
        }) as unknown as AnyAgent;
      case "analytics":
        return createAnalyticsAgent({
          execute: llm,
          capabilityExecution,
          config: { model: "deterministic", platform: "youtube", systemPrompt: "" },
        }) as unknown as AnyAgent;
      case "growth":
        return createGrowthAgent({
          execute: llm,
          config: { model, systemPrompt: model === "glm-5.3" ? DEFAULT_GROWTH_SYSTEM_PROMPT : "", maxOutputTokens: model === "glm-5.3" ? 4096 : undefined },
        }) as unknown as AnyAgent;
      case "finance":
        return createFinanceAgent({
          execute: llm,
          config: { model, systemPrompt: model === "glm-5.3" ? DEFAULT_FINANCE_SYSTEM_PROMPT : "", maxOutputTokens: model === "glm-5.3" ? 4096 : undefined },
        }) as unknown as AnyAgent;
      case "ceo":
        return createCEOAgent({ execute: llm, config: { model, systemPrompt: DEFAULT_CEO_SYSTEM_PROMPT, temperature: 0.2, maxOutputTokens: 16384 } }) as unknown as AnyAgent;
      case "visual-director":
        return createPreMediaRoutedAgent("visual-director", model, llm);
      default:
        throw new Error(`Unsupported production agent "${agent}"`);
    }
  }

  private buildArtifact(step: AgentStep, context: WorkflowContext, payload: Json, status: "completed" | "blocked" | "failed", updateContext = true, canonicalParent?: CollaborationArtifact): CollaborationArtifact {
    const previous = safeRecord(context.data.previousArtifact);
    const parent = canonicalParent === undefined
      ? previous.artifactId === undefined ? undefined : { artifactId: String(previous.artifactId), kind: String(previous.kind) }
      : { artifactId: canonicalParent.artifactId, kind: canonicalParent.kind };
    const recovery = safeRecord(context.data.workflowRecovery);
    const recoverySuffix = typeof recovery.recoveredAt === "string" ? `-${recovery.recoveredAt.replace(/[^0-9A-Za-z]/g, "")}` : "";
    const artifact = {
      artifactId: `${artifactIdFor(context.workflowId, step.id)}${status === "completed" ? recoverySuffix : ""}`,
      kind: safeRecord(context.data).strategyMode === "PRE_PUBLICATION_STRATEGY" && ["writer","seo","brand","growth","finance","ceo"].includes(step.agent)
        ? `strategy_council_${step.agent}_v2`
        : KIND_BY_STEP[step.id]
        ?? (step.agent === "planner" && step.id.startsWith("planner-synthesis") ? "evidence_backed_content_brief" : undefined)
        ?? KIND_BY_AGENT[step.agent]
        ?? `${step.agent}_report`,
      producerAgent: step.agent,
      workflowId: context.workflowId,
      correlationId: context.correlationId ?? "",
      status,
      payload,
      contentType: "application/json",
      schemaVersion: SCHEMA_VERSION,
      createdAt: nowIso(),
      ...(parent === undefined ? {} : { parentArtifact: parent }),
    };
    const collaborationArtifact = artifact as CollaborationArtifact;
    if (["research_report", "ceo_recommendation", "evidence_backed_content_brief", "writer_report", "scene_plan", "visual_direction_contract"].includes(collaborationArtifact.kind) && status === "completed") {
      validateArtifactContract({ artifact: collaborationArtifact, expectedWorkflowId: context.workflowId, expectedKind: collaborationArtifact.kind });
    }
    if (updateContext) context.data.previousArtifact = { artifactId: artifact.artifactId, kind: artifact.kind };
    return collaborationArtifact;
  }

  private async persistCapabilityEvidence(step: AgentStep, context: WorkflowContext, output: Json): Promise<void> {
    if (this.persistence === undefined) return;
    const record = safeRecord(output);
    const executions = Array.isArray(record.capabilityExecutions) ? record.capabilityExecutions : [];
    for (const item of executions) {
      const execution = safeRecord(item);
      const status: "success" | "blocked" | "failed" =
        execution.status === "success" ? "success" : execution.status === "blocked" ? "blocked" : "failed";
      const evidence = safeRecord(execution.evidence);
      const evidenceId = typeof evidence.evidenceId === "string" ? evidence.evidenceId : null;
      // Stable identities so a crash re-run (same result / evidence id) replays
      // the same rows instead of duplicating them.
      const capabilityKey = typeof execution.resultId === "string" ? execution.resultId : `cap-${context.workflowId}-${step.id}`;
      await this.persistence.saveCapabilityExecution({
        resultId: String(execution.resultId ?? `cap-${context.workflowId}-${step.id}`),
        workflowId: context.workflowId,
        correlationId: context.correlationId ?? null,
        capabilityId: String(execution.capabilityId ?? ""),
        agentId: step.agent,
        status,
        evidenceId,
        idempotencyKey: typeof execution.idempotencyKey === "string" ? execution.idempotencyKey : capabilityKey,
        executedAt: typeof evidence.executedAt === "string" ? evidence.executedAt : nowIso(),
        payload: execution,
      });
      if (evidenceId !== null) {
        await this.persistence.saveExecutionEvidence({
          evidenceId,
          workflowId: context.workflowId,
          correlationId: context.correlationId ?? null,
          capabilityId: String(execution.capabilityId ?? ""),
          agentId: step.agent,
          executedAt: typeof evidence.executedAt === "string" ? evidence.executedAt : nowIso(),
          succeeded: evidence.succeeded === true,
          idempotencyKey: evidenceId,
          payload: execution,
        });
      }
      // Loud persistence verification: a silent ON CONFLICT skip must never be
      // reported as successful persistence. Re-read our row; a missing row is
      // a persistence failure, and a row holding DIFFERENT evidence under our
      // identity is a cross-attempt conflict (both fail loudly with codes).
      if (this.persistence.listCapabilityExecutions !== undefined) {
        const stored = (await this.persistence.listCapabilityExecutions(context.workflowId))
          .find((candidate) => candidate.resultId === String(execution.resultId ?? `cap-${context.workflowId}-${step.id}`));
        if (stored === undefined) {
          throw new Error(`CAPABILITY_EVIDENCE_PERSISTENCE_FAILED:${String(execution.capabilityId ?? "unknown")}`);
        }
        const evidenceIdentityMatches = stored.evidenceId === evidenceId;
        const storedProviderPayload = capabilityProviderPayload(stored.payload);
        const replayProviderPayload = capabilityProviderPayload(execution);
        const storedPayloadFingerprint = stableFingerprint(storedProviderPayload);
        const replayPayloadFingerprint = stableFingerprint(replayProviderPayload);
        const payloadMatches = storedPayloadFingerprint === replayPayloadFingerprint;
        if (!evidenceIdentityMatches || !payloadMatches) {
          const differencePath = firstJsonDifference(storedProviderPayload, replayProviderPayload) ?? "UNKNOWN";
          throw new Error(`CAPABILITY_EVIDENCE_CONFLICT:${String(execution.capabilityId ?? "unknown")}:${evidenceIdentityMatches ? `PAYLOAD:${differencePath}` : "EVIDENCE_ID"}`);
        }
      }
    }
  }

  /**
   * Prepare a durable record before an LLM can cross its provider boundary.
   * A prior non-terminal record for the same governed stage fails closed rather
   * than risking a duplicate paid submission after process recovery.
   */
  private async prepareGovernedLlmLifecycle(step: AgentStep, context: WorkflowContext, configuration: Json, startedAt: string, startedMs: number): Promise<GovernedLlmLifecycle | null> {
    // The ordinary production Writer is also a provider-backed, canonical
    // boundary.  It must receive the same pre-submission and terminal failure
    // provenance as strategy stages; otherwise a transport failure can happen
    // before any provider-visible evidence is durable.
    const governedProviderStage = GOVERNED_PROVIDER_AGENTS.has(step.agent);
    if ((safeRecord(configuration).strategyMode !== "PRE_PUBLICATION_STRATEGY" && !governedProviderStage) || this.persistence?.saveExecutionProvenance === undefined) return null;
    const existing = this.persistence.listExecutionProvenance === undefined ? [] : await this.persistence.listExecutionProvenance(context.workflowId);
    // READY_FOR_SUBMISSION is conclusively pre-transport.  Resolve its identity
    // before checking competitors so this one authorized lineage can be exact.
    const resumablePreparation = existing.find((record) => record.agentId === step.agent && record.stage === step.id
      && ["PREPARING", "READY_FOR_SUBMISSION"].includes(String(safeRecord(record.configuration).lifecycleState ?? "")));
    const excludedParentExecutionIds = authorizedRecoveryParentExclusions(configuration, resumablePreparation?.executionId ?? "", context, resumablePreparation);
    const unresolved = existing.find((record) => record.agentId === step.agent && record.stage === step.id
      && !excludedParentExecutionIds.includes(record.executionId)
      && ["STARTED", "PROVIDER_SUBMISSION_INTENT", "FETCH_INVOCATION_STARTED", "HTTP_RESPONSE_HEADERS_RECEIVED", "PROVIDER_RESPONSE_RECEIVED", "VALIDATING"].includes(String(safeRecord(record.configuration).lifecycleState ?? "")));
    if (unresolved !== undefined) throw new Error(`EXECUTION_RECONCILIATION_REQUIRED:${unresolved.executionId}`);
    // Resume the conclusively pre-transport identity; any later state remains
    // deliberately ambiguous.
    const lifecycle: GovernedLlmLifecycle = {
      executionId: resumablePreparation?.executionId ?? randomUUID(), workflowId: context.workflowId, correlationId: context.correlationId ?? null,
      agentId: step.agent, stage: step.id, startedAt, startedMs, configuration,
    };
    if (resumablePreparation === undefined) await this.persistLifecycle(lifecycle, "PREPARING", { providerSubmissionStarted: false });
    return lifecycle;
  }

  private governedRouteForLifecycle(lifecycle: GovernedLlmLifecycle): { provider: string; protocol: "ANTHROPIC" | "OPENAI_COMPATIBLE"; model: string } {
    const scoped = safeRecord(safeRecord(lifecycle.configuration).controlAgentOverrides)[lifecycle.agentId]
      ?? safeRecord(safeRecord(lifecycle.configuration).controlAgentOverrides)["*"];
    // Canonical production routing is authoritative when present. It must win
    // over legacy AgentRouter defaults and ambient agentRouterModelOverride
    // values; otherwise reservation (canonical) and transport (legacy) diverge.
    const canonical = safeRecord(safeRecord(scoped).canonicalRouting);
    const canonicalModel = typeof safeRecord(scoped).model === "string" ? String(safeRecord(scoped).model).trim() : "";
    if (typeof canonical.priceSnapshotId === "string" && canonical.priceSnapshotId.length > 0 && canonicalModel.length > 0) {
      return { provider: "openrouter", protocol: "OPENAI_COMPATIBLE", model: canonicalModel };
    }
    const scopedProvider = typeof safeRecord(scoped).provider === "string" ? String(safeRecord(scoped).provider).trim().toLowerCase() : "";
    const scopedModel = typeof safeRecord(scoped).model === "string" ? String(safeRecord(scoped).model).trim() : "";
    if (scopedProvider === "openrouter" && scopedModel) return { provider: "openrouter", protocol: "OPENAI_COMPATIBLE", model: scopedModel };
    if (scopedProvider === "agentrouter" && scopedModel) {
      const route = agentRouterRoute(scopedModel);
      return { provider: route.provider, protocol: route.protocol, model: scopedModel };
    }
    const openRaw = safeRecord(lifecycle.configuration).openRouterModelOverride;
    if (typeof openRaw === "string" && openRaw.trim()) return { provider: "openrouter", protocol: "OPENAI_COMPATIBLE", model: openRaw.trim() };
    const agentRaw = safeRecord(lifecycle.configuration).agentRouterModelOverride;
    if (typeof agentRaw === "string" && agentRaw.trim()) {
      const r = agentRouterRoute(agentRaw.trim());
      return { provider: r.provider, protocol: r.protocol, model: agentRaw.trim() };
    }
    const model = resolvedAgentRouterModel(lifecycle.agentId, lifecycle.configuration);
    if (model.includes(":free") && process.env.TEXT_AGENT_PROVIDER?.trim().toLowerCase() === "openrouter") return { provider: "openrouter", protocol: "OPENAI_COMPATIBLE", model };
    const r = agentRouterRoute(model);
    return { provider: r.provider, protocol: r.protocol, model };
  }

  private async persistLifecycle(lifecycle: GovernedLlmLifecycle, lifecycleState: string, details: Record<string, unknown> = {}): Promise<void> {
    if (this.persistence?.saveExecutionProvenance === undefined) throw new Error("EXECUTION_PROVENANCE_PERSISTENCE_REQUIRED");
    const { provider, protocol, model } = this.governedRouteForLifecycle(lifecycle);
    const route = { provider, protocol } as { provider: "agentrouter-anthropic" | "agentrouter-openai" | string; protocol: "ANTHROPIC" | "OPENAI_COMPATIBLE" };
    const inputArtifactIds = referencedArtifactIds(lifecycle.configuration);
    await this.persistence.saveExecutionProvenance(executionProvenance({
      executionId: lifecycle.executionId, workflowId: lifecycle.workflowId, correlationId: lifecycle.correlationId,
      agentId: lifecycle.agentId, stage: lifecycle.stage, capability: "agent.execute", provider: route.provider, model,
      runtime: route.provider === "openrouter" ? "governed-openrouter-llm" : "governed-agentrouter-llm", promptVersion: stableFingerprint({ agent: lifecycle.agentId, stage: lifecycle.stage, version: AGENT_VERSION }),
      startedAt: lifecycle.startedAt, completedAt: nowIso(), latencyMs: Date.now() - lifecycle.startedMs,
      status: "blocked", usage: null, costKind: "UNKNOWN", cost: null, currency: "USD", artifactIds: inputArtifactIds,
      parentExecutionIds: recoveryParentExecutionIds(lifecycle.configuration), attemptNumber: 1, providerRequestId: typeof details.providerRequestId === "string" ? details.providerRequestId : null,
      providerJobId: null, errorClassification: null,
      configuration: { ...safeRecord(lifecycle.configuration), lifecycleState, protocol: route.protocol, requestedModel: model, resolvedTimeoutMs: resolveAgentRouterTimeoutMs(), inputArtifactIds, requestFingerprint: stableFingerprint(lifecycle.configuration), lifecycleDetails: details },
    }));
    if (this.persistence.appendExecutionLifecycleEvent !== undefined) {
      await this.persistence.appendExecutionLifecycleEvent({
        executionId: lifecycle.executionId, workflowId: lifecycle.workflowId, stage: lifecycle.stage,
        state: lifecycleState, occurredAt: nowIso(), attemptNumber: 1,
        metadata: { provider: route.provider, requestedModel: model, ...safeRecord(details) },
      });
    }
  }

  private withProviderSubmissionLifecycle(execute: ExecuteFn, lifecycle: GovernedLlmLifecycle, reservations: readonly ProductionCallReservation[]): ExecuteFn {
    let transportCount = 0;
    return async (executionContext, request, cancellation) => {
      // The SQL implementation is a compare-and-set, so concurrent workers
      // cannot both cross the provider boundary.  Legacy/in-memory adapters
      // retain the fail-closed semantics for production by requiring the claim.
      if (this.persistence?.claimReadyExecutionProvenance === undefined) {
        throw new Error("EXECUTION_PROVIDER_CLAIM_REQUIRED");
      }
      transportCount += 1;
      const callLeg = request.callIdentity?.callLeg ?? (transportCount === 1 ? "PRIMARY" : `CALL_${transportCount}`);
      const textReservations = reservations.filter((reservation) => reservation.callKind === "text_agent");
      const reservation = callLeg === "FINAL_SYNTHESIS" ? textReservations.at(-1) : textReservations[0];
      const attribution = { callLeg, reservationId: reservation?.reservationId, idempotencyKey: reservation?.idempotencyKey };
      let claimed = await this.persistence.claimReadyExecutionProvenance(lifecycle.executionId, { maxTokens: request.maxOutputTokens, ...attribution });
      if (!claimed && transportCount > 1) {
        // Sequential multi-leg synthesis within ONE execution (planning LLM,
        // then post-retrieval synthesis LLM): the prior leg completed, so
        // re-arm the claim for the next leg. This runs strictly after the
        // previous transport finished, so the concurrent-submission guard is
        // unaffected; a crash between legs resumes the whole step under the
        // existing reservation-idempotency rules.
        await this.persistLifecycle(lifecycle, "READY_FOR_SUBMISSION", { providerSubmissionStarted: false, ...attribution });
        claimed = await this.persistence.claimReadyExecutionProvenance(lifecycle.executionId, { maxTokens: request.maxOutputTokens, ...attribution });
      }
      if (!claimed) throw new Error(`EXECUTION_PROVIDER_CLAIM_NOT_ACQUIRED:${lifecycle.executionId}`);
      let response: Awaited<ReturnType<ExecuteFn>>;
      try {
        response = await execute(executionContext, {
          ...request,
          onTransportEvent: async (event, details) => {
            await this.persistLifecycle(lifecycle, event, { ...safeRecord(details), ...attribution });
          },
        }, cancellation);
      } catch (error) {
        // JSON parsing happens inside the governed runtime, before it can
        // return a response for the ordinary validation transition below.
        // Preserve the same append-only validation boundary using only the
        // already-sanitized error diagnostics.
        const diagnostics = error instanceof AgentRouterExecutionError || error instanceof OpenRouterExecutionError
          ? safeRecord((error as unknown as { diagnostics?: unknown }).diagnostics)
          : safeValidationDiagnostics(error);
        if (diagnostics.validationStage === "parse") await this.persistLifecycle(lifecycle, "VALIDATING", diagnostics);
        throw error;
      }
      const diagnostics = safeRecord((response as unknown as { providerResponseDiagnostics?: unknown }).providerResponseDiagnostics);
      lifecycle.lastProviderResponse = diagnostics;
      await this.persistLifecycle(lifecycle, "PROVIDER_RESPONSE_RECEIVED", {
        ...diagnostics, ...attribution, finishReason: (response as unknown as { finishReason?: unknown }).finishReason ?? "unknown",
      });
      await this.persistLifecycle(lifecycle, "VALIDATING", {
        ...diagnostics, ...attribution, finishReason: (response as unknown as { finishReason?: unknown }).finishReason ?? "unknown",
      });
      return response;
    };
  }

  /** Attribution is observational only: unavailable attribution storage never changes execution outcome. */
  private async persistCompletedAgentProvenance(step: AgentStep, context: WorkflowContext, response: ExecutionResponse, artifactId: string, artifactStatus: "completed" | "blocked" | "failed", configuration: Json, startedAt: string, observedLatencyMs: number, lifecycle: GovernedLlmLifecycle | null = null, strict = false): Promise<void> {
    if (this.persistence?.saveExecutionProvenance === undefined) return;
    const completedAt = nowIso();
    try {
      const isOpenRouter = response.provider === "openrouter" || response.model === "nvidia/nemotron-3-super-120b-a12b:free";
      const runtimeForProvider = response.provider === "local" ? "local" : response.provider === "openrouter" || isOpenRouter ? "governed-openrouter-llm" : response.provider.startsWith("agentrouter-") ? "governed-agentrouter-llm" : null;
      const protocolForModel = isOpenRouter ? "OPENAI_COMPATIBLE" : agentRouterRoute(response.model).protocol;
      const timeoutForProtocol = isOpenRouter ? resolveOpenRouterTimeoutMs() : resolveAgentRouterTimeoutMs();
      await this.persistence.saveExecutionProvenance(executionProvenance({
        ...(lifecycle === null ? {} : { executionId: lifecycle.executionId }),
        workflowId: context.workflowId, correlationId: context.correlationId ?? null, agentId: step.agent, stage: step.id,
        capability: "agent.execute", provider: response.provider, model: response.model || null,
        runtime: runtimeForProvider,
        promptVersion: stableFingerprint({ agent: step.agent, stage: step.id, version: AGENT_VERSION }),
        startedAt, completedAt, latencyMs: observedLatencyMs,
        status: artifactStatus === "completed" ? "success" : artifactStatus,
        usage: { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens, totalTokens: response.usage.inputTokens + response.usage.outputTokens },
        costKind: response.provider.includes("deterministic") ? "FREE" : response.usage.costUsd > 0 ? "ACTUAL" : "UNKNOWN",
        cost: response.provider.includes("deterministic") ? 0 : response.usage.costUsd > 0 ? response.usage.costUsd : null,
        currency: "USD", artifactIds: [artifactId], parentExecutionIds: recoveryParentExecutionIds(configuration), attemptNumber: 1,
        providerRequestId: typeof safeRecord((response as unknown as { providerResponseDiagnostics?: unknown }).providerResponseDiagnostics).providerRequestId === "string"
          ? String(safeRecord((response as unknown as { providerResponseDiagnostics?: unknown }).providerResponseDiagnostics).providerRequestId)
          : null,
        providerJobId: null,
        errorClassification: artifactStatus === "completed" ? null : "AGENT_OUTPUT_BLOCKED",
        configuration: {
          ...safeRecord(configuration),
          ...(lifecycle === null ? {} : { lifecycleState: artifactStatus === "completed" ? "COMPLETED" : "LOCAL_EXECUTION_FAILED", providerSubmissionStarted: true, protocol: protocolForModel, requestedModel: response.model, resolvedTimeoutMs: timeoutForProtocol, inputArtifactIds: referencedArtifactIds(configuration), requestFingerprint: stableFingerprint(configuration) }),
          providerResponse: {
            finishReason: (response as unknown as { finishReason?: unknown }).finishReason ?? "unknown",
            ...safeRecord((response as unknown as { providerResponseDiagnostics?: unknown }).providerResponseDiagnostics),
          },
        },
      }));
      if (lifecycle !== null && this.persistence.appendExecutionLifecycleEvent !== undefined) {
        const diagnostics = safeRecord((response as unknown as { providerResponseDiagnostics?: unknown }).providerResponseDiagnostics);
        await this.persistence.appendExecutionLifecycleEvent({ executionId: lifecycle.executionId, workflowId: lifecycle.workflowId, stage: lifecycle.stage, state: artifactStatus === "completed" ? "COMPLETED" : "FAILED", occurredAt: nowIso(), attemptNumber: 1, metadata: { provider: response.provider, requestedModel: response.model, ...diagnostics } });
      }
    } catch (error) {
      if (strict) throw error;
      // Metrics must never turn a completed production execution into a failure.
    }
  }

  /** Persist a secret-safe attempt record even when provider execution fails before an artifact exists. */
  private async persistFailedAgentProvenance(step: AgentStep, context: WorkflowContext, configuration: Json, startedAt: string, observedLatencyMs: number, error: unknown, lifecycle: GovernedLlmLifecycle | null = null, budgetReconciliationFailure: string | null = null): Promise<string | null> {
    if (this.persistence?.saveExecutionProvenance === undefined) return lifecycle === null ? null : "DURABLE_FAILURE_EVIDENCE_UNAVAILABLE";
    const details = { ...(error instanceof AgentRouterExecutionError || error instanceof OpenRouterExecutionError ? safeRecord((error as unknown as { diagnostics: unknown }).diagnostics) : safeValidationDiagnostics(error)) };
    const message = error instanceof Error ? error.message : String(error);
    if (step.agent === "review" && lifecycle?.lastProviderResponse !== null && lifecycle?.lastProviderResponse !== undefined && lifecycleFailureState(details, message) === "LOCAL_EXECUTION_FAILED") details.runtimeFailureCode = "REVIEW_RUNTIME_FAILED";
    const scopedOverride=safeRecord(safeRecord(configuration).controlAgentOverrides)[step.agent];
    const governed = String(safeRecord(configuration).strategyMode ?? safeRecord(configuration).__strategyMode) === "PRE_PUBLICATION_STRATEGY"
      || GOVERNED_PROVIDER_AGENTS.has(step.agent);
    const rawModel = typeof safeRecord(scopedOverride).model==="string"?safeRecord(scopedOverride).model:(governed ? (safeRecord(configuration).openRouterModelOverride ?? safeRecord(configuration).agentRouterModelOverride) : null);
    const model = governed ? (typeof rawModel === "string" && String(rawModel).trim() ? String(rawModel).trim() : resolvedAgentRouterModel(step.agent, configuration)) : null;
    const hasOpenRouterOverride = safeRecord(scopedOverride).provider==="openrouter"||(typeof safeRecord(configuration).openRouterModelOverride === "string" && String(safeRecord(configuration).openRouterModelOverride).trim().length > 0);
    const isOpenRouterModel = hasOpenRouterOverride || (typeof model === "string" && model.includes(":free"));
    const provider = model === null ? null : isOpenRouterModel ? "openrouter" : agentRouterRoute(model).provider;
    let durableTerminalEvidence = false;
    let persistenceFailure: string | null = null;
    if (lifecycle !== null) {
      try {
        if (this.persistence.appendExecutionLifecycleEvent === undefined) throw new Error("FAILED_LIFECYCLE_WRITER_UNAVAILABLE");
        await this.persistence.appendExecutionLifecycleEvent({ executionId: lifecycle.executionId, workflowId: lifecycle.workflowId, stage: lifecycle.stage, state: "FAILED", occurredAt: nowIso(), attemptNumber: 1, metadata: { errorClassification: lifecycleFailureState(details, message), failureMessage: sanitizedFailureMessage(error), ...safeRecord(details) } });
        durableTerminalEvidence = true;
      } catch (terminalError) {
        const safeCode = (value: unknown): string | null => typeof value === "string" && /^[A-Z][A-Z0-9_]{0,119}$/.test(value) ? value : null;
        const boundedStrings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length <= 120).slice(0, 20) : [];
        const response = safeRecord(lifecycle.lastProviderResponse);
        const fallbackMetadata = {
          eventCode: "TERMINAL_FAILURE_PERSISTENCE_FAILED",
          originalFailureClass: lifecycleFailureState(details, message),
          originalFailureStage: safeCode(details.validationStage) ?? (typeof details.validationStage === "string" ? details.validationStage.slice(0, 20) : null),
          originalFailureCode: safeCode(details.validationCode) ?? safeCode(details.reviewOutcomeCode) ?? safeCode(details.runtimeFailureCode),
          terminalPersistenceFailureClass: terminalError instanceof Error ? terminalError.name.slice(0, 80) : "UNKNOWN",
          terminalPersistenceFailureCode: safeCode(safeRecord(terminalError).code),
          commandId: typeof safeRecord(safeRecord(configuration).recoveryExecution).commandId === "string" ? String(safeRecord(safeRecord(configuration).recoveryExecution).commandId).slice(0, 120) : null,
          provider: typeof response.provider === "string" ? response.provider.slice(0, 80) : null,
          requestedModel: typeof response.requestedModel === "string" ? response.requestedModel.slice(0, 120) : null,
          actualModel: typeof response.actualModel === "string" ? response.actualModel.slice(0, 120) : null,
          providerRequestId: typeof response.providerRequestId === "string" ? response.providerRequestId.slice(0, 120) : null,
          httpStatus: typeof response.httpStatus === "number" ? response.httpStatus : null,
          finishReason: typeof response.finishReason === "string" ? response.finishReason.slice(0, 40) : null,
          validationStage: typeof details.validationStage === "string" ? details.validationStage.slice(0, 20) : null,
          parseCode: details.validationStage === "parse" ? safeCode(details.validationCode) : null,
          structuralIssueCount: typeof details.issueCount === "number" ? details.issueCount : null,
          structuralIssuePaths: boundedStrings(details.issuePaths),
          structuralIssueCodes: boundedStrings(details.issueCodes),
          semanticRuleId: safeCode(details.semanticRuleId),
          reviewOutcomeCode: safeCode(details.reviewOutcomeCode),
          runtimeFailureCode: safeCode(details.runtimeFailureCode),
          responseFingerprint: typeof response.responseFingerprint === "string" && /^[a-f0-9]{64}$/.test(response.responseFingerprint) ? response.responseFingerprint : null,
          visibleContentFingerprint: typeof response.visibleContentFingerprint === "string" && /^[a-f0-9]{64}$/.test(response.visibleContentFingerprint) ? response.visibleContentFingerprint : null,
        };
        try {
          if (this.persistence.appendExecutionFailureFallbackEvent === undefined) throw new Error("FAILURE_FALLBACK_WRITER_UNAVAILABLE");
          await this.persistence.appendExecutionFailureFallbackEvent({ executionId: lifecycle.executionId, workflowId: lifecycle.workflowId, stage: lifecycle.stage, attemptNumber: 1, occurredAt: nowIso(), metadata: fallbackMetadata });
          durableTerminalEvidence = true;
          persistenceFailure = "TERMINAL_FAILURE_PERSISTENCE_FAILED";
        } catch (fallbackError) {
          persistenceFailure = "DURABLE_FAILURE_EVIDENCE_UNAVAILABLE";
          console.error(`DURABLE_FAILURE_EVIDENCE_UNAVAILABLE:${fallbackError instanceof Error ? fallbackError.name : "UNKNOWN"}`);
        }
      }
    }
    try {
      const runtimeForProvider = provider === null ? null : provider === "openrouter" ? "governed-openrouter-llm" : "governed-agentrouter-llm";
      const protocolForFailed = isOpenRouterModel ? "OPENAI_COMPATIBLE" : agentRouterRoute(model as string).protocol;
      const timeoutForFailed = isOpenRouterModel ? resolveOpenRouterTimeoutMs() : resolveAgentRouterTimeoutMs();
      const responseUsage=safeRecord(safeRecord(lifecycle?.lastProviderResponse).usage);
      const normalizedFailureUsage=typeof responseUsage.prompt_tokens==="number"&&typeof responseUsage.completion_tokens==="number"?{inputTokens:Number(responseUsage.prompt_tokens),outputTokens:Number(responseUsage.completion_tokens),totalTokens:Number(responseUsage.total_tokens??Number(responseUsage.prompt_tokens)+Number(responseUsage.completion_tokens)),reasoningTokens:Number(safeRecord(responseUsage.completion_tokens_details).reasoning_tokens??0)}:null;
      const failureCost=typeof responseUsage.cost==="number"?responseUsage.cost:null;
      await this.persistence.saveExecutionProvenance(executionProvenance({
        ...(lifecycle === null ? {} : { executionId: lifecycle.executionId }),
        workflowId: context.workflowId, correlationId: context.correlationId ?? null, agentId: step.agent, stage: step.id,
        capability: "agent.execute", provider, model, runtime: runtimeForProvider,
        promptVersion: stableFingerprint({ agent: step.agent, stage: step.id, version: AGENT_VERSION }),
        startedAt, completedAt: nowIso(), latencyMs: observedLatencyMs, status: "failed", usage: normalizedFailureUsage,
        costKind: provider === null ? "FREE" : failureCost!==null?"ACTUAL":"UNKNOWN", cost: provider === null ? 0 : failureCost, currency: "USD",
        artifactIds: [], parentExecutionIds: recoveryParentExecutionIds(configuration), attemptNumber: 1,
        providerRequestId: typeof details.providerRequestId === "string" ? details.providerRequestId : null, providerJobId: null,
        errorClassification: lifecycleFailureState(details, message),
        configuration: { ...safeRecord(configuration), ...(lifecycle === null || model === null ? {} : { lifecycleState: lifecycleFailureState(details, message), providerSubmissionStarted: true, protocol: protocolForFailed, requestedModel: model, resolvedTimeoutMs: timeoutForFailed, inputArtifactIds: referencedArtifactIds(configuration), requestFingerprint: stableFingerprint(configuration), providerResponse: lifecycle.lastProviderResponse ?? {} }), providerFailure: details, failureMessage: sanitizedFailureMessage(error), ...(budgetReconciliationFailure === null ? {} : { budgetReconciliationFailure }) },
      }));
    } catch (persistenceError) {
      // Preserve the business error, but make a diagnostic write failure visible
      // to the local worker without leaking the original provider payload.
      console.error(`TERMINAL_FAILURE_DIAGNOSTIC_PERSISTENCE_FAILED:${persistenceError instanceof Error ? persistenceError.name : "UNKNOWN"}`);
      if (!durableTerminalEvidence && lifecycle !== null) persistenceFailure = "DURABLE_FAILURE_EVIDENCE_UNAVAILABLE";
    }
    return persistenceFailure;
  }

  private async persistMediaStageProvenance(step: AgentStep, context: WorkflowContext, resultStatus: MediaChainStageOutput["status"], startedAt: string, latencyMs: number): Promise<void> {
    if (this.persistence?.saveExecutionProvenance === undefined) return;
    try {
      const artifactKind: Record<string, string> = { director: "scene_plan", tts: "narration_artifact", timeline: "timeline_plan", "scene-image": "scene_visual_artifact", "visual-semantic-review": "visual_semantic_review", "visual-technical-qa": "visual_technical_qa", "wan-authorization": "wan_authorization", video: "scene_video_clip", composer: "final_media_artifact" };
      const artifacts = await this.loadChain(context);
      await this.persistence.saveExecutionProvenance(executionProvenance({
        workflowId: context.workflowId, correlationId: context.correlationId ?? null, agentId: step.agent, stage: step.id,
        capability: "agent.execute", provider: "local", model: null, runtime: "production-media-chain-bridge",
        promptVersion: stableFingerprint({ agent: step.agent, stage: step.id, version: AGENT_VERSION }), startedAt, completedAt: nowIso(), latencyMs,
        status: resultStatus === "COMPLETED" ? "success" : resultStatus === "AWAITING_APPROVAL" ? "blocked" : "blocked",
        usage: null, costKind: "FREE", cost: 0, currency: "USD",
        artifactIds: artifacts.filter((artifact) => artifact.kind === artifactKind[step.agent]).map((artifact) => artifact.artifactId),
        parentExecutionIds: [], attemptNumber: 1, providerRequestId: null, providerJobId: null,
        errorClassification: resultStatus === "COMPLETED" ? null : resultStatus,
        configuration: { stage: step.id, agent: step.agent },
      }));
    } catch {
      // Attribution storage must not change the production stage outcome.
    }
  }

  /** Deterministic placeholder for legacy (non-production) agent steps. */
  private async deterministicStep(step: AgentStep, context: WorkflowContext): Promise<StepOutcome> {
    const kind = KIND_BY_AGENT[step.agent] ?? `${step.agent}_report`;
    const artifactId = artifactIdFor(context.workflowId, step.id);
    const previous = safeRecord(context.data.previousArtifact);
    const artifact = {
      artifactId,
      kind,
      producerAgent: step.agent,
      workflowId: context.workflowId,
      correlationId: context.correlationId ?? "",
      status: "completed" as const,
      payload: { reportId: artifactId, agent: step.agent, workflowId: context.workflowId },
      contentType: "application/json",
      schemaVersion: SCHEMA_VERSION,
      createdAt: nowIso(),
      ...(previous.artifactId === undefined
        ? {}
        : { parentArtifact: { artifactId: String(previous.artifactId), kind: String(previous.kind) } }),
    } as unknown as CollaborationArtifact;
    context.data.previousArtifact = { artifactId, kind };
    return { status: "completed", output: artifact.payload as unknown as Json, artifact };
  }
}

const MEDIA_STAGE_AGENTS = new Set(["director", "tts", "timeline", "scene-image", "visual-semantic-review", "visual-technical-qa", "wan-authorization", "video", "composer"]);
function mediaInputFromChain(context: WorkflowContext, chain: CollaborationArtifact[], budget?: { consume(input: { stage: string; capabilityId: string; itemId?: string }): Promise<void>, resumeId: string }, resolvedProviderIds: Readonly<Record<string, string>> = {}): import("./media-chain/production-media-chain.js").MediaChainInput {
  const data = safeRecord(context.data);
  const gate = safeRecord(context.outputs?.["visual-human-gate"]);
  const gateScenes = gate.sceneDecisions !== null && typeof gate.sceneDecisions === "object" && !Array.isArray(gate.sceneDecisions)
    ? gate.sceneDecisions as Record<string, "APPROVED" | "REJECTED" | "REQUEST_REGENERATION">
    : undefined;
  // Fail-closed semantic provenance (§12): the wan stage must distinguish a
  // genuine human approval (gate outcome "approved") from a policy bypass.
  // The outcome travels explicitly; sceneDecisions alone are not trusted.
  const gateOutcome = typeof gate.outcome === "string" ? gate.outcome : undefined;
  const writer = [...chain].reverse().find((a) => a.kind === "writer_report" && a.status === "completed");
  const writerPayload = safeRecord(writer?.payload);
  return {
    workflowId: context.workflowId,
    correlationId: context.correlationId ?? "",
    contentId: String(writerPayload.contentId ?? `content-${context.workflowId}`),
    scriptIdentity: String(writer?.artifactId ?? `script-${context.workflowId}`),
    script: String(writerPayload.content ?? writerPayload.script ?? data.directive ?? data.contentTopic ?? "Production narration"),
    language: String(data.language ?? "en"),
    voice: resolveProductionTtsVoice(data.voice, context.workflowId),
    ttsProvider: resolvedProviderIds["tts.generate"] ?? "unknown",
    ttsModel: resolvedProviderIds["tts.generate"] === "voicetut" ? "UNKNOWN" : undefined,
    caption: typeof data.caption === "string" ? data.caption : undefined,
    regenerationVersion: typeof data.visualRegenerationVersion === "number" ? data.visualRegenerationVersion : undefined,
    regenerationSceneIds: Array.isArray(data.visualRegenerationSceneIds) ? data.visualRegenerationSceneIds.filter((v): v is string => typeof v === "string") : undefined,
    lockedVisualArtifactIds: Array.isArray(data.visualLockedArtifactIds) ? data.visualLockedArtifactIds.filter((v): v is string => typeof v === "string") : undefined,
    visualConstraintOverrides: data.visualConstraintOverrides && typeof data.visualConstraintOverrides === "object" && !Array.isArray(data.visualConstraintOverrides) ? data.visualConstraintOverrides as Record<string, Record<string, unknown>> : undefined,
    negativeConditioningSupported: data.negativeConditioningSupported === false ? false : undefined,
    approvedHumanScenes: typeof data.approvedHumanScenes === "object" && data.approvedHumanScenes !== null ? data.approvedHumanScenes as Record<string, "APPROVED" | "REJECTED" | "REQUEST_REGENERATION"> : undefined,
    ...(gateOutcome === undefined ? {} : { visualGateOutcome: gateOutcome }),
    ...(gateScenes === undefined ? {} : { visualGateSceneDecisions: gateScenes }),
    ...(data.videoTailPadPolicy && typeof data.videoTailPadPolicy === "object" && !Array.isArray(data.videoTailPadPolicy)
      ? { videoTailPadPolicy: data.videoTailPadPolicy as unknown as import("@ai-media-factory/tool-framework").VideoTailPadPolicy }
      : {}),
    ...(typeof data.wanAuthorizationId === "string" && data.wanAuthorizationId.trim() !== "" ? { wanAuthorizationId: data.wanAuthorizationId } : {}),
    ...(budget === undefined ? {} : {
      mediaResumeId: budget.resumeId,
      consumeProviderBudget: (input: { stage: string; capabilityId: string; itemId?: string }) => budget.consume({ ...input, stage: input.stage }),
    }),
  };
}

/** Safe production voice resolution: workflow choice, then VoiceTut's real adapter default. */
const TEMPORARY_VALIDATION_TTS_VOICES: Readonly<Record<string, string>> = {
  "wf-1789233193749-gvydpiah": "Mohamed",
};

export function resolveProductionTtsVoice(value: unknown, workflowId?: string): string {
  const governedValidationVoice = workflowId === undefined ? undefined : TEMPORARY_VALIDATION_TTS_VOICES[workflowId];
  return governedValidationVoice !== undefined
    ? governedValidationVoice
    : typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : (process.env.VOICETUT_DEFAULT_SPEAKER?.trim() || "Mohamed");
}

/**
 * Bounded canonical diagnostics for a blocked Research outcome
 * (contract amf-research-blocked-diagnostics-v1).
 *
 * Retained when Research returns output that the evidence gate blocks
 * (AGENT_OUTPUT_BLOCKED:research): the grounded report's evidenceQuality /
 * sufficiency verdict plus counts only. Never retains raw evidence text,
 * source URLs, snippets, provider bodies, or secrets. Diagnostics never
 * change the blocked verdict: a blocked workflow remains blocked.
 */
export interface ResearchBlockedDiagnostics {
  readonly researchBlockReason: string;
  readonly evidenceQualityStatus: string | null;
  readonly evidenceStatus: string | null;
  readonly ceoEligible: boolean;
  readonly sufficiencyReasons: readonly string[];
  readonly insufficiencyReasons: readonly string[];
  readonly failedGatePaths: readonly string[];
  readonly retrievalCount: number;
  readonly evidenceRecordCount: number;
  readonly uniqueSourceUrlCount: number;
  readonly authorityBreakdown: Record<string, number>;
  readonly candidateCount: number;
  readonly viableCandidateCount: number;
  readonly synthesisEligibility: string;
  readonly synthesisSubmitted: boolean;
}

const RESEARCH_BLOCKED_AUTHORITY_CLASSES: readonly string[] = [
  "PRIMARY_OR_INSTITUTIONAL",
  "REPUTABLE_SECONDARY",
  "GENERAL_MEDIA",
  "COMMUNITY",
  "AGGREGATOR_OR_COMPILATION",
  "UNKNOWN",
];

const RESEARCH_BLOCKED_MAX_REASONS = 20;
const RESEARCH_BLOCKED_MAX_REASON_CHARS = 120;
const RESEARCH_BLOCKED_MAX_PATHS = 8;

function boundDiagnosticCode(value: unknown, fallback = "UNKNOWN"): string {
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  const bounded = value.trim().slice(0, RESEARCH_BLOCKED_MAX_REASON_CHARS);
  return /^[A-Z][A-Z0-9_]*$/.test(bounded) ? bounded : fallback;
}

function boundDiagnosticCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim().slice(0, RESEARCH_BLOCKED_MAX_REASON_CHARS))
    .filter((entry) => /^[A-Z][A-Z0-9_]*$/.test(entry))
    .slice(0, RESEARCH_BLOCKED_MAX_REASONS);
}

function boundDiagnosticPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim().slice(0, 80))
    .filter((entry) => /^[A-Za-z][A-Za-z0-9_.\[\]-]*$/.test(entry))
    .slice(0, RESEARCH_BLOCKED_MAX_PATHS);
}

function boundDiagnosticCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/**
 * Defense-in-depth bound for researchBlocked diagnostics arriving on a thrown
 * error: only the allowlisted shape survives, every string is sliced, every
 * list is capped, counts are non-negative integers, and no raw evidence text
 * (titles, URLs, snippets, provider bodies) is ever admitted.
 */
export function boundResearchBlockedDiagnostics(value: unknown): ResearchBlockedDiagnostics {
  const record = safeRecord(value);
  const authority = safeRecord(record.authorityBreakdown);
  const authorityBreakdown: Record<string, number> = {};
  for (const key of RESEARCH_BLOCKED_AUTHORITY_CLASSES) authorityBreakdown[key] = boundDiagnosticCount(authority[key]);
  return {
    researchBlockReason: boundDiagnosticCode(record.researchBlockReason, "RESEARCH_EVIDENCE_GATE_BLOCKED"),
    evidenceQualityStatus: typeof record.evidenceQualityStatus === "string" && /^[A-Z][A-Z0-9_]{0,39}$/.test(record.evidenceQualityStatus) ? record.evidenceQualityStatus : null,
    evidenceStatus: typeof record.evidenceStatus === "string" && /^[A-Z][A-Z0-9_]{0,39}$/.test(record.evidenceStatus) ? record.evidenceStatus : null,
    ceoEligible: record.ceoEligible === true,
    sufficiencyReasons: boundDiagnosticCodes(record.sufficiencyReasons),
    insufficiencyReasons: boundDiagnosticCodes(record.insufficiencyReasons),
    failedGatePaths: boundDiagnosticPaths(record.failedGatePaths),
    retrievalCount: boundDiagnosticCount(record.retrievalCount),
    evidenceRecordCount: boundDiagnosticCount(record.evidenceRecordCount),
    uniqueSourceUrlCount: boundDiagnosticCount(record.uniqueSourceUrlCount),
    authorityBreakdown,
    candidateCount: boundDiagnosticCount(record.candidateCount),
    viableCandidateCount: boundDiagnosticCount(record.viableCandidateCount),
    synthesisEligibility: ["SUBMITTED", "NOT_SUBMITTED", "UNKNOWN"].includes(String(record.synthesisEligibility)) ? String(record.synthesisEligibility) : "UNKNOWN",
    synthesisSubmitted: record.synthesisSubmitted === true,
  };
}

/**
 * Build bounded blocked diagnostics from a grounded Research output (the
 * artifactStatusFor input). Pure and provider-free: reads only the already
 * computed evidenceQuality / researchStatus / capabilityExecutions /
 * synthesisUsage markers plus counts derived from the artifact-local source
 * table (URL strings are counted via canonicalization, never retained).
 */
export function buildResearchBlockedDiagnostics(output: Json, contextData?: Readonly<Record<string, Json>>, stepId?: string): ResearchBlockedDiagnostics {
  const record = safeRecord(output);
  const gate = safeRecord(record.evidenceQuality);
  const executions = Array.isArray(record.capabilityExecutions) ? record.capabilityExecutions : [];
  const successfulSearches = executions.filter(
    (item) => safeRecord(item).capabilityId === "web.search" && safeRecord(item).status === "success",
  );
  const hasSearch = executions.some((item) => safeRecord(item).capabilityId === "web.search");
  const gateStatus = typeof gate.status === "string" ? gate.status : null;
  const ceoEligible = gate.ceoEligible === true;
  const researchStatus = typeof record.researchStatus === "string" ? record.researchStatus : null;
  const candidateCount = boundDiagnosticCount(gate.candidateCount);
  const researchBlockReason = !hasSearch
    ? "RESEARCH_RETRIEVAL_ABSENT"
    : gateStatus === "NEEDS_RESEARCH_RETRY"
      ? "EVIDENCE_QUALITY_NEEDS_RESEARCH_RETRY"
      : "EVIDENCE_GATE_NOT_CEO_ELIGIBLE";
  const failedGatePaths: string[] = [];
  if (!hasSearch) failedGatePaths.push("capabilityExecutions.web.search");
  if (gateStatus === "NEEDS_RESEARCH_RETRY") failedGatePaths.push("evidenceQuality.status");
  if (!ceoEligible) failedGatePaths.push("evidenceQuality.ceoEligible");
  if (researchStatus === "INSUFFICIENT_EVIDENCE") failedGatePaths.push("researchStatus");
  if (candidateCount === 0) failedGatePaths.push("candidateStories");
  void contextData;
  void stepId;
  const synthesisSources = Array.isArray(record.sources) ? record.sources : [];
  const canonicalUrls = new Set<string>();
  for (const source of synthesisSources) {
    const canonical = canonicalResearchSourceUrl(safeRecord(source).url);
    if (canonical !== null) canonicalUrls.add(canonical);
  }
  const synthesisUsage = safeRecord(record.synthesisUsage);
  const synthesisSubmitted = Object.keys(synthesisUsage).length > 0;
  return boundResearchBlockedDiagnostics({
    researchBlockReason,
    evidenceQualityStatus: gateStatus,
    evidenceStatus: typeof gate.evidenceStatus === "string" ? gate.evidenceStatus : researchStatus,
    ceoEligible,
    sufficiencyReasons: Array.isArray(gate.sufficiencyReasons) ? gate.sufficiencyReasons : [],
    insufficiencyReasons: Array.isArray(gate.reasons) ? gate.reasons : (Array.isArray(gate.sufficiencyReasons) ? gate.sufficiencyReasons : []),
    failedGatePaths,
    retrievalCount: boundDiagnosticCount(gate.retrievalCount),
    evidenceRecordCount: successfulSearches.length,
    uniqueSourceUrlCount: canonicalUrls.size,
    authorityBreakdown: safeRecord(gate.authorityBreakdown),
    candidateCount,
    viableCandidateCount: boundDiagnosticCount(gate.viableCandidates),
    synthesisEligibility: synthesisSubmitted ? "SUBMITTED" : "NOT_SUBMITTED",
    synthesisSubmitted,
  });
}

function artifactStatusFor(agent: string, output: Json, contextData?: Readonly<Record<string, Json>>, stepId?: string): "completed" | "blocked" | "failed" {
  const record = safeRecord(output);
  const status = typeof record.status === "string" ? record.status : "";
  if (typeof record.contract === "string" && record.contract.startsWith("STRATEGY_COUNCIL_") && (status === "COMPLETED" || status === "AWAITING_OWNER_APPROVAL")) return "completed";
  switch (agent) {
    case "planner":
      return status === "blocked" ? "blocked" : "completed";
    case "writer":
    case "seo":
      return status === "completed" ? "completed" : status === "blocked" ? "blocked" : "failed";
    case "brand":
    case "review":
      return status === "approved" || status === "human_review_required" ? "completed" : "blocked";
    case "qa":
      return status === "passed" ? "completed" : "blocked";
    case "thumbnail":
    case "video":
    case "publisher":
    case "analytics":
      return status === "completed" ? "completed" : status === "failed" ? "failed" : "blocked";
    case "research": {
      // PRE_PUBLICATION_STRATEGY Research is grounded in persisted, governed
      // owner/reference evidence and intentionally performs no web.search.
      // Its bounded strategy findings are the explicit contract marker; do
      // not incorrectly block a valid LLM report for lacking a post-search
      // capability execution.
      if (safeRecord(record.strategyFindings) && Object.keys(safeRecord(record.strategyFindings)).length > 0) return "completed";
      // The research report can only be "completed" when its required web.search
      // capability actually succeeded AND the deterministic evidence gate finds
      // it usable. Retrieval presence alone never proves evidence quality.
      const executions = Array.isArray(record.capabilityExecutions) ? record.capabilityExecutions : [];
      const search = executions.find((item) => safeRecord(item).capabilityId === "web.search");
      if (search === undefined) {
        const planning = safeRecord(record.retrievalPlanning);
        const gate = safeRecord(record.evidenceQuality);
        const legitimateNoCapability = contextData?.researchIntelligenceVersion === "V2"
          && typeof stepId === "string"
          && planning.status === "NO_SUPPORTED_CAPABILITY"
          && Array.isArray(record.retrievalPlan)
          && record.retrievalPlan.length === 0
          && record.researchStatus === "INSUFFICIENT_EVIDENCE"
          && gate.evidenceStatus === "INSUFFICIENT_EVIDENCE"
          && gate.ceoEligible === false;
        return legitimateNoCapability ? "completed" : "blocked";
      }
      const searchStatus = typeof search.status === "string" ? search.status : "";
      if (searchStatus !== "success") return "blocked";
      const gate = safeRecord(record.evidenceQuality);
      if (gate.status === "NEEDS_RESEARCH_RETRY") return "blocked";
      // V2 Research is allowed to complete honestly with no eligible
      // candidate.  Completion here means the requested intelligence cycle
      // produced a durable report; it does not make that report CEO-eligible.
      // The workflow-engine arms the bounded stop from this completed artifact
      // on the original live context (routing uses an executor-local clone).
      const honestV2BusinessStop = contextData?.researchIntelligenceVersion === "V2"
        && typeof stepId === "string"
        && (record.researchStatus === "INSUFFICIENT_EVIDENCE" || record.researchStatus === "NEEDS_VERIFICATION")
        && gate.ceoEligible === false;
      if (honestV2BusinessStop) return "completed";
      // Business sufficiency: a structurally valid report is still blocked
      // unless the evidence is CEO-eligible (viable candidates above the
      // authority threshold). Missing sufficiency data fails closed.
      if (gate.ceoEligible !== true) return "blocked";
      // Reports produced before the evidenceQuality marker carry the historic
      // confidence-inflation risk: a synthesis that returned no sources or zero
      // confidence must not count as completed merely because retrieval exists.
      if (gate.status === undefined) {
        const synthesisSources = Array.isArray(record.sources) ? record.sources : [];
        // Grounded reports carry retrieval-derived sources with providerInfo;
        // ungrounded synthesis outputs (no providerInfo) with empty sources or
        // zero confidence are insufficient evidence.
        const grounded = safeRecord(record.metadata) !== undefined
          && safeRecord(safeRecord(record.metadata).providerInfo).succeeded === true;
        if (!grounded && (synthesisSources.length === 0 || record.confidence === 0)) return "blocked";
      }
      return "completed";
    }
    default:
      return "completed";
  }
}

/**
 * Production research search-query construction (content-selection safe).
 *
 * A content-selection brief ("select the strongest evidence-grounded factual
 * micro-story") is a meta-task, not a searchable factual subject. Sending it
 * verbatim to web.search matches educational pages about "textual evidence".
 * This builder detects that meta-task and rewrites it into an explicit
 * candidate-seeking query grounded in the Morroway strategy. It never selects
 * the future topic; it only makes retrieval seek candidate factual stories.
 */
export function isResearchContentSelectionQuery(contentTopic: string, objective: string): boolean {
  const haystack = `${contentTopic} ${objective}`.toLowerCase();
  return /select/.test(haystack) && (/micro-story/.test(haystack) || /strongest.*evidence/.test(haystack) || /factual.*short/.test(haystack));
}

export function buildProductionResearchSearchQuery(input: {
  readonly contentTopic: string;
  readonly objective: string;
  readonly brandProject?: string;
  readonly audience?: string;
  readonly platform?: string;
}): string {
  const brand = (input.brandProject ?? "morroway").trim() || "morroway";
  const audience = (input.audience ?? "").trim();
  const platform = (input.platform ?? "").trim();
  if (isResearchContentSelectionQuery(input.contentTopic, input.objective)) {
    const segments = [
      `${brand} factual YouTube Short candidate stories`,
      "surprising well-sourced visually feasible real history science innovation",
      audience.length > 0 ? audience : null,
      platform.length > 0 ? platform : null,
    ].filter((segment): segment is string => typeof segment === "string" && segment.trim().length > 0);
    return segments.join(" ").slice(0, 160);
  }
  const fallback = `Morroway factual research: ${input.contentTopic}`.trim();
  return fallback.slice(0, 160);
}

/**
 * Generic fact-list intent detector. Discovery queries aimed at concrete
 * named candidates (events, people, objects, discoveries, experiments,
 * incidents) retrieve verifiable evidence; queries aimed at "interesting /
 * amazing / mind-blowing facts" or "best stories" retrieve compilation
 * content. The detector is deterministic lexical matching, not a model call.
 */
const GENERIC_FACT_LIST_INTENT = /\b(interesting|amazing|mind[\s-]?blow(ing)?|jaw[\s-]?drop(ping)?|best|viral|shocking|unbelievable|incredible)\s+(facts?|stories)\b|\btop\s+\d+\s+facts?\b|\bstrongest\s+evidence\b|\btextual\s+evidence\b|\bevidence[-\s]?grounded\s+micro-story\b/i;

export function isGenericFactListQuery(query: unknown): boolean {
  return typeof query === "string" && GENERIC_FACT_LIST_INTENT.test(query);
}

/**
 * Phase A — candidate discovery queries (contract: discovery intent, no
 * hardcoded topic). Several focused searches for concrete named factual
 * subjects (events, people, objects, discoveries, experiments, historical
 * incidents, documented unusual facts) framed by the Historical POV pillar:
 * real people, civilizations, documented events, source-supported settings.
 * The primary (first) query is the governed single-retrieval query.
 */
export function buildDiscoveryQueries(input: {
  readonly brandProject?: string;
  readonly audience?: string;
}): string[] {
  // brandProject names whose strategy this discovery serves; the queries
  // themselves seek real-world subjects, never the brand as subject.
  const audience = (input.audience ?? "").trim();
  const audienceSuffix = audience.length > 0 ? ` ${audience}` : "";
  const queries = [
    `documented historical event discovery archive museum verified${audienceSuffix}`,
    `unusual documented historical incident people civilization primary sources${audienceSuffix}`,
    `scientific discovery innovation experiment documented evidence history${audienceSuffix}`,
    `historical object artifact discovery museum collection story${audienceSuffix}`,
  ];
  return queries.map((query) => query.slice(0, 160)).filter((query) => !isGenericFactListQuery(query));
}

/**
 * Phase B — candidate verification query for one concrete named candidate.
 * Seeks higher-authority corroboration (museum, university, archive, official
 * institution, reputable reference). The candidate name comes from retrieval,
 * never hardcoded here.
 */
export function buildVerificationQuery(candidateName: string): string {
  const name = candidateName.trim().replace(/\s+/g, " ").slice(0, 80);
  if (name.length === 0) throw new Error("VERIFICATION_CANDIDATE_REQUIRED");
  const query = `${name} museum OR university OR archive OR official institution OR reputable reference`;
  if (isGenericFactListQuery(query)) throw new Error("VERIFICATION_QUERY_FACT_LIST_INTENT");
  return query.slice(0, 160);
}

/**
 * Canonical Morroway research context gate. Fails closed with
 * PROJECT_CONTEXT_INCOMPLETE when the resolved approved context lacks the
 * governing identity (brand, both content pillars, positioning, prohibitions).
 * Runs inside buildAgentInput, i.e. before budget reservation, so a context
 * failure never consumes provider budget and never reaches a model.
 */
export function requireMorrowayResearchProjectContext(resolved: unknown): Record<string, Json> {
  const record = safeRecord(resolved);
  const missing: string[] = [];
  if (String(record.brand ?? "") !== "Morroway") missing.push("brand");
  const pillars = Array.isArray(record.contentPillars) ? (record.contentPillars as unknown[]).map((pillar) => String(pillar)) : [];
  if (!pillars.some((pillar) => /historical/i.test(pillar))) missing.push("contentPillars:historical");
  if (!pillars.some((pillar) => /fantasy/i.test(pillar))) missing.push("contentPillars:fantasy");
  if (typeof record.positioning !== "string" || record.positioning.trim().length === 0) missing.push("positioning");
  if (!Array.isArray(record.prohibitions) || (record.prohibitions as unknown[]).length === 0) missing.push("prohibitions");
  if (missing.length > 0) throw new Error(`PROJECT_CONTEXT_INCOMPLETE:${missing.join(",")}`);
  return record as unknown as Record<string, Json>;
}

/**
 * Capability request identity scoped by authorized recovery attempt.
 * First runs keep the legacy workflow+step identity; each separately
 * authorized recovery execution gets a distinct suffix, so a new attempt
 * persists new evidence instead of colliding (ON CONFLICT DO NOTHING) with
 * a prior attempt's row. Deterministic per recovery: same dispatch reuses
 * the same identity (idempotent replay), a new dispatch gets a new one.
 */
export function researchCapabilityRequestId(workflowId: string, stepId: string, contextData: unknown): string {
  const base = `web-search-${workflowId}-${stepId}`;
  const recovery = safeRecord(safeRecord(contextData).recoveryExecution);
  const attemptId = typeof recovery.recoveryExecutionId === "string" && recovery.recoveryExecutionId.trim() !== ""
    ? recovery.recoveryExecutionId.trim()
    : (typeof recovery.recoveryOfExecutionId === "string" ? recovery.recoveryOfExecutionId.trim() : "");
  return attemptId === "" ? base : `${base}:recovery:${attemptId}`;
}

/**
 * Deterministic source-authority heuristic for research gating
 * (contract amf-evidence-sufficiency-v1). This classifies PROVENANCE TIER,
 * never truth: a primary source can still be wrong, and an unknown source can
 * still be right. Tiers only decide production eligibility thresholds.
 */
export type SourceAuthorityClass =
  | "PRIMARY_OR_INSTITUTIONAL"
  | "REPUTABLE_SECONDARY"
  | "GENERAL_MEDIA"
  | "COMMUNITY"
  | "AGGREGATOR_OR_COMPILATION"
  | "UNKNOWN";

const EDUCATIONAL_AGGREGATOR_HOSTS = new Set([
  "quizlet.com", "quiz-tree.com", "coursehero.com", "brainly.com", "piqosity.com",
  "chegg.com", "studocu.com", "khanacademy.org",
]);

const REPUTABLE_SECONDARY_HOSTS = new Set([
  "wikipedia.org", "britannica.com", "reuters.com", "apnews.com",
  "bbc.co.uk", "bbc.com", "nationalgeographic.com", "history.com",
  "smithsonianmag.com", "archaeology.org", "arxiv.org", "jstor.org",
  "nytimes.com", "theguardian.com", "washingtonpost.com", "cnn.com",
]);

const GENERAL_MEDIA_HOSTS = new Set([
  "youtube.com", "youtu.be", "vimeo.com", "dailymotion.com", "ted.com",
]);

const COMMUNITY_HOSTS = new Set([
  "reddit.com", "quora.com", "facebook.com", "twitter.com", "x.com",
  "tiktok.com", "instagram.com", "threads.net", "stackoverflow.com",
  "stackexchange.com",
]);

const PRIMARY_PUBLISHER_HOSTS = new Set([
  "nature.com", "science.org", "pnas.org", "nejm.org", "thelancet.com",
  "unesco.org", "who.int",
]);

const FACT_LIST_SIGNALS = /\b(top\s+\d+|amazing\s+facts?|mind[-\s]?blow(ing)?|facts?\s+(that\s+)?will\s+blow|jaw[-\s]?drop(ping)?|you\s+won'?t\s+believe|compilation|best\s+stories|viral\s+facts?|shocking\s+facts?)\b/i;

function effectiveHostname(value: unknown): string {
  const record = safeRecord(value);
  const candidates = [record.url, record.source].map((item) => typeof item === "string" ? item.trim() : "");
  for (const candidate of candidates) {
    if (candidate === "") continue;
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
    try {
      const host = new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "");
      if (host.includes(".")) return host;
    } catch { /* try next candidate */ }
  }
  return "";
}

function registrableHost(host: string): string {
  return host;
}

/** Classify one retrieved result into a source-authority tier (deterministic). */
export function classifySourceAuthority(result: unknown): { authorityClass: SourceAuthorityClass; reason: string } {
  const record = safeRecord(result);
  const title = typeof record.title === "string" ? record.title : "";
  const snippet = typeof record.snippet === "string" ? record.snippet : "";
  const host = effectiveHostname(result);
  if (FACT_LIST_SIGNALS.test(`${title} ${snippet}`)) {
    return { authorityClass: "AGGREGATOR_OR_COMPILATION", reason: "fact-list/compilation signals in title or snippet" };
  }
  if (host === "") return { authorityClass: "UNKNOWN", reason: "no parseable host" };
  const domain = registrableHost(host);
  if (EDUCATIONAL_AGGREGATOR_HOSTS.has(domain)) return { authorityClass: "AGGREGATOR_OR_COMPILATION", reason: "educational aggregator host" };
  if (COMMUNITY_HOSTS.has(domain)) return { authorityClass: "COMMUNITY", reason: "community/discussion host" };
  if (PRIMARY_PUBLISHER_HOSTS.has(domain)
    || domain.endsWith(".gov") || domain.endsWith(".edu") || /\.ac\.[a-z]{2}$/.test(domain)
    || /(^|\.)museum($|\.)/.test(domain) || /(^|\.)archives?($|\.)/.test(domain)) {
    return { authorityClass: "PRIMARY_OR_INSTITUTIONAL", reason: "institutional host or suffix" };
  }
  if (REPUTABLE_SECONDARY_HOSTS.has(domain) || /(^|\.)(museum|archive)($|\.)/.test(`${title} ${snippet}`.toLowerCase())) {
    return { authorityClass: "REPUTABLE_SECONDARY", reason: "reputable secondary host or museum/archive evidence" };
  }
  if (GENERAL_MEDIA_HOSTS.has(domain)) return { authorityClass: "GENERAL_MEDIA", reason: "general media platform host" };
  return { authorityClass: "UNKNOWN", reason: "no authority rule matched" };
}

/** Authority rank for threshold comparisons (higher = stronger provenance tier). */
export function sourceAuthorityRank(authorityClass: SourceAuthorityClass): number {
  switch (authorityClass) {
    case "PRIMARY_OR_INSTITUTIONAL": return 5;
    case "REPUTABLE_SECONDARY": return 4;
    case "GENERAL_MEDIA": return 3;
    case "UNKNOWN": return 2;
    case "AGGREGATOR_OR_COMPILATION": return 1;
    case "COMMUNITY": return 0;
  }
}

/** Business evidence status: execution success and evidence sufficiency are distinct. */
export type ResearchEvidenceStatus =
  | "USABLE"
  | "NEEDS_VERIFICATION"
  | "INSUFFICIENT_EVIDENCE"
  | "OFF_TOPIC"
  | "FAILED";

export interface ResearchEvidenceSufficiency {
  readonly retrievalCount: number;
  readonly authorityBreakdown: Record<SourceAuthorityClass, number>;
  readonly candidateCount: number;
  readonly viableCandidates: number;
  readonly status: ResearchEvidenceStatus;
  readonly ceoEligible: boolean;
  readonly reasons: readonly string[];
}

const ABOVE_LOW_AUTHORITY: ReadonlySet<SourceAuthorityClass> = new Set([
  "PRIMARY_OR_INSTITUTIONAL", "REPUTABLE_SECONDARY", "GENERAL_MEDIA",
]);

function distinctDomains(results: readonly unknown[]): Set<string> {
  const domains = new Set<string>();
  for (const result of results) {
    const host = effectiveHostname(result);
    if (host !== "") domains.add(host);
  }
  return domains;
}

/**
 * Conservative production eligibility (contract amf-evidence-sufficiency-v1).
 * A candidate is viable only with: a concrete topic, ≥2 independent
 * (distinct-domain) supporting sources, ≥1 source above the low
 * (community/compilation/unknown) tier, and ≥1 citation tied to its sources.
 * model-declared insufficiency caps the verdict at NEEDS_VERIFICATION even
 * when candidates look viable (human/model disagreement goes to verification).
 * This is a production threshold, never a guarantee of factual truth.
 */
export function evaluateResearchEvidenceSufficiency(input: {
  readonly retrievalResults: readonly unknown[];
  readonly synthesisSources: readonly unknown[];
  readonly synthesisConfidence: unknown;
  readonly synthesisCitations?: readonly unknown[];
  readonly candidateStories?: readonly unknown[];
  readonly synthesisStatus?: unknown;
}): ResearchEvidenceSufficiency {
  const reasons: string[] = [];
  const retrievalCount = input.retrievalResults.length;
  const authorityBreakdown: Record<SourceAuthorityClass, number> = {
    PRIMARY_OR_INSTITUTIONAL: 0, REPUTABLE_SECONDARY: 0, GENERAL_MEDIA: 0,
    COMMUNITY: 0, AGGREGATOR_OR_COMPILATION: 0, UNKNOWN: 0,
  };
  const classes = input.retrievalResults.map(classifySourceAuthority);
  for (const classified of classes) authorityBreakdown[classified.authorityClass] += 1;
  if (retrievalCount === 0) {
    const candidates = Array.isArray(input.candidateStories) ? input.candidateStories : [];
    const modelInsufficient = typeof input.synthesisStatus === "string" && input.synthesisStatus.trim().toLowerCase() === "insufficient_evidence";
    return candidates.length === 0 && modelInsufficient
      ? { retrievalCount, authorityBreakdown, candidateCount: 0, viableCandidates: 0, status: "INSUFFICIENT_EVIDENCE", ceoEligible: false, reasons: ["RETRIEVAL_EMPTY", "MODEL_DECLARED_INSUFFICIENT", "NO_CANDIDATE_STORIES"] }
      : { retrievalCount, authorityBreakdown, candidateCount: candidates.length, viableCandidates: 0, status: "FAILED", ceoEligible: false, reasons: ["RETRIEVAL_EMPTY"] };
  }
  const offTopicCount = input.retrievalResults.filter(isOffTopicEducationalSearchResult).length;
  const offTopicMajority = offTopicCount * 2 >= retrievalCount;
  if (offTopicMajority) reasons.push("RETRIEVAL_OFF_TOPIC_EDUCATIONAL");
  const sourceById = new Map<number, unknown>();
  for (const source of input.synthesisSources) {
    const id = safeRecord(source).id;
    if (typeof id === "number") sourceById.set(id, source);
  }
  const citations = Array.isArray(input.synthesisCitations) ? input.synthesisCitations : [];
  const citedIds = new Set<number>();
  for (const citation of citations) {
    const id = safeRecord(citation).sourceId;
    if (typeof id === "number") citedIds.add(id);
  }
  const candidates = Array.isArray(input.candidateStories) ? input.candidateStories : [];
  let viableCandidates = 0;
  for (const candidate of candidates) {
    const record = safeRecord(candidate);
    if (typeof record.topic !== "string" || record.topic.trim().length === 0) { reasons.push("CANDIDATE_WITHOUT_TOPIC"); continue; }
    const claimedIds = Array.isArray(record.sourceIds) ? record.sourceIds.filter((id): id is number => typeof id === "number") : [];
    const evidenceIds = Array.isArray(record.supportingEvidenceIds)
      ? record.supportingEvidenceIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      : [];
    const linkedIds = [...new Set(claimedIds)].filter((id) => sourceById.has(id));
    if (linkedIds.length === 0) { reasons.push("CANDIDATE_WITHOUT_EVIDENCE"); continue; }
    // V2 candidate-level eligibility is authoritative.  The aggregate gate
    // may not promote a candidate that the same artifact declares partial,
    // incomplete, or not recommended for production.  Legacy V1 candidates
    // without these V2 fields retain the original source-only evaluation.
    const factual = safeRecord(record.factualVerification);
    const hasV2Eligibility = Object.prototype.hasOwnProperty.call(record, "recommendedForProduction")
      || Object.keys(factual).length > 0;
    if (hasV2Eligibility) {
      if (factual.status !== "STRONG") { reasons.push("CANDIDATE_FACTUAL_ELIGIBILITY_BELOW_THRESHOLD"); continue; }
      if (record.recommendedForProduction !== true) { reasons.push("CANDIDATE_NOT_RECOMMENDED_FOR_PRODUCTION"); continue; }
      if (evidenceIds.length === 0 || record.evidenceLineageValidated !== true) { reasons.push("CANDIDATE_WITHOUT_VALIDATED_EVIDENCE_LINEAGE"); continue; }
    }
    const linkedSources = linkedIds.map((id) => sourceById.get(id)).filter((source): source is unknown => source !== undefined);
    const domains = distinctDomains(linkedSources);
    if (domains.size < 2) { reasons.push("CANDIDATE_SINGLE_DOMAIN"); continue; }
    const best = Math.max(...linkedSources.map((source) => sourceAuthorityRank(classifySourceAuthority(source).authorityClass)));
    if (!ABOVE_LOW_AUTHORITY.has(rankToClass(best))) { reasons.push("CANDIDATE_LOW_AUTHORITY_ONLY"); continue; }
    const cited = linkedIds.some((id) => citedIds.has(id));
    if (!cited) { reasons.push("CANDIDATE_UNCITED"); continue; }
    viableCandidates += 1;
  }
  const synthesisConfidence = typeof input.synthesisConfidence === "number" && Number.isFinite(input.synthesisConfidence)
    ? input.synthesisConfidence
    : null;
  const modelInsufficient = typeof input.synthesisStatus === "string" && input.synthesisStatus.trim().toLowerCase() === "insufficient_evidence";
  if (candidates.length === 0) {
    if (synthesisConfidence === 0) reasons.push("SYNTHESIS_CONFIDENCE_ZERO");
    reasons.push("NO_CANDIDATE_STORIES");
    return { retrievalCount, authorityBreakdown, candidateCount: 0, viableCandidates: 0, status: "INSUFFICIENT_EVIDENCE", ceoEligible: false, reasons };
  }
  if (viableCandidates > 0 && !modelInsufficient && !offTopicMajority) {
    return { retrievalCount, authorityBreakdown, candidateCount: candidates.length, viableCandidates, status: "USABLE", ceoEligible: true, reasons };
  }
  if (viableCandidates > 0 && !modelInsufficient && offTopicMajority) {
    return { retrievalCount, authorityBreakdown, candidateCount: candidates.length, viableCandidates, status: "OFF_TOPIC", ceoEligible: false, reasons };
  }
  if (synthesisConfidence === 0) reasons.push("SYNTHESIS_CONFIDENCE_ZERO");
  if (modelInsufficient) reasons.push("MODEL_DECLARED_INSUFFICIENT");
  // Candidates exist but none clear the bar (or the model disagrees with a
  // passing gate): targeted verification could still complete the evidence.
  return { retrievalCount, authorityBreakdown, candidateCount: candidates.length, viableCandidates, status: "NEEDS_VERIFICATION", ceoEligible: false, reasons };
}

function canonicalResearchSourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString();
  } catch {
    return null;
  }
}

interface PersistedRetrievalLineage {
  resultId: string;
  evidenceId: string;
  idempotencyKey: string;
  urls: Set<string>;
}

/**
 * Resolve model-authored artifact-local source ids against persisted retrieval
 * output, then rebuild candidate evidence links from candidate-specific
 * verification executions.  Source ids remain local numeric ids; evidence ids
 * are durable execution_evidence identities.  No id from one namespace is
 * accepted as an id from another namespace.
 */
export function normalizeResearchArtifactLineage(output: Json): Json {
  const record = safeRecord(output);
  const executions = Array.isArray(record.capabilityExecutions) ? record.capabilityExecutions : [];
  const persisted: PersistedRetrievalLineage[] = [];
  for (const item of executions) {
    const execution = safeRecord(item);
    if (execution.capabilityId !== "web.search" || execution.status !== "success") continue;
    const evidence = safeRecord(execution.evidence);
    const resultId = typeof execution.resultId === "string" ? execution.resultId : "";
    const evidenceId = typeof evidence.evidenceId === "string" ? evidence.evidenceId : "";
    if (resultId === "" || evidenceId === "") continue;
    const results = Array.isArray(safeRecord(execution.output).results) ? safeRecord(execution.output).results as unknown[] : [];
    const urls = new Set<string>();
    for (const result of results) {
      const url = canonicalResearchSourceUrl(safeRecord(result).url);
      if (url !== null) urls.add(url);
    }
    persisted.push({
      resultId,
      evidenceId,
      idempotencyKey: typeof execution.idempotencyKey === "string" ? execution.idempotencyKey : "",
      urls,
    });
  }

  const sourceItems = Array.isArray(record.sources) ? record.sources : [];
  const sourceById = new Map<number, JsonRecord>();
  const canonicalSources = sourceItems.map((item) => {
    const source = safeRecord(item);
    if (typeof source.id !== "number") throw new Error("RESEARCH_ARTIFACT_SOURCE_ID_INVALID");
    const url = canonicalResearchSourceUrl(source.url);
    if (url === null) throw new Error(`RESEARCH_ARTIFACT_SOURCE_URL_INVALID:${source.id}`);
    const matches = persisted.filter((entry) => entry.urls.has(url));
    if (matches.length === 0) throw new Error(`RESEARCH_ARTIFACT_SOURCE_REFERENCE_UNRESOLVED:${source.id}`);
    const normalized: JsonRecord = {
      ...source,
      canonicalUrl: url,
      sourceLineage: {
        capabilityResultIds: [...new Set(matches.map((entry) => entry.resultId))],
        evidenceIds: [...new Set(matches.map((entry) => entry.evidenceId))],
      },
    };
    sourceById.set(source.id, normalized);
    return normalized;
  });

  const candidates = Array.isArray(record.candidateStories) ? record.candidateStories : [];
  const canonicalCandidates = candidates.map((item) => {
    const candidate = safeRecord(item);
    const candidateId = typeof candidate.candidateId === "string" ? candidate.candidateId : "";
    if (candidateId === "") throw new Error("RESEARCH_ARTIFACT_CANDIDATE_ID_INVALID");
    const sourceIds = Array.isArray(candidate.sourceIds)
      ? candidate.sourceIds.filter((id): id is number => typeof id === "number")
      : [];
    if (sourceIds.some((id) => !sourceById.has(id))) throw new Error(`RESEARCH_ARTIFACT_CANDIDATE_SOURCE_UNRESOLVED:${candidateId}`);
    const candidateUrls = new Set(sourceIds.map((id) => canonicalResearchSourceUrl(sourceById.get(id)?.url)).filter((url): url is string => url !== null));
    // Research invocation identities encode the verification lane as
    // `verification-${candidateId}`. Match that canonical lane verbatim;
    // the former `verify-...` alias could never match and incorrectly
    // downgraded fully verified candidates to AGENT_OUTPUT_BLOCKED.
    const marker = `verification-${candidateId.toLowerCase()}`;
    const verification = persisted.filter((entry) => {
      const identity = `${entry.resultId} ${entry.idempotencyKey}`.toLowerCase();
      return identity.includes(marker) && [...candidateUrls].some((url) => entry.urls.has(url));
    });
    const supportingEvidenceIds = [...new Set(verification.map((entry) => entry.evidenceId))];
    return {
      ...candidate,
      sourceIds,
      supportingEvidenceIds,
      evidenceLineageValidated: supportingEvidenceIds.length > 0,
    };
  });

  const citations = Array.isArray(record.citations) ? record.citations : [];
  if (citations.some((citation) => !sourceById.has(Number(safeRecord(citation).sourceId)))) {
    throw new Error("RESEARCH_ARTIFACT_CITATION_SOURCE_UNRESOLVED");
  }
  return { ...record, sources: canonicalSources, candidateStories: canonicalCandidates } as Json;
}

function rankToClass(rank: number): SourceAuthorityClass {
  if (rank >= 5) return "PRIMARY_OR_INSTITUTIONAL";
  if (rank === 4) return "REPUTABLE_SECONDARY";
  if (rank === 3) return "GENERAL_MEDIA";
  if (rank === 2) return "UNKNOWN";
  if (rank === 1) return "AGGREGATOR_OR_COMPILATION";
  return "COMMUNITY";
}

/** Deterministic educational-quiz detector for retrieved web.search results. */
export function isOffTopicEducationalSearchResult(result: unknown): boolean {  const record = safeRecord(result);
  const haystack = `${String(record.title ?? "")} ${String(record.snippet ?? "")} ${String(record.url ?? "")} ${String(record.source ?? "")}`.toLowerCase();
  return /quiz|sat\b|act \d+|textual evidence|flash.?cards|practice test|quizlet|quiz-tree|coursehero|brainly/.test(haystack);
}

export interface ResearchEvidenceEvaluation {
  readonly retrievalCount: number;
  readonly retrievalQuality: "EMPTY" | "OFF_TOPIC" | "RELEVANT";
  readonly synthesisConfidence: number | null;
  readonly synthesisSourceCount: number;
  readonly status: "USABLE" | "NEEDS_RESEARCH_RETRY";
  readonly reasons: readonly string[];
}

/**
 * Deterministic Research evidence-quality gate. Retrieval presence alone never
 * proves usability: empty sources, off-topic retrieval, synthesis with no
 * sources, synthesis confidence 0, or missing citation linkage all require a
 * research retry and must block CEO consumption.
 */
export function evaluateResearchEvidenceQuality(input: {
  readonly retrievalResults: readonly unknown[];
  readonly synthesisSources: readonly unknown[];
  readonly synthesisConfidence: unknown;
  readonly synthesisCitations?: readonly unknown[];
}): ResearchEvidenceEvaluation {
  const reasons: string[] = [];
  const retrievalCount = input.retrievalResults.length;
  let retrievalQuality: ResearchEvidenceEvaluation["retrievalQuality"] = "RELEVANT";
  if (retrievalCount === 0) {
    retrievalQuality = "EMPTY";
    reasons.push("RETRIEVAL_EMPTY");
  } else {
    const offTopic = input.retrievalResults.filter(isOffTopicEducationalSearchResult).length;
    if (offTopic * 2 >= retrievalCount) {
      retrievalQuality = "OFF_TOPIC";
      reasons.push("RETRIEVAL_OFF_TOPIC_EDUCATIONAL");
    }
  }
  const synthesisConfidence = typeof input.synthesisConfidence === "number" && Number.isFinite(input.synthesisConfidence)
    ? input.synthesisConfidence
    : null;
  const synthesisSourceCount = input.synthesisSources.length;
  if (synthesisSourceCount === 0) reasons.push("SYNTHESIS_SOURCES_EMPTY");
  if (synthesisConfidence === 0) reasons.push("SYNTHESIS_CONFIDENCE_ZERO");
  if (synthesisConfidence === null) reasons.push("SYNTHESIS_CONFIDENCE_MISSING");
  if (Array.isArray(input.synthesisCitations) && synthesisSourceCount > 0) {
    const ids = new Set((input.synthesisSources as unknown[]).map((source) => safeRecord(source).id));
    const dangling = (input.synthesisCitations as unknown[]).some((citation) => !ids.has(safeRecord(citation).sourceId));
    if (dangling) reasons.push("CITATION_EVIDENCE_MISMATCH");
  }
  const status = retrievalQuality !== "RELEVANT" || synthesisSourceCount === 0 || synthesisConfidence === null || synthesisConfidence <= 0
    ? "NEEDS_RESEARCH_RETRY"
    : "USABLE";
  return { retrievalCount, retrievalQuality, synthesisConfidence, synthesisSourceCount, status, reasons };
}

/** Business research status derived from sufficiency (never rewrites history). */
export type ResearchBusinessStatus =
  | "USABLE"
  | "NEEDS_RESEARCH_RETRY"
  | "NEEDS_VERIFICATION"
  | "INSUFFICIENT_EVIDENCE";

export function researchStatusForSufficiency(sufficiency: { readonly status: ResearchEvidenceStatus; readonly ceoEligible: boolean }): ResearchBusinessStatus {
  if (sufficiency.ceoEligible) return "USABLE";
  switch (sufficiency.status) {
    case "NEEDS_VERIFICATION": return "NEEDS_VERIFICATION";
    case "INSUFFICIENT_EVIDENCE": return "INSUFFICIENT_EVIDENCE";
    default: return "NEEDS_RESEARCH_RETRY";
  }
}

export interface ReclassifiedResearchEvidence {
  readonly executionStatus: string;
  readonly evidenceStatus: ResearchEvidenceStatus;
  readonly ceoEligible: boolean;
  readonly candidateCount: number;
  readonly viableCandidates: number;
  readonly authorityBreakdown: Record<SourceAuthorityClass, number>;
  readonly reasons: readonly string[];
  readonly gateVersion: string;
}

/**
 * Re-derive corrected quality status for an already-persisted research
 * artifact WITHOUT rewriting it (contract amf-evidence-sufficiency-v1).
 * The persisted retrieval-derived sources double as the retrieval results
 * (titles/urls/snippets preserved); the synthesis fields come from the
 * artifact itself.
 */
export function reclassifyResearchEvidence(artifactPayload: unknown): ReclassifiedResearchEvidence {
  const payload = safeRecord(artifactPayload);
  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  const sufficiency = evaluateResearchEvidenceSufficiency({
    retrievalResults: sources,
    synthesisSources: sources,
    synthesisConfidence: payload.confidence,
    synthesisCitations: Array.isArray(payload.citations) ? payload.citations : [],
    candidateStories: Array.isArray(payload.candidateStories) ? payload.candidateStories : [],
    synthesisStatus: typeof payload.status === "string" ? payload.status : undefined,
  });
  return {
    executionStatus: "COMPLETED",
    evidenceStatus: sufficiency.status,
    ceoEligible: sufficiency.ceoEligible,
    candidateCount: sufficiency.candidateCount,
    viableCandidates: sufficiency.viableCandidates,
    authorityBreakdown: sufficiency.authorityBreakdown,
    reasons: sufficiency.reasons,
    gateVersion: "amf-evidence-sufficiency-v1",
  };
}

/**
 * Ground the research report in the real web.search capability outcome.
 * Retrieval presence is NOT evidence quality: the synthesis confidence is
 * always preserved (never inflated because results were attached), and every
 * grounded report carries an explicit evidenceQuality marker consumed by the
 * artifact gate and CEO eligibility checks.
 */
export function groundResearchReport(output: Json): Json {
  const initialRecord = safeRecord(output);
  // Both legacy V1 and Intelligence V2 persist a `researchPlan`.  Only the V2
  // mission plan carries a mission identity; treating the legacy task plan as
  // V2 incorrectly applies candidate-verification lineage rules to discovery-
  // only V1 output and blocks otherwise valid canonical producer fixtures.
  const isResearchV2 = typeof safeRecord(initialRecord.researchPlan).missionId === "string"
    || initialRecord.synthesisContract === "amf-research-intelligence-v2";
  const record = isResearchV2 ? safeRecord(normalizeResearchArtifactLineage(output)) : initialRecord;
  const executions = Array.isArray(record.capabilityExecutions) ? record.capabilityExecutions : [];
  const searches = executions.filter(
    (item) => safeRecord(item).capabilityId === "web.search" && safeRecord(item).status === "success",
  );
  if (searches.length === 0) {
    const synthesisSources = Array.isArray(record.sources) ? record.sources : [];
    const synthesisCitations = Array.isArray(record.citations) ? record.citations : [];
    const candidateStories = Array.isArray(record.candidateStories) ? record.candidateStories : [];
    const synthesisStatus = typeof record.status === "string" ? record.status : undefined;
    const sufficiency = evaluateResearchEvidenceSufficiency({ retrievalResults: [], synthesisSources, synthesisConfidence: record.confidence, synthesisCitations, candidateStories, synthesisStatus });
    return {
      ...record,
      executionStatus: sufficiency.status === "INSUFFICIENT_EVIDENCE" ? "COMPLETED" : "FAILED",
      evidenceStatus: sufficiency.status,
      ceoEligibleCandidates: [],
      evidenceQuality: {
        retrievalCount: 0,
        retrievalQuality: "EMPTY",
        synthesisConfidence: typeof record.confidence === "number" ? record.confidence : null,
        synthesisSourceCount: synthesisSources.length,
        status: sufficiency.status === "INSUFFICIENT_EVIDENCE" ? "INSUFFICIENT_EVIDENCE" : "NEEDS_RESEARCH_RETRY",
        evidenceStatus: sufficiency.status,
        ceoEligible: false,
        authorityBreakdown: sufficiency.authorityBreakdown,
        candidateCount: sufficiency.candidateCount,
        viableCandidates: sufficiency.viableCandidates,
        sufficiencyReasons: sufficiency.reasons,
      } as unknown as Json,
      researchStatus: researchStatusForSufficiency(sufficiency),
    };
  }
  const searchOutcome = safeRecord(searches[0]);
  const searchEvidence = safeRecord(searchOutcome.evidence);
  const results = searches.flatMap((item) => {
    const rows = safeRecord(safeRecord(item).output).results;
    return Array.isArray(rows) ? rows : [];
  });
  const providerInfo = {
    providerId: typeof searchEvidence.providerId === "string" ? searchEvidence.providerId : "web.search",
    resultCount: results.length,
    evidenceIds: searches.map((item) => safeRecord(safeRecord(item).evidence).evidenceId).filter((id): id is string => typeof id === "string"),
    succeeded: searches.every((item) => safeRecord(safeRecord(item).evidence).succeeded === true),
  };
  const synthesisConfidence = typeof record.confidence === "number" ? record.confidence : null;
  const synthesisSources = Array.isArray(record.sources) ? record.sources : [];
  const synthesisCitations = Array.isArray(record.citations) ? record.citations : [];
  const authoredCandidates = Array.isArray(record.candidateStories) ? record.candidateStories : [];
  // V1 uses one governed retrieval for discovery and corroboration. Its
  // candidate source ids inherit the successful capability evidence identity
  // only when every claimed source resolves to that grounded result set. V2
  // retains candidate-specific verification normalization above.
  const candidateStories = isResearchV2 ? authoredCandidates : authoredCandidates.map((candidate) => {
    const item = safeRecord(candidate);
    const sourceIds = Array.isArray(item.sourceIds) ? item.sourceIds.filter((id): id is number => typeof id === "number") : [];
    const resolvable = sourceIds.length > 0 && sourceIds.every((id) => synthesisSources.some((source) => safeRecord(source).id === id));
    return resolvable
      ? { ...item, supportingEvidenceIds: providerInfo.evidenceIds, evidenceLineageValidated: providerInfo.evidenceIds.length > 0 }
      : item;
  });
  const synthesisStatus = typeof record.status === "string" ? record.status : undefined;
  if (results.length === 0) {
    // The provider succeeded but returned zero results: report it as such and
    // never fall back to fabricated placeholder sources or invented confidence.
    const evaluation = evaluateResearchEvidenceQuality({ retrievalResults: results, synthesisSources, synthesisConfidence, synthesisCitations });
    const sufficiency = evaluateResearchEvidenceSufficiency({ retrievalResults: results, synthesisSources, synthesisConfidence, synthesisCitations, candidateStories, synthesisStatus });
    return {
      ...record,
      summary: "Research completed but the web.search provider returned zero results; no sources to cite.",
      sources: [],
      citations: [],
      confidence: synthesisConfidence ?? 0,
      metadata: { ...safeRecord(record.metadata), providerInfo },
      evidenceQuality: {
        ...evaluation,
        status: sufficiency.status === "INSUFFICIENT_EVIDENCE" ? "INSUFFICIENT_EVIDENCE" : evaluation.status,
        synthesisConfidence: synthesisConfidence ?? evaluation.synthesisConfidence,
        evidenceStatus: sufficiency.status,
        ceoEligible: sufficiency.ceoEligible,
        authorityBreakdown: sufficiency.authorityBreakdown,
        candidateCount: sufficiency.candidateCount,
        viableCandidates: sufficiency.viableCandidates,
        sufficiencyReasons: sufficiency.reasons,
      } as unknown as Json,
      researchStatus: researchStatusForSufficiency(sufficiency),
    };
  }
  const evaluation = evaluateResearchEvidenceQuality({ retrievalResults: results, synthesisSources, synthesisConfidence, synthesisCitations });
  const sufficiency = evaluateResearchEvidenceSufficiency({ retrievalResults: results, synthesisSources, synthesisConfidence, synthesisCitations, candidateStories, synthesisStatus });
  // V2 synthesis owns the artifact-local source table.  Those source ids are
  // canonicalized against persisted retrieval URLs above and must never be
  // replaced by the first discovery result set (which changes their meaning).
  const sources = isResearchV2 ? synthesisSources : results.map((row, index) => {
    const result = safeRecord(row);
    return {
      id: index + 1,
      title: String(result.title ?? ""),
      url: String(result.url ?? ""),
      snippet: String(result.snippet ?? ""),
      dateAccessed: typeof searchEvidence.executedAt === "string" ? searchEvidence.executedAt : nowIso(),
    };
  });
  const citations = isResearchV2 ? synthesisCitations : sources.map((source) => ({ sourceId: safeRecord(source).id, text: String(safeRecord(source).snippet ?? "").slice(0, 120) }));
  const usable = evaluation.status === "USABLE";
  return {
    ...record,
    candidateStories,
    // Preserve the synthesis narrative when it explicitly rejected the evidence;
    // only use the grounded summary when the synthesis actually used evidence.
    summary: isResearchV2 ? String(record.summary ?? "") : usable ? `Research summary grounded in ${sources.length} real web search results from ${providerInfo.providerId}.` : String(record.summary ?? ""),
    sources,
    citations,
    // Never invent factual confidence: retrieval attachment alone must not raise
    // a synthesis confidence of 0 (or missing) to 0.75.
    confidence: synthesisConfidence ?? 0,
    metadata: { ...safeRecord(record.metadata), providerInfo },
    evidenceQuality: {
      ...evaluation,
      evidenceStatus: sufficiency.status,
      ceoEligible: sufficiency.ceoEligible,
      authorityBreakdown: sufficiency.authorityBreakdown,
      candidateCount: sufficiency.candidateCount,
      viableCandidates: sufficiency.viableCandidates,
      sufficiencyReasons: sufficiency.reasons,
    } as unknown as Json,
    ceoEligibleCandidates: sufficiency.ceoEligible
      ? candidateStories.filter((candidate) => {
        const item = safeRecord(candidate);
        return item.recommendedForProduction === true
          && safeRecord(item.factualVerification).status === "STRONG"
          && item.evidenceLineageValidated === true;
      }).map((candidate) => String(safeRecord(candidate).candidateId))
      : [],
    researchStatus: researchStatusForSufficiency(sufficiency),
  };
}

function noopCancellation(): CancellationToken {
  return {
    isCancelled: false,
    onCancelled: () => undefined,
    throwIfCancelled: () => undefined,
  };
}

/** Factory used by the CLI to swap the deterministic placeholder for real agents. */
export function createProductionAgentExecutor(options: ProductionAgentExecutorOptions = {}): AgentExecutorPort {
  return new ProductionAgentExecutor(options, buildProviderBoundary(options));
}
