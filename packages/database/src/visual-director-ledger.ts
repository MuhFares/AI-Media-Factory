import type pg from "pg";

/**
 * Visual Director execution ledger (append-only).
 *
 * Canonical aliases (VD-ATTEMPT-001, VD-ATTEMPT-002, VD-ATTEMPT-003A,
 * VD-ATTEMPT-003B, ...) disambiguate repeated human labels: identity is
 * (authorization_ref, submission_ordinal) plus the unique provider-side
 * execution ID. Rows are never updated or deleted. Backfilled history is
 * marked source='backfill-from-artifacts' and never renames artifacts.
 * Zero provider I/O.
 */

export interface VisualDirectorAttemptRecord {
  readonly visualDirectorAttemptId: string;
  readonly workflowId: string;
  readonly authorizationRef: string;
  readonly submissionOrdinal: number;
  readonly executionId: string | null;
  readonly inputArtifactId: string | null;
  readonly evidenceArtifactId: string | null;
  readonly provider: string | null;
  readonly requestedModel: string | null;
  readonly actualModel: string | null;
  readonly transport: string | null;
  readonly reasoningConfig: unknown;
  readonly maxTokens: number | null;
  readonly httpStatus: number | null;
  readonly finishReason: string | null;
  readonly visibleBytes: number | null;
  readonly reasoningTokens: number | null;
  readonly validationOutcome: string | null;
  readonly canonicalContractArtifactId: string | null;
  readonly source: string;
}

export interface RegisterAttemptInput {
  readonly visualDirectorAttemptId: string;
  readonly workflowId: string;
  readonly authorizationRef: string;
  readonly submissionOrdinal?: number;
  readonly executionId?: string | null;
  readonly inputArtifactId?: string | null;
  readonly evidenceArtifactId?: string | null;
  readonly provider?: string | null;
  readonly requestedModel?: string | null;
  readonly actualModel?: string | null;
  readonly transport?: string | null;
  readonly reasoningConfig?: unknown;
  readonly maxTokens?: number | null;
  readonly httpStatus?: number | null;
  readonly finishReason?: string | null;
  readonly visibleBytes?: number | null;
  readonly reasoningTokens?: number | null;
  readonly validationOutcome?: string | null;
  readonly canonicalContractArtifactId?: string | null;
  readonly source?: string;
}

function row(r: Record<string, unknown>): VisualDirectorAttemptRecord {
  const str = (v: unknown): string | null => typeof v === "string" ? v : null;
  const num = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    visualDirectorAttemptId: String(r.visual_director_attempt_id),
    workflowId: String(r.workflow_id),
    authorizationRef: String(r.authorization_ref),
    submissionOrdinal: Number(r.submission_ordinal),
    executionId: str(r.execution_id),
    inputArtifactId: str(r.input_artifact_id),
    evidenceArtifactId: str(r.evidence_artifact_id),
    provider: str(r.provider),
    requestedModel: str(r.requested_model),
    actualModel: str(r.actual_model),
    transport: str(r.transport),
    reasoningConfig: r.reasoning_config ?? null,
    maxTokens: num(r.max_tokens),
    httpStatus: num(r.http_status),
    finishReason: str(r.finish_reason),
    visibleBytes: num(r.visible_bytes),
    reasoningTokens: num(r.reasoning_tokens),
    validationOutcome: str(r.validation_outcome),
    canonicalContractArtifactId: str(r.canonical_contract_artifact_id),
    source: String(r.source),
  };
}

export class VisualDirectorLedgerStore {
  constructor(private readonly pool: pg.Pool) {}

