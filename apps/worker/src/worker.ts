/**
 * WorkflowWorker — consumes durable queue jobs and runs them to completion
 * through the durable Workflow Engine.
 *
 * Flow (per job):
 *   claim next job  →  load submission  →  build durable engine
 *   →  start (new) OR resume (crash re-run)  →  wait for terminal state
 *   →  acknowledge (succeeded / failed)  →  update submission status.
 *
 * Crash safety: a killed worker leaves its job `running`. On restart,
 * recoverOrphans() re-queues stale running jobs; engine.resume() reloads the
 * checkpoint, skips completed stages and re-runs only in-flight steps
 * idempotently (no duplicated artifacts / evidence / lineage).
 */

import type { PersistencePort, WorkflowDefinition, DefaultWorkflowEngine, ApprovalDecision } from "@ai-media-factory/workflow-engine";
import type { AgentExecutorPort, Json } from "@ai-media-factory/shared";
import type { PostgresQueue, WorkflowJob, RequestVisualIterationInput, VisualIterationRecord, TargetedVerificationDispatchRecord, TargetedReevaluationRecoveryRecord } from "@ai-media-factory/database";
import type { TargetedVerificationExecutionResult, TargetedReevaluationRecoveryExecutionResult } from "./targeted-verification.js";
import { OWNER_PRE_MEDIA_GATE_STEP_ID, withPreProductionOwnerGate } from "@ai-media-factory/orchestrator";
import { buildDefaultEngine } from "./engine.js";
import { waitForTerminalState } from "./engine.js";
import { GovernedAgentRuntime, type EffectiveRuntimeConfig } from "./governed-agent-runtime.js";
import { participantContract, internalAnalysisBudget } from "./research-contracts.js";
import type { ExecutionResponse } from "@ai-media-factory/runtime";
import { resolveApprovedProjectContext } from "./project-context.js";
type ApprovalRecord = { approvalId: string; targetType: string; targetId: string; status: string; ownerDecision: "APPROVE" | "MODIFY" | "REJECT" | "REQUEST_ITERATION" | "OVERRIDE" | null; ownerRationale: string | null; decidedAt: string | null };
type CommandControlPort = {
  updateCommand(commandId: string, input: { status: string; visibleResult?: unknown; synthesis?: unknown; artifactRefs?: unknown[] }): Promise<void>;
  createApproval(input: { approvalId: string; projectId: string; targetType: string; targetId: string; agentRecommendation: unknown; agentConfidence: string | null; evidenceRefs: unknown[]; status: string; supersedes: string | null; supersededBy: string | null; createdAt: string }): Promise<ApprovalRecord>;
  getApproval(approvalId: string): Promise<ApprovalRecord | null>;
  createReviewRevisionTask?(input: { taskId: string; workflowId: string; commandId: string | null; projectId: string | null; correlationId: string | null; reviewExecutionId: string | null; reviewArtifactId: string; writerArtifactId: string; seoArtifactId: string; brandArtifactId: string; status: "PENDING"; reviewStatus: "changes_requested" | "owner_iteration_requested"; summary: string; findings: unknown[]; recommendations: unknown[]; createdAt: string }): Promise<unknown>;
  /** Revision Cycle V1: settle the source revision task once its cycle reaches a business boundary. */
  settleReviewRevisionTask?(input: { taskId: string; status: "COMPLETED" | "FAILED"; completedAt: string }): Promise<unknown>;
  /** Human-gate governance: resolve the effective gate policy for a project (snapshot semantics). */
  effectiveHumanGatePolicy?(projectId: string): Promise<{ preProductionEnabled: boolean; visualHumanGateEnabled: boolean; resolvedScope: string; configurationVersion: number; resolvedAt: string }>;
  /** Media Technical Resume V1: settle the durable resume outcome at the boundary. */
  settleMediaResumeOutcome?(input: { resumeId: string; outcome: "VISUAL_GATE_PENDING" | "COMPLETED" | "FAILED" }): Promise<unknown>;
};

/** Human-gate keys mapped to the two configurable gate steps. */
const CONFIGURABLE_GATE_STEP_IDS = new Set(["pre-production-owner-gate", "visual-human-gate"]);

/**
 * Durable gate identity for the Control Plane. The two production governance
 * approvals are deliberately distinct types: pre-production content approval
 * (before media work begins) vs post-visual-QA approval (before Wan execution).
 */
function gateTypeFor(stepId: string): string {
  if (stepId === OWNER_PRE_MEDIA_GATE_STEP_ID) return "OWNER_PRE_MEDIA_REVIEW_REQUIRED";
  if (stepId === "pre-production-owner-gate") return "PRE_PRODUCTION_CONTENT_APPROVAL";
  if (stepId === "visual-human-gate") return "POST_VISUAL_QA_APPROVAL";
  if (stepId === "final-human-gate") return "FINAL_PUBLICATION_APPROVAL";
  return `WORKFLOW_GATE:${stepId}`;
}

/** Revision-task identity of a workflow instance rewound by the revision dispatcher. */
function revisionTaskIdOf(instance: { context: { data: Record<string, unknown> } } | null | undefined): string | null {
  const revision = instance?.context?.data?.revisionExecution;
  if (revision === null || typeof revision !== "object" || Array.isArray(revision)) return null;
  const taskId = (revision as Record<string, unknown>).revisionTaskId;
  return typeof taskId === "string" && taskId.trim() !== "" ? taskId : null;
}

/** Media-resume identity of a workflow instance rewound by the media-resume dispatcher. */
function mediaResumeIdOf(instance: { context: { data: Record<string, unknown> } } | null | undefined): string | null {
  const mediaResume = instance?.context?.data?.mediaResumeExecution;
  if (mediaResume === null || typeof mediaResume !== "object" || Array.isArray(mediaResume)) return null;
  const resumeId = (mediaResume as Record<string, unknown>).resumeId;
  return typeof resumeId === "string" && resumeId.trim() !== "" ? resumeId : null;
}

/**
 * Bounded-stop completion: the instance is PAUSED with a durable boundedStop
 * marker whose stopAfter step actually completed. Plain external pauses carry
 * no marker and keep the previous wait semantics.
 */
