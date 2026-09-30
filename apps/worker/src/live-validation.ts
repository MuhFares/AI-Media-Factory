import { rewindWorkflow } from "@ai-media-factory/workflow-engine";
import type { PersistencePort, WorkflowDefinition, WorkflowInstance } from "@ai-media-factory/workflow-engine";
import type { ApprovalDecision } from "@ai-media-factory/workflow-engine";
import { directiveToWorkflowDefinition } from "@ai-media-factory/orchestrator";
import { buildDefaultEngine } from "./engine.js";
import { createProductionAgentExecutor } from "./production-executor.js";
import type { AgentExecutorPort } from "@ai-media-factory/shared";

export interface LiveValidationEvidence {
  readonly workflowId: string;
  readonly correlationId: string;
  readonly researchArtifactIds: readonly string[];
  readonly selectedIdeaArtifactId: string;
  readonly ideaApproval: ApprovalDecision;
}

/**
 * Build the real produce graph with a durable idea gate in front of it.
 * Existing produce steps are retained; the bootstrapper can mark already
 * completed research/selection steps complete without manufacturing runs.
 */
export function liveValidationDefinition(): WorkflowDefinition {
  const produce = directiveToWorkflowDefinition("produce");
  const firstPostIdea = "planner-synthesis";
  const visualPrefix = [
    "planner-initial", "research", "planner-synthesis", "writer", "seo", "brand",
    "review", "pre-production-owner-gate", "director", "scene-image", "visual-semantic-review", "visual-technical-qa", "visual-human-gate",
  ];
  const produceSteps = new Map(produce.steps.map((step) => [step.id, step]));
  const safeSteps = visualPrefix.map((id, index) => {
    const step = produceSteps.get(id);
    if (!step) throw new Error(`LIVE_VALIDATION_STEP_MISSING:${id}`);
    const next = index + 1 < visualPrefix.length ? visualPrefix[index + 1] : undefined;
    return next === undefined ? { ...step, next: undefined } : { ...step, next };
  });
  return {
    ...produce,
    id: "content-factory-live-validation",
    version: produce.version + 2,
    entryStep: "idea-human-gate",
    steps: [
      { id: "idea-human-gate", kind: "gate", approver: "human_operator", reason: "Approve the agent-selected content idea before production.", next: firstPostIdea },
      ...safeSteps,
    ],
  };
}

function importedArtifact(workflowId: string, correlationId: string, artifactId: string, kind: string, payload: Record<string, unknown>) {
  return {
    artifactId,
    workflowId,
    correlationId,
    kind,
    producerAgent: "live-validation-import",
    status: "completed",
    payload: { ...payload, imported: true, sourceArtifactId: artifactId },
    contentType: "application/json",
    schemaVersion: "1.0",
    createdAt: new Date().toISOString(),
  } as never;
}

/** Start a live run before any research call and persist the Idea Gate. */
export async function startLiveValidation(options: {
  readonly persistence: PersistencePort;
  readonly workflowId: string;
  readonly correlationId: string;
  readonly trigger: Record<string, unknown>;
  readonly researchArtifactIds?: readonly string[];
  readonly selectedIdeaArtifactId?: string;
}): Promise<WorkflowInstance> {
  const definition = liveValidationDefinition();
  const executor = createProductionAgentExecutor({ persistence: options.persistence });
  const engine = buildDefaultEngine({ persistence: options.persistence, executor, definitionLoader: async () => definition });
  return engine.start({
    workflowId: options.workflowId,
    correlationId: options.correlationId,
    definition,
    trigger: { ...options.trigger, liveValidation: true, researchArtifactIds: [...(options.researchArtifactIds ?? [])], selectedIdeaArtifactId: options.selectedIdeaArtifactId ?? null },
  });
}

/**
 * One-time import for the already completed Gate 1 evidence. The workflow is
 * created by the engine; only evidence references and completed pre-gate
 * records are imported. Repeated calls return the existing instance.
 */
export async function bootstrapApprovedIdeaGate(options: {
  readonly persistence: PersistencePort;
  readonly workflowId: string;
  readonly correlationId: string;
  readonly trigger: Record<string, unknown>;
  readonly researchArtifactIds: readonly string[];
  readonly selectedIdeaArtifactId: string;
  readonly approval: ApprovalDecision;
}): Promise<WorkflowInstance> {
  const existing = await options.persistence.loadWorkflow(options.workflowId);
  if (existing) return existing;
  await startLiveValidation(options);
  const initial = await options.persistence.loadWorkflow(options.workflowId);
  if (!initial) throw new Error("LIVE_VALIDATION_WORKFLOW_NOT_PERSISTED");
  const deadline = Date.now() + 5000;
  let gated = initial;
  while (gated.state !== "AWAITING_APPROVAL" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const current = await options.persistence.loadWorkflow(options.workflowId);
    if (current) gated = current;
  }
  if (gated.state !== "AWAITING_APPROVAL") throw new Error("LIVE_VALIDATION_IDEA_GATE_NOT_PERSISTED");
  for (const id of options.researchArtifactIds) {
    await options.persistence.saveArtifact(importedArtifact(options.workflowId, options.correlationId, id, "research_report", { evidenceId: id }));
  }
  await options.persistence.saveArtifact(importedArtifact(options.workflowId, options.correlationId, options.selectedIdeaArtifactId, "selected_idea", { ideaApproval: "APPROVED" }));
  const preGate = new Set(["research"]);
  const bootstrapped: WorkflowInstance = {
    ...gated,
    steps: gated.steps.map((step) => preGate.has(step.stepId) ? { ...step, status: "completed", attempts: 0, startedAt: null, finishedAt: new Date().toISOString() } : step),
    context: { ...gated.context, data: { ...gated.context.data, importedResearchArtifactIds: [...options.researchArtifactIds], selectedIdeaArtifactId: options.selectedIdeaArtifactId, ideaGateApproval: options.approval as never } },
    ready: ["planner-initial"],
  };
  await options.persistence.saveWorkflow(bootstrapped);
  return bootstrapped;
}

