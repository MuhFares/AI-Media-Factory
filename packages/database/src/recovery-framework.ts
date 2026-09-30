import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";

export const RECOVERY_MODES = [
  "NORMAL_RECOVERY",
  "REVISION",
  "REVIEW_RESUME",
  "MEDIA_RESUME",
  "TARGETED_VERIFICATION",
  "TARGETED_REEVALUATION_RECOVERY",
  "VISUAL_ITERATION",
  "VIDEO_RECONCILIATION",
  "PUBLISH_SESSION_RESUME",
  "ORPHAN_RECOVERY",
] as const;
export type RecoveryMode = typeof RECOVERY_MODES[number];

export type RecoveryExecutionMode = "WORKFLOW_RESUME" | "SPECIAL_EXECUTION" | "LOCAL_RECONCILIATION";
export type RecoveryBudgetCallKind = "NONE" | "TEXT_AGENT" | "RESEARCH" | "MEDIA" | "MODE_DEFINED";

export interface RecoveryModeDefinition {
  readonly mode: RecoveryMode;
  readonly eligibleStates: readonly string[];
  readonly requiredOwnerAuthority: boolean;
  readonly executionMode: RecoveryExecutionMode;
  readonly rewindTarget: string | null;
  readonly preservedStages: readonly string[];
  readonly forbiddenStages: readonly string[];
  readonly frozenReferenceKinds: readonly string[];
  readonly budgetCallKind: RecoveryBudgetCallKind;
  readonly preflightPolicy: "STANDARD" | "MEDIA" | "TARGETED" | "REEVALUATION_ONLY" | "LOCAL_ONLY";
  readonly settlementPolicy: "RESUME" | "REVISION" | "OWNER_REVIEW" | "RECONCILE";
  readonly ownerAttentionOutcome: string;
}

/**
 * Canonical rewind/preservation authority. Dispatchers may add narrower item
 * detail, but may never expand a policy's rewind horizon or execute a forbidden
 * stage. This registry deliberately reuses Program-1 stage IDs.
 */
