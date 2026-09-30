/**
 * E2E Operating Loop Proof M2 — governed learning loop store.
 *
 * Capability chain: PERFORMANCE OBSERVATION → CONTENT LINEAGE →
 * EXPERIMENT ASSOCIATION → HYPOTHESIS EVALUATION → PERSISTED LEARNING →
 * NEXT-CYCLE RECOMMENDATION → OWNER-GOVERNED NEXT-CYCLE PROPOSAL.
 *
 * Append-only: the store exposes no UPDATE/DELETE. Idempotency via
 * deterministic IDs + ON CONFLICT DO NOTHING. Evaluation is deterministic
 * and fail-closed (INSUFFICIENT_DATA, never zero-fill). STUBBED evidence
 * stays visibly validation-only and can never masquerade as live business
 * evidence. Nothing here starts workflows, mutates strategy, or grants
 * production/publication authority. The next cycle starts only through the
 * canonical Owner decision boundary (control_approvals), never from here.
 */
import type pg from "pg";
import { createHash } from "node:crypto";

export type MetricProvenance = "LIVE" | "STUBBED" | "IMPORTED" | "UNKNOWN";
export type LineageKind = "GOVERNED_RUN" | "VALIDATION_FIXTURE";
export type EvalVerdict = "MET" | "NOT_MET" | "INSUFFICIENT_DATA" | "NOT_APPLICABLE";

const PROVENANCE = new Set<string>(["LIVE", "STUBBED", "IMPORTED", "UNKNOWN"]);

export interface GateSpec {
  readonly id: string;
  readonly metric: string;
  readonly comparator: ">=" | "<=";
  readonly threshold: number;
  /** Minimum measurement window in days; shorter windows fail closed. */
  readonly windowDays?: number;
  /** When true, only LIVE provenance may satisfy this gate. */
  readonly requiresLive?: boolean;
  /** When false, validation fixtures are NOT_APPLICABLE instead of evaluated. */
  readonly fixtureApplicable?: boolean;
}

export interface GateEvaluation {
  readonly gateId: string;
  readonly verdict: EvalVerdict;
  readonly detail: string;
}

export interface PerformanceObservation {
  observationId: string; projectId: string;
  workflowId: string | null; artifactId: string | null; publicationId: string | null;
  contentId: string | null; publishedReportId: string | null; finalMediaSha256: string | null;
  channelId: string | null; analyticsProviderId: string | null;
  experimentId: string | null; lineageKind: LineageKind;
  windowStart: string | null; windowEnd: string | null;
  metrics: Record<string, unknown>; metricProvenance: MetricProvenance;
  transportProvenance: MetricProvenance; observedAt: string; createdAt: string;
}

export interface RecordObservationInput {
  readonly projectId: string;
  readonly workflowId?: string | null;
  readonly artifactId?: string | null;
  readonly publicationId?: string | null;
  readonly contentId?: string | null;
  readonly publishedReportId?: string | null;
  readonly finalMediaSha256?: string | null;
  readonly channelId?: string | null;
  readonly analyticsProviderId?: string | null;
  readonly experimentId?: string | null;
  readonly lineageKind: LineageKind;
  readonly windowStart?: string | null;
  readonly windowEnd?: string | null;
  readonly metrics: Record<string, unknown>;
  readonly metricProvenance: MetricProvenance;
  readonly transportProvenance: MetricProvenance;
  readonly observedAt?: string;
}

export interface LearningRecord {
  learningId: string; projectId: string; sourceObservationIds: string[];
  experimentId: string | null; finding: string; evidence: Record<string, unknown>;
  validationOnly: boolean; supersedes: string | null; createdAt: string;
}

export interface NextCycleRecommendation {
  recommendationId: string; projectId: string; learningId: string;
  proposal: string; rationale: string; evidence: Record<string, unknown>;
  requiresOwnerDecision: boolean; createdAt: string;
}

export interface NextCycleProposal {
  proposalId: string; projectId: string; recommendationId: string;
  summary: string; approvalId: string | null;
  status: "AWAITS_OWNER_DECISION" | "OWNER_APPROVED_AWAITS_EXPLICIT_START" |
    "OWNER_REJECTED" | "OWNER_DEFERRED" | "OWNER_REQUESTED_CHANGES";
  createdAt: string;
}