function isBoundedStopComplete(instance: {
  steps: ReadonlyArray<{ stepId: string; status: string }>;
  context: { data: Record<string, unknown> };
} | null | undefined): boolean {
  const marker = instance?.context?.data?.boundedStop;
  if (marker === null || typeof marker !== "object" || Array.isArray(marker)) return false;
  const stopAfterStepId = (marker as Record<string, unknown>).stopAfterStepId;
  if (typeof stopAfterStepId !== "string" || stopAfterStepId.trim() === "") return false;
  return instance?.steps.some((step) => step.stepId === stopAfterStepId && step.status === "completed") === true;
}

export interface WorkflowWorkerDeps {
  readonly queue: PostgresQueue;
  readonly persistence: PersistencePort;
  readonly executor: AgentExecutorPort;
  /** Reclaim a running job older than this (ms) after a worker crash. */
  readonly orphanStaleMs?: number;
  readonly workerInstanceId?: string;
  readonly jobLeaseHeartbeatMs?: number;
  readonly pollMs?: number;
  readonly buildEngine?: (definition: WorkflowDefinition) => DefaultWorkflowEngine;
  readonly resolveCommandConfiguration?: (projectId: string) => Promise<Record<string, { provider: string | null; model: string | null; source: string; routingVersionId?: string; routingScope?: string; priceSnapshotId?: string }>>;
  /** Production wiring supplies the canonical route/catalog/context preflight. */
  readonly preflightGovernedCommand?: (input: { projectId: string; role: string; provider: "agentrouter" | "openrouter"; model: string; routingVersionId?: string; prompt: string; system: string; outputTokens: number }) => Promise<{ fingerprint: string }>;
  /**
   * Strategic Operating Layer V1 resolver. When wired, governed commands
   * resolve task-aware strategic context + immutable snapshot per agent.
   * Absent => legacy approved project context (existing behavior).
   */
  readonly resolveStrategicContext?: (projectId: string, agentId: string, requested: unknown, operational?: Record<string, Json> | null) => Promise<{ context: Record<string, Json>; snapshotId: string | null }>;
  /**
   * Slice 5 remediation: compact operational evidence (lifecycle +
   * actionability truth) merged into governed context. Absent => context
   * carries strategic/legacy state only. Best-effort: nulls never block.
   */
  readonly resolveOperationalContext?: (projectId: string) => Promise<Record<string, Json> | null>;
  /**
   * Slice 5 offline-proof seam: overrides the provider transport for governed
   * agent execution. Absent => production transport. Used only by isolated
   * tests; production wiring never passes it.
   */
  readonly governedExecute?: (input: { agentId: string; workflowId: string; correlationId?: string | null; provider: "agentrouter" | "openrouter"; model: string; system: string; prompt: string; metadata?: Record<string, Json>; maxOutputTokens?: number; reasoning?: { readonly effort: "none" } }) => Promise<ExecutionResponse>;
  /** Command execution is optional so legacy workflow-only workers remain compatible. */
  readonly control?: CommandControlPort;
  /**
   * Governed Visual Iteration V1 store. Required only when a visual-human-gate
   * owner iteration must be routed to a VisualIteration (never a
   * ReviewRevisionTask). Absent => fail closed with
   * VISUAL_ITERATION_STORE_REQUIRED.
   */
  readonly visualIterations?: {
    requestVisualIteration(input: RequestVisualIterationInput): Promise<{ created: boolean; iteration: VisualIterationRecord }>;
  };
  /** Distinct Research TARGETED_VERIFICATION job path; never enters the normal workflow engine. */
  readonly targetedVerification?: {
    byJobId(jobId: number): Promise<TargetedVerificationDispatchRecord | null>;
    markRunning(dispatchId: string): Promise<boolean>;
    execute(dispatch: TargetedVerificationDispatchRecord): Promise<TargetedVerificationExecutionResult>;
    settle(dispatchId: string, status: "COMPLETED" | "FAILED", revisionId?: string, errorCode?: string): Promise<void>;
  };
  /** Retrieval-free continuation of a failed targeted reevaluation. */
  readonly targetedReevaluationRecovery?: {
    byJobId(jobId:number):Promise<TargetedReevaluationRecoveryRecord|null>;
    markRunning(recoveryId:string):Promise<boolean>;
    execute(recovery:TargetedReevaluationRecoveryRecord):Promise<TargetedReevaluationRecoveryExecutionResult>;
    settle(recoveryId:string,status:"COMPLETED"|"FAILED",revisionId?:string,errorCode?:string,routeSnapshot?:Record<string,unknown>):Promise<void>;
  };
}

export class WorkflowWorker {
  private readonly staleMs: number;
  private readonly pollMs: number;
  private readonly buildEngine: (definition: WorkflowDefinition) => DefaultWorkflowEngine;
  private stopped = false;

  constructor(private readonly deps: WorkflowWorkerDeps) {
    this.staleMs = deps.orphanStaleMs ?? 10_000;
    this.pollMs = deps.pollMs ?? 100;
    this.buildEngine =
      deps.buildEngine ??
      ((definition) =>
        buildDefaultEngine({
          persistence: deps.persistence,
          executor: deps.executor,
          definitionLoader: async () => definition,
        }));
  }

  /** Requeue stale running jobs left by a crashed worker. Returns count. */
  async recoverOrphans(): Promise<number> {
    return this.deps.queue.recoverOrphanedJobs(this.staleMs);
  }

  /**
   * Claim + process one job. Returns true if a job was handled, false if the
   * queue was empty. Used directly by tests; runLoop() drives it continuously.
   */
  async runOnce(): Promise<boolean> {
    const job = await this.deps.queue.claimNextJob(this.deps.workerInstanceId);
    if (job === null) return false;
    const heartbeatMs = this.deps.jobLeaseHeartbeatMs ?? Math.max(1_000, Math.floor(this.staleMs / 3));
    const heartbeat = this.deps.workerInstanceId
      ? setInterval(() => { void this.deps.queue.heartbeatJob(job.jobId, this.deps.workerInstanceId!); }, heartbeatMs)
      : null;
    if (heartbeat && typeof heartbeat.unref === "function") heartbeat.unref();
    try { await this.process(job); } finally { if (heartbeat) clearInterval(heartbeat); }
    return true;
  }

  async runLoop(): Promise<void> {
    await this.recoverOrphans();
    while (!this.stopped) {
      const handled = await this.runOnce();
      if (!handled) await new Promise((r) => setTimeout(r, this.pollMs));
    }
  }

  stop(): void {
    this.stopped = true;
  }

