import type pg from "pg";
import { rewindWorkflow } from "@ai-media-factory/workflow-engine";
import type { PostgresPersistence } from "./adapter.js";
import { PostgresQueue } from "./queue.js";
import { ControlPlaneStore, type ReviewRevisionTask } from "./control-plane.js";
import { assertRecoveryHorizon } from "./recovery-framework.js";

export interface RevisionAuthorizeInput {
  readonly taskId: string;
  readonly authorizedBy: string;
  readonly rationale: string;
}

export interface RevisionDispatchResult {
  /** True only when this call performed the durable rewind + enqueue. */
  readonly created: boolean;
  readonly dispatchId: string;
  readonly revisionVersion: number;
  readonly jobId: number | null;
  readonly task: ReviewRevisionTask;
}

/**
 * Durable Revision Cycle dispatcher (Revision Cycle V1).
 *
 * One owner action — AUTHORIZE_REVISION — drives a PENDING (or FAILED, after
 * an owner-reviewed technical failure) revision task through exactly one
 * durable dispatch per authorized version:
 *
 *   resolve canonical stage configuration from the control plane
 *   (fail-closed STOP_PRE_SUBMISSION on resolution failure)
 *   CAS task -> AUTHORIZED (revision_version++)
 *   -> insert revision_dispatches (unique dispatch_id per task+version)
 *   -> rewind workflow to the Writer stage (preserve Planner/Research inputs)
 *   -> inject the owner-authorized revisionExecution lineage marker and the
 *      canonical controlAgentOverrides (the same GLOBAL→PROJECT→AGENT
 *      resolution the production worker uses, so revision stages honor their
 *      task-class policy instead of ambient defaults — Revision v1 incident)
 *   -> enqueue the persistent-worker job
 *   -> CAS task -> IN_PROGRESS + command status REVISION_AUTHORIZED
 *
 * Duplicate authorization re-reads the durable state and never dispatches a
 * second time; concurrent authorization collapses onto the single dispatch
 * row; a COMPLETED task can never launch again. This class never creates an
 * engine or provider executor: the persistent WorkflowWorker is the only
 * provider transport path.
 */
export class PostgresRevisionDispatcher {
  private readonly control: ControlPlaneStore;
  constructor(private readonly pool: pg.Pool, private readonly persistence: PostgresPersistence) {
    this.control = new ControlPlaneStore(pool);
  }