function sha12(canonical: string): string {
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (typeof v === "string") {
    try { return asRecord(JSON.parse(v)); } catch { return null; }
  }
  return typeof v === "object" && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function asStringArray(v: unknown): string[] | null {
  if (Array.isArray(v)) return v.every((x) => typeof x === "string") ? v as string[] : null;
  if (typeof v === "string") {
    try { return asStringArray(JSON.parse(v)); } catch { return null; }
  }
  return null;
}

/** Deterministic evaluation. Missing/non-numeric data fails closed. */
export function evaluateGate(obs: PerformanceObservation, gate: GateSpec): GateEvaluation {
  if (obs.lineageKind === "VALIDATION_FIXTURE" && gate.fixtureApplicable === false) {
    return { gateId: gate.id, verdict: "NOT_APPLICABLE", detail: "gate scope excludes validation fixtures" };
  }
  if (gate.requiresLive === true && obs.transportProvenance !== "LIVE") {
    return { gateId: gate.id, verdict: "INSUFFICIENT_DATA", detail: `gate requires LIVE provenance, observed ${obs.transportProvenance}` };
  }
  if (typeof gate.windowDays === "number" && Number.isFinite(gate.windowDays) && gate.windowDays > 0) {
    const s = obs.windowStart ? Date.parse(obs.windowStart) : NaN;
    const e = obs.windowEnd ? Date.parse(obs.windowEnd) : NaN;
    if (!Number.isFinite(s) || !Number.isFinite(e) || (e - s) < gate.windowDays * 86400000) {
      return { gateId: gate.id, verdict: "INSUFFICIENT_DATA", detail: "measurement window incomplete" };
    }
  }
  const raw = obs.metrics[gate.metric];
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return { gateId: gate.id, verdict: "INSUFFICIENT_DATA", detail: `metric ${gate.metric} missing or non-numeric; never zero-filled` };
  }
  const met = gate.comparator === ">=" ? raw >= gate.threshold : raw <= gate.threshold;
  return { gateId: gate.id, verdict: met ? "MET" : "NOT_MET", detail: `${gate.metric}=${raw} ${gate.comparator} ${gate.threshold}` };
}

const obsRow = (r: any): PerformanceObservation => ({
  observationId: r.observation_id, projectId: r.project_id,
  workflowId: r.workflow_id ?? null, artifactId: r.artifact_id ?? null,
  publicationId: r.publication_id ?? null, channelId: r.channel_id ?? null,
  contentId: r.content_id ?? null, publishedReportId: r.published_report_id ?? null,
  finalMediaSha256: r.final_media_sha256 ?? null, analyticsProviderId: r.analytics_provider_id ?? null,
  experimentId: r.experiment_id ?? null,
  lineageKind: r.lineage_kind, windowStart: r.window_start ?? null, windowEnd: r.window_end ?? null,
  metrics: asRecord(r.metrics) ?? {},
  metricProvenance: r.metric_provenance, transportProvenance: r.transport_provenance,
  observedAt: r.observed_at, createdAt: r.created_at,
});

export class LearningLoopStore {
  constructor(private readonly pool: pg.Pool) {}

