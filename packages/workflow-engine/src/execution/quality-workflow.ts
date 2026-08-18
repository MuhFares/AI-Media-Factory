import type { AgentExecutorPort } from "@ai-media-factory/runtime";
import type { AgentStep, CollaborationArtifact, Json, WorkflowContext } from "@ai-media-factory/shared";
import { CollaborationRunner, type CollaborationStage, payloadToJson } from "./collaboration.js";
import { ReviewerFeedbackLoop, type ReviewerFeedbackLoopConfig } from "./review-loop.js";

export interface QualityWorkflowConfig {
  readonly upstreamStages: readonly CollaborationStage[];
  readonly reviewLoop: Omit<ReviewerFeedbackLoopConfig, "initialParentArtifact">;
  readonly qaStep: AgentStep;
  readonly documentationStep: AgentStep;
  readonly maxQAIterations: number;
}

export type QualityWorkflowStatus = "completed" | "failed" | "review_limit_reached" | "qa_limit_reached" | "qa_blocked" | "qa_not_executed" | "qa_invalid";

export interface QualityWorkflowResult {
  readonly status: QualityWorkflowStatus;
  readonly output?: CollaborationArtifact;
  readonly lineage: readonly CollaborationArtifact[];
  readonly reviewIterations: number;
  readonly qaIterations: number;
  readonly error?: { readonly message: string; readonly retryable: boolean };
}

function serializeArtifact(artifact: CollaborationArtifact): Json {
  const value: { [key: string]: Json } = { artifactId: artifact.artifactId, kind: artifact.kind, producerAgent: artifact.producerAgent, workflowId: artifact.workflowId, correlationId: artifact.correlationId, status: artifact.status, payload: payloadToJson(artifact.payload), contentType: artifact.contentType, schemaVersion: artifact.schemaVersion, createdAt: artifact.createdAt };
  if (artifact.parentArtifact !== undefined) value.parentArtifact = { ...artifact.parentArtifact };
  return value;
}

function handoffContext(context: WorkflowContext, artifact: CollaborationArtifact, qaIteration: number, reviewFindings?: Json): WorkflowContext {
  return { ...context, data: { ...context.data, previousArtifact: serializeArtifact(artifact), qaIteration, ...(reviewFindings === undefined ? {} : { reviewFindings }) } };
}

function validIdentity(artifact: CollaborationArtifact | undefined, kind: CollaborationArtifact["kind"], producer: string, context: WorkflowContext, parent: CollaborationArtifact): artifact is CollaborationArtifact {
  return artifact !== undefined && artifact.kind === kind && artifact.producerAgent === producer && artifact.workflowId === context.workflowId && artifact.correlationId === context.correlationId && (artifact.status === "proposed" || artifact.status === "completed") && artifact.parentArtifact?.artifactId === parent.artifactId && artifact.parentArtifact.kind === parent.kind;
}

function isRecord(value: Json): value is { [key: string]: Json } { return value !== null && typeof value === "object" && !Array.isArray(value); }

function hasExecutionEvidence(artifact: CollaborationArtifact): boolean {
  if (artifact.kind !== "qa_report" || artifact.payload.executionEvidencePresent !== true) return false;
  return artifact.payload.testResults.some((item) => isRecord(item) && item.executed === true && item.source === "runtime" && typeof item.evidence === "string" && item.evidence.trim() !== "");
}

/** Reviewer-gated QA and documentation stages. QA failure re-enters the existing review loop. */
export class QualityWorkflow {
  constructor(private readonly agentExecutor: AgentExecutorPort) {}