  async authorizeAndDispatch(input: RevisionAuthorizeInput): Promise<RevisionDispatchResult> {
    assertRecoveryHorizon("REVISION", "writer", ["planner-initial", "research", "planner-synthesis"], ["writer", "seo", "brand", "review"]);
    const task = await this.loadTask(input.taskId);
    if (task.status === "COMPLETED") {
      return { created: false, dispatchId: "", revisionVersion: task.revisionVersion, jobId: null, task };
    }
    // Resolve the canonical stage configuration BEFORE any durable mutation:
    // a governed project whose effective configuration cannot be resolved is
    // a STOP_PRE_SUBMISSION condition, never a silent ambient fallback.
    let canonicalConfiguration: Record<string, { provider: string | null; model: string | null; source: string }> = {};
    if (task.projectId) {
      try {
        canonicalConfiguration = await this.control.agentConfigurationMap(task.projectId);
      } catch (error) {
        throw new Error(`RUNTIME_CONFIGURATION_RESOLUTION_FAILED:${error instanceof Error ? error.message : String(error)}`);
      }
    }
    let version = task.revisionVersion;
    if (task.status === "PENDING" || task.status === "FAILED") {
      // Atomic owner-authorization CAS. Exactly one concurrent caller wins.
      const cas = await this.pool.query(
        `UPDATE review_revision_tasks SET status='AUTHORIZED', revision_version=revision_version+1, authorized_at=$2, authorized_by=$3 WHERE task_id=$1 AND status IN ('PENDING','FAILED') RETURNING revision_version`,
        [input.taskId, new Date().toISOString(), input.authorizedBy],
      );
      if (cas.rowCount) version = Number(cas.rows[0].revision_version);
    }
    const current = await this.loadTask(input.taskId);
    version = current.revisionVersion;

    const dispatchId = `revision-dispatch-${input.taskId}-v${version}`;
    const existing = await this.pool.query(`SELECT job_id FROM revision_dispatches WHERE dispatch_id=$1`, [dispatchId]);
    if (existing.rowCount) {
      return { created: false, dispatchId, revisionVersion: version, jobId: existing.rows[0].job_id === null ? null : Number(existing.rows[0].job_id), task: current };
    }
    const insert = await this.pool.query(
      `INSERT INTO revision_dispatches (dispatch_id, task_id, workflow_id, revision_version, reason, authorization_status, created_at)
       VALUES ($1,$2,$3,$4,$5,'OWNER_APPROVED',$6) ON CONFLICT (dispatch_id) DO NOTHING RETURNING dispatch_id`,
      [dispatchId, input.taskId, task.workflowId, version, input.rationale, new Date().toISOString()],
    );
    if (!insert.rowCount) {
      const settled = await this.pool.query(`SELECT job_id FROM revision_dispatches WHERE dispatch_id=$1`, [dispatchId]);
      return { created: false, dispatchId, revisionVersion: version, jobId: settled.rows[0]?.job_id === null || settled.rows[0]?.job_id === undefined ? null : Number(settled.rows[0].job_id), task: current };
    }

    // Exactly-once dispatch holder: validate the durable lineage, rewind, enqueue.
    const submission = await new PostgresQueue(this.pool).loadSubmissionByWorkflow(task.workflowId);
    if (!submission) throw new Error("REVISION_WORKFLOW_SUBMISSION_NOT_FOUND");
    const definition = submission.definition;
    const preserve = ["planner-initial", "research", "planner-synthesis"];
    if (!definition.steps.some((step: { id: string }) => step.id === "writer")) throw new Error("REVISION_TARGET_STEP_NOT_FOUND");
    const artifacts = await this.persistence.listArtifacts(task.workflowId);
    const byId = new Map(artifacts.map((artifact) => [artifact.artifactId, artifact]));
    const sourceReview = byId.get(task.reviewArtifactId);
    if (!sourceReview || sourceReview.kind !== "review_report") throw new Error("REVISION_SOURCE_REVIEW_ARTIFACT_REQUIRED");
    for (const [label, artifactId] of [["writer", task.writerArtifactId], ["seo", task.seoArtifactId], ["brand", task.brandArtifactId]] as const) {
      if (!byId.has(artifactId)) throw new Error(`REVISION_SOURCE_${label.toUpperCase()}_ARTIFACT_REQUIRED`);
    }
    await rewindWorkflow(this.persistence, definition, {
      workflowId: task.workflowId,
      targetStepId: "writer",
      requiredArtifactsByStep: { research: { artifactKind: "research_report" }, "planner-synthesis": { artifactKind: "evidence_backed_content_brief" } },
      preserveCompletedStepIds: preserve,
      rewindStepIds: definition.steps.map((step: { id: string }) => step.id).filter((id: string) => !preserve.includes(id)),
      reason: `Owner-authorized revision cycle v${version}: ${input.rationale}`,
    });
    const workflow = await this.persistence.loadWorkflow(task.workflowId);
    if (!workflow) throw new Error("REVISION_WORKFLOW_NOT_FOUND_AFTER_REWIND");
    const revisionExecution = {
      revisionTaskId: task.taskId,
      revisionVersion: version,
      reviewArtifactId: task.reviewArtifactId,
      reviewExecutionId: task.reviewExecutionId ?? "",
      priorWriterArtifactId: task.writerArtifactId,
      priorSeoArtifactId: task.seoArtifactId,
      priorBrandArtifactId: task.brandArtifactId,
      revisionAuthorization: "OWNER_APPROVED",
      replayUpstreamStages: false,
    };
    const { reviewBusinessOutcome: _cleared, ...restData } = workflow.context.data as Record<string, unknown>;
    await this.persistence.saveWorkflow({
      ...workflow,
      context: { ...workflow.context, data: { ...restData, revisionExecution, controlAgentOverrides: canonicalConfiguration } as never },
      updatedAt: new Date().toISOString(),
    });

    const jobId = await new PostgresQueue(this.pool).enqueue(task.workflowId, submission.submissionKey);
    await this.pool.query(`UPDATE revision_dispatches SET job_id=$2 WHERE dispatch_id=$1`, [dispatchId, jobId]);
    await this.pool.query(`UPDATE review_revision_tasks SET status='IN_PROGRESS' WHERE task_id=$1 AND status='AUTHORIZED'`, [input.taskId]);
    if (task.commandId) {
      await this.pool.query(
        `UPDATE control_commands SET status='REVISION_AUTHORIZED', visible_result=COALESCE($3,visible_result), updated_at=$4 WHERE command_id=$1 AND project_id=$2`,
        [task.commandId, task.projectId, JSON.stringify({ kind: "REVISION_AUTHORIZED", revisionTaskId: task.taskId, revisionVersion: version, sourceReviewArtifactId: task.reviewArtifactId, summary: task.summary, authorizedBy: input.authorizedBy, rationale: input.rationale }), new Date().toISOString()],
      );
    }
    const dispatched = await this.loadTask(input.taskId);
    return { created: true, dispatchId, revisionVersion: version, jobId, task: dispatched };
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
