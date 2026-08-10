import type { AgentExecutorPort } from "@ai-media-factory/runtime";
import type { AgentStep, CollaborationArtifact, Json, WorkflowContext } from "@ai-media-factory/shared";

export interface ReviewerFeedbackLoopConfig {
  readonly codingStep: AgentStep;
  readonly reviewerStep: AgentStep;
  readonly maxReviewIterations: number;
}

export interface ReviewerFeedbackLoopResult {
  readonly status: "completed" | "failed" | "limit_reached";
  readonly finalReview?: CollaborationArtifact;
  readonly lineage: readonly CollaborationArtifact[];
  readonly iterations: number;
  readonly error?: { readonly message: string; readonly retryable: boolean };
}

function serializedArtifact(artifact: CollaborationArtifact): Json {
  const value: { [key: string]: Json } = {
    artifactId: artifact.artifactId,
    kind: artifact.kind,
    producerAgent: artifact.producerAgent,
    workflowId: artifact.workflowId,
    correlationId: artifact.correlationId,
    status: artifact.status,
    payload: { ...artifact.payload },
    contentType: artifact.contentType,
    schemaVersion: artifact.schemaVersion,
    createdAt: artifact.createdAt,
  };
  if (artifact.parentArtifact !== undefined) value.parentArtifact = { ...artifact.parentArtifact };
  return value;
}

function withHandoff(context: WorkflowContext, artifact: CollaborationArtifact, iteration: number, reviewFeedback?: Json): WorkflowContext {
  return {
    ...context,
    data: {
      ...context.data,
      previousArtifact: serializedArtifact(artifact),
      reviewIteration: iteration,
      ...(reviewFeedback === undefined ? {} : { reviewFeedback }),
    },
  };
}

function validArtifact(artifact: CollaborationArtifact | undefined, expectedKind: CollaborationArtifact["kind"], producerAgent: string, context: WorkflowContext, parent: CollaborationArtifact | undefined): artifact is CollaborationArtifact {
  return artifact !== undefined && artifact.kind === expectedKind && artifact.producerAgent === producerAgent && artifact.workflowId === context.workflowId && artifact.correlationId === context.correlationId && (artifact.status === "proposed" || artifact.status === "completed") && (parent === undefined ? artifact.parentArtifact === undefined : artifact.parentArtifact?.artifactId === parent.artifactId && artifact.parentArtifact.kind === parent.kind);
}

/** Controlled Coding ↔ Reviewer feedback loop using the existing AgentExecutorPort. */
export class ReviewerFeedbackLoop {
  constructor(private readonly agentExecutor: AgentExecutorPort) {}

  async run(config: ReviewerFeedbackLoopConfig, context: WorkflowContext): Promise<ReviewerFeedbackLoopResult> {
    if (!Number.isInteger(config.maxReviewIterations) || config.maxReviewIterations < 1) return { status: "failed", lineage: [], iterations: 0, error: { message: "maxReviewIterations must be a positive integer", retryable: false } };
    const lineage: CollaborationArtifact[] = [];
    let currentContext = context;
    let parent: CollaborationArtifact | undefined;

    for (let iteration = 1; iteration <= config.maxReviewIterations; iteration += 1) {
      const codingOutcome = await this.agentExecutor.executeAgentStep(config.codingStep, { ...currentContext, data: { ...currentContext.data, reviewIteration: iteration } });
      if (codingOutcome.status !== "completed") return { status: "failed", lineage, iterations: iteration, error: codingOutcome.error ?? { message: "Coding execution failed", retryable: false } };
      const codingArtifact = codingOutcome.artifact;
      if (!validArtifact(codingArtifact, "coding_report", config.codingStep.agent, context, parent)) return { status: "failed", lineage, iterations: iteration, error: { message: "Malformed or incorrectly linked Coding artifact", retryable: false } };
      if (codingArtifact.payload.status === "blocked" || codingArtifact.payload.status === "failed") return { status: "failed", lineage, iterations: iteration, error: { message: `Coding artifact is ${codingArtifact.payload.status}`, retryable: false } };
      lineage.push(codingArtifact);

      const reviewerContext = withHandoff(currentContext, codingArtifact, iteration);
      const reviewOutcome = await this.agentExecutor.executeAgentStep(config.reviewerStep, reviewerContext);
      if (reviewOutcome.status !== "completed") return { status: "failed", lineage, iterations: iteration, error: reviewOutcome.error ?? { message: "Reviewer execution failed", retryable: false } };
      const reviewArtifact = reviewOutcome.artifact;
      if (!validArtifact(reviewArtifact, "review_report", config.reviewerStep.agent, context, codingArtifact) || !Array.isArray(reviewArtifact.payload.findings) || typeof reviewArtifact.payload.status !== "string") return { status: "failed", lineage, iterations: iteration, error: { message: "Malformed Reviewer report", retryable: false } };
      if (reviewArtifact.payload.status !== "approved" && reviewArtifact.payload.status !== "changes_requested" && reviewArtifact.payload.status !== "blocked") return { status: "failed", lineage, iterations: iteration, error: { message: "Invalid Reviewer status", retryable: false } };
      lineage.push(reviewArtifact);
      if (reviewArtifact.payload.status === "approved") return { status: "completed", finalReview: reviewArtifact, lineage, iterations: iteration };
      if (reviewArtifact.payload.status === "blocked") return { status: "failed", lineage, iterations: iteration, error: { message: "Reviewer returned blocked status", retryable: false } };
      if (iteration === config.maxReviewIterations) return { status: "limit_reached", lineage, iterations: iteration, error: { message: "Maximum review iterations reached", retryable: false } };
      parent = reviewArtifact;
      currentContext = withHandoff(currentContext, reviewArtifact, iteration, { reviewStatus: reviewArtifact.payload.status, findings: reviewArtifact.payload.findings, reviewerArtifact: serializedArtifact(reviewArtifact) });
    }

    return { status: "limit_reached", lineage, iterations: config.maxReviewIterations, error: { message: "Maximum review iterations reached", retryable: false } };
  }
}