  async run(config: QualityWorkflowConfig, context: WorkflowContext): Promise<QualityWorkflowResult> {
    if (!Number.isInteger(config.maxQAIterations) || config.maxQAIterations < 1) return { status: "failed", lineage: [], reviewIterations: 0, qaIterations: 0, error: { message: "maxQAIterations must be a positive integer", retryable: false } };
    const upstream = await new CollaborationRunner(this.agentExecutor).run(config.upstreamStages, context);
    if (upstream.status !== "completed" || upstream.output === undefined) return { status: "failed", lineage: upstream.lineage, reviewIterations: 0, qaIterations: 0, error: upstream.error };
    const lineage: CollaborationArtifact[] = [...upstream.lineage];
    let parent = upstream.output;
    let reviewIterations = 0;
    let loopContext = context;

    for (let qaIteration = 1; qaIteration <= config.maxQAIterations; qaIteration += 1) {
      const review = await new ReviewerFeedbackLoop(this.agentExecutor).run({ ...config.reviewLoop, initialParentArtifact: parent }, loopContext);
      reviewIterations += review.iterations;
      if (review.status !== "completed" || review.finalReview === undefined) return { status: review.status === "limit_reached" ? "review_limit_reached" : "failed", lineage: [...lineage, ...review.lineage], reviewIterations, qaIterations: qaIteration, error: review.error };
      lineage.push(...review.lineage);
      const reviewArtifact = review.finalReview;
      const qaOutcome = await this.agentExecutor.executeAgentStep(config.qaStep, handoffContext(context, reviewArtifact, qaIteration));
      if (qaOutcome.status !== "completed") return { status: "failed", lineage, reviewIterations, qaIterations: qaIteration, error: qaOutcome.error ?? { message: "QA execution failed", retryable: false } };
      const qaArtifact = qaOutcome.artifact;
      if (!validIdentity(qaArtifact, "qa_report", config.qaStep.agent, context, reviewArtifact) || !Array.isArray(qaArtifact.payload.testResults) || typeof qaArtifact.payload.executionEvidencePresent !== "boolean" || typeof qaArtifact.payload.status !== "string") return { status: "qa_invalid", lineage, reviewIterations, qaIterations: qaIteration, error: { message: "Malformed QA report", retryable: false } };
      lineage.push(qaArtifact);
      if (qaArtifact.payload.status === "blocked") return { status: "qa_blocked", lineage, reviewIterations, qaIterations: qaIteration, error: { message: "QA is blocked", retryable: false } };
      if (qaArtifact.payload.status === "not_executed" || qaArtifact.payload.status === "reviewed") return { status: "qa_not_executed", lineage, reviewIterations, qaIterations: qaIteration, error: { message: "QA execution was not established", retryable: false } };
      if (qaArtifact.payload.status === "passed") {
        if (!hasExecutionEvidence(qaArtifact)) return { status: "qa_invalid", lineage, reviewIterations, qaIterations: qaIteration, error: { message: "QA PASS lacks runtime execution evidence", retryable: false } };
        const documentationOutcome = await this.agentExecutor.executeAgentStep(config.documentationStep, { ...handoffContext(context, qaArtifact, qaIteration), data: { ...handoffContext(context, qaArtifact, qaIteration).data, validatedArtifacts: lineage.map((item) => serializeArtifact(item)) } });
        if (documentationOutcome.status !== "completed") return { status: "failed", lineage, reviewIterations, qaIterations: qaIteration, error: documentationOutcome.error ?? { message: "Documentation execution failed", retryable: false } };
        const documentationArtifact = documentationOutcome.artifact;
        if (!validIdentity(documentationArtifact, "documentation_report", config.documentationStep.agent, context, qaArtifact) || documentationArtifact.payload.status !== "generated" || documentationArtifact.payload.generatedOnly !== true || documentationArtifact.payload.persistence !== "not_written") return { status: "failed", lineage, reviewIterations, qaIterations: qaIteration, error: { message: "Invalid Documentation artifact", retryable: false } };
        lineage.push(documentationArtifact);
        return { status: "completed", output: documentationArtifact, lineage, reviewIterations, qaIterations: qaIteration };
      }
      if (qaArtifact.payload.status !== "failed") return { status: "qa_invalid", lineage, reviewIterations, qaIterations: qaIteration, error: { message: "Invalid QA status", retryable: false } };
      if (qaIteration === config.maxQAIterations) return { status: "qa_limit_reached", lineage, reviewIterations, qaIterations: qaIteration, error: { message: "Maximum QA iterations reached", retryable: false } };
      parent = qaArtifact;
      loopContext = { ...handoffContext(context, qaArtifact, qaIteration, reviewArtifact.payload.findings), data: { ...handoffContext(context, qaArtifact, qaIteration, reviewArtifact.payload.findings).data, qaFeedback: { status: qaArtifact.payload.status, testResults: qaArtifact.payload.testResults } } };
    }
    return { status: "qa_limit_reached", lineage, reviewIterations, qaIterations: config.maxQAIterations, error: { message: "Maximum QA iterations reached", retryable: false } };
  }
}
