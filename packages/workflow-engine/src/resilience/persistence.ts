/**
 * Persistence Port — the durable storage boundary for workflow state.
 *
 * The engine OWNS execution state but must NOT know anything about the storage
 * technology behind this port. Implementations (e.g. PostgreSQL adapter in the
 * database package) provide durability, idempotency and crash recovery without
 * leaking storage details into the engine or any agent.
 *
 * Dependency direction:
 *   Agent → Runtime / Workflow Engine → Persistence Port → PostgreSQL Adapter
 */

import type { Uuid, CollaborationArtifact } from "@ai-media-factory/shared";
import type { WorkflowInstance } from "../core/instance.js";
import type { WorkflowCheckpoint } from "./checkpoint.js";

/**
 * Marker thrown by a step executor when the process is interrupted mid-step
 * (simulated or real crash). The engine treats it as "process died" — it
 * persists the current state and stops, leaving the in-flight step pending so
 * it can be re-run idempotently after recovery. It is NOT a step failure.
 */
export class WorkflowCrashError extends Error {
  readonly crash: true;
  constructor(message = "Workflow execution was interrupted") {
    super(message);
    this.name = "WorkflowCrashError";
    this.crash = true;
  }
}

/** A durable record of one capability execution (capability boundary evidence). */
export interface CapabilityExecutionRecord {
  readonly resultId: Uuid;
  readonly workflowId: Uuid;
  readonly correlationId: string | null;
  readonly capabilityId: string;
  readonly agentId: string;
  readonly status: "success" | "blocked" | "failed";
  readonly evidenceId: Uuid | null;
  readonly idempotencyKey: string | null;
  readonly executedAt: string;
  readonly payload: Record<string, unknown>;
}

/** A durable execution-evidence record (provenance for a produced artifact). */
export interface ExecutionEvidenceRecord {
  readonly evidenceId: Uuid;
  readonly workflowId: Uuid;
  readonly correlationId: string | null;
  readonly capabilityId: string;
  readonly agentId: string;
  readonly executedAt: string;
  readonly succeeded: boolean;
  readonly idempotencyKey: string | null;
  readonly payload: Record<string, unknown>;
}

/** A durable decision/directive/business-cycle record (CEO layer). */
export interface DecisionRecord {
  readonly decisionId: Uuid;
  readonly kind: "executive_directive" | "business_decision" | "business_cycle";
  readonly workflowId: Uuid | null;
  readonly correlationId: string | null;
  readonly cycle: number | null;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
}

/**
 * The single durable boundary the workflow engine depends on.
 * All writes are idempotent from the caller's perspective:
 *  - saveWorkflow upserts; repeating a completed step never re-executes it.
 *  - saveArtifact / saveCapabilityExecution / saveExecutionEvidence are
 *    deduplicated by stable identity (artifact id / idempotency key).
 */
export interface PersistencePort {
  // -- Workflow instance + per-step execution state -------------------------
  saveWorkflow(instance: WorkflowInstance): Promise<void>;
  loadWorkflow(workflowId: Uuid): Promise<WorkflowInstance | null>;

  // -- Checkpoints -----------------------------------------------------------
  saveCheckpoint(checkpoint: WorkflowCheckpoint): Promise<void>;
  loadLatestCheckpoint(workflowId: Uuid): Promise<WorkflowCheckpoint | null>;

  // -- Collaboration artifacts + lineage -------------------------------------
  saveArtifact(artifact: CollaborationArtifact): Promise<void>;
  listArtifacts(workflowId: Uuid): Promise<CollaborationArtifact[]>;

  // -- Capability executions -------------------------------------------------
  saveCapabilityExecution(record: CapabilityExecutionRecord): Promise<void>;
  listCapabilityExecutions(workflowId: Uuid): Promise<CapabilityExecutionRecord[]>;

  // -- Execution evidence ------------------------------------------------------
  saveExecutionEvidence(record: ExecutionEvidenceRecord): Promise<void>;
  listExecutionEvidence(workflowId: Uuid): Promise<ExecutionEvidenceRecord[]>;

  // -- Decisions / directives / business cycle ---------------------------------
  saveDecision(record: DecisionRecord): Promise<void>;
  listDecisions(workflowId: Uuid): Promise<DecisionRecord[]>;

  /** Close underlying resources (pool). Safe to call once. */
  close(): Promise<void>;
}
