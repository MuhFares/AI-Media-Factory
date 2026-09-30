/**
 * Slice 2 — canonical lifecycle read model (derived, never mutated).
 *
 * Problem: raw step/job/submission rows can read stale (pending/failed)
 * while later governed continuation (revisions, media resumes, visual
 * iterations, downstream canonical artifacts) already completed. This store
 * derives CURRENT effective truth with explicit precedence:
 *
 *   completed canonical artifacts + decided approvals
 *     over stale step/job/submission rows,
 *
 * but NEVER invents completion: every derived fact cites evidence, and
 * material conflict fails closed (STATE_CONFLICT) instead of guessing.
 * History rows are only read, never written, by this layer.
 */

import type pg from "pg";
import { ApprovalActionabilityStore } from "./approval-actionability.js";
import { isValidationAcceptance } from "./validation-acceptance.js";
import type { ApprovalActionabilityState } from "./approval-actionability.js";

export type LifecycleOverallState =
  | "NEEDS_OWNER_ATTENTION"
  | "VALIDATION_COMPLETED"
  | "MEDIA_COMPLETED"
  | "BLOCKED"
  | "FAILED_TERMINAL"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "NOT_STARTED"
  | "STATE_CONFLICT";

export type LifecyclePhaseState =
  | "COMPLETED" | "WAITING_OWNER" | "BLOCKED" | "IN_PROGRESS" | "NOT_STARTED";

export interface LifecyclePhaseDef {
  id: string;
  label: string;
  /** step_id values (lowercased, substring-matched) belonging to this phase. */
  steps: string[];
  /** artifact kinds whose completed presence proves phase completion. */
  completeKinds: string[];
  /** any single one of these completed kinds also proves completion (terminal evidence). */
  terminalKinds?: string[];
  /** human-gate step fragments that raise Owner attention inside this phase. */
  gates: string[];
}

export const LIFECYCLE_PHASES: readonly LifecyclePhaseDef[] = [
  { id: "plan", label: "Plan", steps: ["planner-initial", "planner-synthesis", "plan"], completeKinds: ["execution_plan"], gates: [] },
  { id: "research", label: "Research", steps: ["research"], completeKinds: ["research_report"], gates: [] },
  { id: "create", label: "Create", steps: ["writer", "seo", "brand"], completeKinds: ["writer_report", "seo_report", "brand_report"], gates: [] },
  { id: "review", label: "Review", steps: ["review", "pre-production-owner-gate", "pre_production"], completeKinds: ["review_report", "evidence_backed_content_brief"], gates: ["pre-production-owner-gate", "pre_production"] },
  { id: "media", label: "Media production", steps: ["director", "tts", "timeline", "scene-image", "visual", "video", "wan", "composer"], completeKinds: ["scene_video_clip", "narration_audio_artifact", "duration_reconciliation"], terminalKinds: ["final_media_artifact"], gates: ["visual-human-gate"] },
  { id: "final-review", label: "Final review", steps: ["final-product-review", "final-technical-qa", "qa", "final-human-gate"], completeKinds: ["final_technical_qa", "final_product_review"], terminalKinds: ["final_product_review"], gates: ["final-human-gate"] },
  { id: "publication", label: "Publication", steps: ["publisher", "publisher-authorization"], completeKinds: ["publication_integration_validation"], terminalKinds: ["publication_integration_validation"], gates: ["publisher-authorization"] },
  { id: "analytics", label: "Analytics", steps: ["analytics"], completeKinds: [], gates: [] },
];