  private async process(job: WorkflowJob): Promise<void> {
    const reevaluationRecovery=await this.deps.targetedReevaluationRecovery?.byJobId(job.jobId)??null;
    if(reevaluationRecovery!==null)return this.processTargetedReevaluationRecovery(job,reevaluationRecovery);
    const targeted = await this.deps.targetedVerification?.byJobId(job.jobId) ?? null;
    if (targeted !== null) return this.processTargetedVerification(job, targeted);
    const submission = await this.deps.queue.loadSubmissionByWorkflow(job.workflowId);
    if (submission === null) {
      await this.deps.queue.acknowledge(job.jobId, "failed", "submission not found");
      return;
    }

    const command = submission.commandContext as Record<string, unknown> | undefined;
    if (command?.commandType === "ASK_AGENT" || command?.commandType === "MULTI_AGENT_REVIEW") {
      return this.processGovernedCommand(job, submission, command);
    }
    // Legacy produce submissions predate PRE_PRODUCTION_OWNER_GATE; upgrade the
    // persisted definition (idempotent) so resume stops for owner approval
    // between Review and Director instead of continuing into media production.
    const definition = submission.directive === "produce-pre-media" ? submission.definition : withPreProductionOwnerGate(submission.definition);
    const engine = this.buildEngine(definition);
    const existing = await this.deps.persistence.loadWorkflow(job.workflowId);

    try {
      if (existing === null) {
        // A governed (brand-scoped) submission must resolve its effective
        // stage configuration from the canonical control plane before any
        // stage executes. A missing resolver is an operator-path wiring
        // defect: fail closed here — before any provider submission — rather
        // than silently inheriting ambient TEXT_AGENT_PROVIDER / model
        // defaults (Revision v1 incident, 2026-09-13).
        let scopedConfiguration: Record<string, { provider: string | null; model: string | null; source: string }> = {};
        if (submission.brandId) {
          if (!this.deps.resolveCommandConfiguration) throw new Error("RUNTIME_CONFIGURATION_RESOLUTION_FAILED:GOVERNED_CONFIGURATION_RESOLVER_NOT_WIRED");
          try {
            scopedConfiguration = await this.deps.resolveCommandConfiguration(submission.brandId);
          } catch (error) {
            throw new Error(`RUNTIME_CONFIGURATION_RESOLUTION_FAILED:${error instanceof Error ? error.message : String(error)}`);
          }
        }
        // START_GOVERNED_TASK is dispatched from Command Room. Its owner
        // instruction is the canonical workflow objective, rather than a
        // mere command envelope field; otherwise the production stages only
        // see the directive name (for example, "research").
        const ownerObjective = command?.commandType === "START_GOVERNED_TASK" && typeof command.ownerMessage === "string"
          ? command.ownerMessage.trim()
          : "";
        await engine.start({
          definition,
          trigger: {
            directive: submission.directive,
            ...(submission.commandContext ?? {}),
            ...(ownerObjective === "" ? {} : { objective: ownerObjective, contentTopic: ownerObjective }),
            controlAgentOverrides: scopedConfiguration,
          },
          correlationId: submission.correlationId ?? undefined,
          brandId: submission.brandId ?? undefined,
          workflowId: job.workflowId,
        });
      } else {
        // Resume of a governed submission with NO persisted stage overrides
        // and no wired resolver is the same operator-path defect class: fail
        // closed before resuming into ambient routing.
        if (submission.brandId && !this.deps.resolveCommandConfiguration) {
          const persisted = await this.deps.persistence.loadWorkflow(job.workflowId);
          const overrides = (persisted?.context?.data as Record<string, unknown> | undefined)?.controlAgentOverrides;
          const hasOverrides = overrides !== null && typeof overrides === "object" && !Array.isArray(overrides) && Object.keys(overrides).length > 0;
          if (!hasOverrides) throw new Error("RUNTIME_CONFIGURATION_RESOLUTION_FAILED:GOVERNED_CONFIGURATION_RESOLVER_NOT_WIRED");
        }
        await engine.resume(job.workflowId);
      }

      const state = await this.waitForTerminalOrOwnerApproval(engine, submission, job.workflowId);
      const revisionTaskId = revisionTaskIdOf(existing);
      const mediaResumeId = mediaResumeIdOf(existing);
      const settleMediaResume = async (outcome: "VISUAL_GATE_PENDING" | "COMPLETED" | "FAILED"): Promise<void> => {
        if (mediaResumeId === null) return;
        if (!this.deps.control?.settleMediaResumeOutcome) throw new Error("MEDIA_RESUME_SETTLE_STORE_REQUIRED");
        await this.deps.control.settleMediaResumeOutcome({ resumeId: mediaResumeId, outcome });
      };
      const settleRevisionTask = async (status: "COMPLETED" | "FAILED"): Promise<void> => {
        if (revisionTaskId === null) return;
        if (!this.deps.control?.settleReviewRevisionTask) throw new Error("REVISION_TASK_SETTLE_STORE_REQUIRED");
        await this.deps.control.settleReviewRevisionTask({ taskId: revisionTaskId, status, completedAt: new Date().toISOString() });
      };
      if (state === "COMPLETED") {
        await settleRevisionTask("COMPLETED");
        await this.deps.queue.updateSubmissionStatus(job.workflowId, "completed");
        if (command?.commandType === "START_GOVERNED_TASK" && this.deps.control && typeof command.commandId === "string") {
          const artifacts = await this.deps.persistence.listArtifacts(job.workflowId);
          await this.deps.control.updateCommand(command.commandId, { status: "COMPLETED", artifactRefs: artifacts.map((artifact) => artifact.artifactId) });
        }
        await this.deps.queue.acknowledge(job.jobId, "succeeded");
      } else if (state === "OWNER_PRE_MEDIA_REVIEW_REQUIRED") {
        await this.deps.queue.updateSubmissionStatus(job.workflowId, "owner_pre_media_review_required");
        await this.deps.queue.acknowledge(job.jobId, "succeeded");
      } else if (state === "BOUNDED_STOP") {
        // Owner-authorized bounded execution halted after its stopAfter step.
        // Successful bounded pause, not a failure: no downstream step ran.
        const boundedInstance = await this.deps.persistence.loadWorkflow(job.workflowId);
        const bounded = boundedInstance?.context.data.boundedStop as Record<string, unknown> | undefined;
        const reason = typeof bounded?.reason === "string" ? bounded.reason : "";
        if (reason.startsWith("CEO_") && this.deps.control && submission.brandId) {
          const approvalId = `approval-${job.workflowId}-ceo-recommendation`;
          if (!await this.deps.control.getApproval(approvalId)) await this.deps.control.createApproval({
            approvalId, projectId: submission.brandId, targetType: "research_decision", targetId: `${job.workflowId}:ceo-recommendation`,
            agentRecommendation: { workflowId: job.workflowId, stepId: "ceo-recommendation", gateType: "OWNER_RESEARCH_DECISION_REQUIRED", decision: reason.slice(4), required: "OWNER_DECISION" },
            agentConfidence: null, evidenceRefs: (await this.deps.persistence.listArtifacts(job.workflowId)).map((artifact) => artifact.artifactId),
            status: "PENDING", supersedes: null, supersededBy: null, createdAt: new Date().toISOString(),
          });
        }
        await this.deps.queue.updateSubmissionStatus(job.workflowId, "bounded_stop");
        await this.deps.queue.acknowledge(job.jobId, "succeeded");
      } else if (state === "REVISION_REQUIRED" || state === "BUSINESS_BLOCKED") {
        const instance = await this.deps.persistence.loadWorkflow(job.workflowId);
        const ownerIteration = instance?.context.data.preProductionOwnerDecision as Record<string, unknown> | undefined;
        const business = instance?.context.data.reviewBusinessOutcome as Record<string, unknown> | undefined;
        const artifacts = await this.deps.persistence.listArtifacts(job.workflowId);
        const review = artifacts.find((artifact) => artifact.artifactId === business?.reviewArtifactId && artifact.kind === "review_report");
        const report = review?.payload as Record<string, unknown> | undefined;
        if (ownerIteration?.decision === "REQUEST_ITERATION") {
          if (ownerIteration.stepId === "visual-human-gate") {
            // Governed Visual Iteration V1: creative downstream revision while
            // the approved content package stays valid. NEVER a
            // ReviewRevisionTask, NEVER a media resume, NEVER R9. The lineage
            // rule is explicit and recorded: approved review exact, latest
            // completed writer/seo/brand/director/narration/timeline, all
            // completed R8 visuals + QA. Scene dispositions stay UNDETERMINED
            // here; the owner records keep/regenerate during preparation.
            if (state !== "REVISION_REQUIRED" || !review || !report || !business) throw new Error("OWNER_ITERATION_REVIEW_PACKAGE_REQUIRED");
            if (!this.deps.visualIterations?.requestVisualIteration) throw new Error("VISUAL_ITERATION_STORE_REQUIRED");
            const visualApprovalId = `approval-${job.workflowId}-visual-human-gate`;
            const latestCompleted = (kind: string) => [...artifacts].reverse().find((artifact) => artifact.kind === kind && artifact.status === "completed");
            const writer = latestCompleted("writer_report");
            const writerPayload = writer?.payload as Record<string, unknown> | undefined;
            const contentId = typeof writerPayload?.contentId === "string" ? writerPayload.contentId : job.workflowId;
            const visualIteration = await this.deps.visualIterations.requestVisualIteration({
              workflowId: job.workflowId,
              contentId,
              sourceVisualApprovalId: visualApprovalId,
              sourceVisualGateState: "DECIDED",
              ownerDecision: "REQUEST_VISUAL_ITERATION",
              ownerRationale: typeof ownerIteration.rationale === "string" ? ownerIteration.rationale : "",
              lineage: {
                sourceWriterArtifactId: writer?.artifactId ?? null,
                sourceBrandArtifactId: latestCompleted("brand_report")?.artifactId ?? null,
                sourceReviewArtifactId: typeof business.reviewArtifactId === "string" ? business.reviewArtifactId : null,
                sourceDirectorArtifactId: latestCompleted("scene_plan")?.artifactId ?? null,
                sourceNarrationArtifactId: latestCompleted("narration_artifact")?.artifactId ?? null,
                sourceTimelineArtifactId: latestCompleted("timeline_plan")?.artifactId ?? null,
                sourceVisualArtifactIds: artifacts.filter((artifact) => artifact.kind === "scene_visual_artifact" && artifact.status === "completed").map((artifact) => artifact.artifactId),
                sourceSemanticQaArtifactIds: artifacts.filter((artifact) => artifact.kind === "visual_semantic_review" && artifact.status === "completed").map((artifact) => artifact.artifactId),
                sourceTechnicalQaArtifactIds: artifacts.filter((artifact) => artifact.kind === "visual_technical_qa" && artifact.status === "completed").map((artifact) => artifact.artifactId),
              },
              scenesToKeep: [],
              scenesToRegenerate: [],
              proposedImageBudget: 0,
            });
            const visualResult = { kind: "VISUAL_ITERATION_REQUESTED", gateStepId: "visual-human-gate", visualIterationId: visualIteration.iteration.visualIterationId, iterationNumber: visualIteration.iteration.iterationNumber, created: visualIteration.created, reviewArtifactId: review.artifactId };
            await this.deps.queue.updateSubmissionStatus(job.workflowId, state.toLowerCase());
            const visualCommandId = typeof instance?.context.data.commandId === "string" ? instance.context.data.commandId : typeof command?.commandId === "string" ? command.commandId : null;
            if (visualCommandId && this.deps.control) await this.deps.control.updateCommand(visualCommandId, { status: state, visibleResult: visualResult, artifactRefs: [review.artifactId] });
            await this.deps.queue.acknowledge(job.jobId, "succeeded");
            return;
          }
          // Owner REQUEST_ITERATION at PRE_PRODUCTION_OWNER_GATE: route to the
          // durable revision state with the review package and owner feedback.
          if (state !== "REVISION_REQUIRED" || !review || !report || !business) throw new Error("OWNER_ITERATION_REVIEW_PACKAGE_REQUIRED");
          if (!this.deps.control?.createReviewRevisionTask) throw new Error("REVIEW_REVISION_TASK_STORE_REQUIRED");
          // Revision cycles supersede prior content: canonical inputs are the
          // LATEST completed artifacts of each kind.
          const source = (kind: string) => [...artifacts].reverse().find((artifact) => artifact.kind === kind && artifact.status === "completed");
          const writer = source("writer_report"), seo = source("seo_report"), brand = source("brand_report");
          if (!writer || !seo || !brand) throw new Error("REVIEW_REVISION_CANONICAL_INPUTS_REQUIRED");
          const ownerRationale = typeof ownerIteration.rationale === "string" ? ownerIteration.rationale : "";
          await this.deps.control.createReviewRevisionTask({
            taskId: `revision-${job.workflowId}-${review.artifactId}`, workflowId: job.workflowId,
            commandId: typeof instance?.context.data.commandId === "string" ? instance.context.data.commandId : null,
            projectId: submission.brandId, correlationId: instance?.context.correlationId ?? null,
            reviewExecutionId: typeof business.reviewExecutionId === "string" ? business.reviewExecutionId : null,
            reviewArtifactId: review.artifactId, writerArtifactId: writer.artifactId, seoArtifactId: seo.artifactId, brandArtifactId: brand.artifactId,
            status: "PENDING", reviewStatus: "owner_iteration_requested", summary: `Owner requested iteration at the pre-production gate: ${ownerRationale}`,
            findings: report.findings as unknown[], recommendations: report.recommendations as unknown[], createdAt: new Date().toISOString(),
          });
          const iterationResult = { kind: "OWNER_ITERATION_REQUESTED", gateStepId: typeof ownerIteration.stepId === "string" ? ownerIteration.stepId : null, reviewArtifactId: review.artifactId, ownerRationale, summary: report.summary, findings: report.findings, recommendations: report.recommendations };
          await this.deps.queue.updateSubmissionStatus(job.workflowId, state.toLowerCase());
          const iterationCommandId = typeof instance?.context.data.commandId === "string" ? instance.context.data.commandId : typeof command?.commandId === "string" ? command.commandId : null;
          if (iterationCommandId && this.deps.control) await this.deps.control.updateCommand(iterationCommandId, { status: state, visibleResult: iterationResult, artifactRefs: [review.artifactId] });
          await settleRevisionTask("COMPLETED");
          await this.deps.queue.acknowledge(job.jobId, "succeeded");
          return;
        }
        const expectedStatus = state === "REVISION_REQUIRED" ? "changes_requested" : "blocked";
        if (!review || !report || report.status !== expectedStatus || business?.status !== expectedStatus) throw new Error("REVIEW_BUSINESS_ARTIFACT_REQUIRED");
        const visibleResult = { kind: "REVIEW_BUSINESS_OUTCOME", status: report.status, reviewArtifactId: review.artifactId, summary: report.summary, findings: report.findings, recommendations: report.recommendations };
        if (state === "REVISION_REQUIRED") {
          if (!this.deps.control?.createReviewRevisionTask) throw new Error("REVIEW_REVISION_TASK_STORE_REQUIRED");
          // Revision cycles supersede prior content: canonical inputs are the
          // LATEST completed artifacts of each kind.
          const source = (kind: string) => [...artifacts].reverse().find((artifact) => artifact.kind === kind && artifact.status === "completed");
          const writer = source("writer_report"), seo = source("seo_report"), brand = source("brand_report");
          if (!writer || !seo || !brand) throw new Error("REVIEW_REVISION_CANONICAL_INPUTS_REQUIRED");
          await this.deps.control.createReviewRevisionTask({
            taskId: `revision-${job.workflowId}-${review.artifactId}`, workflowId: job.workflowId,
            commandId: typeof instance?.context.data.commandId === "string" ? instance.context.data.commandId : null,
            projectId: submission.brandId, correlationId: instance?.context.correlationId ?? null,
            reviewExecutionId: typeof business.reviewExecutionId === "string" ? business.reviewExecutionId : null,
            reviewArtifactId: review.artifactId, writerArtifactId: writer.artifactId, seoArtifactId: seo.artifactId, brandArtifactId: brand.artifactId,
            status: "PENDING", reviewStatus: "changes_requested", summary: String(report.summary),
            findings: report.findings as unknown[], recommendations: report.recommendations as unknown[], createdAt: new Date().toISOString(),
          });
        }
          await this.deps.queue.updateSubmissionStatus(job.workflowId, state.toLowerCase());
          const commandId = typeof instance?.context.data.commandId === "string" ? instance.context.data.commandId : typeof command?.commandId === "string" ? command.commandId : null;
          if (commandId && this.deps.control) await this.deps.control.updateCommand(commandId, { status: state, visibleResult, artifactRefs: [review.artifactId] });
          await settleRevisionTask("COMPLETED");
          await this.deps.queue.acknowledge(job.jobId, "succeeded");
      } else {
        // A technical failure during a media resume settles the resume FAILED.
        await settleMediaResume("FAILED");
        await settleRevisionTask("FAILED");
        await this.deps.queue.updateSubmissionStatus(job.workflowId, state.toLowerCase());
        if (command?.commandType === "START_GOVERNED_TASK" && this.deps.control && typeof command.commandId === "string") {
          await this.deps.control.updateCommand(command.commandId, { status: "FAILED" });
        }
        let failureEvidenceState = "";
        if (this.deps.persistence.listExecutionProvenance) {
          try {
            const executions = await this.deps.persistence.listExecutionProvenance(job.workflowId);
            const latest = [...executions].reverse().find((record) => record.configuration !== null
              && typeof record.configuration === "object"
              && ((record.configuration as Record<string, unknown>).providerSubmissionStarted === true
                || (record.configuration as Record<string, unknown>).lifecycleState === "VALIDATING"));
            if (latest) {
              const events = await this.deps.persistence.listExecutionLifecycleEvents?.(latest.executionId) ?? [];
              const fallback = await this.deps.persistence.listExecutionFailureFallbackEvents?.(latest.executionId) ?? [];
              if (!events.some((event) => event.state === "FAILED") && fallback.length === 0) failureEvidenceState = "; DURABLE_FAILURE_EVIDENCE_UNAVAILABLE";
            }
          } catch {
            failureEvidenceState = "; DURABLE_FAILURE_EVIDENCE_UNAVAILABLE";
          }
        }
        await this.deps.queue.acknowledge(job.jobId, "failed", `workflow ended ${state}${failureEvidenceState}`);
      }
    } catch (error) {
      await this.deps.queue.updateSubmissionStatus(job.workflowId, "failed");
      await this.deps.queue.acknowledge(
        job.jobId,
        "failed",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private async processTargetedVerification(job: WorkflowJob, dispatch: TargetedVerificationDispatchRecord): Promise<void> {
    if (!this.deps.targetedVerification) throw new Error("TARGETED_VERIFICATION_RUNTIME_NOT_CONFIGURED");
    try {
      const claimed = await this.deps.targetedVerification.markRunning(dispatch.dispatchId);
      if (!claimed) throw new Error("TARGETED_VERIFICATION_DISPATCH_NOT_CLAIMABLE");
      const result = await this.deps.targetedVerification.execute(dispatch);
      await this.deps.targetedVerification.settle(dispatch.dispatchId, "COMPLETED", result.revisionId);
      await this.deps.queue.acknowledge(job.jobId, "succeeded");
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
      await this.deps.targetedVerification.settle(dispatch.dispatchId, "FAILED", undefined, code);
      await this.deps.queue.acknowledge(job.jobId, "failed", code);
    }
  }

  private async processTargetedReevaluationRecovery(job:WorkflowJob,recovery:TargetedReevaluationRecoveryRecord):Promise<void>{
    if(!this.deps.targetedReevaluationRecovery)throw new Error("TARGETED_REEVALUATION_RECOVERY_RUNTIME_NOT_CONFIGURED");
    try{if(!await this.deps.targetedReevaluationRecovery.markRunning(recovery.recoveryId))throw new Error("TARGETED_REEVALUATION_RECOVERY_NOT_CLAIMABLE");const result=await this.deps.targetedReevaluationRecovery.execute(recovery);await this.deps.targetedReevaluationRecovery.settle(recovery.recoveryId,"COMPLETED",result.revisionId,undefined,result.route);await this.deps.queue.acknowledge(job.jobId,"succeeded");}
    catch(error){const code=error instanceof Error?error.message.slice(0,300):String(error).slice(0,300);await this.deps.targetedReevaluationRecovery.settle(recovery.recoveryId,"FAILED",undefined,code);await this.deps.queue.acknowledge(job.jobId,"failed",code);}
  }

  /**
   * Bridge an existing durable workflow gate to the owner-facing Approval
   * Center.  The deterministic approval id makes recovery idempotent: a
   * restarted worker observes the same pending/decided record and never
   * creates a second owner request or replays a provider call.
   */
  private async waitForTerminalOrOwnerApproval(engine: DefaultWorkflowEngine, submission: { brandId: string | null }, workflowId: string): Promise<"COMPLETED" | "FAILED" | "CANCELLED" | "REVISION_REQUIRED" | "BUSINESS_BLOCKED" | "OWNER_PRE_MEDIA_REVIEW_REQUIRED" | "BOUNDED_STOP"> {
    let recordedGateId: string | null = null;
    while (true) {
      const instance = await this.deps.persistence.loadWorkflow(workflowId);
      if (instance?.state === "COMPLETED" || instance?.state === "FAILED" || instance?.state === "CANCELLED" || instance?.state === "REVISION_REQUIRED" || instance?.state === "BUSINESS_BLOCKED") return instance.state;
      if (instance?.state === "PAUSED" && isBoundedStopComplete(instance)) return "BOUNDED_STOP";
      if (instance?.state === "AWAITING_APPROVAL") {
        if (!this.deps.control || !submission.brandId) throw new Error("OWNER_APPROVAL_CONTROL_PLANE_REQUIRED");
        const gate = instance.steps.find((step) => step.status === "running");
        if (!gate) throw new Error("OWNER_APPROVAL_GATE_NOT_RESOLVED");
        const approvalId = `approval-${workflowId}-${gate.stepId}`;
        if (recordedGateId !== approvalId) {
          // Human-gate governance snapshot: resolve the effective policy at
          // the moment this gate is reached. The snapshot governs THIS
          // routing decision; later configuration changes never release an
          // approval created here (§ no-retroactive-release).
          let gatePolicy: { preProductionEnabled: boolean; visualHumanGateEnabled: boolean; resolvedScope: string; configurationVersion: number; resolvedAt: string } | null = null;
          if (CONFIGURABLE_GATE_STEP_IDS.has(gate.stepId)) {
            if (!this.deps.control.effectiveHumanGatePolicy) throw new Error("HUMAN_GATE_POLICY_RESOLVER_NOT_WIRED");
            gatePolicy = await this.deps.control.effectiveHumanGatePolicy(submission.brandId);
          }
          const existing = await this.deps.control.getApproval(approvalId);
          // Policy-based bypass (NEW routing decisions only): when the
          // project has explicitly disabled this human gate AND no approval
          // row exists, record the bypass provenance and continue. This is
          // never a human approval: no approval object is created and the
          // durable gate record states gateRequired=false.
          const gateDisabledByPolicy = gatePolicy !== null
            && !existing
            && (gate.stepId === "pre-production-owner-gate" ? !gatePolicy.preProductionEnabled : !gatePolicy.visualHumanGateEnabled);
          if (gateDisabledByPolicy) {
            const business = instance.context.data.reviewBusinessOutcome as Record<string, unknown> | undefined;
            const reviewArtifactId = typeof business?.reviewArtifactId === "string" ? business.reviewArtifactId : null;
            if (reviewArtifactId && (business?.status === "approved" || business?.status === "human_review_required")) {
              const review = (await this.deps.persistence.listArtifacts(workflowId)).find((artifact) => artifact.artifactId === reviewArtifactId && artifact.kind === "review_report");
              if (review) {
                const commandId = typeof instance.context.data.commandId === "string" ? instance.context.data.commandId : null;
                if (commandId) await this.deps.control.updateCommand(commandId, {
                  status: business.status === "approved" ? "REVIEW_APPROVED" : "REVIEW_HUMAN_REVIEW_REQUIRED",
                  visibleResult: { kind: "REVIEW_BUSINESS_OUTCOME", status: business.status, reviewArtifactId, summary: (review.payload as Record<string, unknown>).summary, findings: (review.payload as Record<string, unknown>).findings, recommendations: (review.payload as Record<string, unknown>).recommendations },
                  artifactRefs: [reviewArtifactId],
                });
              }
            }
            // Visual gate bypass: derive policy-level scene approvals from the
            // director scene plan so downstream authorization stages have an
            // explicit, auditable input. These are POLICY approvals, not human
            // ones; the bypass record says so.
            let sceneDecisions: Record<string, "APPROVED"> | undefined;
            if (gate.stepId === "visual-human-gate") {
              const artifacts = await this.deps.persistence.listArtifacts(workflowId);
              const scenePlan = [...artifacts].reverse().find((artifact) => artifact.kind === "scene_plan" && artifact.status === "completed");
              const planned = Array.isArray((scenePlan?.payload as Record<string, unknown> | undefined)?.sceneIds)
                ? ((scenePlan!.payload as Record<string, unknown>).sceneIds as unknown[]).filter((id): id is string => typeof id === "string")
                : [];
              if (planned.length === 0) throw new Error("VISUAL_GATE_BYPASS_SCENE_PLAN_REQUIRED");
              sceneDecisions = Object.fromEntries(planned.map((sceneId) => [sceneId, "APPROVED" as const]));
            }
            await engine.signalApproval(workflowId, {
              workflowId, stepId: gate.stepId, outcome: "policy_bypass", approver: "gate-policy",
              note: `Human gate bypassed by owner-configured project policy (scope ${gatePolicy!.resolvedScope}, configuration version ${gatePolicy!.configurationVersion}); not a human approval.`,
              decidedAt: new Date().toISOString(),
              gatePolicy: gatePolicy as unknown as ApprovalDecision["gatePolicy"],
              ...(sceneDecisions === undefined ? {} : { sceneDecisions }),
            });
            recordedGateId = approvalId;
            // A revision/resume cycle completes its routing at the bypassed
            // gate exactly as it would at a pending one.
            const bypassRevisionTaskId = revisionTaskIdOf(instance);
            if (bypassRevisionTaskId !== null && this.deps.control.settleReviewRevisionTask) {
              await this.deps.control.settleReviewRevisionTask({ taskId: bypassRevisionTaskId, status: "COMPLETED", completedAt: new Date().toISOString() });
            }
          } else {
          const business = instance.context.data.reviewBusinessOutcome as Record<string, unknown> | undefined;
          const reviewArtifactId = typeof business?.reviewArtifactId === "string" ? business.reviewArtifactId : null;
          if (reviewArtifactId && (business?.status === "approved" || business?.status === "human_review_required")) {
            const review = (await this.deps.persistence.listArtifacts(workflowId)).find((artifact) => artifact.artifactId === reviewArtifactId && artifact.kind === "review_report");
            if (!review) throw new Error("REVIEW_APPROVAL_ARTIFACT_REQUIRED");
            const commandId = typeof instance.context.data.commandId === "string" ? instance.context.data.commandId : null;
            if (commandId) await this.deps.control.updateCommand(commandId, {
              status: business.status === "approved" ? "REVIEW_APPROVED" : "REVIEW_HUMAN_REVIEW_REQUIRED",
              visibleResult: { kind: "REVIEW_BUSINESS_OUTCOME", status: business.status, reviewArtifactId, summary: (review.payload as Record<string, unknown>).summary, findings: (review.payload as Record<string, unknown>).findings, recommendations: (review.payload as Record<string, unknown>).recommendations },
              artifactRefs: [reviewArtifactId],
            });
          }
          const existingApproval = await this.deps.control.getApproval(approvalId);
          if (!existingApproval) await this.deps.control.createApproval({
            approvalId, projectId: submission.brandId, targetType: "workflow_gate", targetId: `${workflowId}:${gate.stepId}`,
            agentRecommendation: { workflowId, stepId: gate.stepId, gateType: gateTypeFor(gate.stepId), required: "OWNER_DECISION", reviewArtifactId: (instance.context.data.reviewBusinessOutcome as Record<string, unknown> | undefined)?.reviewArtifactId ?? null, reviewExecutionId: (instance.context.data.reviewBusinessOutcome as Record<string, unknown> | undefined)?.reviewExecutionId ?? null, ...(gatePolicy === null ? {} : { gatePolicy }) }, agentConfidence: null,
            evidenceRefs: (await this.deps.persistence.listArtifacts(workflowId)).map((artifact) => artifact.artifactId),
            status: "PENDING", supersedes: null, supersededBy: null, createdAt: new Date().toISOString(),
          });
          recordedGateId = approvalId;
          // Revision Cycle V1: reaching the pre-production gate with a PENDING
          // owner approval completes the revision cycle itself; the gate
          // decision is the NEXT, separate owner action.
          const revisionTaskId = revisionTaskIdOf(instance);
          if (revisionTaskId !== null) {
            if (!this.deps.control.settleReviewRevisionTask) throw new Error("REVISION_TASK_SETTLE_STORE_REQUIRED");
            await this.deps.control.settleReviewRevisionTask({ taskId: revisionTaskId, status: "COMPLETED", completedAt: new Date().toISOString() });
          }
          // Media Technical Resume V1: reaching the visual human gate with a
          // PENDING owner approval completes the authorized resume boundary.
          // The gate decision is the NEXT, separate owner action.
          if (gate.stepId === "visual-human-gate") {
            const mediaResumeId = mediaResumeIdOf(instance);
            if (mediaResumeId !== null) {
              if (!this.deps.control.settleMediaResumeOutcome) throw new Error("MEDIA_RESUME_SETTLE_STORE_REQUIRED");
              await this.deps.control.settleMediaResumeOutcome({ resumeId: mediaResumeId, outcome: "VISUAL_GATE_PENDING" });
            }
          }
          if (gate.stepId === OWNER_PRE_MEDIA_GATE_STEP_ID) return "OWNER_PRE_MEDIA_REVIEW_REQUIRED";
          }
        }
        const approval = await this.deps.control.getApproval(approvalId);
        if (approval?.status === "DECIDED" && approval.ownerDecision && approval.decidedAt) {
          const approved = approval.ownerDecision === "APPROVE" || approval.ownerDecision === "OVERRIDE";
          const iterated = approval.ownerDecision === "REQUEST_ITERATION";
          const decision: ApprovalDecision = { workflowId, stepId: gate.stepId, outcome: approved ? "approved" : iterated ? "iteration_requested" : "rejected", approver: "owner", note: approval.ownerRationale ?? `Owner ${approval.ownerDecision}`, decidedAt: approval.decidedAt };
          await engine.signalApproval(workflowId, decision);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollMs));
    }
  }

  private async processGovernedCommand(job: WorkflowJob, submission: { workflowId: string; correlationId: string | null; brandId: string | null }, command: Record<string, unknown>): Promise<void> {
    const commandId = typeof command.commandId === "string" ? command.commandId : "";
    const projectId = submission.brandId;
    const selectedAgents = Array.isArray(command.selectedAgents) ? command.selectedAgents.filter((v): v is string => typeof v === "string" && v.trim() !== "") : [];
    const message = typeof command.ownerMessage === "string" ? command.ownerMessage : "";
    if (!this.deps.control || !projectId || !commandId || selectedAgents.length === 0 || !message) {
      await this.deps.queue.acknowledge(job.jobId, "failed", "governed command runtime is not configured"); return;
    }
    if (command.commandType === "MULTI_AGENT_REVIEW" && selectedAgents.length < 2) {
      await this.deps.control.updateCommand(commandId, { status: "BLOCKED" });
      await this.deps.queue.updateSubmissionStatus(submission.workflowId, "failed");
      await this.deps.queue.acknowledge(job.jobId, "failed", "MULTI_AGENT_REVIEW requires at least two selected agents"); return;
    }
    await this.deps.control.updateCommand(commandId, { status: "WORKING" });
    try {
      const requestedRuntime = command.commandContext !== null && typeof command.commandContext === "object" && !Array.isArray(command.commandContext)
        ? (command.commandContext as Record<string, unknown>).runtimeOptions : undefined;
      const requestedReasoning = requestedRuntime !== null && typeof requestedRuntime === "object" && !Array.isArray(requestedRuntime)
        ? (requestedRuntime as Record<string, unknown>).reasoning : undefined;
      if (requestedReasoning !== undefined && (requestedReasoning === null || typeof requestedReasoning !== "object" || Array.isArray(requestedReasoning) || (requestedReasoning as Record<string, unknown>).effort !== "none")) throw new Error("GOVERNED_REASONING_OPTION_UNAVAILABLE");
      const reasoning = requestedReasoning === undefined ? undefined : { effort: "none" as const };
      const overrides = this.deps.resolveCommandConfiguration ? await this.deps.resolveCommandConfiguration(projectId) : {};
      const configFor = (agentId: string): EffectiveRuntimeConfig => {
        const scoped = overrides[agentId] ?? overrides["*"];
        const provider = scoped?.provider;
        const model = scoped?.model;
        if ((provider !== "agentrouter" && provider !== "openrouter") || !model) throw new Error("GOVERNED_PROVIDER_UNAVAILABLE");
        return { provider, model, source: scoped?.source === "AGENT" ? "AGENT" : scoped?.source === "PROJECT" ? "PROJECT" : "GLOBAL", routingVersionId: scoped?.routingVersionId, routingScope: scoped?.routingScope, priceSnapshotId: scoped?.priceSnapshotId };
      };
      const runtime = new GovernedAgentRuntime(this.deps.persistence, this.deps.governedExecute, this.deps.preflightGovernedCommand);
      // Strategic Operating Layer V1: per-agent task-aware context + snapshot.
      // Without the wired resolver this is exactly the legacy approved context.
      let operational: Record<string, Json> | null = null;
      if (this.deps.resolveOperationalContext) {
        try {
          operational = await this.deps.resolveOperationalContext(projectId);
        } catch {
          operational = null;
        }
      }
      const strategicFor = async (agentId: string): Promise<{ context: Record<string, Json>; snapshotId: string | null }> => {
        if (this.deps.resolveStrategicContext) return this.deps.resolveStrategicContext(projectId, agentId, command.commandContext, operational);
        const context = resolveApprovedProjectContext(projectId, command.commandContext);
        if (operational) context._operational = operational;
        return { context, snapshotId: null };
      };
      const requests = [];
      for (const agentId of selectedAgents) {
        const resolved = await strategicFor(agentId);
        // V5: the flat multi-agent 1000-token override bypassed the
        // contract-derived budget (V2 n=3 needs ~2200) and could truncate a
        // worst-case valid payload into a fail-closed length error.
        // Internal-analysis participants get their contract budget; every
        // other participant keeps the proven multi-agent 1000.
        const participant = command.commandType === "MULTI_AGENT_REVIEW" ? participantContract(agentId, message) : null;
        const reviewBudget = participant === null ? undefined
          : participant.kind === "INTERNAL_ANALYSIS" ? internalAnalysisBudget(participant.findingCount) : 1000;
        requests.push({ workflowId: submission.workflowId, correlationId: submission.correlationId, projectId, agentId, prompt: message, context: resolved.context, strategicSnapshotId: resolved.snapshotId, config: configFor(agentId), ...(reviewBudget !== undefined ? { outputBudget: reviewBudget } : {}), ...(reasoning ? { reasoning } : {}) });
      }
      const group = await runtime.executeGovernedAgentGroup(requests);
      const ceoStrategic = await strategicFor("ceo");
      const synthesis = command.commandType === "MULTI_AGENT_REVIEW" && group.results.every((result) => result.status === "COMPLETED")
        ? await runtime.synthesizeAgentOutputs({ workflowId: submission.workflowId, correlationId: submission.correlationId, projectId, prompt: message, context: ceoStrategic.context, strategicSnapshotId: ceoStrategic.snapshotId, results: group.results, config: configFor("ceo"), ...(reasoning ? { reasoning } : {}) }) : null;
      const artifacts = [...group.results, ...(synthesis ? [synthesis] : [])].map((r) => r.artifactId).filter((v): v is string => v !== null);
      const completed = command.commandType === "ASK_AGENT" ? group.results.length === 1 && group.results[0].status === "COMPLETED" : group.results.some((r) => r.status === "COMPLETED") && synthesis?.status === "COMPLETED";
      // V6 finalization invariant: a FAILED (or absent) synthesis carries its
      // transient output and error only in-memory — persisting it would let
      // the UI render a non-canonical synthesis as completed success
      // (command-1789912080235). Canonical synthesis is stored iff COMPLETED.
      await this.deps.control.updateCommand(commandId, { status: completed ? "COMPLETED" : "FAILED", visibleResult: group.results, synthesis: synthesis?.status === "COMPLETED" ? synthesis.output : undefined, artifactRefs: artifacts });
      await this.deps.queue.updateSubmissionStatus(submission.workflowId, completed ? "completed" : "failed");
      await this.deps.queue.acknowledge(job.jobId, completed ? "succeeded" : "failed", completed ? undefined : "governed command failed");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.deps.control.updateCommand(commandId, { status: /UNAVAILABLE/.test(message) ? "BLOCKED" : "FAILED" });
      await this.deps.queue.updateSubmissionStatus(submission.workflowId, "failed");
      await this.deps.queue.acknowledge(job.jobId, "failed", message);
    }
  }
}