export const RECOVERY_MODE_REGISTRY: Readonly<Record<RecoveryMode, RecoveryModeDefinition>> = Object.freeze({
  NORMAL_RECOVERY: {
    mode: "NORMAL_RECOVERY", eligibleStates: ["FAILED", "PAUSED", "BUSINESS_BLOCKED"], requiredOwnerAuthority: true,
    executionMode: "WORKFLOW_RESUME", rewindTarget: null, preservedStages: [], forbiddenStages: [],
    frozenReferenceKinds: ["sourceExecutionId", "sourceJobId", "artifactIds"], budgetCallKind: "MODE_DEFINED",
    preflightPolicy: "STANDARD", settlementPolicy: "RESUME", ownerAttentionOutcome: "OWNER_RECOVERY_REVIEW",
  },
  REVISION: {
    mode: "REVISION", eligibleStates: ["REVISION_REQUIRED", "PAUSED"], requiredOwnerAuthority: true,
    executionMode: "WORKFLOW_RESUME", rewindTarget: "writer", preservedStages: ["planner-initial", "research", "planner-synthesis"],
    forbiddenStages: ["research", "planner-initial", "planner-synthesis"],
    frozenReferenceKinds: ["reviewArtifactId", "writerArtifactId", "seoArtifactId", "brandArtifactId"],
    budgetCallKind: "TEXT_AGENT", preflightPolicy: "STANDARD", settlementPolicy: "REVISION", ownerAttentionOutcome: "OWNER_REVIEW_REQUIRED",
  },
  REVIEW_RESUME: {
    mode: "REVIEW_RESUME", eligibleStates: ["PAUSED", "AWAITING_APPROVAL", "REVISION_REQUIRED"], requiredOwnerAuthority: true,
    executionMode: "WORKFLOW_RESUME", rewindTarget: "review", preservedStages: ["research", "planner-synthesis", "writer", "seo", "brand"],
    forbiddenStages: ["research", "planner-synthesis", "writer", "seo", "brand"],
    frozenReferenceKinds: ["writerArtifactId", "seoArtifactId", "brandArtifactId"], budgetCallKind: "TEXT_AGENT",
    preflightPolicy: "STANDARD", settlementPolicy: "RESUME", ownerAttentionOutcome: "OWNER_REVIEW_REQUIRED",
  },
  MEDIA_RESUME: {
    mode: "MEDIA_RESUME", eligibleStates: ["FAILED", "PAUSED", "BUSINESS_BLOCKED"], requiredOwnerAuthority: true,
    executionMode: "WORKFLOW_RESUME", rewindTarget: "director", preservedStages: ["research", "planner-synthesis", "writer", "scenes", "visual-prompt", "review"],
    forbiddenStages: ["research", "planner-synthesis", "writer"],
    frozenReferenceKinds: ["sourceArtifactIds", "sceneIds", "configurationFingerprint"], budgetCallKind: "MEDIA",
    preflightPolicy: "MEDIA", settlementPolicy: "RESUME", ownerAttentionOutcome: "OWNER_MEDIA_REVIEW_REQUIRED",
  },
  TARGETED_VERIFICATION: {
    mode: "TARGETED_VERIFICATION", eligibleStates: ["PAUSED"], requiredOwnerAuthority: true,
    executionMode: "SPECIAL_EXECUTION", rewindTarget: null, preservedStages: ["research"],
    forbiddenStages: ["research-direction", "research-discovery", "ceo-recommendation"],
    frozenReferenceKinds: ["researchArtifactId", "candidateIds", "evidenceIds"], budgetCallKind: "RESEARCH",
    preflightPolicy: "TARGETED", settlementPolicy: "OWNER_REVIEW", ownerAttentionOutcome: "OWNER_RESEARCH_REVIEW_REQUIRED",
  },
  TARGETED_REEVALUATION_RECOVERY: {
    mode: "TARGETED_REEVALUATION_RECOVERY", eligibleStates: ["FAILED"], requiredOwnerAuthority: true,
    executionMode: "SPECIAL_EXECUTION", rewindTarget: null, preservedStages: ["research"],
    forbiddenStages: ["research-direction", "research-discovery", "web.search", "ceo-recommendation"],
    frozenReferenceKinds: ["sourceDispatchId", "researchArtifactId", "candidateIds", "evidenceIds", "routingSnapshot"],
    budgetCallKind: "TEXT_AGENT", preflightPolicy: "REEVALUATION_ONLY", settlementPolicy: "OWNER_REVIEW",
    ownerAttentionOutcome: "OWNER_RESEARCH_REVIEW_REQUIRED",
  },
  VISUAL_ITERATION: {
    mode: "VISUAL_ITERATION", eligibleStates: ["PAUSED", "REVISION_REQUIRED", "BUSINESS_BLOCKED"], requiredOwnerAuthority: true,
    executionMode: "SPECIAL_EXECUTION", rewindTarget: null, preservedStages: ["research", "planner-synthesis", "writer", "scenes", "visual-prompt"],
    forbiddenStages: ["research", "planner-synthesis", "writer", "scenes"],
    frozenReferenceKinds: ["sceneIds", "visualDirectionArtifactId", "sourceArtifactIds", "configurationFingerprint"],
    budgetCallKind: "MEDIA", preflightPolicy: "MEDIA", settlementPolicy: "OWNER_REVIEW", ownerAttentionOutcome: "OWNER_VISUAL_REVIEW_REQUIRED",
  },
  VIDEO_RECONCILIATION: {
    mode: "VIDEO_RECONCILIATION", eligibleStates: ["FAILED", "PAUSED", "BUSINESS_BLOCKED"], requiredOwnerAuthority: true,
    executionMode: "LOCAL_RECONCILIATION", rewindTarget: null, preservedStages: ["research", "planner-synthesis", "writer", "scenes", "visual-prompt", "director", "scene-image"],
    forbiddenStages: ["research", "planner-synthesis", "writer", "scenes", "scene-image", "video-submit"],
    frozenReferenceKinds: ["logicalExecutionId", "sourceVisualArtifactId", "sourceVisualSha256", "providerJobId", "configurationFingerprint"],
    budgetCallKind: "NONE", preflightPolicy: "LOCAL_ONLY", settlementPolicy: "RECONCILE", ownerAttentionOutcome: "OWNER_VIDEO_RECONCILIATION_REQUIRED",
  },
  PUBLISH_SESSION_RESUME: {
    mode: "PUBLISH_SESSION_RESUME", eligibleStates: ["FAILED", "PAUSED", "BUSINESS_BLOCKED"], requiredOwnerAuthority: true,
    executionMode: "SPECIAL_EXECUTION", rewindTarget: null, preservedStages: ["final-product-review", "publisher-authorization"],
    forbiddenStages: ["research", "planner-synthesis", "writer", "scene-image", "video", "composer"],
    frozenReferenceKinds: ["finalMediaArtifactId", "finalMediaSha256", "publicationIdentity", "publicationPayloadHash", "sessionMarker"],
    budgetCallKind: "NONE", preflightPolicy: "STANDARD", settlementPolicy: "RECONCILE", ownerAttentionOutcome: "OWNER_PUBLICATION_REVIEW_REQUIRED",
  },
  ORPHAN_RECOVERY: {
    mode: "ORPHAN_RECOVERY", eligibleStates: ["RUNNING", "FAILED", "PAUSED"], requiredOwnerAuthority: false,
    executionMode: "LOCAL_RECONCILIATION", rewindTarget: null, preservedStages: [], forbiddenStages: [],
    frozenReferenceKinds: ["sourceJobId", "workerLeaseId"], budgetCallKind: "NONE", preflightPolicy: "LOCAL_ONLY",
    settlementPolicy: "RECONCILE", ownerAttentionOutcome: "ENGINEERING_OR_OWNER_ACTION_REQUIRED",
  },
});