  /** Durable canonical observation. Restart-safe: same source identity
   *  returns the existing row (created:false), never a duplicate. */
  async recordObservation(input: RecordObservationInput): Promise<{ observation: PerformanceObservation; created: boolean }> {
    if (!input.projectId) throw new Error("LEARNING_OBSERVATION_PROJECT_REQUIRED");
    const metrics = asRecord(input.metrics);
    if (!metrics) throw new Error("LEARNING_OBSERVATION_METRICS_REQUIRED");
    if (!PROVENANCE.has(input.metricProvenance) || !PROVENANCE.has(input.transportProvenance)) {
      throw new Error("LEARNING_OBSERVATION_PROVENANCE_INVALID");
    }
    if (input.lineageKind !== "GOVERNED_RUN" && input.lineageKind !== "VALIDATION_FIXTURE") {
      throw new Error("LEARNING_OBSERVATION_LINEAGE_INVALID");
    }
    if (input.lineageKind === "VALIDATION_FIXTURE" && input.publicationId) {
      throw new Error("LEARNING_OBSERVATION_FIXTURE_MUST_NOT_CLAIM_PUBLICATION");
    }
    if (input.lineageKind === "GOVERNED_RUN") {
      const join = [input.workflowId, input.contentId, input.artifactId, input.finalMediaSha256,
        input.publishedReportId, input.publicationId, input.channelId, input.analyticsProviderId];
      if (join.some((value) => typeof value !== "string" || value.trim() === "")) {
        throw new Error("LEARNING_OBSERVATION_CANONICAL_JOIN_REQUIRED");
      }
      if (!/^[a-f0-9]{64}$/i.test(input.finalMediaSha256!)) throw new Error("LEARNING_OBSERVATION_MEDIA_HASH_INVALID");
    }
    const id = `obs-${sha12(JSON.stringify([input.projectId, input.contentId ?? null, input.workflowId ?? null, input.artifactId ?? null, input.finalMediaSha256 ?? null, input.publishedReportId ?? null, input.publicationId ?? null, input.channelId ?? null, input.analyticsProviderId ?? null, input.experimentId ?? null, input.lineageKind, input.windowStart ?? null, input.windowEnd ?? null, metrics, input.metricProvenance, input.transportProvenance]))}`;
    const now = new Date().toISOString();
    const inserted = await this.pool.query(
      `INSERT INTO performance_observations (observation_id,project_id,content_id,workflow_id,artifact_id,final_media_sha256,published_report_id,publication_id,channel_id,analytics_provider_id,experiment_id,lineage_kind,window_start,window_end,metrics,metric_provenance,transport_provenance,observed_at,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) ON CONFLICT (observation_id) DO NOTHING RETURNING *`,
      [id, input.projectId, input.contentId ?? null, input.workflowId ?? null, input.artifactId ?? null,
        input.finalMediaSha256 ?? null, input.publishedReportId ?? null, input.publicationId ?? null,
        input.channelId ?? null, input.analyticsProviderId ?? null, input.experimentId ?? null,
        input.lineageKind, input.windowStart ?? null, input.windowEnd ?? null,
        JSON.stringify(metrics), input.metricProvenance, input.transportProvenance, input.observedAt ?? now, now]);
    if (inserted.rowCount) return { observation: obsRow(inserted.rows[0]), created: true };
    const existing = await this.pool.query(`SELECT * FROM performance_observations WHERE observation_id=$1`, [id]);
    return { observation: obsRow(existing.rows[0]), created: false };
  }

  async getObservation(id: string): Promise<PerformanceObservation | null> {
    const q = await this.pool.query(`SELECT * FROM performance_observations WHERE observation_id=$1`, [id]);
    return q.rowCount ? obsRow(q.rows[0]) : null;
  }

  async listObservations(projectId: string, limit = 50, channelId?: string | null): Promise<PerformanceObservation[]> {
    const n = Math.min(Math.max(limit, 1), 200);
    if (channelId) {
      const q = await this.pool.query(`SELECT * FROM performance_observations WHERE project_id=$1 AND channel_id=$2 ORDER BY created_at DESC LIMIT ${n}`, [projectId, channelId]);
      return q.rows.map(obsRow);
    }
    const q = await this.pool.query(`SELECT * FROM performance_observations WHERE project_id=$1 ORDER BY created_at DESC LIMIT ${n}`, [projectId]);
    return q.rows.map(obsRow);
  }

