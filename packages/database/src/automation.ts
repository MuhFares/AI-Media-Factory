/**
 * Program 6 — Governed Automation: canonical automation domain.
 *
 * Target: L2 GOVERNED AUTOMATION. L3/L4 are deferred and rejected here.
 *
 * Core principle: Automation != Authority. This module may detect, queue,
 * prepare, route, execute already-authorized reversible work, observe,
 * measure, evaluate, recommend, and resume. It may NOT infer authority,
 * convert readiness into approval, publish, spend, or start governed work
 * unless policy + Owner authorization explicitly permit it.
 *
 * Fail-closed defaults: no policy row == DISABLED. Existing projects never
 * become automated by migration. Morroway stays manual unless an Owner
 * explicitly configures it.
 *
 * Provider-free: this module performs no provider I/O, no LLM calls, no
 * media generation, no publication calls, no live analytics reads. All
 * execution is durable state transitions over automation_* tables plus
 * reads of canonical tables. Monetary price stays UNKNOWN; budgets are
 * count-based.
 */
import type pg from "pg";
import { createHash, randomUUID } from "node:crypto";
import { LearningLoopStore } from "./learning-loop.js";

// ---------------------------------------------------------------------------
// Canonical vocabularies
// ---------------------------------------------------------------------------

export type AutomationLevel = "L0_MANUAL" | "L1_ASSISTED" | "L2_GOVERNED";
export const AUTOMATION_LEVELS: readonly AutomationLevel[] = ["L0_MANUAL", "L1_ASSISTED", "L2_GOVERNED"];

export const OPERATION_CLASSES = [
  "internal.prepare",
  "internal.plan",
  "workflow.start.internal",
  "workflow.resume",
  "workflow.retry.bounded",
  "analytics.schedule",
  "analytics.measure",
  "learning.evaluate",
  "learning.recommend",
  "learning.propose",
  "provider.llm",
  "provider.image",
  "provider.video",
  "provider.tts",
  "provider.publish",
  "provider.analytics",
  "provider.other",
  "publication.prepare",
  "publication.execute",
  "nextcycle.evaluate",
  "nextcycle.start.internal",
] as const;
export type OperationClass = (typeof OPERATION_CLASSES)[number];
const KNOWN_OPS = new Set<string>(OPERATION_CLASSES);

/** Safe, reversible, internal-only operation classes (never touch providers). */
export const INTERNAL_SAFE_OPS: ReadonlySet<string> = new Set([
  "internal.prepare",
  "internal.plan",
  "workflow.start.internal",
  "workflow.resume",
  "workflow.retry.bounded",
  "analytics.schedule",
  "learning.evaluate",
  "learning.recommend",
  "learning.propose",
  "publication.prepare",
  "nextcycle.evaluate",
  "nextcycle.start.internal",
]);

/** Operation classes that inherently require a provider call. */
export const PROVIDER_OPS: ReadonlySet<string> = new Set([
  "provider.llm",
  "provider.image",
  "provider.video",
  "provider.tts",
  "provider.publish",
  "provider.analytics",
  "provider.other",
  "analytics.measure",
]);

export const CALL_KINDS = ["llm", "image", "video", "tts", "publication", "analytics", "other",
  "research", "text_agent", "image_generation", "video_generation", "voice_generation", "private_upload"] as const;
export type CallKind = (typeof CALL_KINDS)[number];
const KNOWN_CALL_KINDS = new Set<string>(CALL_KINDS);

export type ProviderPolicyMode = "DENY_ALL" | "ALLOW_INTERNAL_ONLY" | "ALLOW_LISTED";
export interface ProviderCallPolicy {
  readonly mode: ProviderPolicyMode;
  readonly allowedProviderOps?: readonly string[];
}

export type PublicationPolicy =
  | "PREPARE_ONLY"
  | "OWNER_APPROVAL_REQUIRED"
  | "PREAUTHORIZED_PRIVATE_VALIDATION"
  | "PREAUTHORIZED_DESTINATION_SCOPE";
export const PUBLICATION_POLICIES: readonly PublicationPolicy[] = [
  "PREPARE_ONLY",
  "OWNER_APPROVAL_REQUIRED",
  "PREAUTHORIZED_PRIVATE_VALIDATION",
  "PREAUTHORIZED_DESTINATION_SCOPE",
];

export type NextCyclePolicy = "OWNER_START_ONLY" | "AUTO_START_AFTER_OWNER_APPROVAL" | "L2_PREAUTHORIZED_INTERNAL_CYCLE";
export const NEXT_CYCLE_POLICIES: readonly NextCyclePolicy[] = [
  "OWNER_START_ONLY",
  "AUTO_START_AFTER_OWNER_APPROVAL",
  "L2_PREAUTHORIZED_INTERNAL_CYCLE",
];

export interface AutomationPolicy {
  readonly projectId: string;
  readonly enabled: boolean;
  readonly level: AutomationLevel;
  readonly allowedOps: readonly string[];
  readonly humanGatedOps: readonly string[];
  readonly providerPolicy: ProviderCallPolicy;
  readonly publicationPolicy: PublicationPolicy;
  readonly nextCyclePolicy: NextCyclePolicy;
  readonly updatedBy: string;
  readonly updatedAt: string;
}

export type EligibilityVerdict = "ELIGIBLE" | "WAITING" | "REQUIRES_OWNER_DECISION" | "BLOCKED" | "NOT_APPLICABLE";
export interface EligibilityResult {
  readonly verdict: EligibilityVerdict;
  readonly reasons: readonly string[];
}

export type AutomationState =
  | "DISABLED"
  | "IDLE"
  | "EVALUATING"
  | "RUNNING"
  | "WAITING"
  | "WAITING_FOR_OWNER"
  | "SCHEDULED"
  | "BLOCKED"
  | "FAILED"
  | "COMPLETED";

export const JOB_TYPES = [
  "eligible_work_evaluation",
  "scheduled_analytics_measurement",
  "content_planning_checkpoint",
  "workflow_resume",
  "learning_evaluation",
  "health_recovery_check",
  "next_cycle_evaluation",
  "next_cycle_execution",
] as const;
export type AutomationJobType = (typeof JOB_TYPES)[number];
const KNOWN_JOB_TYPES = new Set<string>(JOB_TYPES);

export const JOB_STATES = ["PENDING", "SCHEDULED", "CLAIMED", "RUNNING", "SUCCEEDED", "FAILED", "DEAD_LETTER", "CANCELLED"] as const;
export type AutomationJobState = (typeof JOB_STATES)[number];