export interface FrozenRecoveryContextInput {
  readonly mode: RecoveryMode;
  readonly authorizationId: string;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly workflowId: string;
  readonly contentId?: string | null;
  readonly correlationId?: string | null;
  readonly sourceExecutionId?: string | null;
  readonly sourceJobId?: number | null;
  readonly frozenArtifactIds?: readonly string[];
  readonly evidenceIds?: readonly string[];
  readonly candidateIds?: readonly string[];
  readonly sceneIds?: readonly string[];
  readonly configurationFingerprint?: string | null;
  readonly routingSnapshot?: Readonly<Record<string, unknown>> | null;
  readonly budgetEnvelope?: Readonly<Record<string, number>>;
  readonly authorizedBy: string;
  readonly authorizedAt: string;
}

export interface FrozenRecoveryContext extends FrozenRecoveryContextInput {
  readonly recoveryExecutionId: string;
  readonly policyVersion: "amf-recovery-policy-v1";
  readonly attempt: 1;
  readonly rewindTarget: string | null;
  readonly preservedFrontier: readonly string[];
  readonly contextFingerprint: string;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function recoveryFingerprint(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function freezeRecoveryContext(input: FrozenRecoveryContextInput, recoveryExecutionId: string = randomUUID()): FrozenRecoveryContext {
  const policy = RECOVERY_MODE_REGISTRY[input.mode];
  if (!input.authorizationId.trim() || !input.idempotencyKey.trim() || !input.projectId.trim() || !input.workflowId.trim()) {
    throw new Error("RECOVERY_IDENTITY_REQUIRED");
  }
  const base = {
    ...input,
    frozenArtifactIds: [...new Set(input.frozenArtifactIds ?? [])].sort(),
    evidenceIds: [...new Set(input.evidenceIds ?? [])].sort(),
    candidateIds: [...new Set(input.candidateIds ?? [])].sort(),
    sceneIds: [...new Set(input.sceneIds ?? [])].sort(),
    recoveryExecutionId,
    policyVersion: "amf-recovery-policy-v1" as const,
    attempt: 1 as const,
    rewindTarget: policy.rewindTarget,
    preservedFrontier: [...policy.preservedStages],
  };
  return { ...base, contextFingerprint: recoveryFingerprint(base) };
}

export function assertFrozenRecoveryContext(context: FrozenRecoveryContext, current: FrozenRecoveryContextInput): void {
  const rebuilt = freezeRecoveryContext(current, context.recoveryExecutionId);
  if (rebuilt.contextFingerprint !== context.contextFingerprint) throw new Error("RECOVERY_FROZEN_CONTEXT_DRIFT");
}

export function assertRecoveryHorizon(mode: RecoveryMode, rewindTarget: string | null, preservedStages: readonly string[], requestedStages: readonly string[] = []): void {
  const policy = RECOVERY_MODE_REGISTRY[mode];
  if (rewindTarget !== policy.rewindTarget) throw new Error("RECOVERY_REWIND_TARGET_OUTSIDE_POLICY");
  if (policy.preservedStages.some((stage) => !preservedStages.includes(stage))) throw new Error("RECOVERY_PRESERVED_FRONTIER_REDUCED");
  if (requestedStages.some((stage) => policy.forbiddenStages.includes(stage))) throw new Error(`RECOVERY_FORBIDDEN_STAGE:${requestedStages.find((stage) => policy.forbiddenStages.includes(stage))}`);
}

export type DurableIdOwner = "RUNTIME_OWNED_ID" | "MODEL_SEMANTIC_ID" | "PROVIDER_EXTERNAL_ID";
export function validateDurableId(owner: DurableIdOwner, value: string): void {
  if (!value.trim()) throw new Error("DURABLE_ID_REQUIRED");
  if (owner === "RUNTIME_OWNED_ID" && !/^(art-|wf-|recovery-|revision-|targeted-|media-|visual-|[0-9a-f]{8}-)/i.test(value)) {
    throw new Error("RUNTIME_ID_NOT_CANONICAL");
  }
  if (owner === "PROVIDER_EXTERNAL_ID" && /^(art-|wf-|recovery-|revision-)/i.test(value)) throw new Error("PROVIDER_ID_NAMESPACE_CONFLICT");
}

export interface ArtifactRevisionDescriptor {
  readonly revisionId: string;
  readonly artifactId: string;
  readonly revisionOf: string;
  readonly revisionNumber: number;
  readonly parentArtifactIds: readonly string[];
  readonly sourceArtifactIds: readonly string[];
  readonly priorPayloadHash: string;
  readonly payloadHash: string;
  readonly producerExecutionId: string;
  readonly createdAt: string;
  readonly mutationMode: "IMMUTABLE_REVISION" | "AUDITED_IN_PLACE_REPAIR";
}

export function createArtifactRevision(input: Omit<ArtifactRevisionDescriptor, "revisionId" | "payloadHash" | "mutationMode"> & { readonly payload: unknown }): ArtifactRevisionDescriptor {
  if (input.revisionNumber < 1 || !Number.isSafeInteger(input.revisionNumber)) throw new Error("ARTIFACT_REVISION_NUMBER_INVALID");
  return {
    ...input,
    revisionId: `revision-${recoveryFingerprint([input.artifactId, input.revisionNumber, input.producerExecutionId]).slice(0, 32)}`,
    payloadHash: recoveryFingerprint(input.payload),
    mutationMode: "IMMUTABLE_REVISION",
  };
}

export function authorizeAuditedInPlaceRepair(input: { authorization: string; repairReason: string; repairExecutionId: string; oldHash: string; newHash: string; changedFields: readonly string[]; timestamp: string }): void {
  if (input.authorization !== "OWNER_APPROVED" || !input.repairReason.trim() || !input.repairExecutionId.trim()
    || !input.oldHash.trim() || !input.newHash.trim() || input.oldHash === input.newHash || input.changedFields.length === 0
    || !Number.isFinite(Date.parse(input.timestamp))) throw new Error("AUDITED_IN_PLACE_REPAIR_CONTRACT_INVALID");
}

export type RecoveryStateClassification = "STATE_CONSISTENT" | "STATE_RECOVERABLE" | "STATE_OWNER_ACTION_REQUIRED" | "STATE_CONFLICT" | "STATE_TERMINAL" | "STATE_BUSINESS_BLOCKED";
export interface RecoveryStateSnapshot {
  readonly workflowState: string;
  readonly submissionStatus: string | null;
  readonly jobStatus: string | null;
  readonly ownerActionCount: number;
  readonly completedStepArtifactValid?: boolean;
  readonly authorizationExists?: boolean;
  readonly dispatchExists?: boolean;
  readonly revisionExists?: boolean;
  readonly lifecycleReconciled?: boolean;
}
export interface RecoveryStateVerdict { readonly classification: RecoveryStateClassification; readonly codes: readonly string[]; readonly safeAutoRepair: boolean; }

export function classifyRecoveryState(state: RecoveryStateSnapshot): RecoveryStateVerdict {
  const codes: string[] = [];
  const wf = state.workflowState.toUpperCase();
  const job = state.jobStatus?.toLowerCase() ?? null;
  if ((wf === "PAUSED" || wf === "AWAITING_APPROVAL" || wf === "REVISION_REQUIRED") && state.ownerActionCount < 1) codes.push("PAUSED_WITHOUT_OWNER_ACTION");
  if (state.completedStepArtifactValid === false) codes.push("COMPLETED_STEP_INVALID_ARTIFACT");
  if (state.authorizationExists && !state.dispatchExists) codes.push("AUTHORIZATION_WITHOUT_DISPATCH");
  if (job === "running" && ["COMPLETED", "FAILED", "CANCELLED"].includes(wf)) codes.push("RUNNING_JOB_TERMINAL_WORKFLOW");
  if (["succeeded", "failed"].includes(job ?? "") && wf === "RUNNING") codes.push("TERMINAL_JOB_RUNNING_WORKFLOW");
  if (state.revisionExists && state.lifecycleReconciled === false) codes.push("REVISION_WITHOUT_LIFECYCLE_RECONCILIATION");
  if (codes.length > 0) return { classification: "STATE_CONFLICT", codes, safeAutoRepair: false };
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(wf)) return { classification: "STATE_TERMINAL", codes: [], safeAutoRepair: false };
  if (wf === "BUSINESS_BLOCKED") return { classification: "STATE_BUSINESS_BLOCKED", codes: [], safeAutoRepair: false };
  if (["PAUSED", "AWAITING_APPROVAL", "REVISION_REQUIRED"].includes(wf)) return { classification: "STATE_OWNER_ACTION_REQUIRED", codes: [], safeAutoRepair: false };
  if (job === "failed" || wf === "RETRYING") return { classification: "STATE_RECOVERABLE", codes: [], safeAutoRepair: false };
  return { classification: "STATE_CONSISTENT", codes: [], safeAutoRepair: false };
}

export type ReconciliationDisposition = "AUTO_RECONCILABLE" | "OWNER_ACTION_REQUIRED" | "ENGINEERING_ACTION_REQUIRED" | "TERMINAL_HISTORY";
export interface ReconciliationFinding { readonly code: string; readonly disposition: ReconciliationDisposition; readonly workflowId: string; readonly jobId?: number; readonly recoveryId?: string; }

/** Read-only by default: identifies split-brain states without inventing completion. */
export class RecoveryReconciliationSweeper {
  constructor(private readonly pool: pg.Pool) {}

