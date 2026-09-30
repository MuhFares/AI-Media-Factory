import type pg from "pg";

export interface VisualValidationAcceptance {
  readonly acceptanceId: string;
  readonly workflowId: string;
  readonly visualIterationId: string;
  readonly gateApprovalId: string;
  readonly kind: string;
  readonly contractArtifactId: string | null;
  readonly promptPlanArtifactId: string | null;
  readonly targetCapability: string | null;
  readonly evidenceRefs: readonly string[];
  readonly decidedAt: string;
  readonly createdAt: string;
}

const row = (r: Record<string, unknown>): VisualValidationAcceptance => ({
  acceptanceId: String(r.acceptance_id),
  workflowId: String(r.workflow_id),
  visualIterationId: String(r.visual_iteration_id),
  gateApprovalId: String(r.gate_approval_id),
  kind: String(r.kind),
  contractArtifactId: (r.contract_artifact_id as string | null) ?? null,
  promptPlanArtifactId: (r.prompt_plan_artifact_id as string | null) ?? null,
  targetCapability: (r.target_capability as string | null) ?? null,
  evidenceRefs: Array.isArray(r.evidence_refs) ? (r.evidence_refs as unknown[]).filter((v): v is string => typeof v === "string") : [],
  decidedAt: String(r.decided_at),
  createdAt: String(r.created_at),
});

export class VisualValidationAcceptanceStore {
  constructor(private readonly pool: pg.Pool) {}

  /** Record an owner-gated validation acceptance for the current iteration. Idempotent by workflow_id. */
  async recordAcceptance(input: {
    readonly workflowId: string;
    readonly visualIterationId: string;
    readonly gateApprovalId: string;
    readonly contractArtifactId?: string | null;
    readonly promptPlanArtifactId?: string | null;
    readonly targetCapability?: string | null;
    readonly evidenceRefs?: readonly string[];
  }): Promise<{ created: boolean; acceptance: VisualValidationAcceptance }> {
    if (!input.workflowId || !input.visualIterationId || !input.gateApprovalId) {
      throw new Error("VISUAL_VALIDATION_ACCEPTANCE_IDENTITY_REQUIRED");
    }
    const acceptanceId = `visual-validation-acceptance-${input.workflowId}`;
    const now = new Date().toISOString();
    const inserted = await this.pool.query(
      `INSERT INTO visual_validation_acceptances (acceptance_id, workflow_id, visual_iteration_id, gate_approval_id, kind, contract_artifact_id, prompt_plan_artifact_id, target_capability, evidence_refs, decided_at, created_at)
       VALUES ($1,$2,$3,$4,'validation_accepted_for_e2e',$5,$6,$7,$8,$9,$9)
       ON CONFLICT (acceptance_id) DO NOTHING RETURNING *`,
      [acceptanceId, input.workflowId, input.visualIterationId, input.gateApprovalId,
        input.contractArtifactId ?? null, input.promptPlanArtifactId ?? null, input.targetCapability ?? null,
        JSON.stringify([...(input.evidenceRefs ?? [])]), now],
    );
    if (inserted.rowCount) return { created: true, acceptance: row(inserted.rows[0]) };
    const existing = await this.pool.query(`SELECT * FROM visual_validation_acceptances WHERE acceptance_id=$1`, [acceptanceId]);
    return { created: false, acceptance: row(existing.rows[0]) };
  }

  async getByWorkflow(workflowId: string): Promise<VisualValidationAcceptance | null> {
    const q = await this.pool.query(`SELECT * FROM visual_validation_acceptances WHERE workflow_id=$1`, [workflowId]);
    return q.rowCount ? row(q.rows[0]) : null;
  }

  /** Validation-aware continuation check: true only when a validation acceptance exists. */
  async isValidationAcceptedForE2E(workflowId: string): Promise<boolean> {
    const q = await this.pool.query(`SELECT 1 FROM visual_validation_acceptances WHERE workflow_id=$1`, [workflowId]);
    return (q.rowCount ?? 0) > 0;
  }

  /** Governed contract: a production check must be a separate approval bit. Validation acceptance MUST NOT pass it. */
  // eslint-disable-next-line require-await
  async isProductionApproved(_workflowId: string): Promise<boolean> {
    return false;
  }
}