/** Milestones in Owner order: label + artifact kinds proving them. */
const MILESTONES: ReadonlyArray<{ id: string; label: string; kinds: string[] }> = [
  { id: "research", label: "Research completed", kinds: ["research_report"] },
  { id: "brief", label: "Brief completed", kinds: ["evidence_backed_content_brief"] },
  { id: "script", label: "Script completed", kinds: ["writer_report"] },
  { id: "seo", label: "SEO package completed", kinds: ["seo_report"] },
  { id: "brand", label: "Brand direction completed", kinds: ["brand_report"] },
  { id: "review", label: "Review completed", kinds: ["review_report"] },
  { id: "visuals", label: "Visual production completed", kinds: ["scene_visual_artifact", "scene-image"] },
  { id: "video", label: "Video assembled", kinds: ["scene_video_clip", "final_media_artifact"] },
  { id: "final-review", label: "Final review completed", kinds: ["final_product_review"] },
  { id: "validation", label: "Publication validation completed", kinds: ["publication_integration_validation"] },
];

/** Meaningful Owner outputs: category + artifact kinds (first match wins display). */
const OUTPUT_CATEGORIES: ReadonlyArray<{ id: string; label: string; kinds: string[] }> = [
  { id: "final-video", label: "Final video", kinds: ["final_media_artifact"] },
  { id: "script", label: "Script", kinds: ["writer_report"] },
  { id: "research", label: "Research", kinds: ["research_report"] },
  { id: "brief", label: "Brief", kinds: ["evidence_backed_content_brief"] },
  { id: "seo", label: "SEO package", kinds: ["seo_report"] },
  { id: "brand-visual", label: "Brand / visual direction", kinds: ["brand_report", "visual_direction_contract", "scene_visual_artifact"] },
  { id: "scenes", label: "Images / scenes", kinds: ["scene_video_clip"] },
  { id: "narration", label: "Narration", kinds: ["narration_audio_artifact", "narration_artifact"] },
  { id: "reviews", label: "Reviews / QA", kinds: ["final_product_review", "final_technical_qa", "review_report"] },
  { id: "validation", label: "Publication validation", kinds: ["publication_integration_validation"] },
];

export interface LifecycleAttention {
  /** APPROVAL = an Owner decision exists; SYSTEM = technical state, no Owner decision required. */
  kind: "APPROVAL" | "SYSTEM";
  phaseId: string | null;
  title: string;
  detail: string;
  approvalId: string | null;
}

export interface LifecyclePhaseView {
  id: string;
  label: string;
  state: LifecyclePhaseState;
  evidence: string[];
  detail: string;
}

export interface LifecycleMilestone {
  id: string;
  label: string;
  completed: boolean;
  evidenceArtifactIds: string[];
}

export interface LifecycleOutput {
  id: string;
  label: string;
  count: number;
  artifactIds: string[];
}

export interface CanonicalLifecycle {
  workflowId: string;
  projectId: string | null;
  directive: string;
  title: string;
  overallState: LifecycleOverallState;
  overallLabel: string;
  currentPhaseId: string | null;
  progress: { completedPhases: number; totalPhases: number };
  phases: LifecyclePhaseView[];
  milestones: LifecycleMilestone[];
  attention: LifecycleAttention[];
  blockers: Array<{ where: string; what: string; detail: string; providerContacted: boolean | null; retryable: boolean | null }>;
  attempts: { total: number; succeeded: number; failedSuperseded: number; unresolved: number; note: string };
  /** Pending approvals reclassified as no-longer-actionable (immutable rows, read-model truth). */
  supersededGates: string[];
  /** Queued/running jobs exist on this workflow right now. */
  liveWork: boolean;
  outputs: LifecycleOutput[];
  productionApproval: "GRANTED" | "NOT_GRANTED" | "UNKNOWN";
  publicationApproval: "GRANTED" | "NOT_GRANTED" | "UNKNOWN";
  /** Explicit Owner validation acceptance (payload bit on the exact
   *  integration-validation scope). Never implies any authority grant. */
  validationAcceptance: boolean;
  publicStatus: "NOT_PUBLISHED" | "PUBLISHED" | "UNKNOWN";
  /**
   * Provider publication/integration truth, distinct from public visibility.
   * A confirmed private record keeps publicStatus NOT_PUBLISHED while remaining
   * visible here. Null visibility (pre-visibility rows) fails closed.
   */
  providerPublication: { confirmed: boolean; visibility: string | null } | null;
  readyToPublish: boolean;
  readinessNote: string;
  lastMilestone: string | null;
  nextStep: string;
  ifYouDoNothing: string;
  conflicts: string[];
  resolvedAt: string;
}