  /** Immutable learning derived from observations. STUBBED-sourced learning
   *  is visibly validation-only and can never become live business truth. */
  async recordLearning(input: {
    projectId: string; observationIds: string[]; experimentId?: string | null;
    finding: string; evidence: Record<string, unknown>; supersedes?: string | null;
  }): Promise<{ learning: LearningRecord; created: boolean }> {
    if (!input.projectId) throw new Error("LEARNING_PROJECT_REQUIRED");
    if (!input.observationIds.length) throw new Error("LEARNING_OBSERVATION_REQUIRED");
    if (!input.finding.trim()) throw new Error("LEARNING_FINDING_REQUIRED");
    const ev = asRecord(input.evidence);
    if (!ev) throw new Error("LEARNING_EVIDENCE_REQUIRED");
    const sources: PerformanceObservation[] = [];
    for (const oid of input.observationIds) {
      const o = await this.getObservation(oid);
      if (!o) throw new Error(`LEARNING_UNKNOWN_OBSERVATION:${oid}`);
      if (o.projectId !== input.projectId) throw new Error("LEARNING_PROJECT_MISMATCH");
      sources.push(o);
    }
    const citedMetrics = Array.isArray(ev.citedMetrics) ? ev.citedMetrics : [];
    if (citedMetrics.some((metric) => typeof metric !== "string" || !sources.some((source) => Object.prototype.hasOwnProperty.call(source.metrics, metric)))) {
      throw new Error("LEARNING_EVIDENCE_CITES_UNOBSERVED_METRIC");
    }
    if (input.supersedes) {
      const prior = await this.pool.query(`SELECT 1 FROM learning_records WHERE learning_id=$1`, [input.supersedes]);
      if (!prior.rowCount) throw new Error("LEARNING_UNKNOWN_SUPERSEDED");
    }
    const validationOnly = sources.some((o) => o.transportProvenance !== "LIVE");
    const id = `learn-${sha12(JSON.stringify([input.projectId, [...input.observationIds].sort(), input.experimentId ?? null, input.finding, ev, input.supersedes ?? null]))}`;
    const now = new Date().toISOString();
    const inserted = await this.pool.query(
      `INSERT INTO learning_records (learning_id,project_id,source_observation_ids,experiment_id,finding,evidence,validation_only,supersedes,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (learning_id) DO NOTHING RETURNING *`,
      [id, input.projectId, JSON.stringify([...input.observationIds].sort()), input.experimentId ?? null,
        input.finding, JSON.stringify(ev), validationOnly ? 1 : 0, input.supersedes ?? null, now]);
    const row = inserted.rowCount
      ? inserted.rows[0]
      : (await this.pool.query(`SELECT * FROM learning_records WHERE learning_id=$1`, [id])).rows[0];
    const sourceIds = asStringArray(row.source_observation_ids) ?? [...input.observationIds].sort();
    const evidence = asRecord(row.evidence) ?? ev;
    return {
      learning: {
        learningId: row.learning_id, projectId: row.project_id,
        sourceObservationIds: sourceIds,
        experimentId: row.experiment_id ?? null, finding: row.finding,
        evidence, validationOnly: Number(row.validation_only) === 1,
        supersedes: row.supersedes ?? null, createdAt: row.created_at,
      },
      created: (inserted.rowCount ?? 0) > 0,
    };
  }

  async listLearnings(projectId: string, limit = 50): Promise<LearningRecord[]> {
    const n = Math.min(Math.max(limit, 1), 200);
    const q = await this.pool.query(`SELECT * FROM learning_records WHERE project_id=$1 ORDER BY created_at DESC LIMIT ${n}`, [projectId]);
    return q.rows.map((r: any) => ({
      learningId: r.learning_id, projectId: r.project_id,
      sourceObservationIds: asStringArray(r.source_observation_ids) ?? [],
      experimentId: r.experiment_id ?? null, finding: r.finding,
      evidence: asRecord(r.evidence) ?? {}, validationOnly: Number(r.validation_only) === 1,
      supersedes: r.supersedes ?? null, createdAt: r.created_at,
    }));
  }

  /** Evidence-linked recommendation. Persists the recommendation only;
   *  it never mutates strategy, experiments, authority, or execution. */
  async recommend(input: {
    projectId: string; learningId: string; proposal: string; rationale: string;
    evidence: Record<string, unknown>;
  }): Promise<{ recommendation: NextCycleRecommendation; created: boolean }> {
    if (!input.proposal.trim() || !input.rationale.trim()) throw new Error("LEARNING_RECOMMENDATION_CONTENT_REQUIRED");
    const ev = asRecord(input.evidence);
    if (!ev) throw new Error("LEARNING_RECOMMENDATION_EVIDENCE_REQUIRED");
    const learn = await this.pool.query(`SELECT project_id,source_observation_ids FROM learning_records WHERE learning_id=$1`, [input.learningId]);
    if (!learn.rowCount) throw new Error("LEARNING_UNKNOWN_LEARNING");
    if (String(learn.rows[0].project_id) !== input.projectId) throw new Error("LEARNING_PROJECT_MISMATCH");
    const citedMetrics = Array.isArray(ev.citedMetrics) ? ev.citedMetrics : [];
    if (citedMetrics.length > 0) {
      const observationIds = asStringArray(learn.rows[0].source_observation_ids) ?? [];
      const sources = await Promise.all(observationIds.map((id) => this.getObservation(id)));
      if (citedMetrics.some((metric) => typeof metric !== "string" || !sources.some((source) => source !== null && Object.prototype.hasOwnProperty.call(source.metrics, metric)))) {
        throw new Error("LEARNING_RECOMMENDATION_CITES_UNOBSERVED_METRIC");
      }
    }
    const id = `rec-${sha12(JSON.stringify([input.projectId, input.learningId, input.proposal, input.rationale, ev]))}`;
    const now = new Date().toISOString();
    const inserted = await this.pool.query(
      `INSERT INTO next_cycle_recommendations (recommendation_id,project_id,learning_id,proposal,rationale,evidence,requires_owner_decision,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,1,$7) ON CONFLICT (recommendation_id) DO NOTHING RETURNING *`,
      [id, input.projectId, input.learningId, input.proposal, input.rationale, JSON.stringify(ev), now]);
    const row = inserted.rowCount
      ? inserted.rows[0]
      : (await this.pool.query(`SELECT * FROM next_cycle_recommendations WHERE recommendation_id=$1`, [id])).rows[0];
    return {
      recommendation: {
        recommendationId: row.recommendation_id, projectId: row.project_id, learningId: row.learning_id,
        proposal: row.proposal, rationale: row.rationale, evidence: asRecord(row.evidence) ?? ev,
        requiresOwnerDecision: Number(row.requires_owner_decision) === 1, createdAt: row.created_at,
      },
      created: (inserted.rowCount ?? 0) > 0,
    };
  }

