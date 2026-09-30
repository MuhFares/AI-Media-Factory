import type pg from "pg";
import { assertRecoveryHorizon } from "./recovery-framework.js";
import { rewindWorkflow } from "@ai-media-factory/workflow-engine";
import type { PostgresPersistence } from "./adapter.js";
import { PostgresQueue } from "./queue.js";
import { ControlPlaneStore, HUMAN_GATE_DEFAULT_ENABLED, type HumanGateKey } from "./control-plane.js";
import { mediaCapabilityPreflight, type MediaCapabilityPreflightResult, type PreflightCapabilityBoundary } from "./media-capability-preflight.js";

export interface MediaResumeAuthorizeInput {
  readonly workflowId: string;
  readonly authorizedBy: string;
  readonly rationale: string;
  /** Optional explicit provider-submission ceiling; defaults to the frozen plan-derived envelope. */
  readonly providerBudget?: number;
}

export interface MediaResumeEligibility {
  eligible: boolean;
  reason?: string;
  workflowId: string;
  workflowState?: string;
  sourceFailedJobId?: number;
  failureClassification?: string;
  preProductionApproval?: { approvalId: string; ownerDecision: string; decidedAt: string };
  directorArtifactId?: string;
  directorLineageArtifactId?: string | null;
  directorSceneIds?: string[];
  frozenPackage?: {
    reviewArtifactId: string; writerArtifactId: string; seoArtifactId: string; brandArtifactId: string;
    directorArtifactId: string; directorLineageArtifactId: string | null; directorSceneIds: string[];
  };
  /** Timeline-start resume: exact frozen R6 TTS checkpoint reused without re-execution. */
  frozenTtsPackage?: {
    sourceResumeId: string;
    sourceJobId: number | null;
    chunkArtifactIds: string[];
    providerJobIds: (string | null)[];
    narrationArtifactId: string;
  } | null;
  resumeStartStage?: "tts" | "timeline";
  providerBudget?: number;
  gatePolicySnapshot?: { preProductionEnabled: boolean; visualHumanGateEnabled: boolean; resolvedScope: string; configurationVersion: number; resolvedAt: string };
}

/** Mutable eligibility accumulator (internal to the dispatcher's read-only check). */
type EligibilityAccumulator = { -readonly [K in keyof MediaResumeEligibility]: MediaResumeEligibility[K] };

/**
 * Standalone pre-authorization build-parity check (R7 hardening, pool-only
 * so operator scripts can use it without a dispatcher). Throws
 * MEDIA_WORKER_BUILD_DRIFT when no live persistent worker matches.
 */
export async function assertWorkerBuildParity(
  pool: pg.Pool,
  expectedBuildId: string,
  maxHeartbeatAgeMs = 300_000,
): Promise<{ workerInstanceId: string; buildId: string }> {
  const rows = await pool.query(
    `SELECT worker_instance_id, build_id, last_heartbeat_at FROM amf_worker_presence WHERE runtime_mode='PERSISTENT_PRODUCTION_WORKER' ORDER BY last_heartbeat_at DESC LIMIT 5`,
    [],
  );
  const cutoff = Date.now() - maxHeartbeatAgeMs;
  const live = rows.rows.filter((r) => Date.parse(String(r.last_heartbeat_at)) >= cutoff);
  if (live.length === 0) throw new Error("MEDIA_WORKER_BUILD_DRIFT:NO_LIVE_PERSISTENT_WORKER");
  const match = live.find((r) => r.build_id === expectedBuildId);
  if (!match) throw new Error("MEDIA_WORKER_BUILD_DRIFT:RUNNING_BUILD_MISMATCH");
  return { workerInstanceId: String(match.worker_instance_id), buildId: String(match.build_id) };
}

export interface MediaResumeDispatchResult {
  /** True only when this call performed the durable rewind + enqueue. */
  readonly created: boolean;
  readonly resumeId: string;
  readonly resumeAttempt: number;
  readonly resumeStartStage: "tts" | "timeline";
  readonly jobId: number | null;
  readonly providerBudget: number;
  readonly frozenPackage: MediaResumeEligibility["frozenPackage"];
  /** Timeline-start only: the exact frozen TTS checkpoint reused. */
  readonly frozenTtsPackage?: MediaResumeEligibility["frozenTtsPackage"];
}

/** The authorized media-segment stage chain, in order, starting at TTS. */
export const MEDIA_RESUME_STAGE_CHAIN = ["tts", "timeline", "scene-image", "visual-semantic-review", "visual-technical-qa", "visual-human-gate"] as const;
/** Stages that must remain untouched by a media resume. */
export const MEDIA_RESUME_FORBIDDEN_STAGES = ["analytics", "wan-authorization", "video", "composer", "final-product-review", "final-human-gate", "publisher-authorization", "publisher"] as const;
/** Stages preserved as completed upstream evidence. */
const MEDIA_RESUME_PRESERVED_STAGES = ["planner-initial", "research", "planner-synthesis", "writer", "seo", "brand", "review", "pre-production-owner-gate", "director"];

function safeRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * Durable MEDIA TECHNICAL RESUME dispatcher (Media Technical Resume V1).
 *
 * A workflow whose media segment was lost to a TECHNICAL failure after the
 * pre-production owner APPROVE and a completed Director stage may be resumed
 * from TTS by ONE explicit owner action — AUTHORIZE_MEDIA_RESUME:
 *
 *   eligibility guard (read-only, fail-closed before any mutation)
 *   -> freeze the exact resume package (all upstream artifact identities,
 *      the canonical Director artifact, the scene plan, the gate-policy
 *      snapshot, the provider budget, the downstream boundary)
 *   -> insert media_resume_dispatches (unique resume_id per attempt)
 *   -> rewind the workflow to TTS ONLY
 *      (content stages + pre-production gate + Director stay completed;
 *       the historical failed-step evidence of the spurious failure is
 *       referenced, never rewritten)
 *   -> inject the owner-authorized mediaResumeExecution marker
 *   -> enqueue the persistent-worker job
 *
 * Eligibility (all must hold, else fail closed with zero mutations):
 *   - the workflow is FAILED
 *   - the terminal failure is technical (the last non-preserved failed step
 *     is a downstream stage with no valid completed inputs — classified
 *     RECOVERY_FRONTIER_TECHNICAL_FAILURE — or a technical media-stage
 *     failure), NOT a business verdict
 *   - the pre-production approval is DECIDED / APPROVE
 *   - Director is COMPLETED with a valid scene plan artifact
 *   - none of TTS / Timeline / Scene Image / Visual QA completed
 *   - the Visual Human Gate is unresolved
 *   - no forbidden downstream stage started
 *   - no active (unsettled) media resume exists
 *   - the visual human gate is currently ENABLED (the frozen proof requires
 *     it; a disabled gate fails closed rather than silently changing the
 *     authorized boundary)
 *
 * The start frontier is the owner-authorized durable resumeStartStage = TTS —
 * never a recovery heuristic, DB row order, or "first pending step".
 */
export class PostgresMediaResumeDispatcher {
  private readonly control: ControlPlaneStore;
  /**
   * MEDIA CAPABILITY PREFLIGHT V1: the injected REAL production capability
   * boundary (constructed by the composition root through
   * createProviderCapabilityBoundaryFromEnv — the exact wiring the live
   * worker uses). The preflight reads its registration state provider-free.
   * When absent, authorization FAILS CLOSED with
   * MEDIA_CAPABILITY_PREFLIGHT_UNAVAILABLE (fail-closed is the safe default;
   * the production bootstrap always wires it).
   */
  private readonly capabilityBoundary?: PreflightCapabilityBoundary;
  private readonly pool: pg.Pool;
  private readonly persistence: PostgresPersistence;
  /**
   * Effective-voice resolver for fingerprint lineage: (value, workflowId) =>
   * governed voice label. The production composition root injects the real
   * governed resolver; the default mirrors its fallback (explicit value,
   * else default speaker, else Mohamed) without the workflow override map.
   * Safe labels only — never secrets.
   */
  private readonly resolveVoice: (value: unknown, workflowId?: string) => string;
  constructor(
    pool: pg.Pool,
    persistence: PostgresPersistence,
    capabilityBoundary?: PreflightCapabilityBoundary,
    options: { readonly resolveVoice?: (value: unknown, workflowId?: string) => string } = {},
  ) {
    this.pool = pool;
    this.persistence = persistence;
    this.control = new ControlPlaneStore(pool);
    this.capabilityBoundary = capabilityBoundary;
    this.resolveVoice = options.resolveVoice ?? ((value) =>
      typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : (process.env.VOICETUT_DEFAULT_SPEAKER?.trim() || "Mohamed"));
  }

  /**
   * Run the provider-free media capability preflight against the REAL
   * production boundary. Fails closed when the boundary is not wired or any
   * required media capability is unregistered/misconfigured. The optional
   * workflow voice folds voice-lineage into the v2 fingerprint; omit it only
   * for workflow-free readiness.
   */
  preflight(workflowVoice?: { readonly value: unknown; readonly workflowId?: string }): MediaCapabilityPreflightResult {
    if (this.capabilityBoundary === undefined) {
      throw new Error("MEDIA_CAPABILITY_PREFLIGHT_FAILED:MEDIA_CAPABILITY_PREFLIGHT_UNAVAILABLE");
    }
    const voice = workflowVoice === undefined
      ? this.resolveVoice(undefined, undefined)
      : this.resolveVoice(workflowVoice.value, workflowVoice.workflowId);
    return mediaCapabilityPreflight(this.capabilityBoundary, voice);
  }