interface StepRow { step_id: string; status: string; attempts: number }
interface JobRow { job_id: number; status: string; attempts: number; error: string | null; updated_at: string }
interface ArtifactRow { artifact_id: string | null; kind: string; status: string; created_at: string }
interface ApprovalRow { approval_id: string; target_type: string; target_id: string; status: string; owner_decision: string | null; agent_recommendation: unknown }

const norm = (s: string): string => s.toLowerCase();

/** agent_recommendation arrives as parsed JSONB or text depending on driver. */
const parseRecommendation = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return v; }
};

/**
 * Matrix item 24: job error text can embed provider secrets. The read model
 * (and therefore the UI) must never surface them. Deterministic redaction of
 * key/token-shaped material; everything else passes through untouched.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/(api[_-]?key|secret|token|password|passwd|authorization|auth)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .replace(/\b(secret|token|password)\s+[A-Za-z0-9\-._~+/=]{3,}/gi, "$1 [REDACTED]")
    .replace(/(bearer\s+)[A-Za-z0-9\-._~+/=]+/gi, "$1[REDACTED]");
}
const stepInPhase = (stepId: string, def: LifecyclePhaseDef): boolean => {
  const s = norm(stepId);
  return def.steps.some((frag) => s.includes(norm(frag)));
};
const gatePhase = (targetId: string): string | null => {
  const t = norm(targetId);
  for (const def of LIFECYCLE_PHASES) {
    if (def.gates.some((g) => t.includes(norm(g)))) return def.id;
  }
  return null;
};

function deriveTitle(directive: string, brandId: string | null, createdAt?: string): string {
  const brand = (brandId ?? "project").trim() || "project";
  const cap = brand.charAt(0).toUpperCase() + brand.slice(1);
  const dir = (directive ?? "").trim() || "workflow";
  const dirLabel = dir.charAt(0).toUpperCase() + dir.slice(1);
  let when = "";
  if (createdAt) {
    const t = Date.parse(createdAt);
    if (Number.isFinite(t)) {
      when = ` · ${new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
    }
  }
  return `${cap} · ${dirLabel}${when}`;
}

export class LifecycleStore {
  constructor(private readonly pool: pg.Pool) {}

  async workflowLifecycle(workflowId: string): Promise<CanonicalLifecycle | null> {
    const sub = await this.pool.query(
      `SELECT workflow_id, directive, brand_id, status, created_at, updated_at FROM workflow_submissions WHERE workflow_id=$1`,
      [workflowId]);
    if (!sub.rowCount) return null;
    const s = sub.rows[0];
    const stepsQ = await this.pool.query(`SELECT step_id, status, attempts FROM workflow_steps WHERE workflow_id=$1`, [workflowId]);
    const jobsQ = await this.pool.query(`SELECT job_id, workflow_id, status, attempts, error, updated_at FROM workflow_jobs WHERE workflow_id=$1 ORDER BY job_id`, [workflowId]);
    const artsQ = await this.pool.query(`SELECT artifact_id, kind, status, created_at FROM artifacts WHERE workflow_id=$1 ORDER BY created_at`, [workflowId]);
    const apprQ = await this.pool.query(`SELECT approval_id, target_type, target_id, status, owner_decision, agent_recommendation FROM control_approvals WHERE target_id LIKE $1`, [`%${workflowId}%`]);
    const actionStore = new ApprovalActionabilityStore(this.pool);
    const actionability = new Map<string, import("./approval-actionability.js").ApprovalActionabilityState>();
    for (const a of apprQ.rows as ApprovalRow[]) {
      if (a.status !== "DECIDED") {
        try {
          const c = await actionStore.approvalActionability(a.approval_id);
          if (c) actionability.set(a.approval_id, c.state);
        } catch {
          // Fail toward attention when classification itself errors.
        }
      }
    }
    let published = false;
    let publicationVisibility: string | null = null;
    try {
      const pubQ = await this.pool.query(`SELECT visibility FROM provider_publications WHERE workflow_id=$1 AND status='completed' LIMIT 1`, [workflowId]);
      if ((pubQ.rowCount ?? 0) > 0) {
        published = true;
        const v = pubQ.rows[0].visibility;
        publicationVisibility = typeof v === "string" && v !== "" ? v : null;
      }
    } catch {
      published = false;
      publicationVisibility = null;
    }
    const steps = stepsQ.rows as StepRow[];
    const jobs = jobsQ.rows as JobRow[];
    const artifacts = artsQ.rows as ArtifactRow[];
    const approvals = apprQ.rows as ApprovalRow[];
    return this.resolve({
      workflowId, projectId: s.brand_id ?? null, directive: s.directive ?? "",
      submissionStatus: s.status ?? "",
      steps, jobs, artifacts, approvals, published, publicationVisibility, actionability,
      createdAt: s.created_at ?? undefined,
    });
  }

  async projectLifecycles(projectId: string, limit = 20): Promise<CanonicalLifecycle[]> {
    const n = Math.min(Math.max(limit, 1), 50);
    // ASK/MULTI executions live in Command Room history, not the content pipeline.
    const q = await this.pool.query(
      `SELECT workflow_id FROM workflow_submissions WHERE brand_id=$1 AND (command_context IS NULL OR command_context->>'commandType' NOT IN ('ASK_AGENT','MULTI_AGENT_REVIEW')) ORDER BY created_at DESC LIMIT ${n}`, [projectId]);
    const out: CanonicalLifecycle[] = [];
    for (const r of q.rows) {
      const lc = await this.workflowLifecycle(r.workflow_id);
      if (lc) out.push(lc);
    }
    return out;
  }

  /** Pure deterministic resolution over already-loaded rows (unit-testable). */
  resolve(input: {
    workflowId: string; projectId: string | null; directive: string; submissionStatus: string;
    steps: StepRow[]; jobs: JobRow[]; artifacts: ArtifactRow[]; approvals: ApprovalRow[];
    published?: boolean;
    /** Provider-confirmed visibility; null/unknown fails closed to NOT_PUBLISHED. */
    publicationVisibility?: string | null;
    /** Actionability per approval id. Absent PENDING entries fail toward ACTION_REQUIRED. */
    actionability?: Map<string, ApprovalActionabilityState>;
    createdAt?: string;
  }): CanonicalLifecycle {
    const { workflowId, projectId, directive } = input;
    const resolvedAt = new Date().toISOString();
    const completedKinds = new Set(
      input.artifacts.filter((a) => norm(a.status) === "completed").map((a) => norm(a.kind)));
    const artifactsByKind = new Map<string, ArtifactRow[]>();
    for (const a of input.artifacts) {
      const k = norm(a.kind);
      const list = artifactsByKind.get(k) ?? [];
      list.push(a);
      artifactsByKind.set(k, list);
    }
    const actionOf = (a: ApprovalRow): ApprovalActionabilityState => {
      const known = input.actionability?.get(a.approval_id);
      if (known) return known;
      return a.status === "DECIDED" ? "DECIDED" : "ACTION_REQUIRED";
    };
    const actionable = input.approvals.filter((a) => actionOf(a) === "ACTION_REQUIRED");
    const conflicted = input.approvals.filter((a) => actionOf(a) === "CONFLICTED");
    const supersededGates = input.approvals
      .filter((a) => actionOf(a) === "SUPERSEDED" || actionOf(a) === "HISTORICAL")
      .map((a) => a.approval_id);
    const pendingApprovals = actionable;
    const decidedApprovals = input.approvals.filter((a) => a.status === "DECIDED");
    const conflicts: string[] = [];

    // Same gate target with more than one PENDING approval: ambiguous routing.
    const pendingByTarget = new Map<string, number>();
    for (const a of input.approvals.filter((x) => x.status !== "DECIDED")) pendingByTarget.set(a.target_id, (pendingByTarget.get(a.target_id) ?? 0) + 1);
    for (const [target, count] of pendingByTarget) {
      if (count > 1) conflicts.push(`Multiple pending approvals on ${target}`);
    }
    for (const a of conflicted) conflicts.push(`Approval ${a.approval_id} needs platform review before any decision.`);

    // -- milestones --
    const milestones: LifecycleMilestone[] = MILESTONES.map((m) => {
      const ids = m.kinds.flatMap((k) => (artifactsByKind.get(norm(k)) ?? []).filter((a) => norm(a.status) === "completed" && a.artifact_id).map((a) => a.artifact_id as string));
      return { id: m.id, label: m.label, completed: ids.length > 0, evidenceArtifactIds: [...new Set(ids)] };
    });
    const milestoneDone = (id: string): boolean => milestones.find((m) => m.id === id)?.completed ?? false;

    // -- phases --
    const phases: LifecyclePhaseView[] = LIFECYCLE_PHASES.map((def) => {
      const kindsDone = def.completeKinds.filter((k) => completedKinds.has(norm(k)));
      const terminalDone = (def.terminalKinds ?? []).some((k) => completedKinds.has(norm(k)));
      const phaseSteps = input.steps.filter((st) => stepInPhase(st.step_id, def));
      const failedSteps = phaseSteps.filter((st) => norm(st.status) === "failed");
      const completed = terminalDone || (def.completeKinds.length > 0
        ? kindsDone.length === def.completeKinds.length
        : phaseSteps.length > 0 && phaseSteps.every((st) => norm(st.status) === "completed"));
      const waitingGate = pendingApprovals.some((a) => gatePhase(a.target_id) === def.id);
      let state: LifecyclePhaseState;
      let detail: string;
      const evidence: string[] = kindsDone.map((k) => `completed ${k}`);
      if (waitingGate && completed) {
        state = "WAITING_OWNER";
        detail = "Work completed; waiting for your approval to continue.";
      } else if (waitingGate) {
        state = "WAITING_OWNER";
        detail = "Waiting for your approval.";
      } else if (completed) {
        state = "COMPLETED";
        detail = failedSteps.length > 0
          ? `Completed; ${failedSteps.length} earlier attempt(s) superseded by governed continuation.`
          : "Completed.";
      } else if (failedSteps.length > 0) {
        state = "BLOCKED";
        detail = "A step failed and no completed output supersedes it yet.";
        evidence.push(...failedSteps.map((st) => `failed ${st.step_id}`));
      } else if (phaseSteps.length > 0 || kindsDone.length > 0) {
        state = "IN_PROGRESS";
        detail = "Work recorded; completion evidence not yet complete.";
      } else {
        state = "NOT_STARTED";
        detail = "No work recorded for this phase yet.";
      }
      return { id: def.id, label: def.label, state, evidence, detail };
    });

    // Finding D: never label validation as publication. The publication phase
    // reads "Publication validation" until a real completed publication exists.
    if (!input.published) {
      const pub = phases.find((p) => p.id === "publication");
      if (pub) {
        pub.label = "Publication validation";
        if (pub.state === "COMPLETED") pub.detail = "Validation recorded — nothing was publicly published.";
      }
    }

    // -- attempts --
    const succeededJobs = input.jobs.filter((j) => j.status === "succeeded").length;
    const failedJobs = input.jobs.filter((j) => j.status === "failed").length;
    const downstreamProof = milestoneDone("video") || milestoneDone("final-review") || milestoneDone("validation");
    const failedSuperseded = downstreamProof ? failedJobs : 0;

    // -- authority --
    const decidedTarget = (pred: (a: ApprovalRow) => boolean): ApprovalRow | undefined =>
      decidedApprovals.find(pred);
    const validationApproval = decidedTarget((a) => norm(a.target_type).includes("publication_integration_validation") && a.owner_decision === "APPROVE");
    const prodApproval = decidedTarget((a) => /production_approval|production-approved/.test(norm(a.target_id)));
    const pubApproval = decidedTarget((a) => /public_publish/.test(norm(a.target_id)) && !norm(a.target_type).includes("integration_validation"));
    const productionApproval = prodApproval ? "GRANTED" : "NOT_GRANTED";
    const publicationApproval = pubApproval ? "GRANTED" : "NOT_GRANTED";
    // E2E validation-acceptance payload-bit contract: explicit Owner bit on
    // the exact validation scope only. Historical rows never carry the bit
    // and read false; technical milestone success alone never accepts.
    const validationAcceptance = decidedApprovals.some((a) => isValidationAcceptance({
      status: a.status, owner_decision: a.owner_decision,
      target_type: a.target_type, agent_recommendation: parseRecommendation(a.agent_recommendation),
    }));

    // -- overall state (precedence-ordered, never latest-wins) --
    let overallState: LifecycleOverallState;
    let overallLabel: string;
    if (conflicts.length > 0) {
      overallState = "STATE_CONFLICT";
      overallLabel = "Needs platform review — conflicting records";
    } else if (pendingApprovals.length > 0) {
      overallState = "NEEDS_OWNER_ATTENTION";
      overallLabel = "Waiting for your approval";
    } else if (milestoneDone("validation")) {
      overallState = "VALIDATION_COMPLETED";
      overallLabel = "Technical validation complete";
    } else if (milestoneDone("final-review") || milestoneDone("video")) {
      overallState = "MEDIA_COMPLETED";
      overallLabel = "Media completed";
    } else if (failedJobs > 0 && !downstreamProof && input.jobs.every((j) => j.status !== "succeeded" && j.status !== "running" && j.status !== "queued")) {
      overallState = input.jobs.length > 0 && norm(input.submissionStatus) === "failed" ? "FAILED_TERMINAL" : "BLOCKED";
      // Finding C: with no actionable approval, this is NOT an Owner-decision
      // state. Say plainly that the run stopped; point at history and Command
      // Room instead of implying a decision is required.
      overallLabel = overallState === "FAILED_TERMINAL" ? "Stopped — no successful continuation" : "Stopped — system issue";
    } else if (norm(input.submissionStatus) === "completed") {
      overallState = "COMPLETED";
      overallLabel = "Completed";
    } else if (input.jobs.some((j) => j.status === "running" || j.status === "queued") || input.steps.some((st) => ["running", "pending"].includes(norm(st.status)))) {
      overallState = "IN_PROGRESS";
      overallLabel = "In progress";
    } else if (input.steps.length === 0 && input.artifacts.length === 0) {
      overallState = "NOT_STARTED";
      overallLabel = "Not started";
    } else {
      overallState = "IN_PROGRESS";
      overallLabel = "In progress";
    }

    // Unresolved failures only count as current when nothing supersedes them.
    const unresolved = (overallState === "BLOCKED" || overallState === "FAILED_TERMINAL") ? failedJobs : 0;

    // -- attention --
    // APPROVAL entries are Owner decisions. SYSTEM entries describe stopped
    // runs with no actionable decision; they never count as needs-decision.
    const attention: LifecycleAttention[] = pendingApprovals.map((a) => ({
      kind: "APPROVAL" as const,
      phaseId: gatePhase(a.target_id),
      title: "Your approval is needed",
      detail: `Gate ${a.target_id.split(":").slice(-1)[0]} is waiting for your decision.`,
      approvalId: a.approval_id,
    }));
    const stoppedNoDecision = (overallState === "BLOCKED" || overallState === "FAILED_TERMINAL") && pendingApprovals.length === 0;
    if (stoppedNoDecision) {
      const lastErr = input.jobs.filter((j) => j.status === "failed").slice(-1)[0]?.error ?? null;
      attention.push({
        kind: "SYSTEM",
        phaseId: null,
        title: "Historical stopped run",
        detail: lastErr
          ? `Last attempt ended: ${redactSecrets(lastErr).slice(0, 200)}. No Owner decision is currently required; inspect history below, or start a new governed task from Command Room if needed.`
          : "This run stopped with no Owner decision currently required. Inspect history below, or start a new governed task from Command Room if needed.",
        approvalId: null,
      });
    }
    const blockers = (overallState === "BLOCKED" || overallState === "FAILED_TERMINAL")
      ? input.jobs.filter((j) => j.status === "failed").slice(-3).map((j) => ({
        where: "workflow execution",
        what: "A workflow attempt ended without successful continuation.",
        detail: redactSecrets(j.error ?? "No detailed error recorded.").slice(0, 300),
        providerContacted: null,
        retryable: null,
      }))
      : [];

    // -- outputs --
    const outputs: LifecycleOutput[] = OUTPUT_CATEGORIES.map((c) => {
      const ids = c.kinds.flatMap((k) => (artifactsByKind.get(norm(k)) ?? []).filter((a) => a.artifact_id).map((a) => a.artifact_id as string));
      return { id: c.id, label: c.label, count: new Set(ids).size, artifactIds: [...new Set(ids)] };
    }).filter((o) => o.count > 0);

    const completedPhases = phases.filter((p) => p.state === "COMPLETED" || p.state === "WAITING_OWNER").length;
    const currentPhase = phases.find((p) => p.state === "WAITING_OWNER" || p.state === "BLOCKED" || p.state === "IN_PROGRESS") ?? null;
    const doneMilestones = milestones.filter((m) => m.completed);
    const lastMilestone = doneMilestones.length ? doneMilestones[doneMilestones.length - 1].label : null;

    const nextStep = overallState === "NEEDS_OWNER_ATTENTION"
      ? "Review the waiting approval and record your decision."
      : overallState === "VALIDATION_COMPLETED"
        ? "Validation is complete. Production and publication each need a separate Owner approval before anything further happens."
        : overallState === "BLOCKED" || overallState === "FAILED_TERMINAL"
          ? "No Owner decision is currently required. Inspect the history below, or start a new governed task from Command Room if needed."
          : overallState === "IN_PROGRESS"
            ? "The platform is working; no action needed right now."
            : "No action needed.";
    const ifYouDoNothing = overallState === "NEEDS_OWNER_ATTENTION"
      ? "The workflow waits. Nothing advances past the gate without your decision."
      : overallState === "BLOCKED" || overallState === "FAILED_TERMINAL"
        ? "The run stays stopped. Nothing advances on its own."
        : "Nothing external happens on its own; publication always needs your explicit approval.";

    const readyToPublish = publicationApproval === "GRANTED";
    const readinessNote = readyToPublish
      ? "Publication authority granted."
      : "Not ready to publish: publication requires a separate explicit Owner approval, which has not been granted.";

    return {
      workflowId, projectId, directive: input.directive,
      title: deriveTitle(input.directive, projectId, input.createdAt),
      overallState, overallLabel,
      currentPhaseId: currentPhase?.id ?? null,
      progress: { completedPhases, totalPhases: LIFECYCLE_PHASES.length },
      phases, milestones, attention, blockers,
      attempts: {
        total: input.jobs.length, succeeded: succeededJobs,
        failedSuperseded, unresolved,
        note: failedSuperseded > 0
          ? `${failedSuperseded} earlier failed attempt(s) were superseded by later governed continuation.`
          : "No superseded attempts recorded.",
      },
      outputs,
      supersededGates,
      liveWork: input.jobs.some((j) => j.status === "running" || j.status === "queued"),
      productionApproval, publicationApproval,
      validationAcceptance,
      publicStatus: input.published === true && input.publicationVisibility === "public" ? "PUBLISHED" : "NOT_PUBLISHED",
      providerPublication: input.published === true
        ? { confirmed: true, visibility: typeof input.publicationVisibility === "string" && input.publicationVisibility !== "" ? input.publicationVisibility : "unknown" }
        : null,
      readyToPublish, readinessNote,
      lastMilestone, nextStep, ifYouDoNothing,
      conflicts, resolvedAt,
    };
  }
}