  async scan(): Promise<readonly ReconciliationFinding[]> {
    const findings: ReconciliationFinding[] = [];
    const split = await this.pool.query(
      `SELECT j.job_id,j.workflow_id,j.status AS job_status,w.state AS workflow_state
       FROM workflow_jobs j JOIN workflow_instances w ON w.workflow_id=j.workflow_id
       WHERE (j.status='running' AND w.state IN('COMPLETED','FAILED','CANCELLED'))
          OR (j.status IN('succeeded','failed') AND w.state='RUNNING')`,
    );
    for (const row of split.rows) findings.push({
      code: row.job_status === "running" ? "RUNNING_JOB_TERMINAL_WORKFLOW" : "TERMINAL_JOB_RUNNING_WORKFLOW",
      disposition: "ENGINEERING_ACTION_REQUIRED", workflowId: String(row.workflow_id), jobId: Number(row.job_id),
    });
    const orphanDispatch = await this.pool.query(
      `SELECT recovery_execution_id,workflow_id FROM workflow_recovery_dispatches
       WHERE job_id IS NULL AND dispatch_status='PENDING'`,
    );
    for (const row of orphanDispatch.rows) findings.push({ code: "AUTHORIZATION_WITHOUT_JOB", disposition: "OWNER_ACTION_REQUIRED", workflowId: String(row.workflow_id), recoveryId: String(row.recovery_execution_id) });
    const terminalRecovery = await this.pool.query(
      `SELECT d.recovery_execution_id,d.workflow_id,j.job_id FROM workflow_recovery_dispatches d
       JOIN workflow_jobs j ON j.job_id=d.job_id WHERE d.dispatch_status='DISPATCHED' AND j.status IN('succeeded','failed')`,
    );
    for (const row of terminalRecovery.rows) findings.push({ code: "ACTIVE_RECOVERY_WITH_TERMINAL_JOB", disposition: "ENGINEERING_ACTION_REQUIRED", workflowId: String(row.workflow_id), jobId: Number(row.job_id), recoveryId: String(row.recovery_execution_id) });
    return findings;
  }
}

/** Session advisory lock: the DB connection is the lease and crash release. */
export class PostgresWorkerSingletonLease {
  private client: pg.PoolClient | null = null;
  constructor(private readonly pool: pg.Pool, readonly singletonKey: string, readonly workerRole: string) {}
  async acquire(): Promise<"ACQUIRED" | "ALREADY_HELD"> {
    if (this.client) return "ACQUIRED";
    const client = await this.pool.connect();
    const lockKey = `amf-worker:${this.singletonKey}:${this.workerRole}`;
    const result = await client.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS acquired`, [lockKey]);
    if (result.rows[0]?.acquired !== true) { client.release(); return "ALREADY_HELD"; }
    this.client = client;
    return "ACQUIRED";
  }
  async heartbeat(): Promise<boolean> {
    if (!this.client) return false;
    try { await this.client.query("SELECT 1"); return true; } catch { return false; }
  }
  async release(): Promise<void> {
    if (!this.client) return;
    const client = this.client; this.client = null;
    try { await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [`amf-worker:${this.singletonKey}:${this.workerRole}`]); } finally { client.release(); }
  }
}

export interface RetryBudgetDecision { readonly allowed: boolean; readonly action: "RESERVE" | "OWNER_CAPACITY_AUTHORIZATION_REQUIRED" | "NO_BUDGET_REQUIRED"; readonly reason: string; }
export function evaluateRecoveryRetryBudget(input: { required: number; remaining: number; sameExecutionReplay: boolean; ambiguousExternalSideEffect: boolean }): RetryBudgetDecision {
  if (input.ambiguousExternalSideEffect) return { allowed: false, action: "OWNER_CAPACITY_AUTHORIZATION_REQUIRED", reason: "RECONCILIATION_REQUIRED_NO_BLIND_RETRY" };
  if (input.sameExecutionReplay) return { allowed: true, action: "NO_BUDGET_REQUIRED", reason: "IDEMPOTENT_REPLAY_USES_EXISTING_ACCOUNTING_IDENTITY" };
  if (input.required <= input.remaining) return { allowed: true, action: "RESERVE", reason: "AUTHORIZED_RETRY_CAPACITY_AVAILABLE" };
  return { allowed: false, action: "OWNER_CAPACITY_AUTHORIZATION_REQUIRED", reason: "RETRY_BUDGET_INSUFFICIENT" };
}
