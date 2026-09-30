/**
 * Recovery / resume (req #10).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Rebuild an instance from its last checkpoint and continue. Already-completed
 * steps are skipped (idempotent replay, dedupe by step/event id).
 */

import type { Uuid } from "../core/common.js";
import type { WorkflowInstance } from "../core/instance.js";
import type { WorkflowDefinition } from "../model/definition.js";
import type { PersistencePort } from "./persistence.js";

export interface RecoveryManager {
  /** Reconstruct a runnable instance from the last checkpoint. */
  recover(workflowId: Uuid): Promise<WorkflowInstance>;
  /** Determine whether a failed workflow is recoverable (resume vs DLQ). */
  isRecoverable(workflowId: Uuid): Promise<boolean>;
}

export interface WorkflowRewindOptions {
  readonly workflowId: Uuid;
  readonly targetStepId: string;
  readonly requiredArtifactsByStep?: Readonly<Record<string, RecoveryArtifactRequirement>>;
  readonly preserveCompletedStepIds?: readonly string[];
  readonly rewindStepIds?: readonly string[];
  readonly reason: string;
}

/** Explicitly separates an artifact's durable kind from its unique identity. */
export interface RecoveryArtifactRequirement {
  readonly artifactKind: string;
  readonly artifactId?: string;
}

export interface ResolvedRecoveryArtifact {
  readonly stepId: string;
  readonly artifactKind: string;
  readonly artifactId: string;
}

/** Resolve and validate preserved upstream artifacts before any rewind write. */
export async function resolveRecoveryArtifacts(
  persistence: Pick<PersistencePort, "listArtifacts">,
  definition: WorkflowDefinition,
  options: Pick<WorkflowRewindOptions, "workflowId" | "targetStepId" | "requiredArtifactsByStep">,
): Promise<ResolvedRecoveryArtifact[]> {
  const targetIndex = definition.steps.findIndex((step) => step.id === options.targetStepId);
  if (targetIndex < 0) throw new Error(`Recovery target step not found: ${options.targetStepId}`);
  const upstream = new Map(definition.steps.slice(0, targetIndex).map((step) => [step.id, step]));
  const artifacts = await persistence.listArtifacts(options.workflowId);
  const resolved: ResolvedRecoveryArtifact[] = [];
  for (const [stepId, requirement] of Object.entries(options.requiredArtifactsByStep ?? {})) {
    if (requirement === null || typeof requirement !== "object" || Array.isArray(requirement)
      || typeof requirement.artifactKind !== "string" || requirement.artifactKind.trim() === ""
      || (requirement.artifactId !== undefined && (typeof requirement.artifactId !== "string" || requirement.artifactId.trim() === ""))) {
      throw new Error(`RECOVERY_ARTIFACT_CONTRACT_INVALID:${stepId}`);
    }
    const step = upstream.get(stepId);
    if (!step) throw new Error(`RECOVERY_ARTIFACT_REQUIRED_STEP_NOT_UPSTREAM:${stepId}`);
    const match = artifacts.find((artifact) => artifact.status === "completed"
      && artifact.workflowId === options.workflowId
      && artifact.kind === requirement.artifactKind
      && (step.kind !== "agent" || artifact.producerAgent === step.agent)
      && (requirement.artifactId === undefined || artifact.artifactId === requirement.artifactId));
    if (!match) throw new Error(`RECOVERY_ARTIFACT_INVARIANT_FAILED:${stepId}:${requirement.artifactKind}`);
    resolved.push({ stepId, artifactKind: match.kind, artifactId: match.artifactId });
  }
  return resolved;
}

/** Explicit evidence-preserving rewind. It never deletes audit history. */
export async function rewindWorkflow(
  persistence: Pick<PersistencePort, "loadWorkflow" | "listArtifacts" | "saveWorkflow" | "saveCheckpoint">,
  definition: WorkflowDefinition,
  options: WorkflowRewindOptions,
): Promise<WorkflowInstance> {
  const instance = await persistence.loadWorkflow(options.workflowId);
  if (!instance) throw new Error(`Workflow instance not found: ${options.workflowId}`);
  const targetIndex = definition.steps.findIndex((step) => step.id === options.targetStepId);
  if (targetIndex < 0) throw new Error(`Recovery target step not found: ${options.targetStepId}`);
  const resolvedArtifacts = await resolveRecoveryArtifacts(persistence, definition, options);
  const rewind = new Set(options.rewindStepIds ?? definition.steps.slice(targetIndex).map((step) => step.id));
  const preserve = new Set(options.preserveCompletedStepIds ?? []);
  const priorAttempts = Object.fromEntries(instance.steps.filter((step) => rewind.has(step.stepId)).map((step) => [step.stepId, step.attempts]));
  const now = new Date().toISOString();
  const completed = instance.steps.filter((step) => preserve.has(step.stepId) || (!rewind.has(step.stepId) && step.status === "completed")).map((step) => step.stepId);
  const recovered: WorkflowInstance = {
    ...instance,
    state: "PAUSED",
    ready: [options.targetStepId],
    context: { ...instance.context, data: { ...instance.context.data, workflowRecovery: { reason: options.reason, targetStepId: options.targetStepId, recoveredAt: now, priorAttempts, requiredArtifacts: resolvedArtifacts.map((artifact) => ({ stepId: artifact.stepId, artifactKind: artifact.artifactKind, artifactId: artifact.artifactId })) } } },
    steps: instance.steps.map((step) => preserve.has(step.stepId)
      ? { ...step, status: "completed", startedAt: null, finishedAt: step.finishedAt ?? now }
      : rewind.has(step.stepId) ? { ...step, status: "pending", attempts: 0, startedAt: null, finishedAt: null } : step),
    updatedAt: now,
  };
  await persistence.saveCheckpoint({ workflowId: recovered.workflowId, state: recovered.state, completedSteps: completed, contextSnapshotRef: `recovery-${recovered.workflowId}-${Date.now()}`, lastEventOffset: completed.length, createdAt: now });
  await persistence.saveWorkflow(recovered);
  return recovered;
}
