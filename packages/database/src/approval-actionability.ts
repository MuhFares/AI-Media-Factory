/**
 * Slice 3 — deterministic approval actionability (derived, never mutated).
 *
 * A PENDING row is NOT sufficient evidence of Owner attention. An approval is
 * ACTION_REQUIRED only if deciding it now can still materially change live
 * platform state. Later governed continuation (downstream canonical
 * milestones, decided replacements, validation acceptance) supersedes stale
 * gates; the rows stay immutable, the read model reclassifies them.
 *
 * Pure `classifyApproval()` over loaded evidence (unit-testable) + a thin
 * store composing the queries. No LLM, no mutation, fail closed.
 */

import type pg from "pg";

export type ApprovalActionabilityState =
  | "ACTION_REQUIRED"
  | "SUPERSEDED"
  | "HISTORICAL"
  | "DECIDED"
  | "CONFLICTED";

export interface ApprovalActionability {
  approvalId: string;
  state: ApprovalActionabilityState;
  reason: string;
  evidence: string[];
}

export interface ActionabilityEvidence {
  approvalId: string;
  projectId: string;
  targetType: string;
  targetId: string;
  status: string;
  ownerDecision: string | null;
  createdAt: string;
  workflowId: string | null;
  /** Any job currently running/queued on the target workflow. */
  liveWork: boolean;
  /** Terminal canonical milestone kinds completed AFTER the approval was created. */
  laterMilestones: string[];
  /** A DECIDED approval exists on the same target. */
  decidedReplacement: boolean;
  /** Validation acceptance recorded for the workflow after approval creation. */
  laterValidationAcceptance: boolean;
  /** More than one PENDING approval on the same target. */
  duplicatePending: boolean;
  /** Workflow submission reached a terminal state. */
  workflowTerminal: boolean;
  /** Strategic activation scopes are always Owner-decided (no auto-continuation). */
  isStrategic: boolean;
}

const TERMINAL_MILESTONE_KINDS = new Set([
  "scene_video_clip",
  "final_media_artifact",
  "final_technical_qa",
  "final_product_review",
  "publication_integration_validation",
]);

const ACTIVATION_SCOPES = new Set([
  "STRATEGY_ACTIVATION",
  "BRAND_ACTIVATION",
  "CONTENT_SYSTEM_ACTIVATION",
  "OBJECTIVES_ACTIVATION",
  "PRINCIPLES_ACTIVATION",
  "CONSTRAINTS_ACTIVATION",
  "EXPERIMENT_ACTIVATION",
  "DECISION_ACTIVATION",
  "LEARNING_MEMORY_ACTIVATION",
]);

export function isStrategicScope(targetType: string): boolean {
  return ACTIVATION_SCOPES.has(targetType);
}

/** Deterministic classification. Order matters; first match wins. */
export function classifyApproval(ev: ActionabilityEvidence): ApprovalActionability {
  const at = (s: string): string => `${ev.approvalId.slice(0, 40)}: ${s}`;
  if (ev.status === "DECIDED") {
    return { approvalId: ev.approvalId, state: "DECIDED", reason: "Owner decision already recorded; history only.", evidence: [`decision=${ev.ownerDecision ?? "unknown"}`] };
  }
  if (ev.duplicatePending) {
    return { approvalId: ev.approvalId, state: "CONFLICTED", reason: "More than one pending approval on the same target; needs platform review before any decision.", evidence: [`target=${ev.targetId}`] };
  }
  if (ev.isStrategic) {
    return { approvalId: ev.approvalId, state: "ACTION_REQUIRED", reason: "Strategic change awaits Owner decision; nothing auto-continues without it.", evidence: [`scope=${ev.targetType}`] };
  }
  if (ev.liveWork) {
    return { approvalId: ev.approvalId, state: "ACTION_REQUIRED", reason: "Live work is attached to this workflow; the decision can still change its path.", evidence: ["live-job=true"] };
  }
  if (ev.decidedReplacement) {
    return { approvalId: ev.approvalId, state: "SUPERSEDED", reason: "A decided approval already exists on the same target; this pending row no longer gates anything.", evidence: ["decided-replacement=true"] };
  }
  if (ev.laterMilestones.length > 0 && (ev.laterValidationAcceptance || ev.workflowTerminal)) {
    return {
      approvalId: ev.approvalId, state: "SUPERSEDED",
      reason: "Later governed continuation completed canonical milestones after this gate was created; deciding it now changes no live state.",
      evidence: [`later-milestones=${ev.laterMilestones.join(",")}`, `validation-acceptance=${ev.laterValidationAcceptance}`, `workflow-terminal=${ev.workflowTerminal}`],
    };
  }
  if (ev.laterMilestones.length > 0) {
    return {
      approvalId: ev.approvalId, state: "SUPERSEDED",
      reason: "Downstream canonical artifacts completed after this gate was created; the workflow moved past it through governed continuation.",
      evidence: [`later-milestones=${ev.laterMilestones.join(",")}`],
    };
  }
  if (ev.workflowTerminal && !ev.liveWork) {
    return { approvalId: ev.approvalId, state: "HISTORICAL", reason: "The workflow reached a terminal state with no live work and no later continuation; the gate is moot history.", evidence: ["workflow-terminal=true"] };
  }
  return { approvalId: ev.approvalId, state: "ACTION_REQUIRED", reason: "No later continuation or replacement found; the decision can still change workflow state.", evidence: ["no-supersession-evidence"] };
}