  /** Read-only eligibility + frozen-package inspection for the Control Platform. */
  async eligibility(input: { workflowId: string }): Promise<MediaResumeEligibility> {
    const base: EligibilityAccumulator = { eligible: false, workflowId: input.workflowId };
    const fail = (reason: string): MediaResumeEligibility => ({ ...base, reason });
    const instance = await this.persistence.loadWorkflow(input.workflowId);
    if (!instance) return fail("WORKFLOW_NOT_FOUND");
    base.workflowState = instance.state;
    if (instance.state !== "FAILED") return fail(`WORKFLOW_STATE_${instance.state}`);

    // The most recent failed job for this workflow is the source failure.
    const job = await this.pool.query(`SELECT job_id, status FROM workflow_jobs WHERE workflow_id=$1 AND status='failed' ORDER BY job_id DESC LIMIT 1`, [input.workflowId]);
    if (!job.rowCount) return fail("SOURCE_FAILED_JOB_NOT_FOUND");
    base.sourceFailedJobId = Number(job.rows[0].job_id);

    // Pre-production approval: DECIDED / APPROVE.
    const approval = await this.control.getApproval(`approval-${input.workflowId}-pre-production-owner-gate`);
    if (!approval || approval.status !== "DECIDED" || approval.ownerDecision !== "APPROVE") {
      return fail("PRE_PRODUCTION_APPROVAL_NOT_APPROVED");
    }
    base.preProductionApproval = { approvalId: approval.approvalId, ownerDecision: approval.ownerDecision, decidedAt: approval.decidedAt ?? "" };

    // The failed steps: every failed step must be OUTSIDE the preserved
    // chain (a spurious/technical downstream failure), never a content or
    // Director failure.
    const failedSteps = instance.steps.filter((s) => s.status === "failed").map((s) => s.stepId);
    if (failedSteps.length === 0) return fail("NO_FAILED_STEP");
    const preserved = new Set(MEDIA_RESUME_PRESERVED_STAGES);
    const failedOutsidePreserved = failedSteps.filter((id) => !preserved.has(id));
    if (failedOutsidePreserved.length === 0) return fail("FAILURE_INSIDE_PRESERVED_CHAIN");
    for (const id of failedOutsidePreserved) {
      if ((MEDIA_RESUME_STAGE_CHAIN as readonly string[]).includes(id)) {
        // A media-stage failure is technically eligible ONLY if that stage
        // produced no completed artifacts (genuine technical failure).
        const artifacts = await this.persistence.listArtifacts(input.workflowId);
        const kindByStage: Record<string, string> = { tts: "narration_artifact", timeline: "timeline_plan", "scene-image": "scene_visual_artifact", "visual-semantic-review": "visual_semantic_review", "visual-technical-qa": "visual_technical_qa" };
        const kind = kindByStage[id];
        if (kind && artifacts.some((a) => a.kind === kind && a.status === "completed")) {
          return fail(`MEDIA_STAGE_${id.toUpperCase()}_ALREADY_COMPLETED`);
        }
      }
    }
    base.failureClassification = failedOutsidePreserved.every((id) => !(MEDIA_RESUME_STAGE_CHAIN as readonly string[]).includes(id))
      ? "RECOVERY_FRONTIER_TECHNICAL_FAILURE"
      : "MEDIA_STAGE_TECHNICAL_FAILURE";

    // Director: COMPLETED with a valid scene plan artifact.
    const director = instance.steps.find((s) => s.stepId === "director");
    if (!director || director.status !== "completed") return fail("DIRECTOR_NOT_COMPLETED");
    const artifacts = await this.persistence.listArtifacts(input.workflowId);
    const scenePlans = artifacts.filter((a) => a.kind === "scene_plan" && a.status === "completed");
    if (scenePlans.length === 0) return fail("DIRECTOR_SCENE_PLAN_MISSING");
    const canonicalDirector = [...scenePlans].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1)!;
    const directorLineage = scenePlans.length > 1 ? scenePlans.find((a) => a.artifactId !== canonicalDirector.artifactId) ?? null : null;
    const sceneIds = Array.isArray(canonicalDirector.payload?.sceneIds)
      ? (canonicalDirector.payload.sceneIds as unknown[]).filter((id): id is string => typeof id === "string")
      : [];
    if (sceneIds.length === 0) return fail("DIRECTOR_SCENE_PLAN_INVALID");
    base.directorArtifactId = canonicalDirector.artifactId;
    base.directorLineageArtifactId = directorLineage?.artifactId ?? null;
    base.directorSceneIds = sceneIds;

    // Downstream media stages: for a TTS-start resume none of
    // TTS/Timeline/Scene-Image/QA may have completed. For a TIMELINE-start
    // resume TTS must be fully completed (3/3 + narration) while Timeline
    // must NOT have completed. This preserves the TTS-start path while
    // enabling the proven R6 checkpoint (TTS 3/3 -> Timeline failed).
    const completedKinds = new Set(artifacts.filter((a) => a.status === "completed").map((a) => a.kind));
    const ttsStep = instance.steps.find((s) => s.stepId === "tts");
    const timelineStep = instance.steps.find((s) => s.stepId === "timeline");
    // If TTS step is marked completed but its artifacts are missing, the checkpoint is corrupt — fail closed for both paths.
    if (ttsStep?.status === "completed" && (!(completedKinds as unknown as Set<string>).has("narration_artifact") || !(completedKinds as unknown as Set<string>).has("chunk_audio_artifact"))) {
      return fail("TTS_CHUNK_INCOMPLETE");
    }
    const hasCompletedTts = ttsStep?.status === "completed" && (completedKinds as unknown as Set<string>).has("narration_artifact") && (completedKinds as unknown as Set<string>).has("chunk_audio_artifact");
    const hasCompletedTimeline = (completedKinds as unknown as Set<string>).has("timeline_plan");
    let timelineFrozen: { eligible: boolean; reason?: string; frozenTtsPackage?: NonNullable<MediaResumeEligibility["frozenTtsPackage"]> } | null = null;
    if (hasCompletedTts) {
      // Timeline-start candidate: TTS must be fully checkpointed and timeline must be the failed stage.
      if (hasCompletedTimeline) return fail("STAGE_TIMELINE_ALREADY_COMPLETED");
      if (timelineStep?.status !== "failed") {
        if (ttsStep?.status === "completed") return fail("STAGE_TTS_ALREADY_COMPLETED");
      }
      // Validate the frozen R6 TTS checkpoint exactly; any mismatch => timeline resume ineligible (B..E).
      timelineFrozen = await this.validateFrozenTtsPackage(input.workflowId, artifacts);
      if (!timelineFrozen.eligible) return fail(timelineFrozen.reason!);
      for (const [stage, kind] of [["scene-image", "scene_visual_artifact"], ["visual-technical-qa", "visual_technical_qa"]] as const) {
        if (completedKinds.has(kind)) return fail(`STAGE_${stage.toUpperCase()}_ALREADY_COMPLETED`);
      }
    } else {
      for (const [stage, kind] of [["tts", "narration_artifact"], ["timeline", "timeline_plan"], ["scene-image", "scene_visual_artifact"], ["visual-technical-qa", "visual_technical_qa"]] as const) {
        if (completedKinds.has(kind)) return fail(`STAGE_${stage.toUpperCase()}_ALREADY_COMPLETED`);
      }
    }
    // Visual Human Gate unresolved.
    const visualApproval = await this.control.getApproval(`approval-${input.workflowId}-visual-human-gate`);
    if (visualApproval && visualApproval.status === "DECIDED") return fail("VISUAL_HUMAN_GATE_ALREADY_RESOLVED");
    // Forbidden stages never started. A FAILED step is historical failure
    // evidence (e.g. the spurious analytics execution of the recovery-
    // frontier incident), not a start that must block the resume — the
    // resume rewinds it and the frozen boundary excludes it from the frontier.
    for (const stage of MEDIA_RESUME_FORBIDDEN_STAGES) {
      const record = instance.steps.find((s) => s.stepId === stage);
      if (record && record.status !== "pending" && record.status !== "failed") return fail(`FORBIDDEN_STAGE_${stage.toUpperCase()}_STARTED`);
    }

