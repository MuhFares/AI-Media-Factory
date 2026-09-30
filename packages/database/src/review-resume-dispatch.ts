import type pg from "pg";
import { rewindWorkflow } from "@ai-media-factory/workflow-engine";
import type { PostgresPersistence } from "./adapter.js";
import { PostgresQueue } from "./queue.js";
import { ControlPlaneStore, type ReviewRevisionTask } from "./control-plane.js";
import { assertRecoveryHorizon } from "./recovery-framework.js";

function safeRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export interface ReviewResumeAuthorizeInput {
  readonly taskId: string;
  readonly authorizedBy: string;
  readonly rationale: string;
  /**
   * Owner-authorized EXECUTION-SCOPED temporary validation override for the
   * Review stage of THIS resume only (e.g. a cycle-proof model). Persisted as
   * provenance on the resume dispatch; NEVER written to the persistent
   * control-plane policy (control_configuration_events). Omit to use the
   * canonical control-plane configuration unchanged.
   */
  readonly reviewOverride?: { readonly provider: "openrouter"; readonly model: string };
}

export interface ReviewResumeDispatchResult {
  /** True only when this call performed the durable rewind + enqueue. */
  readonly created: boolean;
  readonly resumeId: string;
  readonly revisionVersion: number;
  readonly resumeAttempt: number;
  readonly failedReviewExecutionId: string;
  readonly frozenWriterArtifactId: string;
  readonly frozenSeoArtifactId: string;
  readonly frozenBrandArtifactId: string;
  readonly jobId: number | null;
  readonly task: ReviewRevisionTask;
}

/** Terminal technical lifecycle states of a failed Review execution. */
const TECHNICAL_FAILURE_STATES = new Set([
  "JSON_PARSE_FAILED",
  "STRUCTURAL_VALIDATION_FAILED",
  "SEMANTIC_VALIDATION_FAILED",
  "PROVIDER_TRANSPORT_FAILED",
  "PROVIDER_RESPONSE_INCOMPLETE",
  "REVIEW_RUNTIME_FAILED",
  "LOCAL_EXECUTION_FAILED",
  "ARTIFACT_PERSISTENCE_FAILED",
  "ARTIFACT_RELOAD_VALIDATION_FAILED",
]);

/**
 * REVIEW_ONLY_TECHNICAL_RESUME dispatcher.
 *
 * A revision cycle sometimes reaches Writer/SEO/Brand = canonical COMPLETED
 * and then loses ONLY its Review to a technical failure (transport, parse,
 * structural/semantic validation, runtime, persistence) before any valid
 * Review artifact is persisted. Re-authorizing a full revision would rewind
 * to Writer and needlessly regenerate valid content.
 *
 * One owner action — AUTHORIZE_REVIEW_RESUME — retries ONLY the Review:
 *
 *   eligibility guard (fail-closed, zero mutations before it passes)
 *   -> freeze the exact current Writer/SEO/Brand artifact ids
 *   -> resolve + freeze the canonical stage configuration
 *   -> insert review_resume_dispatches (unique resume_id per attempt)
 *   -> rewind the workflow to the review step ONLY
 *      (Writer/SEO/Brand/Planner/Research stay completed)
 *   -> inject the owner-authorized reviewResumeExecution marker (frozen
 *      package + failed-review lineage) alongside the preserved
 *      revisionExecution marker
 *   -> enqueue the persistent-worker job
 *   -> task FAILED -> IN_PROGRESS (same revision version; NO version bump)
 *
 * Eligibility (all must hold, else fail closed with zero provider fetches):
 *   - the source task is FAILED for the target revision version
 *   - the latest Review execution of that version failed TECHNICALLY
 *   - no valid Review artifact was persisted for that failed attempt
 *   - no later valid Review artifact exists for the same package
 *   - the frozen Writer/SEO/Brand artifacts exist, are canonical COMPLETED,
 *     belong to the same revision package, and reload with valid contracts
 *   - no active (unsettled) resume exists for the same version
 *
 * A previous Review that produced a valid business verdict (approved /
 * human_review_required / changes_requested / blocked) is NOT eligible —
 * those are business outcomes, not technical failures.
 */