export class ApprovalActionabilityStore {
  constructor(private readonly pool: pg.Pool) {}

  /** Classify every approval for a project (bounded). */
  async projectActionability(projectId: string, limit = 100): Promise<ApprovalActionability[]> {
    const n = Math.min(Math.max(limit, 1), 200);
    const q = await this.pool.query(
      `SELECT approval_id, project_id, target_type, target_id, status, owner_decision, created_at
         FROM control_approvals WHERE project_id=$1 ORDER BY created_at DESC LIMIT ${n}`, [projectId]);
    const out: ApprovalActionability[] = [];
    for (const r of q.rows) out.push(await this.classifyRow(r));
    return out;
  }

  async approvalActionability(approvalId: string): Promise<ApprovalActionability | null> {
    const q = await this.pool.query(
      `SELECT approval_id, project_id, target_type, target_id, status, owner_decision, created_at
         FROM control_approvals WHERE approval_id=$1`, [approvalId]);
    if (!q.rowCount) return null;
    return this.classifyRow(q.rows[0]);
  }

  private workflowIdOf(targetId: string): string | null {
    const m = /^([A-Za-z0-9][A-Za-z0-9_-]*)[:/]/.exec(targetId);
    return m ? m[1] : null;
  }

  private async classifyRow(r: Record<string, unknown>): Promise<ApprovalActionability> {
    const approvalId = String(r.approval_id);
    const targetType = String(r.target_type);
    const targetId = String(r.target_id);
    const status = String(r.status);
    const createdAt = String(r.created_at);
    if (status === "DECIDED") {
      return classifyApproval({
        approvalId, projectId: String(r.project_id), targetType, targetId, status,
        ownerDecision: r.owner_decision === null || r.owner_decision === undefined ? null : String(r.owner_decision),
        createdAt, workflowId: null, liveWork: false, laterMilestones: [], decidedReplacement: false,
        laterValidationAcceptance: false, duplicatePending: false, workflowTerminal: false,
        isStrategic: isStrategicScope(targetType),
      });
    }
    const workflowId = this.workflowIdOf(targetId);
    let liveWork = false;
    let laterMilestones: string[] = [];
    let decidedReplacement = false;
    let laterValidationAcceptance = false;
    let duplicatePending = false;
    let workflowTerminal = false;
    const dup = await this.pool.query(
      `SELECT count(*)::int AS n FROM control_approvals WHERE target_id=$1 AND status<>'DECIDED'`, [targetId]);
    duplicatePending = Number(dup.rows[0]?.n ?? 0) > 1;
    const rep = await this.pool.query(
      `SELECT 1 FROM control_approvals WHERE target_id=$1 AND status='DECIDED' LIMIT 1`, [targetId]);
    decidedReplacement = (rep.rowCount ?? 0) > 0;
    if (workflowId) {
      const jobs = await this.pool.query(
        `SELECT status FROM workflow_jobs WHERE workflow_id=$1`, [workflowId]);
      liveWork = jobs.rows.some((j: Record<string, unknown>) => j.status === "running" || j.status === "queued");
      const subs = await this.pool.query(
        `SELECT status FROM workflow_submissions WHERE workflow_id=$1`, [workflowId]);
      const subStatus = subs.rows[0] ? String(subs.rows[0].status) : "";
      workflowTerminal = ["completed", "failed"].includes(subStatus);
      const arts = await this.pool.query(
        `SELECT kind FROM artifacts WHERE workflow_id=$1 AND status='completed' AND created_at > $2`, [workflowId, createdAt]);
      laterMilestones = [...new Set(
        arts.rows.map((a: Record<string, unknown>) => String(a.kind)).filter((k: string) => TERMINAL_MILESTONE_KINDS.has(k.toLowerCase())))];
      try {
        const va = await this.pool.query(
          `SELECT 1 FROM visual_validation_acceptances WHERE workflow_id=$1 AND decided_at > $2 LIMIT 1`, [workflowId, createdAt]);
        laterValidationAcceptance = (va.rowCount ?? 0) > 0;
      } catch {
        laterValidationAcceptance = false;
      }
    }
    return classifyApproval({
      approvalId, projectId: String(r.project_id), targetType, targetId, status,
      ownerDecision: null, createdAt, workflowId, liveWork, laterMilestones, decidedReplacement,
      laterValidationAcceptance, duplicatePending, workflowTerminal,
      isStrategic: isStrategicScope(targetType),
    });
  }
}