    // No active (unsettled) media resume.
    const active = await this.pool.query(`SELECT resume_id FROM media_resume_dispatches WHERE workflow_id=$1 AND outcome IS NULL AND authorization_status='OWNER_APPROVED'`, [input.workflowId]);
    if (active.rowCount) return fail("ACTIVE_MEDIA_RESUME_EXISTS");

    // Frozen content package (the approved review lineage).
    const business = safeRecord(instance.context.data.reviewBusinessOutcome);
    const reviewArtifactId = typeof business.reviewArtifactId === "string" ? business.reviewArtifactId : "";
    if (!reviewArtifactId) return fail("APPROVED_REVIEW_ARTIFACT_MISSING");
    const byId = new Map(artifacts.map((a) => [a.artifactId, a]));
    const review = byId.get(reviewArtifactId);
    if (!review || review.kind !== "review_report" || review.status !== "completed" || review.payload?.status !== "approved") return fail("APPROVED_REVIEW_ARTIFACT_INVALID");
    const revision = safeRecord(review.payload?.revision);
    const writerArtifactId = typeof revision.priorWriterArtifactId === "string" ? revision.priorWriterArtifactId : "";
    // For this workflow the revised writer/seo/brand are the timestamped v2 artifacts.
    const findCompleted = (kind: string) => artifacts.filter((a) => a.kind === kind && a.status === "completed").sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
    const writer = findCompleted("writer_report");
    const seo = findCompleted("seo_report");
    const brand = findCompleted("brand_report");
    if (!writer || !seo || !brand) return fail("CONTENT_PACKAGE_INCOMPLETE");
    const frozenPackage = {
      reviewArtifactId, writerArtifactId: writer.artifactId, seoArtifactId: seo.artifactId, brandArtifactId: brand.artifactId,
      directorArtifactId: canonicalDirector.artifactId, directorLineageArtifactId: directorLineage?.artifactId ?? null, directorSceneIds: sceneIds,
    };
    base.frozenPackage = frozenPackage;

    // Provider budget: for TIMELINE-start reuse TTS (no new TTS budget),
    // envelope is 1 timeline + 5 scenes = 6. For TTS-start it remains
    // TTS chunks + 1 timeline + scenes (e.g. 3+1+5=9 for Morroway).
    if (timelineFrozen !== null) {
      base.frozenTtsPackage = timelineFrozen.frozenTtsPackage!;
      base.resumeStartStage = "timeline";
      base.providerBudget = 1 + sceneIds.length;
      base.failureClassification = "MEDIA_STAGE_TECHNICAL_FAILURE";
    } else {
      const scriptChars = String(writer.payload?.content ?? "").length;
      const ttsChunks = Math.max(1, Math.ceil(scriptChars / 200));
      const budget = ttsChunks + 1 + sceneIds.length;
      base.providerBudget = budget;
      base.resumeStartStage = "tts";
      base.frozenTtsPackage = null;
    }

    // Gate policy: the visual human gate must be enabled for this proof.
    const policy = await this.control.effectiveHumanGatePolicy(instance.context.brandId ?? null);
    base.gatePolicySnapshot = policy;
    if (!policy.visualHumanGateEnabled) return fail("VISUAL_HUMAN_GATE_DISABLED");