export async function recoverLiveValidation(options: {
  readonly persistence: PersistencePort;
  readonly workflowId: string;
  readonly reason: string;
}): Promise<WorkflowInstance> {
  return rewindWorkflow(options.persistence, liveValidationDefinition(), {
    workflowId: options.workflowId,
    targetStepId: "planner-initial",
    reason: options.reason,
    requiredArtifactsByStep: { research: { artifactKind: "research_report" } },
    preserveCompletedStepIds: ["idea-human-gate", "research"],
    rewindStepIds: liveValidationDefinition().steps.map((step) => step.id).filter((id) => !["idea-human-gate", "research"].includes(id)),
  });
}

export async function recoverLiveValidationFromPlannerSynthesis(options: {
  readonly persistence: PersistencePort;
  readonly workflowId: string;
  readonly reason: string;
}): Promise<WorkflowInstance> {
  const definition = liveValidationDefinition();
  const recovered = await rewindWorkflow(options.persistence, definition, {
    workflowId: options.workflowId,
    targetStepId: "planner-synthesis",
    reason: options.reason,
    requiredArtifactsByStep: { research: { artifactKind: "research_report" }, "planner-initial": { artifactKind: "execution_plan" } },
    preserveCompletedStepIds: ["idea-human-gate", "research", "planner-initial"],
    rewindStepIds: definition.steps.map((step) => step.id).filter((id) => !["idea-human-gate", "research", "planner-initial"].includes(id)),
  });
  const selectedIdea = recovered.context.data.selectedIdea;
  if (typeof selectedIdea === "string" && selectedIdea.trim()) {
    const enriched = { ...recovered, context: { ...recovered.context, data: { ...recovered.context.data, contentTopic: selectedIdea, objective: selectedIdea } }, updatedAt: new Date().toISOString() };
    await options.persistence.saveWorkflow(enriched);
    return enriched;
  }
  return recovered;
}

/** Recover only the rejected visual branch for an explicitly authorized V2 regeneration. */
export async function recoverLiveValidationForVisualRegeneration(options: {
  readonly persistence: PersistencePort;
  readonly workflowId: string;
  readonly reason: string;
  readonly regenerationVersion?: number;
  readonly sceneIds?: readonly string[];
  readonly lockedArtifactIds?: readonly string[];
  readonly reuseDirectorArtifact?: boolean;
  readonly constraintOverrides?: Record<string, Record<string, unknown>>;
}): Promise<WorkflowInstance> {
  const definition = liveValidationDefinition();
  const preserve = ["idea-human-gate", "planner-initial", "research", "planner-synthesis", "writer", "seo", "brand", "review", "pre-production-owner-gate", ...(options.reuseDirectorArtifact ? ["director"] : [])];
  const rewound = await rewindWorkflow(options.persistence, definition, {
    workflowId: options.workflowId,
    targetStepId: options.reuseDirectorArtifact ? "scene-image" : "director",
    reason: options.reason,
    requiredArtifactsByStep: { research: { artifactKind: "research_report" }, "planner-synthesis": { artifactKind: "evidence_backed_content_brief" }, writer: { artifactKind: "writer_report" } },
    preserveCompletedStepIds: preserve,
    rewindStepIds: definition.steps.map((step) => step.id).filter((id) => !preserve.includes(id)),
  });
  const recovered: WorkflowInstance = {
    ...rewound,
    state: "PAUSED",
    ready: ["director"],
    context: {
      ...rewound.context,
      data: {
        ...rewound.context.data,
        visualRegenerationVersion: options.regenerationVersion ?? 2,
        visualRegenerationAuthorization: "AUTHORIZED",
        visualRegenerationOnly: true,
        visualRegenerationSceneIds: [...(options.sceneIds ?? ["scene-001", "scene-002", "scene-003"])],
        visualLockedArtifactIds: [...(options.lockedArtifactIds ?? [])],
        visualConstraintOverrides: (options.constraintOverrides ?? {}) as never,
      },
      outputs: { ...rewound.context.outputs, "visual-human-gate": { outcome: "rejected", rejectionReason: "SEMANTIC_MISMATCH", regenerationAuthorization: "AUTHORIZED_V2_PENDING" } },
    },
    updatedAt: new Date().toISOString(),
  };
  await options.persistence.saveWorkflow(recovered);
  return recovered;
}

/** Recover the bootstrapped run and deliver the already-recorded approval. */
export async function approveBootstrappedIdeaGate(options: {
  readonly persistence: PersistencePort;
  readonly workflowId: string;
  readonly approval: ApprovalDecision;
  readonly executor?: AgentExecutorPort;
}): Promise<WorkflowInstance> {
  const definition = liveValidationDefinition();
  const executor = options.executor ?? createProductionAgentExecutor({ persistence: options.persistence });
  const engine = buildDefaultEngine({ persistence: options.persistence, executor, definitionLoader: async () => definition });
  await engine.resume(options.workflowId);
  await engine.signalApproval(options.workflowId, options.approval);
  const instance = await options.persistence.loadWorkflow(options.workflowId);
  if (!instance) throw new Error("LIVE_VALIDATION_WORKFLOW_NOT_FOUND_AFTER_APPROVAL");
  return instance;
}