  /** Idempotent registration: same execution ID or same
   *  (authorization, ordinal) observes the existing row. */
  async registerAttempt(input: RegisterAttemptInput): Promise<{ created: boolean; attempt: VisualDirectorAttemptRecord }> {
    if (!input.visualDirectorAttemptId || !input.workflowId || !input.authorizationRef) {
      throw new Error("VISUAL_DIRECTOR_ATTEMPT_IDENTITY_REQUIRED");
    }
    const ordinal = input.submissionOrdinal ?? 1;
    if (!Number.isSafeInteger(ordinal) || ordinal < 1) throw new Error("VISUAL_DIRECTOR_ORDINAL_INVALID");
    if (input.executionId) {
      const existing = await this.pool.query(`SELECT * FROM visual_director_attempts WHERE execution_id=$1`, [input.executionId]);
      if (existing.rowCount) return { created: false, attempt: row(existing.rows[0]) };
    }
    const now = new Date().toISOString();
    const inserted = await this.pool.query(
      `INSERT INTO visual_director_attempts (visual_director_attempt_id, workflow_id, authorization_ref, submission_ordinal, execution_id, input_artifact_id, evidence_artifact_id, provider, requested_model, actual_model, transport, reasoning_config, max_tokens, http_status, finish_reason, visible_bytes, reasoning_tokens, validation_outcome, canonical_contract_artifact_id, source, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$21)
       ON CONFLICT DO NOTHING RETURNING *`,
      [input.visualDirectorAttemptId, input.workflowId, input.authorizationRef, ordinal,
        input.executionId ?? null, input.inputArtifactId ?? null, input.evidenceArtifactId ?? null,
        input.provider ?? null, input.requestedModel ?? null, input.actualModel ?? null,
        input.transport ?? null,
        input.reasoningConfig === undefined ? null : JSON.stringify(input.reasoningConfig),
        input.maxTokens ?? null, input.httpStatus ?? null, input.finishReason ?? null,
        input.visibleBytes ?? null, input.reasoningTokens ?? null,
        input.validationOutcome ?? null, input.canonicalContractArtifactId ?? null,
        input.source ?? "live", now],
    );
    if (inserted.rowCount) return { created: true, attempt: row(inserted.rows[0]) };
    const settled = await this.pool.query(
      `SELECT * FROM visual_director_attempts WHERE execution_id=$1 OR (authorization_ref=$2 AND submission_ordinal=$3) ORDER BY created_at LIMIT 1`,
      [input.executionId ?? null, input.authorizationRef, ordinal],
    );
    if (!settled.rowCount) throw new Error("VISUAL_DIRECTOR_LEDGER_RACE_UNRESOLVED");
    return { created: false, attempt: row(settled.rows[0]) };
  }

  async getByAlias(visualDirectorAttemptId: string): Promise<VisualDirectorAttemptRecord | null> {
    const q = await this.pool.query(`SELECT * FROM visual_director_attempts WHERE visual_director_attempt_id=$1`, [visualDirectorAttemptId]);
    return q.rowCount ? row(q.rows[0]) : null;
  }

  /**
   * Complete a ledger row with its outcome exactly once. The row is created
   * BEFORE submission (identity first); the outcome lands after. Refuses when
   * an outcome is already recorded (append-only history, no rewrites).
   */
  async recordOutcome(visualDirectorAttemptId: string, input: {
    readonly httpStatus?: number | null;
    readonly finishReason?: string | null;
    readonly visibleBytes?: number | null;
    readonly reasoningTokens?: number | null;
    readonly actualModel?: string | null;
    readonly validationOutcome: string;
    readonly canonicalContractArtifactId?: string | null;
  }): Promise<VisualDirectorAttemptRecord> {
    if (!input.validationOutcome) throw new Error("VISUAL_DIRECTOR_OUTCOME_REQUIRED");
    const q = await this.pool.query(
      `UPDATE visual_director_attempts
       SET http_status=$2, finish_reason=$3, visible_bytes=$4, reasoning_tokens=$5, actual_model=$6,
           validation_outcome=$7, canonical_contract_artifact_id=$8, updated_at=$9
       WHERE visual_director_attempt_id=$1 AND validation_outcome IS NULL
       RETURNING *`,
      [visualDirectorAttemptId, input.httpStatus ?? null, input.finishReason ?? null,
        input.visibleBytes ?? null, input.reasoningTokens ?? null, input.actualModel ?? null,
        input.validationOutcome, input.canonicalContractArtifactId ?? null, new Date().toISOString()],
    );
    if (!q.rowCount) throw new Error("VISUAL_DIRECTOR_OUTCOME_ALREADY_RECORDED");
    return row(q.rows[0]);
  }

  async listByWorkflow(workflowId: string): Promise<VisualDirectorAttemptRecord[]> {
    const q = await this.pool.query(`SELECT * FROM visual_director_attempts WHERE workflow_id=$1 ORDER BY created_at`, [workflowId]);
    return q.rows.map(row);
  }
}
