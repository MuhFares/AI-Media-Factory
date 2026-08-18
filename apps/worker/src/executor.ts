/**
 * Deterministic agent executor (Phase 1 async pipeline).
 *
 * AgentExecutorPort adapter that produces durable, lineage-linked artifacts
 * WITHOUT invoking an LLM. This keeps the async API→Queue→Worker→Engine pipeline
 * fully deterministic and testable offline. Artifacts and capability-execution
 * evidence are idempotent: re-running a step after a crash re-emits the same
 * artifact id / idempotency key, so persistence never duplicates them.
 *
 * Swap this for ArtifactProducingExecutor + RuntimeAgentExecutor + real agents
 * at the wiring site to use live agents — the engine contract is unchanged.
 */

import type {
  AgentExecutorPort,
  AgentStep,
  CollaborationArtifact,
  StepOutcome,
  WorkflowContext,
} from "@ai-media-factory/shared";
import type { PersistencePort } from "@ai-media-factory/workflow-engine";

const KIND_BY_AGENT: Record<string, string> = {
  planner: "execution_plan",
  research: "research_report",
  coding: "coding_report",
  reviewer: "review_report",
  qa: "qa_report",
  documentation: "documentation_report",
  writer: "writer_report",
  seo: "seo_report",
};

/** Deterministic artifact ids / idempotency keys make crash re-runs safe. */
export function createDeterministicAgentExecutor(
  persistence?: PersistencePort
): AgentExecutorPort {
  return {
    async executeAgentStep(step: AgentStep, context: WorkflowContext): Promise<StepOutcome> {
      const kind = KIND_BY_AGENT[step.agent] ?? `${step.agent}_report`;
      const artifactId = `art-${context.workflowId}-${step.id}`;
      const previous = context.data.previousArtifact as
        | { artifactId?: string; kind?: string }
        | undefined;

      const artifact = {
        artifactId,
        kind,
        producerAgent: step.agent,
        workflowId: context.workflowId,
        correlationId: context.correlationId ?? "",
        status: "completed" as const,
        payload: { reportId: artifactId, agent: step.agent, workflowId: context.workflowId },
        contentType: "application/json",
        schemaVersion: "1.0.0",
        createdAt: new Date().toISOString(),
        ...(previous?.artifactId
          ? { parentArtifact: { artifactId: previous.artifactId, kind: previous.kind as string } }
          : {}),
      } as unknown as CollaborationArtifact;

      if (persistence) {
        await persistence.saveCapabilityExecution({
          resultId: `cap-${context.workflowId}-${step.id}`,
          workflowId: context.workflowId,
          correlationId: context.correlationId ?? null,
          capabilityId: step.emits,
          agentId: step.agent,
          status: "success",
          evidenceId: null,
          idempotencyKey: `${context.workflowId}:${step.id}`,
          executedAt: new Date().toISOString(),
          payload: { artifactId, kind },
        });
      }

      // Link lineage for the next sequential step (context is shared by the engine).
      context.data.previousArtifact = { artifactId, kind };

      return { status: "completed", output: { reportId: artifactId }, artifact };
    },
  };
}
