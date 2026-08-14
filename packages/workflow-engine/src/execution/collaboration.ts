import type { AgentExecutorPort } from "@ai-media-factory/runtime";
import type { AgentArtifactKind as SharedArtifactKind, AgentStep, CollaborationArtifact as SharedCollaborationArtifact, Json, WorkflowContext } from "@ai-media-factory/shared";

type CollaborationArtifactType = SharedCollaborationArtifact;
type ArtifactKind = SharedArtifactKind;

export interface CollaborationStage {
  readonly step: AgentStep;
  readonly artifactKind: ArtifactKind;
}

export interface CollaborationRunResult {
  readonly status: "completed" | "failed";
  readonly output?: CollaborationArtifactType;
  readonly lineage: readonly CollaborationArtifactType[];
  readonly error?: { readonly message: string; readonly retryable: boolean };
}

function artifactToJson(artifact: CollaborationArtifactType): Json {
  const serialized: { [key: string]: Json } = {
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
  if (artifact.parentArtifact !== undefined) serialized.parentArtifact = { ...artifact.parentArtifact };
  return serialized;
}

/** Generic in-memory runner for an explicitly supplied ordered collaboration chain. */
export class CollaborationRunner {
  constructor(private readonly agentExecutor: AgentExecutorPort) {}

  async run(stages: readonly CollaborationStage[], context: WorkflowContext): Promise<CollaborationRunResult> {
    let currentContext = context;
    let previous: CollaborationArtifactType | undefined;
    const lineage: CollaborationArtifactType[] = [];

    for (const stage of stages) {
      const outcome = await this.agentExecutor.executeAgentStep(stage.step, currentContext);
      if (outcome.status !== "completed") {
        return { status: "failed", lineage, error: outcome.error ?? { message: `Agent step failed: ${stage.step.agent}`, retryable: false } };
      }
      const artifact = outcome.artifact;
      if (artifact === undefined) return { status: "failed", lineage, error: { message: `Agent step produced no artifact: ${stage.step.agent}`, retryable: false } };
      if (artifact.kind !== stage.artifactKind || artifact.producerAgent !== stage.step.agent || artifact.workflowId !== context.workflowId || artifact.correlationId !== context.correlationId) {
        return { status: "failed", lineage, error: { message: `Invalid artifact identity for agent step: ${stage.step.agent}`, retryable: false } };
      }
      lineage.push(artifact);
      if (artifact.status !== "proposed" && artifact.status !== "completed") {
        return { status: "failed", lineage, error: { message: `Agent produced a ${artifact.status} artifact: ${stage.step.agent}`, retryable: false } };
      }
      if (previous !== undefined && (artifact.parentArtifact === undefined || artifact.parentArtifact.artifactId !== previous.artifactId || artifact.parentArtifact.kind !== previous.kind)) {
        return { status: "failed", lineage, error: { message: `Artifact lineage mismatch for agent step: ${stage.step.agent}`, retryable: false } };
      }
      previous = artifact;
      currentContext = {
        ...currentContext,
        data: {
          ...currentContext.data,
          previousArtifact: artifactToJson(artifact),
          validatedArtifacts: [...(Array.isArray(currentContext.data.validatedArtifacts) ? currentContext.data.validatedArtifacts : []), artifactToJson(artifact)],
        },
      };
    }

    return previous === undefined
      ? { status: "failed", lineage, error: { message: "Collaboration chain has no stages", retryable: false } }
      : { status: "completed", output: previous, lineage };
  }
}