export class PostgresReviewResumeDispatcher {
  private readonly control: ControlPlaneStore;
  constructor(private readonly pool: pg.Pool, private readonly persistence: PostgresPersistence) {
    this.control = new ControlPlaneStore(pool);
  }

  async authorizeAndDispatch(input: ReviewResumeAuthorizeInput): Promise<ReviewResumeDispatchResult> {
    // A dedicated PostgreSQL session lock serializes the complete eligibility
    // check + dispatch mutation for this task across processes. The additive
    // unique index on the failed execution remains the durable backstop.
    const lockClient = await this.pool.connect();
    const lockIdentity = `review-resume:${input.taskId}`;
    let locked = false;
    try {
      await lockClient.query(`SELECT pg_advisory_lock(hashtext($1))`, [lockIdentity]);
      locked = true;
      return await this.authorizeAndDispatchLocked(input);
    } finally {
      if (locked) {
        await lockClient.query(`SELECT pg_advisory_unlock(hashtext($1))`, [lockIdentity]).catch(() => undefined);
      }
      lockClient.release();
    }
  }

  private async authorizeAndDispatchLocked(input: ReviewResumeAuthorizeInput): Promise<ReviewResumeDispatchResult> {
    assertRecoveryHorizon("REVIEW_RESUME", "review", ["research", "planner-synthesis", "writer", "seo", "brand"], ["review"]);
    // --- Eligibility guard: read-only, fail-closed, before any mutation. ---
    const task = await this.loadTask(input.taskId);
    const taskStatus: string = task.status;
    const version = task.revisionVersion;

    // An IN_PROGRESS task with an existing resume row is an active resume:
    // a duplicate authorization is idempotent (same dispatch, no new job).
    if (taskStatus === "IN_PROGRESS") {
      const active = await this.pool.query(
        `SELECT * FROM review_resume_dispatches WHERE task_id=$1 AND revision_version=$2 ORDER BY resume_attempt DESC LIMIT 1`,
        [input.taskId, version],
      );
      if (active.rowCount) {
        const row = active.rows[0];
        return {
          created: false, resumeId: row.resume_id, revisionVersion: version, resumeAttempt: Number(row.resume_attempt),
          failedReviewExecutionId: row.failed_review_execution_id,
          frozenWriterArtifactId: row.frozen_writer_artifact_id, frozenSeoArtifactId: row.frozen_seo_artifact_id,
          frozenBrandArtifactId: row.frozen_brand_artifact_id,
          jobId: row.job_id === null || row.job_id === undefined ? null : Number(row.job_id), task,
        };
      }
      throw new Error("REVIEW_RESUME_NOT_ELIGIBLE:task_in_progress_without_active_resume");
    }
    if (taskStatus !== "FAILED") {
      throw new Error(`REVIEW_RESUME_NOT_ELIGIBLE:task_status_${taskStatus}`);
    }

    // The latest Review execution of this revision version must have failed technically.
    const reviewExecutions = (await this.persistence.listExecutionProvenance(task.workflowId))
      .filter((row) => row.agentId === "review" && row.stage === "review"
        && safeRecord(safeRecord(row.configuration).revisionExecution).revisionTaskId === input.taskId
        && Number(safeRecord(safeRecord(row.configuration).revisionExecution).revisionVersion ?? 0) === version)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const latestReview = reviewExecutions.at(-1);
    if (!latestReview) {
      throw new Error("REVIEW_RESUME_NOT_ELIGIBLE:NO_REVIEW_EXECUTION_FOR_VERSION");
    }
    if (latestReview.status !== "failed" || !TECHNICAL_FAILURE_STATES.has(String(safeRecord(latestReview.configuration).lifecycleState))) {
      throw new Error(`REVIEW_RESUME_NOT_ELIGIBLE:LAST_REVIEW_NOT_TECHNICAL_FAILURE:${latestReview.status}/${String(safeRecord(latestReview.configuration).lifecycleState ?? "none")}`);
    }
    // No valid Review artifact for the failed attempt, and no later one either.
    const artifacts = await this.persistence.listArtifacts(task.workflowId);
    const laterReview = artifacts.find((artifact) => artifact.kind === "review_report" && artifact.createdAt > latestReview.startedAt);
    if (laterReview) {
      throw new Error("REVIEW_RESUME_NOT_ELIGIBLE:LATER_REVIEW_ARTIFACT_EXISTS");
    }

    // Frozen package: the canonical COMPLETED artifacts of THIS revision version.
    const frozen = (kind: string, label: string): string => {
      const candidates = artifacts.filter((a) => a.kind === kind && a.status === "completed"
        && safeRecord(safeRecord(a.payload).revision).revisionTaskId === input.taskId
        && Number(safeRecord(safeRecord(a.payload).revision).revisionVersion ?? 0) === version);
      const latest = candidates.at(-1);
      if (!latest) throw new Error(`REVIEW_RESUME_NOT_ELIGIBLE:FROZEN_${label.toUpperCase()}_ARTIFACT_MISSING`);
      return latest.artifactId;
    };
    const frozenWriterArtifactId = frozen("writer_report", "writer");
    const frozenSeoArtifactId = frozen("seo_report", "seo");
    const frozenBrandArtifactId = frozen("brand_report", "brand");

    // Frozen package reload + contract validation (shape checks; full agent
    // revalidation happens in the executor at execution time).
    const byId = new Map(artifacts.map((a) => [a.artifactId, a]));
    const writerPayload = byId.get(frozenWriterArtifactId)?.payload as Record<string, unknown> | undefined;
    const seoPayload = byId.get(frozenSeoArtifactId)?.payload as Record<string, unknown> | undefined;
    const brandPayload = byId.get(frozenBrandArtifactId)?.payload as Record<string, unknown> | undefined;
    if (!writerPayload || typeof writerPayload.title !== "string" || typeof writerPayload.content !== "string" || typeof writerPayload.status !== "string") {
      throw new Error("REVIEW_RESUME_NOT_ELIGIBLE:FROZEN_WRITER_CONTRACT_INVALID");
    }
    if (!seoPayload || typeof seoPayload.optimizedTitle !== "string" || typeof seoPayload.status !== "string") {
      throw new Error("REVIEW_RESUME_NOT_ELIGIBLE:FROZEN_SEO_CONTRACT_INVALID");
    }
    if (!brandPayload || typeof brandPayload.status !== "string") {
      throw new Error("REVIEW_RESUME_NOT_ELIGIBLE:FROZEN_BRAND_CONTRACT_INVALID");
    }

    // No active (unsettled) resume for the same version: the task is FAILED,
    // so a prior resume (if any) has settled. If the task were IN_PROGRESS
    // with a resume row, a duplicate authorization is idempotent below.

    // --- Canonical configuration (fail-closed, like the revision dispatcher). ---
    let canonicalConfiguration: Record<string, { provider: string | null; model: string | null; source: string }> = {};
    if (task.projectId) {
      try {
        canonicalConfiguration = await this.control.agentConfigurationMap(task.projectId);
      } catch (error) {
        throw new Error(`RUNTIME_CONFIGURATION_RESOLUTION_FAILED:${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // Execution-scoped temporary validation override: applied ONLY to the
    // injected per-execution controlAgentOverrides of this resume, never to
    // the persistent control plane. The durable resume row retains the full
    // override provenance for audit.
    if (input.reviewOverride !== undefined) {
      const model = input.reviewOverride.model.trim();
      if (input.reviewOverride.provider !== "openrouter" || model === "") {
        throw new Error("REVIEW_RESUME_OVERRIDE_INVALID:only openrouter provider with an explicit model is supported");
      }
      canonicalConfiguration = {
        ...canonicalConfiguration,
        review: { provider: "openrouter", model, source: "RESUME_SCOPED_TEMPORARY_VALIDATION" },
      };
    }

    // --- Exactly-once durable resume row (task + version + attempt). ---
    const priorRows = await this.pool.query(
      `SELECT * FROM review_resume_dispatches WHERE task_id=$1 AND revision_version=$2 ORDER BY resume_attempt DESC`,
      [input.taskId, version],
    );
    const prior = priorRows.rows[0];
    const resumeAttempt = prior ? Number(prior.resume_attempt) + 1 : 1;
    const resumeId = `review-resume-${input.taskId}-v${version}-r${resumeAttempt}`;
    const idempotencyIdentity = `review-resume:${input.taskId}:v${version}:${latestReview.executionId}`;
    const existingRow = await this.pool.query(`SELECT job_id FROM review_resume_dispatches WHERE resume_id=$1`, [resumeId]);
    if (existingRow.rowCount) {
      return {
        created: false, resumeId, revisionVersion: version, resumeAttempt,
        failedReviewExecutionId: latestReview.executionId,
        frozenWriterArtifactId, frozenSeoArtifactId, frozenBrandArtifactId,
        jobId: existingRow.rows[0].job_id === null || existingRow.rows[0].job_id === undefined ? null : Number(existingRow.rows[0].job_id), task,
      };
    }
    const insert = await this.pool.query(
      `INSERT INTO review_resume_dispatches (resume_id, task_id, workflow_id, revision_version, resume_attempt, failed_review_execution_id, frozen_writer_artifact_id, frozen_seo_artifact_id, frozen_brand_artifact_id, reason, authorization_status, review_override_provider, review_override_model, review_override_scope, idempotency_identity, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'OWNER_APPROVED',$11,$12,$13,$14,$15) ON CONFLICT DO NOTHING RETURNING resume_id`,
      [resumeId, input.taskId, task.workflowId, version, resumeAttempt, latestReview.executionId, frozenWriterArtifactId, frozenSeoArtifactId, frozenBrandArtifactId, input.rationale,
        input.reviewOverride?.provider ?? null, input.reviewOverride?.model ?? null,
        input.reviewOverride === undefined ? null : "EXECUTION_OR_RESUME_SCOPED_TEMPORARY_VALIDATION",
        idempotencyIdentity,
        new Date().toISOString()],
    );
    if (!insert.rowCount) {
      const settled = await this.pool.query(
        `SELECT * FROM review_resume_dispatches
         WHERE task_id=$1 AND revision_version=$2 AND failed_review_execution_id=$3
         ORDER BY resume_attempt DESC LIMIT 1`,
        [input.taskId, version, latestReview.executionId],
      );
      const row = settled.rows[0];
      if (!row) throw new Error("REVIEW_RESUME_IDEMPOTENCY_CONFLICT_WITHOUT_CANONICAL_DISPATCH");
      return {
        created: false, resumeId: row.resume_id, revisionVersion: version, resumeAttempt: Number(row.resume_attempt),
        failedReviewExecutionId: row.failed_review_execution_id,
        frozenWriterArtifactId: row.frozen_writer_artifact_id,
        frozenSeoArtifactId: row.frozen_seo_artifact_id,
        frozenBrandArtifactId: row.frozen_brand_artifact_id,
        jobId: row.job_id === null || row.job_id === undefined ? null : Number(row.job_id), task,
      };
    }

    // --- Rewind ONLY the review step; content stages stay completed. ---
    const submission = await new PostgresQueue(this.pool).loadSubmissionByWorkflow(task.workflowId);
    if (!submission) throw new Error("REVIEW_RESUME_WORKFLOW_SUBMISSION_NOT_FOUND");
    const definition = submission.definition;
    if (!definition.steps.some((step: { id: string }) => step.id === "review")) throw new Error("REVIEW_RESUME_TARGET_STEP_NOT_FOUND");
    await rewindWorkflow(this.persistence, definition, {
      workflowId: task.workflowId,
      targetStepId: "review",
      requiredArtifactsByStep: { writer: { artifactKind: "writer_report" }, seo: { artifactKind: "seo_report" }, brand: { artifactKind: "brand_report" } },
      preserveCompletedStepIds: ["planner-initial", "research", "planner-synthesis", "writer", "seo", "brand"],
      rewindStepIds: ["review"],
      reason: `Owner-authorized Review-only technical resume v${version} attempt ${resumeAttempt}: ${input.rationale}`,
    });
    const workflow = await this.persistence.loadWorkflow(task.workflowId);
    if (!workflow) throw new Error("REVIEW_RESUME_WORKFLOW_NOT_FOUND_AFTER_REWIND");

    // Preserve the revisionExecution marker (revision lineage + ambiguity-guard
    // identity); add the reviewResumeExecution marker with the frozen package.
    const data = workflow.context.data as Record<string, unknown>;
    const reviewResumeExecution = {
      resumeId,
      revisionTaskId: input.taskId,
      revisionVersion: version,
      resumeAttempt,
      failedReviewExecutionId: latestReview.executionId,
      frozenWriterArtifactId,
      frozenSeoArtifactId,
      frozenBrandArtifactId,
      resumeAuthorization: "OWNER_APPROVED",
    };
    const { reviewBusinessOutcome: _cleared, ...restData } = data;
    await this.persistence.saveWorkflow({
      ...workflow,
      context: { ...workflow.context, data: { ...restData, reviewResumeExecution, controlAgentOverrides: canonicalConfiguration } as never },
      updatedAt: new Date().toISOString(),
    });

    const jobId = await new PostgresQueue(this.pool).enqueue(task.workflowId, submission.submissionKey);
    await this.pool.query(`UPDATE review_resume_dispatches SET job_id=$2 WHERE resume_id=$1`, [resumeId, jobId]);
    await this.pool.query(`UPDATE review_revision_tasks SET status='IN_PROGRESS' WHERE task_id=$1 AND status='FAILED'`, [input.taskId]);
    if (task.commandId) {
      await this.pool.query(
        `UPDATE control_commands SET status='REVIEW_RESUME_AUTHORIZED', visible_result=COALESCE($3,visible_result), updated_at=$4 WHERE command_id=$1 AND project_id=$2`,
        [task.commandId, task.projectId, JSON.stringify({ kind: "REVIEW_RESUME_AUTHORIZED", revisionTaskId: input.taskId, revisionVersion: version, resumeAttempt, resumeId, failedReviewExecutionId: latestReview.executionId, frozenWriterArtifactId, frozenSeoArtifactId, frozenBrandArtifactId, ...(input.reviewOverride === undefined ? {} : { reviewModelOverride: { provider: input.reviewOverride.provider, model: input.reviewOverride.model, scope: "EXECUTION_OR_RESUME_SCOPED_TEMPORARY_VALIDATION", classification: "TEMPORARY_VALIDATION_STACK" } }), authorizedBy: input.authorizedBy, rationale: input.rationale }), new Date().toISOString()],
      );
    }
    const dispatched = await this.loadTask(input.taskId);
    return {
      created: true, resumeId, revisionVersion: version, resumeAttempt,
      failedReviewExecutionId: latestReview.executionId,
      frozenWriterArtifactId, frozenSeoArtifactId, frozenBrandArtifactId,
      jobId, task: dispatched,
    };
  }

  private async loadTask(taskId: string): Promise<ReviewRevisionTask> {
    const q = await this.pool.query(`SELECT * FROM review_revision_tasks WHERE task_id=$1`, [taskId]);
    if (!q.rowCount) throw new Error("REVISION_TASK_NOT_FOUND");
    const r = q.rows[0];
    return {
      taskId: r.task_id, workflowId: r.workflow_id, commandId: r.command_id, projectId: r.project_id,
      correlationId: r.correlation_id, reviewExecutionId: r.review_execution_id, reviewArtifactId: r.review_artifact_id,
      writerArtifactId: r.writer_artifact_id, seoArtifactId: r.seo_artifact_id, brandArtifactId: r.brand_artifact_id,
      status: r.status, reviewStatus: r.review_status, summary: r.summary,
      findings: typeof r.findings === "string" ? JSON.parse(r.findings) : r.findings,
      recommendations: typeof r.recommendations === "string" ? JSON.parse(r.recommendations) : r.recommendations,
      createdAt: r.created_at, revisionVersion: Number(r.revision_version ?? 0),
      authorizedAt: r.authorized_at ?? null, authorizedBy: r.authorized_by ?? null, completedAt: r.completed_at ?? null,
    };
  }
}