  async listRecommendations(projectId: string, limit = 50): Promise<NextCycleRecommendation[]> {
    const n = Math.min(Math.max(limit, 1), 200);
    const q = await this.pool.query(`SELECT * FROM next_cycle_recommendations WHERE project_id=$1 ORDER BY created_at DESC LIMIT ${n}`, [projectId]);
    return q.rows.map((r: any) => ({
      recommendationId: r.recommendation_id, projectId: r.project_id, learningId: r.learning_id,
      proposal: r.proposal, rationale: r.rationale, evidence: asRecord(r.evidence) ?? {},
      requiresOwnerDecision: Number(r.requires_owner_decision) === 1, createdAt: r.created_at,
    }));
  }

  /**
   * Governed next-cycle proposal. Status is ALWAYS AWAITS_OWNER_DECISION:
   * preparing a proposal never starts anything. An approvalId may be
   * attached only when a canonical Owner decision row was created through
   * the existing control_approvals path; this store never creates one.
   */
  async proposeNextCycle(input: {
    projectId: string; recommendationId: string; summary: string; approvalId?: string | null;
  }): Promise<{ proposal: NextCycleProposal; created: boolean }> {
    if (!input.summary.trim()) throw new Error("LEARNING_PROPOSAL_SUMMARY_REQUIRED");
    const rec = await this.pool.query(`SELECT project_id FROM next_cycle_recommendations WHERE recommendation_id=$1`, [input.recommendationId]);
    if (!rec.rowCount) throw new Error("LEARNING_UNKNOWN_RECOMMENDATION");
    if (String(rec.rows[0].project_id) !== input.projectId) throw new Error("LEARNING_PROJECT_MISMATCH");
    const id = `ncp-${sha12(JSON.stringify([input.projectId, input.recommendationId, input.summary]))}`;
    const now = new Date().toISOString();
    const inserted = await this.pool.query(
      `INSERT INTO next_cycle_proposals (proposal_id,project_id,recommendation_id,summary,approval_id,status,created_at)
       VALUES ($1,$2,$3,$4,$5,'AWAITS_OWNER_DECISION',$6) ON CONFLICT (proposal_id) DO NOTHING RETURNING *`,
      [id, input.projectId, input.recommendationId, input.summary, input.approvalId ?? null, now]);
    const row = inserted.rowCount
      ? inserted.rows[0]
      : (await this.pool.query(`SELECT * FROM next_cycle_proposals WHERE proposal_id=$1`, [id])).rows[0];
    return {
      proposal: {
        proposalId: row.proposal_id, projectId: row.project_id, recommendationId: row.recommendation_id,
        summary: row.summary, approvalId: row.approval_id ?? null,
        status: "AWAITS_OWNER_DECISION", createdAt: row.created_at,
      },
      created: (inserted.rowCount ?? 0) > 0,
    };
  }

  async listProposals(projectId: string, limit = 50): Promise<NextCycleProposal[]> {
    const n = Math.min(Math.max(limit, 1), 200);
    const q = await this.pool.query(`SELECT * FROM next_cycle_proposals WHERE project_id=$1 ORDER BY created_at DESC LIMIT ${n}`, [projectId]);
    return q.rows.map((r: any) => ({
      proposalId: r.proposal_id, projectId: r.project_id, recommendationId: r.recommendation_id,
      summary: r.summary, approvalId: r.approval_id ?? null,
      status: r.status as NextCycleProposal["status"], createdAt: r.created_at,
    }));
  }
}