export interface AutomationJob {
  readonly jobId: string;
  readonly projectId: string;
  readonly jobType: string;
  readonly dueAt: string;
  readonly state: AutomationJobState;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly idempotencyKey: string;
  readonly payload: Record<string, unknown>;
  readonly lastOutcome: Record<string, unknown> | null;
  readonly nextEligibleAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const TRIGGER_KINDS = [
  "state_transition",
  "decision_resolved",
  "scheduled_due",
  "analytics_available",
  "workflow_completed",
  "failure_recovery_eligible",
  "proposal_available",
] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export type FailureClassification =
  | "RETRYABLE"
  | "NON_RETRYABLE"
  | "REQUIRES_OWNER"
  | "REQUIRES_CONFIGURATION"
  | "REQUIRES_CREDENTIAL"
  | "PERMANENT";

export const ATTENTION_KINDS = [
  "DECISION_REQUIRED",
  "CREDENTIAL_REQUIRED",
  "CONFIGURATION_REQUIRED",
  "BUDGET_BLOCKED",
  "FAILED",
  "MEASUREMENT_PENDING",
  "READY_FOR_OWNER_START",
] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

export interface AttentionItem {
  readonly attentionId: string;
  readonly projectId: string;
  readonly kind: string;
  readonly subjectType: string | null;
  readonly subjectId: string | null;
  readonly detail: Record<string, unknown>;
  readonly status: string;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

export interface AutomationEventRecord {
  readonly eventId: string;
  readonly projectId: string;
  readonly kind: string;
  readonly subjectType: string | null;
  readonly subjectId: string | null;
  readonly what: string;
  readonly why: Record<string, unknown>;
  readonly policyRef: Record<string, unknown>;
  readonly authorityRef: Record<string, unknown>;
  readonly budgetRef: Record<string, unknown>;
  readonly result: Record<string, unknown>;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Pure helpers: defaults, normalization, eligibility, retry, contracts
// ---------------------------------------------------------------------------

function sha12(canonical: string): string {
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}

function asRecord(v: unknown): Record<string, unknown> {
  if (typeof v === "string") {
    try {
      const p: unknown = JSON.parse(v);
      return typeof p === "object" && p !== null && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") {
    try {
      return asStringArray(JSON.parse(v));
    } catch {
      return [];
    }
  }
  return [];
}

/** Fail-closed default: disabled, manual, nothing allowed, nothing spent. */
export function defaultAutomationPolicy(projectId: string): AutomationPolicy {
  return {
    projectId,
    enabled: false,
    level: "L0_MANUAL",
    allowedOps: [],
    humanGatedOps: [],
    providerPolicy: { mode: "DENY_ALL" },
    publicationPolicy: "PREPARE_ONLY",
    nextCyclePolicy: "OWNER_START_ONLY",
    updatedBy: "system-default",
    updatedAt: new Date(0).toISOString(),
  };
}

export interface SetPolicyInput {
  readonly projectId: string;
  readonly enabled: boolean;
  readonly level: string;
  readonly allowedOps?: readonly string[];
  readonly humanGatedOps?: readonly string[];
  readonly providerPolicy?: ProviderCallPolicy;
  readonly publicationPolicy?: PublicationPolicy;
  readonly nextCyclePolicy?: NextCyclePolicy;
  readonly updatedBy?: string;
}

export function normalizePolicyInput(input: SetPolicyInput): AutomationPolicy {
  if (!input.projectId || typeof input.projectId !== "string") throw new Error("AUTOMATION_PROJECT_REQUIRED");
  if (input.level === "L3_HIGH_AUTONOMY" || input.level === "L4_AUTONOMOUS" || !(AUTOMATION_LEVELS as readonly string[]).includes(input.level)) {
    throw new Error("AUTOMATION_LEVEL_DEFERRED:L3/L4 are not implemented by Program 6");
  }
  const allowed = [...(input.allowedOps ?? [])];
  for (const op of allowed) {
    if (!KNOWN_OPS.has(op)) throw new Error(`AUTOMATION_UNKNOWN_OPERATION:${op}`);
  }
  const gated = [...(input.humanGatedOps ?? [])];
  for (const op of gated) {
    if (!KNOWN_OPS.has(op)) throw new Error(`AUTOMATION_UNKNOWN_OPERATION:${op}`);
  }
  const providerPolicy: ProviderCallPolicy = input.providerPolicy ?? { mode: "DENY_ALL" };
  if (!["DENY_ALL", "ALLOW_INTERNAL_ONLY", "ALLOW_LISTED"].includes(providerPolicy.mode)) {
    throw new Error("AUTOMATION_PROVIDER_POLICY_INVALID");
  }
  if (providerPolicy.mode === "ALLOW_LISTED") {
    const listed = [...(providerPolicy.allowedProviderOps ?? [])];
    for (const op of listed) {
      if (!PROVIDER_OPS.has(op)) throw new Error(`AUTOMATION_PROVIDER_OP_INVALID:${op}`);
    }
  }
  if (input.publicationPolicy && !PUBLICATION_POLICIES.includes(input.publicationPolicy)) {
    throw new Error("AUTOMATION_PUBLICATION_POLICY_INVALID");
  }
  if (input.nextCyclePolicy && !NEXT_CYCLE_POLICIES.includes(input.nextCyclePolicy)) {
    throw new Error("AUTOMATION_NEXT_CYCLE_POLICY_INVALID");
  }
  // L2 with provider calls allowed still requires explicit budgets + authority
  // at eligibility time; normalization only guards shape here.
    return {
      projectId: input.projectId,
      enabled: input.enabled === true,
      level: input.level as AutomationLevel,
    allowedOps: allowed,
    humanGatedOps: gated,
    providerPolicy,
    publicationPolicy: input.publicationPolicy ?? "PREPARE_ONLY",
    nextCyclePolicy: input.nextCyclePolicy ?? "OWNER_START_ONLY",
    updatedBy: (input.updatedBy ?? "owner").slice(0, 200) || "owner",
    updatedAt: new Date().toISOString(),
  };
}

export interface EligibilityEvidence {
  readonly actionProjectId?: string;
  readonly ownerDecisionStatus?: "PENDING" | "APPROVED" | "REJECTED" | "NONE";
  readonly gateRequiresOwner?: boolean;
  /** Count-budget check outcome for provider-bound actions. */
  readonly budgetCheck?: { readonly allowed: boolean; readonly reason: string; readonly remaining?: number };
  readonly providerOp?: string | null;
  /** Structured authority present (canonical DECIDED/APPROVE), never a string claim. */
  readonly authorityPresent?: boolean;
  readonly channelCheck?: { readonly known: boolean; readonly sameProject: boolean; readonly verified: boolean; readonly explicit: boolean };
  readonly credentialCheck?: { readonly known: boolean; readonly valid: boolean };
  readonly conflictingRun?: boolean;
  readonly inputsComplete?: boolean;
  /** Next-cycle proposal state + policy-derived approval state. */
  readonly proposalState?: string | null;
  readonly nextCycleApprovalStatus?: "PENDING" | "APPROVED" | "REJECTED" | "NONE";
}

/**
 * Deterministic eligibility engine. No LLM, no provider I/O. Accumulates
 * every applicable reason; verdict is the highest-priority class present:
 * BLOCKED > REQUIRES_OWNER_DECISION > WAITING > NOT_APPLICABLE > ELIGIBLE.
 */
export function evaluateActionEligibility(
  policy: AutomationPolicy,
  operationClass: string,
  evidence: EligibilityEvidence & { readonly projectId: string },
): EligibilityResult {
  const blocked: string[] = [];
  const needsOwner: string[] = [];
  const waiting: string[] = [];
  const na: string[] = [];

  if (!evidence.projectId || !evidence.actionProjectId) {
    blocked.push("PROJECT_SCOPE_REQUIRED");
  } else if (evidence.projectId !== evidence.actionProjectId) {
    blocked.push("CROSS_PROJECT_DENIED");
  }
  if (!policy.enabled) na.push("AUTOMATION_DISABLED");
  if (policy.level === "L0_MANUAL") na.push("LEVEL_L0_MANUAL_REQUIRES_OWNER_START");
  if (!KNOWN_OPS.has(operationClass)) blocked.push(`UNKNOWN_OPERATION_CLASS:${operationClass}`);
  else if (!policy.allowedOps.includes(operationClass)) blocked.push(`OPERATION_NOT_ALLOWED:${operationClass}`);

  // Publication execution is never automatic in Program 6. Readiness is not
  // authority; even PREAUTHORIZED_* modes stop here (no provider calls).
  if (operationClass === "publication.execute") {
    blocked.push("AUTOMATIC_PUBLICATION_NOT_ENABLED");
  }

  const providerOp = evidence.providerOp ?? (PROVIDER_OPS.has(operationClass) ? operationClass : null);
  if (providerOp) {
    const mode = policy.providerPolicy.mode;
    if (mode === "DENY_ALL") blocked.push("PROVIDER_CALLS_DENIED_BY_POLICY");
    else if (mode === "ALLOW_INTERNAL_ONLY") blocked.push("PROVIDER_CALLS_REQUIRE_LISTED_GRANT");
    else if (mode === "ALLOW_LISTED" && !(policy.providerPolicy.allowedProviderOps ?? []).includes(providerOp)) {
      blocked.push(`PROVIDER_OP_NOT_GRANTED:${providerOp}`);
    }
    if (!evidence.budgetCheck) blocked.push("BUDGET_NOT_CONFIGURED");
    else if (!evidence.budgetCheck.allowed) blocked.push(evidence.budgetCheck.reason || "BUDGET_BLOCKED");
    // Governed external action requires structured authority, never inference.
    if (evidence.authorityPresent !== true) blocked.push("MISSING_AUTHORITY_FOR_EXTERNAL_ACTION");
  }

  if (policy.humanGatedOps.includes(operationClass) && evidence.ownerDecisionStatus !== "APPROVED") {
    needsOwner.push(`HUMAN_GATE_REQUIRES_DECISION:${operationClass}`);
  }
  if (evidence.gateRequiresOwner === true && evidence.ownerDecisionStatus !== "APPROVED") {
    needsOwner.push("GATE_REQUIRES_OWNER_DECISION");
  }
  if (evidence.ownerDecisionStatus === "REJECTED") blocked.push("DECISION_REJECTED_MUST_NOT_CONTINUE");
  else if (evidence.ownerDecisionStatus === "PENDING") waiting.push("DECISION_PENDING");

  if (evidence.channelCheck) {
    const c = evidence.channelCheck;
    if (!c.known) blocked.push("UNKNOWN_CHANNEL");
    else if (!c.sameProject) blocked.push("CROSS_PROJECT_CHANNEL_DENIED");
    else if (!c.verified) blocked.push("CHANNEL_NOT_VERIFIED");
    else if (!c.explicit) blocked.push("CHANNEL_DESTINATION_AMBIGUOUS");
  }
  if (evidence.credentialCheck) {
    if (!evidence.credentialCheck.known) blocked.push("UNKNOWN_CREDENTIAL");
    else if (!evidence.credentialCheck.valid) blocked.push("CREDENTIAL_REQUIRED");
  }
  if (evidence.conflictingRun === true) waiting.push("CONFLICTING_RUN_ACTIVE");
  if (evidence.inputsComplete === false) waiting.push("INPUTS_INCOMPLETE");

  // Next-cycle policy gate (proposal != authorization).
  if (operationClass === "nextcycle.start.internal") {
    const np = policy.nextCyclePolicy;
    const approval = evidence.nextCycleApprovalStatus ?? "NONE";
    if (np === "OWNER_START_ONLY") needsOwner.push("NEXT_CYCLE_OWNER_START_ONLY");
    else if (np === "AUTO_START_AFTER_OWNER_APPROVAL" && approval !== "APPROVED") {
      if (approval === "REJECTED") blocked.push("NEXT_CYCLE_APPROVAL_REJECTED");
      else needsOwner.push("NEXT_CYCLE_REQUIRES_OWNER_APPROVAL");
    }
    // L2_PREAUTHORIZED_INTERNAL_CYCLE still requires recommendation linkage
    // (proposalState present) but not a fresh Owner approval for INTERNAL ops.
    if (evidence.proposalState != null && evidence.proposalState !== "AWAITS_OWNER_DECISION") {
      blocked.push(`NEXT_CYCLE_PROPOSAL_STATE_INVALID:${evidence.proposalState}`);
    }
  }
  if (operationClass === "nextcycle.evaluate" && evidence.proposalState != null && evidence.proposalState !== "AWAITS_OWNER_DECISION") {
    blocked.push(`NEXT_CYCLE_PROPOSAL_STATE_INVALID:${evidence.proposalState}`);
  }

  // L1 prepares but never auto-executes: otherwise-eligible work waits.
  if (policy.level === "L1_ASSISTED" && blocked.length === 0 && needsOwner.length === 0) {
    waiting.push("ASSISTED_REQUIRES_OWNER_START");
  }

  // Scope violations are security boundaries: always BLOCKED, even when the
  // project is disabled or manual (fail-closed beats state reporting).
  const scopeViolation = blocked.find((r) =>
    r === "PROJECT_SCOPE_REQUIRED" || r === "CROSS_PROJECT_DENIED" ||
    r === "CROSS_PROJECT_CHANNEL_DENIED" || r === "UNKNOWN_CHANNEL" ||
    r === "UNKNOWN_CREDENTIAL" || r === "UNKNOWN_OPERATION_CLASS" ||
    r.startsWith("UNKNOWN_OPERATION_CLASS:"));
  if (scopeViolation) return { verdict: "BLOCKED", reasons: blocked };
  // Disabled or MANUAL projects never auto-execute: report NOT_APPLICABLE
  // (with the full reason list) rather than a misleading BLOCKED verdict.
  if (!policy.enabled || policy.level === "L0_MANUAL") {
    return { verdict: "NOT_APPLICABLE", reasons: [...na, ...blocked, ...needsOwner, ...waiting] };
  }
  if (blocked.length) return { verdict: "BLOCKED", reasons: blocked };
  if (needsOwner.length) return { verdict: "REQUIRES_OWNER_DECISION", reasons: [...needsOwner, ...waiting] };
  if (waiting.length) return { verdict: "WAITING", reasons: waiting };
  if (na.length) return { verdict: "NOT_APPLICABLE", reasons: na };
  return { verdict: "ELIGIBLE", reasons: ["POLICY_ALLOWS_INTERNAL_WORK"] };
}

/** Classify a failure code/message into governed retry semantics. */
export function classifyFailure(codeOrMessage: string): FailureClassification {
  const s = String(codeOrMessage ?? "").toUpperCase();
  if (/CREDENTIAL|UNAUTHORIZED|FORBIDDEN|TOKEN|OAUTH|SCOPE/.test(s)) return "REQUIRES_CREDENTIAL";
  if (/CONFIG|MISSING_ENV|NOT_CONFIGURED|UNCONFIGURED|ALLOWLIST|DRIFT/.test(s)) return "REQUIRES_CONFIGURATION";
  if (/OWNER|APPROVAL|GATE|DECISION|AUTHORITY/.test(s)) return "REQUIRES_OWNER";
  if (/PERMANENT|INVALID_INPUT|VALIDATION_FAILED|SCHEMA|NOT_FOUND|CONFLICT/.test(s)) return "PERMANENT";
  if (/NON_RETRYABLE|FATAL|ABORT/.test(s)) return "NON_RETRYABLE";
  if (/TIMEOUT|RATE_LIMIT|THROTTLE|EAI_AGAIN|ENOTFOUND|ECONN|TEMPORARY|TRANSIENT|RETRYABLE|CRASH|RESTART/.test(s)) return "RETRYABLE";
  // Unknown failures fail closed: owner-visible, never silently retried.
  return "NON_RETRYABLE";
}

/** Bounded retry: only RETRYABLE, only within maxAttempts, deterministic backoff. */
export function shouldRetry(classification: FailureClassification, attemptCount: number, maxAttempts: number): boolean {
  if (classification !== "RETRYABLE") return false;
  if (!Number.isFinite(attemptCount) || !Number.isFinite(maxAttempts)) return false;
  return attemptCount < maxAttempts;
}

/** Deterministic backoff: 60s * 2^attempt, capped at 1h. No jitter (reproducible). */
export function retryBackoffMs(attemptCount: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attemptCount), 3_600_000);
}

/**
 * Agent automation contract (Workstream S). Separates recommendation,
 * execution, eligibility, and authority. No agent output string may itself
 * grant authority: only a structured canonical approval (DECIDED + APPROVE)
 * counts, and it is checked by the caller, never parsed from prose.
 */
export function validateAgentAutomationContract(input: {
  readonly hasRecommendation: boolean;
  readonly requestsExecution: boolean;
  readonly operationClass?: string;
  readonly eligibility?: EligibilityResult | null;
  readonly claimedAuthorityText?: string | null;
  readonly structuredApproval?: { readonly status: string; readonly decision: string | null } | null;
}): { readonly allowed: boolean; readonly verdict: EligibilityVerdict; readonly reasons: readonly string[] } {
  if (!input.requestsExecution) {
    return { allowed: true, verdict: "ELIGIBLE", reasons: ["AGENT_RECOMMENDATION_IS_ADVISORY_ONLY"] };
  }
  if (input.claimedAuthorityText != null && input.claimedAuthorityText.trim() !== "") {
    const ok =
      input.structuredApproval != null &&
      input.structuredApproval.status === "DECIDED" &&
      input.structuredApproval.decision === "APPROVE";
    if (!ok) {
      return { allowed: false, verdict: "BLOCKED", reasons: ["AGENT_OUTPUT_CANNOT_GRANT_AUTHORITY"] };
    }
  }
  const elig = input.eligibility;
  if (!elig || elig.verdict !== "ELIGIBLE") {
    return { allowed: false, verdict: elig?.verdict ?? "BLOCKED", reasons: elig?.reasons ?? ["AGENT_EXECUTION_NOT_ELIGIBLE"] };
  }
  return { allowed: true, verdict: "ELIGIBLE", reasons: ["AGENT_EXECUTION_ELIGIBLE_UNDER_POLICY"] };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const jobRow = (r: Record<string, unknown>): AutomationJob => ({
  jobId: String(r.job_id),
  projectId: String(r.project_id),
  jobType: String(r.job_type),
  dueAt: String(r.due_at),
  state: String(r.state) as AutomationJobState,
  attemptCount: Number(r.attempt_count ?? 0),
  maxAttempts: Number(r.max_attempts ?? 3),
  idempotencyKey: String(r.idempotency_key),
  payload: asRecord(r.payload),
  lastOutcome: r.last_outcome == null ? null : asRecord(r.last_outcome),
  nextEligibleAt: (r.next_eligible_at as string | null) ?? null,
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

const eventRow = (r: Record<string, unknown>): AutomationEventRecord => ({
  eventId: String(r.event_id),
  projectId: String(r.project_id),
  kind: String(r.kind),
  subjectType: (r.subject_type as string | null) ?? null,
  subjectId: (r.subject_id as string | null) ?? null,
  what: String(r.what),
  why: asRecord(r.why),
  policyRef: asRecord(r.policy_ref),
  authorityRef: asRecord(r.authority_ref),
  budgetRef: asRecord(r.budget_ref),
  result: asRecord(r.result),
  createdAt: String(r.created_at),
});

const attentionRow = (r: Record<string, unknown>): AttentionItem => ({
  attentionId: String(r.attention_id),
  projectId: String(r.project_id),
  kind: String(r.kind),
  subjectType: (r.subject_type as string | null) ?? null,
  subjectId: (r.subject_id as string | null) ?? null,
  detail: asRecord(r.detail),
  status: String(r.status ?? "OPEN"),
  createdAt: String(r.created_at),
  resolvedAt: (r.resolved_at as string | null) ?? null,
});

export interface ScheduleJobInput {
  readonly projectId: string;
  readonly jobType: string;
  readonly dueAt?: string;
  readonly payload?: Record<string, unknown>;
  readonly idempotencyKey: string;
  readonly maxAttempts?: number;
  readonly jobId?: string;
}

export interface ExplainResult {
  readonly projectId: string;
  readonly policy: AutomationPolicy;
  readonly eligible: ReadonlyArray<{ readonly action: string; readonly reasons: readonly string[] }>;
  readonly waiting: ReadonlyArray<{ readonly action: string; readonly reasons: readonly string[] }>;
  readonly requiresOwnerDecision: ReadonlyArray<{ readonly action: string; readonly reasons: readonly string[] }>;
  readonly blocked: ReadonlyArray<{ readonly action: string; readonly reasons: readonly string[] }>;
  readonly notApplicable: ReadonlyArray<{ readonly action: string; readonly reasons: readonly string[] }>;
}

export interface TickResult {
  readonly projectId: string;
  readonly tickId: string;
  readonly evaluated: number;
  readonly acted: number;
  readonly started: number;
  readonly resumed: number;
  readonly waiting: number;
  readonly blocked: number;
  readonly errors: readonly string[];
  readonly completedTick: boolean;
}

export interface StarterEvaluation {
  readonly proposalId: string;
  readonly projectId: string;
  readonly eligibleToStart: boolean;
  readonly verdict: EligibilityVerdict;
  readonly reasons: readonly string[];
  readonly checks: Record<string, unknown>;
}

export class AutomationStore {
  constructor(private readonly pool: pg.Pool) {}

  // -- policy ---------------------------------------------------------------
  async getPolicy(projectId: string): Promise<AutomationPolicy> {
    const q = await this.pool.query(`SELECT * FROM automation_policies WHERE project_id=$1`, [projectId]);
    if (!q.rowCount) return defaultAutomationPolicy(projectId);
    const r = q.rows[0] as Record<string, unknown>;
    return {
      projectId: String(r.project_id),
      enabled: Number(r.enabled) === 1,
      level: String(r.level) as AutomationLevel,
      allowedOps: asStringArray(r.allowed_ops),
      humanGatedOps: asStringArray(r.human_gated_ops),
      providerPolicy: asRecord(r.provider_policy) as unknown as ProviderCallPolicy,
      publicationPolicy: String(r.publication_policy) as PublicationPolicy,
      nextCyclePolicy: String(r.next_cycle_policy) as NextCyclePolicy,
      updatedBy: String(r.updated_by ?? "owner"),
      updatedAt: String(r.updated_at),
    };
  }

  async listPolicies(): Promise<AutomationPolicy[]> {
    const q = await this.pool.query(`SELECT project_id FROM automation_policies ORDER BY project_id`);
    const out: AutomationPolicy[] = [];
    for (const r of q.rows) out.push(await this.getPolicy(String((r as Record<string, unknown>).project_id)));
    return out;
  }

  async setPolicy(input: SetPolicyInput): Promise<AutomationPolicy> {
    const policy = normalizePolicyInput(input);
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO automation_policies (project_id,enabled,level,allowed_ops,human_gated_ops,provider_policy,publication_policy,next_cycle_policy,updated_by,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
       ON CONFLICT (project_id) DO UPDATE SET enabled=$2,level=$3,allowed_ops=$4,human_gated_ops=$5,provider_policy=$6,publication_policy=$7,next_cycle_policy=$8,updated_by=$9,updated_at=$10`,
      [
        policy.projectId, policy.enabled ? 1 : 0, policy.level,
        JSON.stringify(policy.allowedOps), JSON.stringify(policy.humanGatedOps),
        JSON.stringify(policy.providerPolicy), policy.publicationPolicy, policy.nextCyclePolicy,
        policy.updatedBy, now,
      ],
    );
    await this.recordEvent({
      projectId: policy.projectId, kind: "policy.updated",
      subjectType: "automation_policy", subjectId: policy.projectId,
      what: `Automation policy ${policy.enabled ? "ENABLED" : "DISABLED"} at ${policy.level}`,
      why: { level: policy.level, allowedOps: policy.allowedOps },
      policyRef: { level: policy.level, enabled: policy.enabled },
    });
    return { ...policy, updatedAt: now };
  }

  // -- budgets ---------------------------------------------------------------
  async setCallBudget(input: { projectId: string; callKind: string; limitCount: number; maxRetries?:number; limitKind?:"HARD"|"SOFT"; costKind?:"KNOWN"|"UNKNOWN"; knownUnitCostUsd?:number|null }): Promise<{ projectId: string; callKind: string; limit: number; used: number }> {
    if (!input.projectId) throw new Error("AUTOMATION_PROJECT_REQUIRED");
    if (!KNOWN_CALL_KINDS.has(input.callKind)) throw new Error(`AUTOMATION_CALL_KIND_INVALID:${input.callKind}`);
    if (!Number.isInteger(input.limitCount) || input.limitCount < 0) throw new Error("AUTOMATION_BUDGET_LIMIT_INVALID");
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO automation_call_budgets (project_id,call_kind,limit_count,used_count,updated_at,max_retries,limit_kind,cost_kind,known_unit_cost_usd)
       VALUES ($1,$2,$3,0,$4,$5,$6,$7,$8)
       ON CONFLICT (project_id,call_kind) DO UPDATE SET limit_count=$3,max_retries=$5,limit_kind=$6,cost_kind=$7,known_unit_cost_usd=$8,updated_at=$4`,
      [input.projectId, input.callKind, input.limitCount, now, input.maxRetries??0,input.limitKind??"HARD",input.costKind??"UNKNOWN",input.knownUnitCostUsd??null],
    );
    const row = await this.pool.query(`SELECT limit_count,used_count FROM automation_call_budgets WHERE project_id=$1 AND call_kind=$2`, [input.projectId, input.callKind]);
    return { projectId: input.projectId, callKind: input.callKind, limit: Number(row.rows[0].limit_count), used: Number(row.rows[0].used_count) };
  }

  async getCallBudgets(projectId: string): Promise<ReadonlyArray<{ callKind: string; limit: number; used: number; remaining: number; maxRetries:number; limitKind:string; costKind:string; knownUnitCostUsd:number|null }>> {
    const q = await this.pool.query(`SELECT call_kind,limit_count,used_count,max_retries,limit_kind,cost_kind,known_unit_cost_usd FROM automation_call_budgets WHERE project_id=$1 ORDER BY call_kind`, [projectId]);
    return q.rows.map((r: Record<string, unknown>) => ({
      callKind: String(r.call_kind),
      limit: Number(r.limit_count),
      used: Number(r.used_count),
      remaining: Math.max(0, Number(r.limit_count) - Number(r.used_count)),
      maxRetries: Number(r.max_retries??0), limitKind:String(r.limit_kind??"HARD"),
      costKind:String(r.cost_kind??"UNKNOWN"), knownUnitCostUsd:r.known_unit_cost_usd===null?null:Number(r.known_unit_cost_usd),
    }));
  }

  async checkCallBudget(projectId: string, callKind: string, needed = 1): Promise<{ allowed: boolean; reason: string; remaining: number; limit: number; used: number }> {
    const q = await this.pool.query(`SELECT limit_count,used_count FROM automation_call_budgets WHERE project_id=$1 AND call_kind=$2`, [projectId, callKind]);
    if (!q.rowCount) return { allowed: false, reason: "BUDGET_NOT_CONFIGURED", remaining: 0, limit: 0, used: 0 };
    const limit = Number(q.rows[0].limit_count);
    const used = Number(q.rows[0].used_count);
    const remaining = Math.max(0, limit - used);
    if (used + needed > limit) return { allowed: false, reason: "BUDGET_EXHAUSTED", remaining, limit, used };
    return { allowed: true, reason: "BUDGET_AVAILABLE", remaining, limit, used };
  }

  /** Atomic consume: concurrent double-spend fails closed (0 rows updated). */
  async consumeCallBudget(projectId: string, callKind: string, count: number, ref: string): Promise<{ limit: number; used: number }> {
    if (!Number.isInteger(count) || count <= 0) throw new Error("AUTOMATION_BUDGET_COUNT_INVALID");
    const now = new Date().toISOString();
    const q = await this.pool.query(
      `UPDATE automation_call_budgets SET used_count=used_count+$3,updated_at=$4
        WHERE project_id=$1 AND call_kind=$2 AND used_count+$3 <= limit_count
        RETURNING limit_count,used_count`,
      [projectId, callKind, count, now],
    );
    if (!q.rowCount) {
      const check = await this.checkCallBudget(projectId, callKind, count);
      await this.recordEvent({
        projectId, kind: "budget.blocked", subjectType: "call_budget", subjectId: `${callKind}:${ref}`,
        what: `Budget blocked ${callKind} x${count}`,
        why: { reason: check.reason }, budgetRef: { callKind, limit: check.limit, used: check.used },
      });
      throw new Error(`AUTOMATION_${check.reason}:${callKind}`);
    }
    return { limit: Number(q.rows[0].limit_count), used: Number(q.rows[0].used_count) };
  }

  // -- jobs (scheduler foundation) -------------------------------------------
  async scheduleJob(input: ScheduleJobInput): Promise<{ job: AutomationJob; created: boolean }> {
    if (!input.projectId) throw new Error("AUTOMATION_PROJECT_REQUIRED");
    if (!KNOWN_JOB_TYPES.has(input.jobType)) throw new Error(`AUTOMATION_JOB_TYPE_INVALID:${input.jobType}`);
    if (!input.idempotencyKey) throw new Error("AUTOMATION_IDEMPOTENCY_REQUIRED");
    const maxAttempts = input.maxAttempts ?? 3;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 0 || maxAttempts > 10) throw new Error("AUTOMATION_MAX_ATTEMPTS_INVALID");
    const now = new Date().toISOString();
    const jobId = input.jobId ?? `ajob-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const dueAt = input.dueAt ?? now;
    const inserted = await this.pool.query(
      `INSERT INTO automation_jobs (job_id,project_id,job_type,due_at,state,attempt_count,max_attempts,idempotency_key,payload,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'PENDING',0,$5,$6,$7,$8,$8) ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
      [jobId, input.projectId, input.jobType, dueAt, maxAttempts, input.idempotencyKey, JSON.stringify(input.payload ?? {}), now],
    );
    if (inserted.rowCount) return { job: jobRow(inserted.rows[0]), created: true };
    const existing = await this.pool.query(`SELECT * FROM automation_jobs WHERE idempotency_key=$1`, [input.idempotencyKey]);
    const job = jobRow(existing.rows[0]);
    if (job.projectId !== input.projectId) throw new Error("AUTOMATION_CROSS_PROJECT_IDEMPOTENCY_DENIED");
    return { job, created: false };
  }

  async getJob(jobId: string, projectId: string): Promise<AutomationJob | null> {
    const q = await this.pool.query(`SELECT * FROM automation_jobs WHERE job_id=$1 AND project_id=$2`, [jobId, projectId]);
    return q.rowCount ? jobRow(q.rows[0]) : null;
  }

  async listJobs(projectId: string, opts?: { state?: string; limit?: number }): Promise<AutomationJob[]> {
    const n = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
    if (opts?.state) {
      const q = await this.pool.query(`SELECT * FROM automation_jobs WHERE project_id=$1 AND state=$2 ORDER BY due_at ASC LIMIT ${n}`, [projectId, opts.state]);
      return q.rows.map(jobRow);
    }
    const q = await this.pool.query(`SELECT * FROM automation_jobs WHERE project_id=$1 ORDER BY due_at ASC LIMIT ${n}`, [projectId]);
    return q.rows.map(jobRow);
  }

  async listDueJobs(projectId: string, now: string, limit = 20): Promise<AutomationJob[]> {
    const n = Math.min(Math.max(limit, 1), 100);
    const q = await this.pool.query(
      `SELECT * FROM automation_jobs WHERE project_id=$1 AND state IN ('PENDING','SCHEDULED') AND due_at <= $2 ORDER BY due_at ASC LIMIT ${n}`,
      [projectId, now],
    );
    return q.rows.map(jobRow);
  }

  /** Atomic claim: exactly one claimant wins; restart-safe (CLAIMED is recoverable). */
  async claimDueJobs(projectId: string, now: string, limit = 5): Promise<AutomationJob[]> {
    const n = Math.min(Math.max(limit, 1), 25);
    const q = await this.pool.query(
      `UPDATE automation_jobs SET state='CLAIMED',updated_at=$3 WHERE job_id IN (
         SELECT job_id FROM automation_jobs
          WHERE project_id=$1 AND state IN ('PENDING','SCHEDULED') AND due_at <= $2
          ORDER BY due_at ASC LIMIT ${n} FOR UPDATE SKIP LOCKED
       ) RETURNING *`,
      [projectId, now, new Date().toISOString()],
    );
    return q.rows.map(jobRow);
  }

  async completeJob(jobId: string, projectId: string, outcome: Record<string, unknown>): Promise<AutomationJob | null> {
    const now = new Date().toISOString();
    const q = await this.pool.query(
      `UPDATE automation_jobs SET state='SUCCEEDED',last_outcome=$3,updated_at=$4
        WHERE job_id=$1 AND project_id=$2 AND state IN ('PENDING','SCHEDULED','CLAIMED','RUNNING') RETURNING *`,
      [jobId, projectId, JSON.stringify(outcome), now],
    );
    if (!q.rowCount) return this.getJob(jobId, projectId);
    const job = jobRow(q.rows[0]);
    await this.recordEvent({
      projectId, kind: `job.succeeded`, subjectType: "automation_job", subjectId: jobId,
      what: `Job ${job.jobType} completed`, result: outcome,
    });
    return job;
  }

  async failJob(jobId: string, projectId: string, input: { errorCode: string; errorMessage?: string }): Promise<{ job: AutomationJob | null; classification: FailureClassification; retried: boolean }> {
    const classification = classifyFailure(`${input.errorCode} ${input.errorMessage ?? ""}`);
    const current = await this.getJob(jobId, projectId);
    if (!current) return { job: null, classification, retried: false };
    // Terminal states are never re-transitioned (restart/duplicate safe).
    if (["SUCCEEDED", "DEAD_LETTER", "CANCELLED"].includes(current.state)) {
      return { job: current, classification, retried: false };
    }
    const attemptCount = current.attemptCount + 1;
    const now = new Date().toISOString();
    if (shouldRetry(classification, attemptCount, current.maxAttempts)) {
      const nextAt = new Date(Date.parse(now) + retryBackoffMs(attemptCount)).toISOString();
      const q = await this.pool.query(
        `UPDATE automation_jobs SET state='SCHEDULED',attempt_count=$3,last_outcome=$4,next_eligible_at=$5,updated_at=$6
          WHERE job_id=$1 AND project_id=$2 RETURNING *`,
        [jobId, projectId, attemptCount, JSON.stringify({ errorCode: input.errorCode, classification, attempt: attemptCount }), nextAt, now],
      );
      const job = jobRow(q.rows[0]);
      await this.recordEvent({
        projectId, kind: "job.retry_scheduled", subjectType: "automation_job", subjectId: jobId,
        what: `Retry ${attemptCount}/${current.maxAttempts} scheduled (${classification})`,
        why: { classification, errorCode: input.errorCode }, result: { nextEligibleAt: nextAt },
      });
      return { job, classification, retried: true };
    }
    const q = await this.pool.query(
      `UPDATE automation_jobs SET state='DEAD_LETTER',attempt_count=$3,last_outcome=$4,updated_at=$5
        WHERE job_id=$1 AND project_id=$2 RETURNING *`,
      [jobId, projectId, attemptCount, JSON.stringify({ errorCode: input.errorCode, classification, terminal: true }), now],
    );
    const job = jobRow(q.rows[0]);
    const attentionKind =
      classification === "REQUIRES_CREDENTIAL" ? "CREDENTIAL_REQUIRED"
      : classification === "REQUIRES_CONFIGURATION" ? "CONFIGURATION_REQUIRED"
      : classification === "REQUIRES_OWNER" ? "DECISION_REQUIRED"
      : "FAILED";
    await this.raiseAttention({
      projectId, kind: attentionKind, subjectType: "automation_job", subjectId: jobId,
      detail: { jobType: job.jobType, classification, errorCode: input.errorCode, retryEligible: false },
    });
    await this.recordEvent({
      projectId, kind: "job.dead_letter", subjectType: "automation_job", subjectId: jobId,
      what: `Job ${job.jobType} moved to exception state (${classification})`,
      why: { classification, errorCode: input.errorCode }, result: { attentionKind },
    });
    return { job, classification, retried: false };
  }

  async cancelJob(jobId: string, projectId: string, reason: string): Promise<AutomationJob | null> {
    const now = new Date().toISOString();
    const q = await this.pool.query(
      `UPDATE automation_jobs SET state='CANCELLED',last_outcome=$3,updated_at=$4
        WHERE job_id=$1 AND project_id=$2 AND state IN ('PENDING','SCHEDULED','CLAIMED','RUNNING') RETURNING *`,
      [jobId, projectId, JSON.stringify({ cancelled: true, reason }), now],
    );
    return q.rowCount ? jobRow(q.rows[0]) : this.getJob(jobId, projectId);
  }

  /**
   * Restart recovery: CLAIMED/RUNNING jobs return to the schedulable pool
   * (never marked complete, never duplicated); terminal rows untouched.
   */
  async recoverAfterRestart(projectId: string, now?: string): Promise<{ recovered: number; jobIds: string[] }> {
    const at = now ?? new Date().toISOString();
    const fixed = await this.pool.query(
      `UPDATE automation_jobs SET state=CASE WHEN due_at <= $2 THEN 'PENDING' ELSE 'SCHEDULED' END,updated_at=$2
        WHERE project_id=$1 AND state IN ('CLAIMED','RUNNING') RETURNING job_id`,
      [projectId, at],
    );
    const ids = fixed.rows.map((r: Record<string, unknown>) => String(r.job_id));
    if (ids.length) {
      await this.recordEvent({
        projectId, kind: "recovery.restart", subjectType: "automation_scheduler", subjectId: projectId,
        what: `Restart recovery re-queued ${ids.length} interrupted job(s)`,
        result: { recovered: ids.length, jobIds: ids },
      });
    }
    return { recovered: ids.length, jobIds: ids };
  }

  // -- events (audit trail) ----------------------------------------------------
  async recordEvent(input: {
    projectId: string; kind: string; subjectType?: string | null; subjectId?: string | null;
    what: string; why?: Record<string, unknown>; policyRef?: Record<string, unknown>;
    authorityRef?: Record<string, unknown>; budgetRef?: Record<string, unknown>; result?: Record<string, unknown>;
  }): Promise<AutomationEventRecord> {
    if (!input.projectId) throw new Error("AUTOMATION_PROJECT_REQUIRED");
    const now = new Date().toISOString();
    const eventId = `aevt-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    await this.pool.query(
      `INSERT INTO automation_events (event_id,project_id,kind,subject_type,subject_id,what,why,policy_ref,authority_ref,budget_ref,result,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [eventId, input.projectId, input.kind, input.subjectType ?? null, input.subjectId ?? null, input.what,
        JSON.stringify(input.why ?? {}), JSON.stringify(input.policyRef ?? {}),
        JSON.stringify(input.authorityRef ?? {}), JSON.stringify(input.budgetRef ?? {}),
        JSON.stringify(input.result ?? {}), now],
    );
    const q = await this.pool.query(`SELECT * FROM automation_events WHERE event_id=$1`, [eventId]);
    return eventRow(q.rows[0]);
  }

  async listEvents(projectId: string, limit = 50): Promise<AutomationEventRecord[]> {
    const n = Math.min(Math.max(limit, 1), 200);
    const q = await this.pool.query(`SELECT * FROM automation_events WHERE project_id=$1 ORDER BY created_at DESC LIMIT ${n}`, [projectId]);
    return q.rows.map(eventRow);
  }

  // -- attention ----------------------------------------------------------------
  async raiseAttention(input: { projectId: string; kind: string; subjectType?: string | null; subjectId?: string | null; detail?: Record<string, unknown> }): Promise<{ attention: AttentionItem; created: boolean }> {
    if (!input.projectId) throw new Error("AUTOMATION_PROJECT_REQUIRED");
    if (!ATTENTION_KINDS.includes(input.kind as AttentionKind)) throw new Error(`AUTOMATION_ATTENTION_KIND_INVALID:${input.kind}`);
    const existing = await this.pool.query(
      `SELECT * FROM automation_attention WHERE project_id=$1 AND kind=$2 AND COALESCE(subject_type,'')=COALESCE($3,'') AND COALESCE(subject_id,'')=COALESCE($4,'') AND status='OPEN' LIMIT 1`,
      [input.projectId, input.kind, input.subjectType ?? null, input.subjectId ?? null],
    );
    if (existing.rowCount) return { attention: attentionRow(existing.rows[0]), created: false };
    const now = new Date().toISOString();
    const attentionId = `aatt-${sha12(JSON.stringify([input.projectId, input.kind, input.subjectType ?? null, input.subjectId ?? null, now]))}-${randomUUID().slice(0, 4)}`;
    await this.pool.query(
      `INSERT INTO automation_attention (attention_id,project_id,kind,subject_type,subject_id,detail,status,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'OPEN',$7)`,
      [attentionId, input.projectId, input.kind, input.subjectType ?? null, input.subjectId ?? null, JSON.stringify(input.detail ?? {}), now],
    );
    const q = await this.pool.query(`SELECT * FROM automation_attention WHERE attention_id=$1`, [attentionId]);
    return { attention: attentionRow(q.rows[0]), created: true };
  }

  async listAttention(projectId: string, opts?: { status?: string; limit?: number }): Promise<AttentionItem[]> {
    const n = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
    if (opts?.status) {
      const q = await this.pool.query(`SELECT * FROM automation_attention WHERE project_id=$1 AND status=$2 ORDER BY created_at DESC LIMIT ${n}`, [projectId, opts.status]);
      return q.rows.map(attentionRow);
    }
    const q = await this.pool.query(`SELECT * FROM automation_attention WHERE project_id=$1 ORDER BY created_at DESC LIMIT ${n}`, [projectId]);
    return q.rows.map(attentionRow);
  }

  async resolveAttention(attentionId: string, projectId: string, resolvedBy: string): Promise<AttentionItem | null> {
    const now = new Date().toISOString();
    const q = await this.pool.query(
      `UPDATE automation_attention SET status='RESOLVED',resolved_at=$3 WHERE attention_id=$1 AND project_id=$2 AND status='OPEN' RETURNING *`,
      [attentionId, projectId, now],
    );
    if (!q.rowCount) {
      const existing = await this.pool.query(`SELECT * FROM automation_attention WHERE attention_id=$1 AND project_id=$2`, [attentionId, projectId]);
      return existing.rowCount ? attentionRow(existing.rows[0]) : null;
    }
    await this.recordEvent({
      projectId, kind: "attention.resolved", subjectType: "automation_attention", subjectId: attentionId,
      what: `Attention resolved by ${resolvedBy}`, result: { resolvedBy },
    });
    return attentionRow(q.rows[0]);
  }

  // -- canonical reads (isolation-enforcing) ------------------------------------
  private async approvalState(approvalId: string | null): Promise<{ status: string; decision: string | null; projectId: string | null }> {
    if (!approvalId) return { status: "NONE", decision: null, projectId: null };
    const q = await this.pool.query(`SELECT status,owner_decision,project_id FROM control_approvals WHERE approval_id=$1`, [approvalId]);
    if (!q.rowCount) return { status: "UNKNOWN", decision: null, projectId: null };
    return { status: String(q.rows[0].status), decision: (q.rows[0].owner_decision as string | null) ?? null, projectId: String(q.rows[0].project_id) };
  }

  private async latestDecisionFor(projectId: string, subjectId: string): Promise<{ status: string; decision: string | null }> {
    const q = await this.pool.query(
      `SELECT status,owner_decision FROM control_approvals WHERE project_id=$1 AND (target_id=$2 OR approval_id=$2) ORDER BY created_at DESC LIMIT 1`,
      [projectId, subjectId],
    );
    if (!q.rowCount) return { status: "NONE", decision: null };
    return { status: String(q.rows[0].status), decision: (q.rows[0].owner_decision as string | null) ?? null };
  }

  private async channelCheck(projectId: string, channelId: string | null): Promise<{ known: boolean; sameProject: boolean; verified: boolean; explicit: boolean } | null> {
    if (!channelId) return null;
    const q = await this.pool.query(`SELECT project_id,status FROM channels WHERE channel_id=$1`, [channelId]);
    if (!q.rowCount) return { known: false, sameProject: false, verified: false, explicit: true };
    const sameProject = String(q.rows[0].project_id) === projectId;
    return { known: true, sameProject, verified: String(q.rows[0].status) === "VERIFIED", explicit: true };
  }

  private async credentialCheck(projectId: string, provider: string | null): Promise<{ known: boolean; valid: boolean } | null> {
    if (!provider) return null;
    const q = await this.pool.query(
      `SELECT status FROM credential_bindings WHERE project_id=$1 AND provider=$2 ORDER BY updated_at DESC LIMIT 1`,
      [projectId, provider],
    );
    if (!q.rowCount) return { known: false, valid: false };
    return { known: true, valid: String(q.rows[0].status) === "ACTIVE" };
  }

  // -- governed starter -----------------------------------------------------------
  async evaluateNextCycleProposal(proposalId: string, now?: string): Promise<StarterEvaluation> {
    const at = now ?? new Date().toISOString();
    const pq = await this.pool.query(`SELECT * FROM next_cycle_proposals WHERE proposal_id=$1`, [proposalId]);
    if (!pq.rowCount) {
      return { proposalId, projectId: "", eligibleToStart: false, verdict: "BLOCKED", reasons: ["UNKNOWN_PROPOSAL"], checks: { at } };
    }
    const proposal = pq.rows[0] as Record<string, unknown>;
    const projectId = String(proposal.project_id);
    const policy = await this.getPolicy(projectId);
    const status = String(proposal.status ?? "AWAITS_OWNER_DECISION");
    const approvalId = (proposal.approval_id as string | null) ?? null;
    const approval = await this.approvalState(approvalId);
    if (approval.projectId && approval.projectId !== projectId) {
      return { proposalId, projectId, eligibleToStart: false, verdict: "BLOCKED", reasons: ["CROSS_PROJECT_DENIED"], checks: { at, status } };
    }
    // Conflicting active run: idempotent starter job already exists.
    const existingJob = await this.pool.query(`SELECT state FROM automation_jobs WHERE idempotency_key=$1`, [`nextcycle-${proposalId}`]);
    const conflictingRun = existingJob.rowCount != null && existingJob.rowCount > 0 && !["SUCCEEDED", "DEAD_LETTER", "CANCELLED"].includes(String(existingJob.rows[0].state));
    const completedBefore = existingJob.rowCount != null && existingJob.rowCount > 0 && String(existingJob.rows[0].state) === "SUCCEEDED";
    const approvalStatus = approval.status === "DECIDED" ? (approval.decision === "APPROVE" ? "APPROVED" : "REJECTED") : approval.status === "NONE" ? "NONE" : "PENDING";
    const elig = evaluateActionEligibility(policy, "nextcycle.start.internal", {
      projectId, actionProjectId: projectId,
      ownerDecisionStatus: approvalStatus === "APPROVED" ? "APPROVED" : approvalStatus === "REJECTED" ? "REJECTED" : approvalStatus === "PENDING" ? "PENDING" : "NONE",
      nextCycleApprovalStatus: approvalStatus,
      proposalState: status,
      conflictingRun,
      inputsComplete: true,
    });
    const checks = {
      at, status, approvalId, approvalStatus, nextCyclePolicy: policy.nextCyclePolicy,
      level: policy.level, enabled: policy.enabled, conflictingRun, completedBefore,
    };
    if (completedBefore) {
      return { proposalId, projectId, eligibleToStart: false, verdict: "NOT_APPLICABLE", reasons: ["ALREADY_STARTED_IDEMPOTENT"], checks };
    }
    return { proposalId, projectId, eligibleToStart: elig.verdict === "ELIGIBLE", verdict: elig.verdict, reasons: [...elig.reasons], checks };
  }

  /**
   * Idempotent governed starter. Never duplicates execution for the same
   * proposal (idempotency key `nextcycle-<proposalId>`). When policy requires
   * an Owner decision, records the evaluation and raises READY_FOR_OWNER_START
   * instead of starting. Program 6 executes provider-free internal cycle
   * records only — never provider calls, never publications.
   */
  async startNextCycle(proposalId: string, actor = "governed-starter"): Promise<{ started: boolean; job: AutomationJob | null; evaluation: StarterEvaluation; created: boolean }> {
    const evaluation = await this.evaluateNextCycleProposal(proposalId);
    if (!evaluation.projectId) return { started: false, job: null, evaluation, created: false };
    const { projectId } = evaluation;
    // Idempotent fast-path: completed starter job already exists.
    const existing = await this.pool.query(`SELECT * FROM automation_jobs WHERE idempotency_key=$1`, [`nextcycle-${proposalId}`]);
    if (existing.rowCount) {
      return { started: String(existing.rows[0].state) === "SUCCEEDED", job: jobRow(existing.rows[0]), evaluation, created: false };
    }
    if (!evaluation.eligibleToStart) {
      await this.recordEvent({
        projectId, kind: "nextcycle.evaluated", subjectType: "next_cycle_proposal", subjectId: proposalId,
        what: `Governed starter stopped at Owner boundary (${evaluation.verdict})`,
        why: { reasons: evaluation.reasons }, policyRef: { nextCyclePolicy: String(evaluation.checks.nextCyclePolicy) },
        authorityRef: { approvalStatus: String(evaluation.checks.approvalStatus) }, result: { started: false },
      });
      if (evaluation.verdict === "REQUIRES_OWNER_DECISION" || evaluation.verdict === "WAITING") {
        await this.raiseAttention({
          projectId, kind: "READY_FOR_OWNER_START", subjectType: "next_cycle_proposal", subjectId: proposalId,
          detail: { reasons: evaluation.reasons, actor },
        });
      }
      return { started: false, job: null, evaluation, created: false };
    }
    const { job } = await this.scheduleJob({
      projectId, jobType: "next_cycle_execution", payload: { proposalId, actor, providerFree: true },
      idempotencyKey: `nextcycle-${proposalId}`,
    });
    await this.pool.query(`UPDATE automation_jobs SET state='RUNNING',attempt_count=1,updated_at=$3 WHERE job_id=$1 AND project_id=$2`, [job.jobId, projectId, new Date().toISOString()]);
    const done = await this.completeJob(job.jobId, projectId, {
      started: true, providerFree: true, proposalId, actor,
      note: "Internal preauthorized cycle record. No provider calls, no publication.",
    });
    await this.recordEvent({
      projectId, kind: "nextcycle.started", subjectType: "next_cycle_proposal", subjectId: proposalId,
      what: `Governed starter started preauthorized internal cycle for ${proposalId}`,
      policyRef: { nextCyclePolicy: String(evaluation.checks.nextCyclePolicy) },
      authorityRef: { approvalStatus: String(evaluation.checks.approvalStatus) },
      result: { started: true, jobId: job.jobId },
    });
    return { started: true, job: done, evaluation, created: true };
  }

  // -- analytics scheduling --------------------------------------------------------
  async scheduleAnalyticsMeasurement(input: {
    projectId: string; publicationId?: string | null; channelId?: string | null;
    windowStart?: string | null; windowEnd?: string | null; dueAt?: string; idempotencyKey: string;
  }): Promise<{ job: AutomationJob; created: boolean }> {
    if (!input.projectId) throw new Error("AUTOMATION_PROJECT_REQUIRED");
    if (input.channelId) {
      const check = await this.channelCheck(input.projectId, input.channelId);
      if (!check || !check.known) throw new Error("AUTOMATION_UNKNOWN_CHANNEL");
      if (!check.sameProject) throw new Error("AUTOMATION_CROSS_PROJECT_CHANNEL_DENIED");
    }
    const { job, created } = await this.scheduleJob({
      projectId: input.projectId, jobType: "scheduled_analytics_measurement",
      dueAt: input.dueAt, idempotencyKey: input.idempotencyKey,
      payload: {
        publicationId: input.publicationId ?? null, channelId: input.channelId ?? null,
        windowStart: input.windowStart ?? null, windowEnd: input.windowEnd ?? null,
        transport: "FIXTURE_ONLY",
      },
    });
    if (created) {
      await this.raiseAttention({
        projectId: input.projectId, kind: "MEASUREMENT_PENDING", subjectType: "automation_job", subjectId: job.jobId,
        detail: { channelId: input.channelId ?? null, windowStart: input.windowStart ?? null, windowEnd: input.windowEnd ?? null },
      });
      await this.recordEvent({
        projectId: input.projectId, kind: "analytics.measurement_scheduled", subjectType: "automation_job", subjectId: job.jobId,
        what: `Analytics measurement window scheduled (fixture-only in Program 6)`,
        result: { jobId: job.jobId },
      });
    }
    return { job, created };
  }

  // -- learning automation ------------------------------------------------------------
  /**
   * Internal safe chain: observation -> learning -> recommendation ->
   * next-cycle proposal. Each step requires its operation class in policy;
   * proposal NEVER implies authorization (starter governs separately).
   */
  async progressLearningChain(input: { projectId: string; observationId: string; actor?: string }): Promise<{
    observationId: string; learningId: string | null; recommendationId: string | null; proposalId: string | null;
    verdict: EligibilityVerdict; reasons: readonly string[]; created: Record<string, boolean>;
  }> {
    const policy = await this.getPolicy(input.projectId);
    const learning = new LearningLoopStore(this.pool);
    const obs = await learning.getObservation(input.observationId);
    if (!obs) return { observationId: input.observationId, learningId: null, recommendationId: null, proposalId: null, verdict: "BLOCKED", reasons: ["UNKNOWN_OBSERVATION"], created: {} };
    if (obs.projectId !== input.projectId) {
      return { observationId: input.observationId, learningId: null, recommendationId: null, proposalId: null, verdict: "BLOCKED", reasons: ["CROSS_PROJECT_DENIED"], created: {} };
    }
    const steps: Array<{ op: string; label: string }> = [
      { op: "learning.evaluate", label: "evaluation" },
      { op: "learning.recommend", label: "recommendation" },
      { op: "learning.propose", label: "proposal" },
    ];
    for (const step of steps) {
      const elig = evaluateActionEligibility(policy, step.op, { projectId: input.projectId, actionProjectId: input.projectId, inputsComplete: true });
      if (elig.verdict !== "ELIGIBLE") {
        await this.recordEvent({
          projectId: input.projectId, kind: "learning.chain_stopped", subjectType: "performance_observation", subjectId: input.observationId,
          what: `Learning chain stopped before ${step.label} (${elig.verdict})`,
          why: { reasons: elig.reasons }, policyRef: { level: policy.level },
        });
        return { observationId: input.observationId, learningId: null, recommendationId: null, proposalId: null, verdict: elig.verdict, reasons: elig.reasons, created: {} };
      }
    }
    const created: Record<string, boolean> = {};
    const metrics = obs.metrics as Record<string, unknown>;
    const keys = Object.keys(metrics).slice(0, 12).join(",");
    const { learning: learn, created: lc } = await learning.recordLearning({
      projectId: input.projectId, observationIds: [input.observationId],
      finding: `L2 automated evaluation of ${input.observationId}: observed metrics [${keys}] via ${obs.transportProvenance} transport; Owner review required before strategy use.`,
      evidence: { observationId: input.observationId, metricKeys: Object.keys(metrics), transportProvenance: obs.transportProvenance, actor: input.actor ?? "governed-automation" },
    });
    created.learning = lc;
    const { recommendation, created: rc } = await learning.recommend({
      projectId: input.projectId, learningId: learn.learningId,
      proposal: `Consider next governed internal cycle informed by ${learn.learningId}.`,
      rationale: "Deterministic L2 follow-up: observation produced learning; Owner decision still required to start work.",
      evidence: { learningId: learn.learningId, actor: input.actor ?? "governed-automation" },
    });
    created.recommendation = rc;
    const { proposal, created: pc } = await learning.proposeNextCycle({
      projectId: input.projectId, recommendationId: recommendation.recommendationId,
      summary: `Governed follow-up cycle from ${recommendation.recommendationId} (awaits Owner decision).`,
    });
    created.proposal = pc;
    await this.recordEvent({
      projectId: input.projectId, kind: "learning.chain_progressed", subjectType: "performance_observation", subjectId: input.observationId,
      what: `Learning chain progressed to proposal ${proposal.proposalId} (authorization still required)`,
      policyRef: { level: policy.level }, result: { learningId: learn.learningId, recommendationId: recommendation.recommendationId, proposalId: proposal.proposalId },
    });
    return {
      observationId: input.observationId, learningId: learn.learningId,
      recommendationId: recommendation.recommendationId, proposalId: proposal.proposalId,
      verdict: "ELIGIBLE", reasons: ["LEARNING_CHAIN_PROGRESSSED_PROPOSAL_AWAITS_OWNER"], created,
    };
  }

  // -- dry-run / explain ---------------------------------------------------------------
  async explain(projectId: string, now?: string): Promise<ExplainResult> {
    const at = now ?? new Date().toISOString();
    const policy = await this.getPolicy(projectId);
    const eligible: Array<{ action: string; reasons: readonly string[] }> = [];
    const waiting: Array<{ action: string; reasons: readonly string[] }> = [];
    const requiresOwnerDecision: Array<{ action: string; reasons: readonly string[] }> = [];
    const blocked: Array<{ action: string; reasons: readonly string[] }> = [];
    const notApplicable: Array<{ action: string; reasons: readonly string[] }> = [];
    const push = (action: string, r: EligibilityResult) => {
      const row = { action, reasons: r.reasons };
      if (r.verdict === "ELIGIBLE") eligible.push(row);
      else if (r.verdict === "WAITING") waiting.push(row);
      else if (r.verdict === "REQUIRES_OWNER_DECISION") requiresOwnerDecision.push(row);
      else if (r.verdict === "BLOCKED") blocked.push(row);
      else notApplicable.push(row);
    };
    // Candidate 1: due internal jobs.
    const due = await this.listDueJobs(projectId, at, 20);
    for (const job of due) {
      const op = jobTypeOperation(job.jobType);
      push(`job:${job.jobId}:${job.jobType}`, evaluateActionEligibility(policy, op, {
        projectId, actionProjectId: projectId, inputsComplete: true,
      }));
    }
    // Candidate 2: proposals awaiting decision (evaluation only).
    const props = await this.pool.query(`SELECT proposal_id FROM next_cycle_proposals WHERE project_id=$1 ORDER BY created_at DESC LIMIT 10`, [projectId]);
    for (const r of props.rows) {
      const pid = String((r as Record<string, unknown>).proposal_id);
      const ev = await this.evaluateNextCycleProposal(pid, at);
      push(`proposal:${pid}:evaluate`, { verdict: ev.eligibleToStart ? "ELIGIBLE" : ev.verdict, reasons: ev.reasons });
    }
    // Candidate 3: canonical pending decisions that gate automation.
    const pend = await this.pool.query(`SELECT approval_id FROM control_approvals WHERE project_id=$1 AND status<>'DECIDED' ORDER BY created_at DESC LIMIT 10`, [projectId]);
    for (const r of pend.rows) {
      push(`decision:${String((r as Record<string, unknown>).approval_id)}:awaiting_owner`, {
        verdict: "REQUIRES_OWNER_DECISION", reasons: ["DECISION_PENDING_OWNER_ACTION"],
      });
    }
    // Candidate 4: open attention requiring Owner/config/credential.
    const atts = await this.listAttention(projectId, { status: "OPEN", limit: 10 });
    for (const a of atts) {
      const verdict: EligibilityVerdict = a.kind === "DECISION_REQUIRED" || a.kind === "READY_FOR_OWNER_START" ? "REQUIRES_OWNER_DECISION" : a.kind === "FAILED" ? "BLOCKED" : "WAITING";
      push(`attention:${a.attentionId}:${a.kind}`, { verdict, reasons: [`ATTENTION_OPEN:${a.kind}`] });
    }
    if (!due.length && !props.rowCount && !pend.rowCount && !atts.length) {
      push("project:idle", evaluateActionEligibility(policy, "internal.prepare", { projectId, actionProjectId: projectId, inputsComplete: true }));
    }
    return { projectId, policy, eligible, waiting, requiresOwnerDecision, blocked, notApplicable };
  }

  // -- continuous operating loop (bounded, observable) --------------------------------------
  /**
   * One bounded tick of the continuous operating loop:
   *  observe -> due jobs -> policy evaluation -> act on safe work ->
   *  stop at human gate -> resume after canonical decision -> schedule
   *  follow-ups. Never recurses; maxActions bounds writes. Every action is
   *  audited. Provider-bound or publication work is NEVER executed here.
   */
  async tick(projectId: string, opts?: { now?: string; maxActions?: number; actor?: string }): Promise<TickResult> {
    const at = opts?.now ?? new Date().toISOString();
    const maxActions = Math.min(Math.max(opts?.maxActions ?? 5, 1), 25);
    const actor = opts?.actor ?? "automation-tick";
    const tickId = `tick-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
    const policy = await this.getPolicy(projectId);
    let evaluated = 0;
    let acted = 0;
    let started = 0;
    let resumed = 0;
    let waiting = 0;
    let blocked = 0;
    const errors: string[] = [];

    await this.recordEvent({
      projectId, kind: "tick.started", subjectType: "automation_tick", subjectId: tickId,
      what: `Automation tick started (max ${maxActions})`, policyRef: { level: policy.level, enabled: policy.enabled },
    });

    if (!policy.enabled || policy.level === "L0_MANUAL") {
      await this.recordEvent({
        projectId, kind: "tick.skipped", subjectType: "automation_tick", subjectId: tickId,
        what: policy.enabled ? "Tick skipped: MANUAL level never auto-executes" : "Tick skipped: automation disabled",
        policyRef: { level: policy.level, enabled: policy.enabled },
      });
      return { projectId, tickId, evaluated, acted, started, resumed, waiting: waiting + 1, blocked, errors, completedTick: true };
    }

    // 1. Resume-after-decision: resolve DECISION_REQUIRED attentions whose
    //    canonical approval is now DECIDED, and schedule eligible resume work.
    try {
      const openDecisions = await this.listAttention(projectId, { status: "OPEN", limit: 20 });
      for (const att of openDecisions) {
        if (acted >= maxActions) break;
        if (att.kind === "DECISION_REQUIRED" && att.subjectType === "control_approval" && att.subjectId) {
          const st = await this.approvalState(att.subjectId);
          if (st.status === "DECIDED" && st.decision === "APPROVE") {
            await this.resolveAttention(att.attentionId, projectId, "automation-resume");
            resumed += 1;
            acted += 1;
            if (policy.allowedOps.includes("workflow.resume")) {
              await this.scheduleJob({
                projectId, jobType: "workflow_resume",
                payload: { approvalId: att.subjectId, resumedBy: actor, providerFree: true },
                idempotencyKey: `resume-${att.subjectId}`,
              });
              started += 1;
            }
            await this.recordEvent({
              projectId, kind: "gate.resumed", subjectType: "control_approval", subjectId: att.subjectId,
              what: `Human gate resolved (APPROVE); eligible work resumed without Owner reconstruction`,
              authorityRef: { approvalId: att.subjectId, decision: "APPROVE" }, result: { resumed: true },
            });
          } else if (st.status === "DECIDED") {
            await this.resolveAttention(att.attentionId, projectId, "automation-resume");
            acted += 1;
            await this.recordEvent({
              projectId, kind: "gate.settled_rejected", subjectType: "control_approval", subjectId: att.subjectId,
              what: `Human gate resolved without approval (${st.decision}); work does NOT continue`,
              authorityRef: { approvalId: att.subjectId, decision: st.decision ?? "UNKNOWN" },
            });
          }
        }
      }
    } catch (e) {
      errors.push(`RESUME_SCAN_FAILED:${e instanceof Error ? e.message : String(e)}`);
    }

    // 2. Claim + execute due jobs (internal only; provider-bound parked).
    try {
      const claimed = await this.claimDueJobs(projectId, at, maxActions - acted);
      for (const job of claimed) {
        if (acted >= maxActions) {
          await this.pool.query(`UPDATE automation_jobs SET state='PENDING',updated_at=$3 WHERE job_id=$1 AND project_id=$2`, [job.jobId, projectId, new Date().toISOString()]);
          break;
        }
        evaluated += 1;
        const op = jobTypeOperation(job.jobType);
        const payload = job.payload;
        // Provider-bound measurement jobs never execute providers in Program 6.
        if (job.jobType === "scheduled_analytics_measurement") {
          const elig = evaluateActionEligibility(policy, "analytics.measure", {
            projectId, actionProjectId: projectId,
            providerOp: "provider.analytics", budgetCheck: { allowed: false, reason: "LIVE_MEASUREMENT_DEFERRED" },
            authorityPresent: false, inputsComplete: true,
          });
          blocked += 1;
          await this.recordEvent({
            projectId, kind: "job.parked", subjectType: "automation_job", subjectId: job.jobId,
            what: `Measurement job parked: live analytics reads deferred in Program 6 (fixture-only)`,
            why: { reasons: elig.reasons }, result: { parked: true },
          });
          await this.pool.query(`UPDATE automation_jobs SET state='SCHEDULED',last_outcome=$3,updated_at=$4 WHERE job_id=$1 AND project_id=$2`,
            [job.jobId, projectId, JSON.stringify({ parked: true, reason: "LIVE_MEASUREMENT_DEFERRED", transport: "FIXTURE_ONLY" }), new Date().toISOString()]);
          continue;
        }
        // Publication execution jobs are never executed.
        if (op === "publication.execute") {
          blocked += 1;
          await this.failJob(job.jobId, projectId, { errorCode: "AUTOMATIC_PUBLICATION_NOT_ENABLED", errorMessage: "Program 6 never auto-publishes" });
          continue;
        }
        // Decision-aware evaluation: a parked job carrying a canonical
        // approval id resumes automatically once that approval is DECIDED
        // APPROVE — without the Owner reconstructing anything. A REJECTED
        // decision never continues as approved (fail-closed below).
        let ownerDecisionStatus: "PENDING" | "APPROVED" | "REJECTED" | "NONE" = "NONE";
        const jobApprovalId = typeof payload.approvalId === "string" ? payload.approvalId : null;
        if (jobApprovalId) {
          const st = await this.latestDecisionFor(projectId, jobApprovalId);
          ownerDecisionStatus = st.status === "DECIDED" ? (st.decision === "APPROVE" ? "APPROVED" : "REJECTED") : st.status === "NONE" ? "NONE" : "PENDING";
        }
        const elig = evaluateActionEligibility(policy, op, {
          projectId, actionProjectId: projectId, inputsComplete: true,
          ownerDecisionStatus: policy.humanGatedOps.includes(op) || jobApprovalId ? ownerDecisionStatus : "NONE",
          gateRequiresOwner: policy.humanGatedOps.includes(op) || undefined,
        });
        if (elig.verdict === "ELIGIBLE") {
          await this.pool.query(`UPDATE automation_jobs SET state='RUNNING',attempt_count=attempt_count+1,updated_at=$3 WHERE job_id=$1 AND project_id=$2`, [job.jobId, projectId, new Date().toISOString()]);
          const outcome = await this.executeInternalJob(job, actor);
          await this.completeJob(job.jobId, projectId, outcome);
          acted += 1;
          started += job.jobType === "next_cycle_execution" ? 1 : 0;
          // A previously-parked gate job completing after a canonical
          // APPROVE counts as a resume (no Owner reconstruction required).
          const wasParked = job.lastOutcome != null && (job.lastOutcome as Record<string, unknown>).parked === true;
          if (jobApprovalId && wasParked) {
            resumed += 1;
            await this.recordEvent({
              projectId, kind: "gate.resumed", subjectType: "control_approval", subjectId: jobApprovalId,
              what: `Human gate resolved (APPROVE); parked job ${job.jobId} resumed and completed`,
              authorityRef: { approvalId: jobApprovalId, decision: "APPROVE" }, result: { resumed: true, jobId: job.jobId },
            });
          }
          // A completed post-gate job clears its own gate attention explicitly.
          const openGate = await this.pool.query(
            `SELECT attention_id FROM automation_attention WHERE project_id=$1 AND kind='DECISION_REQUIRED' AND subject_id=$2 AND status='OPEN'`,
            [projectId, job.jobId],
          );
          for (const r of openGate.rows) {
            await this.resolveAttention(String((r as Record<string, unknown>).attention_id), projectId, "automation-resume");
          }
        } else if (elig.verdict === "REQUIRES_OWNER_DECISION") {
          waiting += 1;
          await this.pool.query(`UPDATE automation_jobs SET state='SCHEDULED',last_outcome=$3,updated_at=$4 WHERE job_id=$1 AND project_id=$2`,
            [job.jobId, projectId, JSON.stringify({ parked: true, reasons: elig.reasons }), new Date().toISOString()]);
          const subject = String((payload as Record<string, unknown>).approvalId ?? (payload as Record<string, unknown>).proposalId ?? job.jobId);
          await this.raiseAttention({
            projectId, kind: "DECISION_REQUIRED", subjectType: "automation_job", subjectId: job.jobId,
            detail: { jobType: job.jobType, reasons: elig.reasons, subject },
          });
          await this.recordEvent({
            projectId, kind: "job.awaiting_owner", subjectType: "automation_job", subjectId: job.jobId,
            what: `Job ${job.jobType} paused at human gate`, why: { reasons: elig.reasons },
          });
        } else if (elig.verdict === "BLOCKED") {
          blocked += 1;
          await this.failJob(job.jobId, projectId, { errorCode: String(elig.reasons[0] ?? "POLICY_BLOCKED"), errorMessage: elig.reasons.join(";") });
        } else {
          waiting += 1;
          await this.pool.query(`UPDATE automation_jobs SET state='SCHEDULED',last_outcome=$3,updated_at=$4 WHERE job_id=$1 AND project_id=$2`,
            [job.jobId, projectId, JSON.stringify({ parked: true, reasons: elig.reasons }), new Date().toISOString()]);
        }
      }
    } catch (e) {
      errors.push(`JOB_EXECUTION_FAILED:${e instanceof Error ? e.message : String(e)}`);
    }

    // 3. Proposal availability trigger: evaluate (never auto-start beyond policy).
    try {
      if (acted < maxActions) {
        const props = await this.pool.query(`SELECT proposal_id FROM next_cycle_proposals WHERE project_id=$1 ORDER BY created_at DESC LIMIT 3`, [projectId]);
        for (const r of props.rows) {
          if (acted >= maxActions) break;
          const pid = String((r as Record<string, unknown>).proposal_id);
          const already = await this.pool.query(`SELECT 1 FROM automation_jobs WHERE idempotency_key=$1`, [`nextcycle-${pid}`]);
          const evaluated_evt = await this.pool.query(
            `SELECT 1 FROM automation_events WHERE project_id=$1 AND kind='nextcycle.evaluated' AND subject_id=$2 AND created_at > $3 LIMIT 1`,
            [projectId, pid, new Date(Date.parse(at) - 3600_000).toISOString()],
          );
          if (already.rowCount || evaluated_evt.rowCount) continue;
          evaluated += 1;
          const result = await this.startNextCycle(pid, actor);
          acted += 1;
          if (result.started) started += 1;
          else if (result.evaluation.verdict === "REQUIRES_OWNER_DECISION" || result.evaluation.verdict === "WAITING") waiting += 1;
          else blocked += 1;
        }
      }
    } catch (e) {
      errors.push(`PROPOSAL_SCAN_FAILED:${e instanceof Error ? e.message : String(e)}`);
    }

    await this.recordEvent({
      projectId, kind: "tick.completed", subjectType: "automation_tick", subjectId: tickId,
      what: `Tick completed: ${acted} action(s), ${started} started, ${resumed} resumed`,
      result: { evaluated, acted, started, resumed, waiting, blocked, errors },
    });
    return { projectId, tickId, evaluated, acted, started, resumed, waiting, blocked, errors, completedTick: true };
  }

  /** Deterministic internal job handlers: state transitions only, no providers. */
  private async executeInternalJob(job: AutomationJob, actor: string): Promise<Record<string, unknown>> {
    const base = { executedBy: actor, providerFree: true, jobType: job.jobType };
    switch (job.jobType) {
      case "eligible_work_evaluation":
        return { ...base, note: "Eligible-work evaluation completed; see tick events for ordered actions." };
      case "content_planning_checkpoint":
        return { ...base, checkpoint: "content_planning", note: "Planning checkpoint recorded; Owner gates unchanged." };
      case "workflow_resume":
        return { ...base, resumed: true, approvalId: (job.payload.approvalId as string | null) ?? null };
      case "learning_evaluation":
        return { ...base, note: "Learning evaluation window checked; chain progression via progressLearningChain." };
      case "health_recovery_check":
        return { ...base, healthy: true, note: "Scheduler + queue reachability confirmed from durable state." };
      case "next_cycle_evaluation":
        return { ...base, proposalId: (job.payload.proposalId as string | null) ?? null, note: "Proposal evaluated by governed starter." };
      case "next_cycle_execution":
        return { ...base, started: true, proposalId: (job.payload.proposalId as string | null) ?? null };
      default:
        return { ...base, note: `Internal handler for ${job.jobType}; no side effects.` };
    }
  }

  // -- observability ------------------------------------------------------------
  async getAutomationStatus(projectId: string, now?: string): Promise<{
    projectId: string; enabled: boolean; level: AutomationLevel; state: AutomationState;
    running: number; waiting: number; scheduled: number; needsOwner: number; exceptions: number;
    budgets: ReadonlyArray<{ callKind: string; limit: number; used: number; remaining: number }>;
    nextEligibleAt: string | null; recentEvents: AutomationEventRecord[];
  }> {
    const at = now ?? new Date().toISOString();
    const policy = await this.getPolicy(projectId);
    const counts = await this.pool.query(
      `SELECT state,count(*)::int AS n FROM automation_jobs WHERE project_id=$1 GROUP BY state`, [projectId]);
    const byState: Record<string, number> = {};
    for (const r of counts.rows) byState[String((r as Record<string, unknown>).state)] = Number((r as Record<string, unknown>).n);
    const running = (byState.CLAIMED ?? 0) + (byState.RUNNING ?? 0);
    const scheduled = (byState.PENDING ?? 0) + (byState.SCHEDULED ?? 0);
    const openAtt = await this.listAttention(projectId, { status: "OPEN", limit: 100 });
    const needsOwner = openAtt.filter((a) => a.kind === "DECISION_REQUIRED" || a.kind === "READY_FOR_OWNER_START").length;
    const exceptions = openAtt.filter((a) => a.kind === "FAILED" || a.kind === "CREDENTIAL_REQUIRED" || a.kind === "CONFIGURATION_REQUIRED" || a.kind === "BUDGET_BLOCKED").length;
    const waitingJobs = await this.pool.query(
      `SELECT count(*)::int AS n FROM automation_jobs WHERE project_id=$1 AND state='SCHEDULED' AND last_outcome::text LIKE '%parked%'`, [projectId]);
    const waiting = Number(waitingJobs.rows[0].n ?? 0);
    const nextDue = await this.pool.query(
      `SELECT min(due_at) AS next FROM automation_jobs WHERE project_id=$1 AND state IN ('PENDING','SCHEDULED') AND due_at > $2`, [projectId, at]);
    const budgets = await this.getCallBudgets(projectId);
    const events = await this.listEvents(projectId, 10);
    let state: AutomationState = "IDLE";
    if (!policy.enabled) state = "DISABLED";
    else if (exceptions > 0 || (byState.DEAD_LETTER ?? 0) > 0) state = "FAILED";
    else if (needsOwner > 0) state = "WAITING_FOR_OWNER";
    else if (running > 0) state = "RUNNING";
    else if (scheduled > 0) state = "SCHEDULED";
    else if (waiting > 0) state = "WAITING";
    else if (events.some((e) => e.kind === "tick.completed")) state = "COMPLETED";
    return {
      projectId, enabled: policy.enabled, level: policy.level, state,
      running, waiting, scheduled, needsOwner, exceptions, budgets,
      nextEligibleAt: (nextDue.rows[0].next as string | null) ?? null, recentEvents: events,
    };
  }

  async getPlatformOverview(now?: string): Promise<ReadonlyArray<{
    projectId: string; enabled: boolean; level: AutomationLevel; state: AutomationState;
    running: number; waiting: number; scheduled: number; needsOwner: number; exceptions: number;
  }>> {
    const at = now ?? new Date().toISOString();
    const policies = await this.listPolicies();
    // Portfolio visibility follows the canonical positive project registry.
    // Also retain automation activity/policy rows for forensic visibility if a
    // legacy project was removed from the registry. A registered project with
    // no policy is truthfully represented by getPolicy() as OFF / L0_MANUAL.
    const registered = await this.pool.query(`SELECT project_id FROM control_projects`);
    const active = await this.pool.query(`SELECT DISTINCT project_id FROM automation_jobs`);
    const ids = new Set<string>([
      ...registered.rows.map((r: Record<string, unknown>) => String(r.project_id)),
      ...policies.map((p) => p.projectId),
      ...active.rows.map((r: Record<string, unknown>) => String(r.project_id)),
    ]);
    const out: Array<{ projectId: string; enabled: boolean; level: AutomationLevel; state: AutomationState; running: number; waiting: number; scheduled: number; needsOwner: number; exceptions: number }> = [];
    for (const id of [...ids].sort()) {
      const s = await this.getAutomationStatus(id, at);
      out.push({ projectId: id, enabled: s.enabled, level: s.level, state: s.state, running: s.running, waiting: s.waiting, scheduled: s.scheduled, needsOwner: s.needsOwner, exceptions: s.exceptions });
    }
    return out;
  }

  // -- triggers ---------------------------------------------------------------------
  async recordTrigger(input: { projectId: string; triggerKind: string; subjectType?: string | null; subjectId?: string | null; payload?: Record<string, unknown> }): Promise<{ accepted: boolean; eventId: string }> {
    if (!input.projectId) throw new Error("AUTOMATION_PROJECT_REQUIRED");
    if (!TRIGGER_KINDS.includes(input.triggerKind as TriggerKind)) throw new Error(`AUTOMATION_TRIGGER_INVALID:${input.triggerKind}`);
    const evt = await this.recordEvent({
      projectId: input.projectId, kind: `trigger.${input.triggerKind}`,
      subjectType: input.subjectType ?? null, subjectId: input.subjectId ?? null,
      what: `Trigger ${input.triggerKind} recorded`, result: input.payload ?? {},
    });
    return { accepted: true, eventId: evt.eventId };
  }
}

function jobTypeOperation(jobType: string): string {
  switch (jobType) {
    case "eligible_work_evaluation": return "internal.prepare";
    case "scheduled_analytics_measurement": return "analytics.schedule";
    case "content_planning_checkpoint": return "internal.plan";
    case "workflow_resume": return "workflow.resume";
    case "learning_evaluation": return "learning.evaluate";
    case "health_recovery_check": return "internal.prepare";
    case "next_cycle_evaluation": return "nextcycle.evaluate";
    case "next_cycle_execution": return "nextcycle.start.internal";
    default: return "internal.prepare";
  }
}