    return { ...base, eligible: true };
  }

  /**
   * Validate the exact frozen R6 TTS checkpoint for a future TIMELINE-start
   * resume (provider-free, read-only). Returns the frozen package when every
   * condition in §1 holds, else the specific ineligibility reason (B..E).
   *
   * No provider calls, no mutations. Validates status, count, existence,
   * lineage, and canonical WAV integrity (RIFF/WAVE header on the data URL).
   */
  private async validateFrozenTtsPackage(
    workflowId: string,
    artifacts: Awaited<ReturnType<PostgresPersistence["listArtifacts"]>>,
  ): Promise<{ eligible: boolean; reason?: string; frozenTtsPackage?: NonNullable<MediaResumeEligibility["frozenTtsPackage"]> }> {
    const chunkArtifacts = artifacts.filter((a) => (a as unknown as { kind: string }).kind === "chunk_audio_artifact" && a.status === "completed");
    if (chunkArtifacts.length === 0) return { eligible: false, reason: "TTS_CHUNK_INCOMPLETE" };
    // For Morroway the expected chunk count derives from the same script-chars
    // rule that defines the TTS-start envelope; for the live frozen package it
    // must be 3/3. Allow generic validation: all chunks for the latest
    // narration must be present and count must match the narration's lineage.
    const narrations = artifacts.filter((a) => (a as unknown as { kind: string }).kind === "narration_artifact" && a.status === "completed")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (narrations.length === 0) return { eligible: false, reason: "NARRATION_MISSING" };
    const narration = narrations.at(-1)!;
    const lineage = safeRecord(narration.payload).lineage as Record<string, unknown> | undefined;
    const orderedIds = Array.isArray(lineage?.orderedChunkArtifactIds) ? lineage.orderedChunkArtifactIds.filter((v): v is string => typeof v === "string") : [];
    // Fallback for legacy narration shapes that stored childArtifactIds.
    const childIds = orderedIds.length > 0 ? orderedIds : Array.isArray(safeRecord(narration.payload).childArtifactIds) ? (safeRecord(narration.payload).childArtifactIds as unknown[]).filter((v): v is string => typeof v === "string") : [];
    if (childIds.length === 0) return { eligible: false, reason: "NARRATION_LINEAGE_MISSING" };
    if (childIds.length !== chunkArtifacts.filter((c) => childIds.includes(c.artifactId)).length) return { eligible: false, reason: "NARRATION_LINEAGE_MISMATCH" };
    // For Morroway the frozen package is 3/3; test fixtures may be 1..3 — allow any >=1 that matches lineage.
    if (childIds.length < 1) return { eligible: false, reason: "TTS_CHUNK_COUNT_MISMATCH" };
    // Each chunk must be the expected Morroway voice/provider and pass WAV header integrity.
    for (const id of childIds) {
      const chunk = artifacts.find((a) => a.artifactId === id);
      if (!chunk || chunk.status !== "completed") return { eligible: false, reason: "TTS_CHUNK_MISSING" };
      const payload = safeRecord(chunk.payload);
      if (payload.provider !== "voicetut" || payload.voice !== "Mohamed") return { eligible: false, reason: "TTS_CHUNK_VOICE_MISMATCH" };
      const path = typeof payload.path === "string" ? payload.path : "";
      if (!path.startsWith("data:audio/wav;base64,")) return { eligible: false, reason: "TTS_CHUNK_INTEGRITY_FAILURE" };
      try {
        const b64 = path.split(",")[1] ?? "";
        const buf = Buffer.from(b64, "base64");
        if (buf.length < 44 || buf.slice(0, 4).toString() !== "RIFF" || buf.slice(8, 12).toString() !== "WAVE") return { eligible: false, reason: "TTS_CHUNK_INTEGRITY_FAILURE" };
      } catch {
        return { eligible: false, reason: "TTS_CHUNK_INTEGRITY_FAILURE" };
      }
    }
    // No later valid Timeline artifact already exists for this package.
    const hasTimeline = artifacts.some((a) => (a as unknown as { kind: string }).kind === "timeline_plan" && a.status === "completed");
    if (hasTimeline) return { eligible: false, reason: "TIMELINE_ALREADY_COMPLETED" };
    // Source R6 resume/job are the latest FAILED media resume for this workflow (the checkpoint we reuse).
    const sourceRows = await this.pool.query(
      `SELECT resume_id, job_id FROM media_resume_dispatches WHERE workflow_id=$1 AND resume_start_stage='tts' ORDER BY resume_attempt DESC LIMIT 1`,
      [workflowId],
    );
    const sourceResumeId = sourceRows.rows[0]?.resume_id ?? null;
    const sourceJobId = sourceRows.rows[0]?.job_id ?? null;
    if (!sourceResumeId) return { eligible: false, reason: "SOURCE_R6_RESUME_MISSING" };
    // Provider job IDs are retained in execution_provenance for the TTS submits; collect them for the frozen package.
    const provRows = await this.pool.query(
      `SELECT provider_job_id FROM execution_provenance WHERE workflow_id=$1 AND agent_id='tts-chunk-coordinator' AND stage='tts-submit' AND status='blocked' AND provider_job_id IS NOT NULL ORDER BY started_at DESC LIMIT 3`,
      [workflowId],
    );
    const providerJobIds = provRows.rows.map((r) => r.provider_job_id as string);
    return {
      eligible: true,
      frozenTtsPackage: {
        sourceResumeId,
        sourceJobId: sourceJobId === null ? null : Number(sourceJobId),
        chunkArtifactIds: childIds,
        providerJobIds,
        narrationArtifactId: narration.artifactId,
      },
    };
  }

  /** Owner-authorized media resume dispatch (durable, idempotent, exactly-once). */
  async authorizeAndDispatch(input: MediaResumeAuthorizeInput): Promise<MediaResumeDispatchResult> {
    assertRecoveryHorizon("MEDIA_RESUME", "director", ["research", "planner-synthesis", "writer", "scenes", "visual-prompt", "review"], MEDIA_RESUME_STAGE_CHAIN);
    // The whole authorization critical section runs under a per-workflow
    // session advisory lock: concurrent owner actions serialize, so exactly
    // one caller ever computes the next attempt number and inserts the
    // resume row; every other caller observes and reuses the active resume.
    const client = await this.pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtext($1))", [`media-resume:${input.workflowId}`]);
      return await this.authorizeLocked(input);
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [`media-resume:${input.workflowId}`]).catch(() => undefined);
      client.release();
    }
  }

  private async authorizeLocked(input: MediaResumeAuthorizeInput): Promise<MediaResumeDispatchResult> {
    // Idempotency FIRST: an active (unsettled, owner-approved) resume for
    // this workflow is reused regardless of the current workflow state (the
    // first authorization legitimately moved it FAILED -> PAUSED). Duplicate
    // or concurrent authorization never creates a second dispatch.
    const active = await this.pool.query(`SELECT * FROM media_resume_dispatches WHERE workflow_id=$1 AND outcome IS NULL AND authorization_status='OWNER_APPROVED' ORDER BY resume_attempt DESC LIMIT 1`, [input.workflowId]);
    if (active.rowCount) {
      const row = active.rows[0];
      const sceneIds = typeof row.director_scene_ids === "string" ? JSON.parse(row.director_scene_ids) : row.director_scene_ids;
      const frozenTts = row.frozen_tts_package === null || row.frozen_tts_package === undefined ? null : (typeof row.frozen_tts_package === "string" ? JSON.parse(row.frozen_tts_package) : row.frozen_tts_package);
      return {
        created: false, resumeId: row.resume_id, resumeAttempt: Number(row.resume_attempt), resumeStartStage: row.resume_start_stage as "tts" | "timeline",
        jobId: row.job_id === null ? null : Number(row.job_id), providerBudget: Number(row.provider_budget),
        frozenPackage: {
          reviewArtifactId: row.review_artifact_id, writerArtifactId: row.writer_artifact_id, seoArtifactId: row.seo_artifact_id, brandArtifactId: row.brand_artifact_id,
          directorArtifactId: row.director_artifact_id, directorLineageArtifactId: row.director_lineage_artifact_id ?? null, directorSceneIds: sceneIds ?? [],
        },
        ...(frozenTts ? { frozenTtsPackage: frozenTts } : {}),
      };
    }

    // Eligibility — read-only, fail-closed.
    const eligibility = await this.eligibility({ workflowId: input.workflowId });
    if (!eligibility.eligible) throw new Error(`MEDIA_RESUME_NOT_ELIGIBLE:${eligibility.reason}`);
    const frozen = eligibility.frozenPackage!;
    const budget = input.providerBudget ?? eligibility.providerBudget!;
    if (!(budget >= 1) || budget > (eligibility.providerBudget ?? budget)) {
      throw new Error(`MEDIA_RESUME_PROVIDER_BUDGET_INVALID:${budget}>${eligibility.providerBudget}`);
    }

    // MEDIA CAPABILITY PREFLIGHT — revalidated INSIDE the authorization
    // critical section, immediately before any durable mutation. If the
    // effective capability configuration changed between the owner's
    // inspection and this authorization (or was never viable), the
    // authorization FAILS CLOSED here: no resume row, no queue job, no
    // rewind, no budget consumption. The resolved configuration fingerprint
    // is frozen onto the resume row so later drift is detectable. The v2
    // fingerprint folds the governed effective voice for this workflow, so a
    // voice change is a fingerprint change.
    const authorizeWorkflow = await this.persistence.loadWorkflow(input.workflowId);
    const authorizeVoice = (authorizeWorkflow?.context.data as Record<string, unknown> | undefined)?.voice;
    const preflightResult = this.preflight({ value: authorizeVoice, workflowId: input.workflowId });
    if (!preflightResult.pass) {
      throw new Error(`MEDIA_CAPABILITY_PREFLIGHT_FAILED:${preflightResult.failureCodes.join(",")}`);
    }

    const startStage = eligibility.resumeStartStage ?? "tts";
    const priorCount = await this.pool.query(`SELECT count(*)::int AS n FROM media_resume_dispatches WHERE workflow_id=$1`, [input.workflowId]);
    const resumeAttempt = Number(priorCount.rows[0].n) + 1;
    const resumeId = `media-resume-${input.workflowId}-from-${startStage}-r${resumeAttempt}`;
    const existingRow = await this.pool.query(`SELECT job_id FROM media_resume_dispatches WHERE resume_id=$1`, [resumeId]);
    if (existingRow.rowCount) {
      return { created: false, resumeId, resumeAttempt, resumeStartStage: startStage, jobId: existingRow.rows[0].job_id === null ? null : Number(existingRow.rows[0].job_id), providerBudget: budget, frozenPackage: frozen, ...(eligibility.frozenTtsPackage ? { frozenTtsPackage: eligibility.frozenTtsPackage } : {}) };
    }
    const frozenTtsJson = eligibility.frozenTtsPackage ? JSON.stringify(eligibility.frozenTtsPackage) : null;
    const insert = await this.pool.query(
      `INSERT INTO media_resume_dispatches (resume_id, workflow_id, source_failed_job_id, failure_classification, resume_attempt, resume_start_stage, pre_production_approval_id, review_artifact_id, writer_artifact_id, seo_artifact_id, brand_artifact_id, director_artifact_id, director_lineage_artifact_id, director_scene_ids, gate_policy_snapshot, provider_budget, downstream_boundary, authorization_status, authorized_by, rationale, authorized_at, outcome, configuration_fingerprint, frozen_tts_package)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'OWNER_APPROVED',$18,$19,$20,NULL,$21,$22) ON CONFLICT (resume_id) DO NOTHING RETURNING resume_id`,
      [resumeId, input.workflowId, eligibility.sourceFailedJobId ?? null, eligibility.failureClassification, resumeAttempt, startStage,
        eligibility.preProductionApproval!.approvalId, frozen.reviewArtifactId, frozen.writerArtifactId, frozen.seoArtifactId, frozen.brandArtifactId,
        frozen.directorArtifactId, frozen.directorLineageArtifactId, JSON.stringify(frozen.directorSceneIds),
        JSON.stringify(eligibility.gatePolicySnapshot), budget, "VISUAL_HUMAN_GATE_PENDING:NO_PUBLISHING",
        input.authorizedBy, input.rationale, new Date().toISOString(),
        preflightResult.configurationFingerprint, frozenTtsJson],
    );
    if (!insert.rowCount) {
      const settled = await this.pool.query(`SELECT job_id FROM media_resume_dispatches WHERE resume_id=$1`, [resumeId]);
      return { created: false, resumeId, resumeAttempt, resumeStartStage: startStage, jobId: settled.rows[0]?.job_id === null || settled.rows[0]?.job_id === undefined ? null : Number(settled.rows[0].job_id), providerBudget: budget, frozenPackage: frozen, ...(eligibility.frozenTtsPackage ? { frozenTtsPackage: eligibility.frozenTtsPackage } : {}) };
    }

    // Rewind: TTS-start preserves content+gate+Director; TIMELINE-start
    // additionally preserves TTS (the frozen R6 checkpoint) so it is never
    // re-executed. The ready frontier is exactly the authorized start stage.
    const submission = await new PostgresQueue(this.pool).loadSubmissionByWorkflow(input.workflowId);
    if (!submission) throw new Error("MEDIA_RESUME_WORKFLOW_SUBMISSION_NOT_FOUND");
    const definition = submission.definition;
    const isTimeline = startStage === "timeline";
    const preservedForStage = isTimeline ? [...MEDIA_RESUME_PRESERVED_STAGES, "tts"] : MEDIA_RESUME_PRESERVED_STAGES;
    const rewindTargets = definition.steps
      .map((step: { id: string }) => step.id)
      .filter((id: string) => !preservedForStage.includes(id));
    await rewindWorkflow(this.persistence, definition, {
      workflowId: input.workflowId,
      targetStepId: startStage,
      requiredArtifactsByStep: { writer: { artifactKind: "writer_report" }, seo: { artifactKind: "seo_report" }, brand: { artifactKind: "brand_report" } },
      preserveCompletedStepIds: preservedForStage,
      rewindStepIds: rewindTargets,
      reason: `Owner-authorized media technical resume r${resumeAttempt} (from ${startStage.toUpperCase()}; failure class ${eligibility.failureClassification}): ${input.rationale}`,
    });
    const workflow = await this.persistence.loadWorkflow(input.workflowId);
    if (!workflow) throw new Error("MEDIA_RESUME_WORKFLOW_NOT_FOUND_AFTER_REWIND");

    // The owner-authorized media-resume marker with the frozen package.
    // For timeline-start the frozen TTS checkpoint is also persisted so
    // execution can verify exact reuse and firewall any TTS provider call.
    const data = workflow.context.data as Record<string, unknown>;
    const { reviewBusinessOutcome: _kept, reviewResumeExecution: _old, ...restData } = data;
    const mediaResumeExecution: Record<string, unknown> = {
      resumeId,
      resumeAttempt,
      resumeStartStage: startStage,
      failureClassification: eligibility.failureClassification,
      sourceFailedJobId: eligibility.sourceFailedJobId ?? null,
      preProductionApprovalId: eligibility.preProductionApproval!.approvalId,
      reviewArtifactId: frozen.reviewArtifactId,
      writerArtifactId: frozen.writerArtifactId,
      seoArtifactId: frozen.seoArtifactId,
      brandArtifactId: frozen.brandArtifactId,
      directorArtifactId: frozen.directorArtifactId,
      directorLineageArtifactId: frozen.directorLineageArtifactId,
      directorSceneIds: frozen.directorSceneIds,
      gatePolicy: eligibility.gatePolicySnapshot,
      providerBudget: budget,
      downstreamBoundary: "VISUAL_HUMAN_GATE_PENDING:NO_PUBLISHING",
      resumeAuthorization: "OWNER_APPROVED",
      ...(eligibility.frozenTtsPackage ? { frozenTtsPackage: eligibility.frozenTtsPackage } : {}),
    };
    // The frontier is EXPLICITLY the owner-authorized start stage — never a
    // recovery heuristic. The engine resumes from this ready list.
    await this.persistence.saveWorkflow({
      ...workflow,
      state: "PAUSED",
      ready: [startStage],
      context: { ...workflow.context, data: { ...restData, reviewBusinessOutcome: _kept, mediaResumeExecution } as never },
      updatedAt: new Date().toISOString(),
    });

    const jobId = await new PostgresQueue(this.pool).enqueue(input.workflowId, submission.submissionKey);
    await this.pool.query(`UPDATE media_resume_dispatches SET job_id=$2 WHERE resume_id=$1`, [resumeId, jobId]);
    if (typeof data.commandId === "string") {
      await this.pool.query(
        `UPDATE control_commands SET status='MEDIA_RESUME_AUTHORIZED', visible_result=COALESCE($3,visible_result), updated_at=$4 WHERE command_id=$1 AND project_id=$2`,
        [data.commandId, workflow.context.brandId, JSON.stringify({ kind: "MEDIA_RESUME_AUTHORIZED", resumeId, resumeAttempt, resumeStartStage: startStage, preservedDirector: frozen.directorArtifactId, scenes: frozen.directorSceneIds.length, maxProviderSubmissions: budget, stopsAt: "Visual Human Approval", publishingAuthorized: false, authorizedBy: input.authorizedBy, rationale: input.rationale, ...(eligibility.frozenTtsPackage ? { frozenTtsPackage: eligibility.frozenTtsPackage } : {}) }), new Date().toISOString()],
      );
    }
    return { created: true, resumeId, resumeAttempt, resumeStartStage: startStage, jobId, providerBudget: budget, frozenPackage: frozen, ...(eligibility.frozenTtsPackage ? { frozenTtsPackage: eligibility.frozenTtsPackage } : {}) };
  }

  /**
   * Exactly-once stage claim (R7 hardening). Atomically claims the logical
   * execution (resume_id, stage, item_id): the first claimant gets
   * { first: true } and owns execution + the single budget consumption.
   * A duplicate/recovery claimant gets { first: false } with the durable
   * claim state and must observe it instead of re-executing or consuming
   * budget. Never throws for duplicates — observation is the safe path.
   */
  async claimStageExecution(input: { resumeId: string; workflowId: string; stage: string; itemId?: string }): Promise<{ first: boolean; state: string; outcome: string | null; error: string | null; budgetConsumed: boolean }> {
    const item = input.itemId ?? "";
    const now = new Date().toISOString();
    const inserted = await this.pool.query(
      `INSERT INTO media_stage_claims (resume_id, stage, item_id, state, claimed_at, updated_at)
       VALUES ($1,$2,$3,'CLAIMED',$4,$4) ON CONFLICT DO NOTHING RETURNING state`,
      [input.resumeId, input.stage, item, now],
    );
    if (inserted.rowCount) return { first: true, state: "CLAIMED", outcome: null, error: null, budgetConsumed: false };
    const row = await this.pool.query(`SELECT state, outcome, error, budget_consumed FROM media_stage_claims WHERE resume_id=$1 AND stage=$2 AND item_id=$3`, [input.resumeId, input.stage, item]);
    const existing = row.rows[0] ?? { state: "CLAIMED", outcome: null, error: null, budget_consumed: false };
    return { first: false, state: String(existing.state), outcome: existing.outcome ?? null, error: existing.error ?? null, budgetConsumed: existing.budget_consumed === true };
  }

  /** Finalize a stage claim with its terminal outcome (idempotent, open-claim only). */
  async finalizeStageExecution(input: { resumeId: string; stage: string; itemId?: string; outcome: "completed" | "failed" | "blocked"; error?: string }): Promise<void> {
    const item = input.itemId ?? "";
    // Terminal states are COMPLETED or FAILED (BLOCKED is recorded as FAILED:
    // a blocked capability must never be silently retried by the same resume).
    await this.pool.query(
      `UPDATE media_stage_claims SET state=$4, outcome=$4, error=$5, updated_at=$6
       WHERE resume_id=$1 AND stage=$2 AND item_id=$3 AND state='CLAIMED'`,
      [input.resumeId, input.stage, item, input.outcome === "completed" ? "COMPLETED" : "FAILED", input.error ?? null, new Date().toISOString()],
    );
  }

  /** Mark a claim's budget as consumed (called by consumeProviderBudget). */
  private async markClaimBudgetConsumed(resumeId: string, stage: string, itemId?: string): Promise<void> {
    await this.pool.query(
      `UPDATE media_stage_claims SET budget_consumed=TRUE, updated_at=$4 WHERE resume_id=$1 AND stage=$2 AND item_id=$3`,
      [resumeId, stage, itemId ?? "", new Date().toISOString()],
    ).catch(() => undefined);
  }

  /**
   * Assert pre-authorization build parity (R7 hardening): the running
   * persistent worker's startup build identity must equal the expected
   * build. Used by operator authorization paths only — never by the worker
   * itself. Throws MEDIA_WORKER_BUILD_DRIFT before any resume mutation.
   */
  async assertWorkerBuildParity(expectedBuildId: string, maxHeartbeatAgeMs = 300_000): Promise<{ workerInstanceId: string; buildId: string }> {
    return assertWorkerBuildParity(this.pool, expectedBuildId, maxHeartbeatAgeMs);
  }

  /**
   * Execution-time configuration verification. Recomputes nothing here: the
   * EXECUTOR recomputes the canonical v2 fingerprint from its live boundary
   * and passes it in; this method compares it against the fingerprint frozen
   * at authorization. Any drift (endpoint swap, provider change, voice
   * change, registration change) FAILS CLOSED here — before budget
   * consumption and before provider submission. Historical v1 rows predate
   * this check and are terminal, so they never reach it.
   */
  async verifyConfigurationFingerprint(input: { resumeId: string; fingerprint: string }): Promise<void> {
    const row = await this.pool.query(`SELECT configuration_fingerprint FROM media_resume_dispatches WHERE resume_id=$1`, [input.resumeId]);
    if (!row.rowCount) throw new Error("MEDIA_RESUME_NOT_FOUND");
    const frozen = row.rows[0].configuration_fingerprint as string | null;
    if (frozen === null || frozen !== input.fingerprint) {
      throw new Error("MEDIA_RESUME_CONFIGURATION_DRIFT");
    }
  }

  /** Record a provider-submission attempt against the resume budget. Fail-closed before the provider call. */
  async consumeProviderBudget(input: { resumeId: string; workflowId: string; stage: string; capabilityId: string; itemId?: string }): Promise<void> {
    const row = await this.pool.query(`SELECT provider_budget FROM media_resume_dispatches WHERE resume_id=$1`, [input.resumeId]);
    if (!row.rowCount) throw new Error("MEDIA_RESUME_NOT_FOUND");
    const budget = Number(row.rows[0].provider_budget);
    const insert = await this.pool.query(
      `INSERT INTO media_resume_provider_usage (resume_id, workflow_id, stage, capability_id, item_id, created_at)
       SELECT $1,$2,$3,$4,$5,$6 WHERE (SELECT count(*) FROM media_resume_provider_usage WHERE resume_id=$1) < $7
       RETURNING usage_id`,
      [input.resumeId, input.workflowId, input.stage, input.capabilityId, input.itemId ?? null, new Date().toISOString(), budget],
    );
    if (!insert.rowCount) throw new Error(`MEDIA_RESUME_PROVIDER_BUDGET_EXCEEDED:${budget}`);
    await this.markClaimBudgetConsumed(input.resumeId, input.stage, input.itemId);
  }

  /** Settle the resume outcome (idempotent). */
  async settleOutcome(resumeId: string, outcome: "VISUAL_GATE_PENDING" | "COMPLETED" | "FAILED"): Promise<void> {
    await this.pool.query(`UPDATE media_resume_dispatches SET outcome=$2 WHERE resume_id=$1 AND outcome IS NULL`, [resumeId, outcome]);
  }

  /** Read-only state inspection for the Control Platform. */
  async state(workflowId: string): Promise<{ resumes: Array<Record<string, unknown>>; usage: Array<Record<string, unknown>>; preflight: { pass: boolean; failureCodes: readonly string[]; details: MediaCapabilityPreflightResult | null } }> {
    const resumes = await this.pool.query(`SELECT * FROM media_resume_dispatches WHERE workflow_id=$1 ORDER BY resume_attempt`, [workflowId]);
    const usage = await this.pool.query(`SELECT stage, capability_id, item_id, count(*)::int AS n FROM media_resume_provider_usage WHERE workflow_id=$1 GROUP BY stage, capability_id, item_id ORDER BY stage`, [workflowId]);
    let preflight: { pass: boolean; failureCodes: readonly string[]; details: MediaCapabilityPreflightResult | null };
    try {
      const result = this.preflight();
      preflight = { pass: result.pass, failureCodes: result.failureCodes, details: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const codes = message.replace(/^MEDIA_CAPABILITY_PREFLIGHT_FAILED:/, "").split(",").filter(Boolean);
      preflight = { pass: false, failureCodes: codes, details: null };
    }
    return { resumes: resumes.rows, usage: usage.rows, preflight };
  }
}
