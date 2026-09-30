import type pg from "pg";
import { assertRecoveryHorizon } from "./recovery-framework.js";

/**
 * Governed Visual Iteration V1 — first-class domain entity.
 *
 * "Owner rejected/requested iteration on generated visual output while the
 * approved content package remains valid." A creative downstream revision:
 * NOT a media resume, recovery, R9, ReviewRevisionTask, or content revision.
 *
 * Lifecycle (explicit, fail-closed):
 *   REQUESTED -> CONTRACT_REQUIRED -> CONTRACT_PREPARED
 *   -> OWNER_REVIEW_REQUIRED (prompt gate PENDING) -> AUTHORIZED
 *   -> GENERATING -> QA_REQUIRED -> VISUAL_HUMAN_REVIEW_REQUIRED -> COMPLETED
 * Terminal: REJECTED | FAILED | CANCELLED.
 *
 * REQUESTED != AUTHORIZED: preparing prompts never authorizes generation.
 * PROPOSED budget != AUTHORIZED budget: no implicit conversion.
 * All transitions are guarded; illegal transitions throw. Creation is
 * exactly-once per (workflow, iteration_number) and per source approval.
 * Lineage is frozen explicitly by the caller — the store never resolves
 * "latest" artifacts. Zero provider I/O in this module.
 */

export const VISUAL_ITERATION_STATUSES = [
  "REQUESTED",
  "CONTRACT_REQUIRED",
  "CONTRACT_PREPARED",
  "OWNER_REVIEW_REQUIRED",
  "AUTHORIZED",
  "GENERATING",
  "QA_REQUIRED",
  "VISUAL_HUMAN_REVIEW_REQUIRED",
  "COMPLETED",
  "REJECTED",
  "FAILED",
  "CANCELLED",
] as const;
export type VisualIterationStatus = typeof VISUAL_ITERATION_STATUSES[number];

const TERMINAL: ReadonlySet<string> = new Set(["COMPLETED", "REJECTED", "FAILED", "CANCELLED"]);

const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  REQUESTED: ["CONTRACT_REQUIRED", "REJECTED", "CANCELLED"],
  CONTRACT_REQUIRED: ["CONTRACT_PREPARED", "REJECTED", "FAILED", "CANCELLED"],
  CONTRACT_PREPARED: ["OWNER_REVIEW_REQUIRED", "REJECTED", "FAILED", "CANCELLED"],
  // Creative supersession / prompt-iteration loop: new contract material
  // (e.g. the canonical Visual Director output superseding a draft) re-opens
  // preparation (OWNER_REVIEW_REQUIRED -> CONTRACT_REQUIRED -> CONTRACT_PREPARED
  // -> OWNER_REVIEW_REQUIRED). Never usable post-AUTHORIZED: generation
  // lineage is frozen at authorization.
  OWNER_REVIEW_REQUIRED: ["AUTHORIZED", "CONTRACT_REQUIRED", "REJECTED", "FAILED", "CANCELLED"],
  AUTHORIZED: ["GENERATING", "REJECTED", "FAILED", "CANCELLED"],
  GENERATING: ["QA_REQUIRED", "FAILED", "CANCELLED"],
  QA_REQUIRED: ["VISUAL_HUMAN_REVIEW_REQUIRED", "FAILED", "CANCELLED"],
  VISUAL_HUMAN_REVIEW_REQUIRED: ["COMPLETED", "REJECTED", "FAILED", "CANCELLED"],
  COMPLETED: [],
  REJECTED: [],
  FAILED: [],
  CANCELLED: [],
};

export interface VisualIterationLineage {
  readonly sourceWriterArtifactId?: string | null;
  readonly sourceBrandArtifactId?: string | null;
  readonly sourceReviewArtifactId?: string | null;
  readonly sourceDirectorArtifactId?: string | null;
  readonly sourceNarrationArtifactId?: string | null;
  readonly sourceTimelineArtifactId?: string | null;
  readonly sourceVisualArtifactIds?: readonly string[];
  readonly sourceSemanticQaArtifactIds?: readonly string[];
  readonly sourceTechnicalQaArtifactIds?: readonly string[];
}

export interface VisualIterationRecord {
  readonly visualIterationId: string;
  readonly workflowId: string;
  readonly contentId: string;
  readonly iterationNumber: number;
  readonly sourceVisualApprovalId: string;
  readonly sourceVisualGateState: string;
  readonly ownerDecision: string | null;
  readonly ownerRationale: string | null;
  readonly status: VisualIterationStatus;
  readonly createdAt: string;
  readonly authorizedAt: string | null;
  readonly completedAt: string | null;
  readonly lineage: VisualIterationLineage;
  readonly visualDirectionContractArtifactId: string | null;
  readonly sceneContractArtifactIds: readonly string[];
  readonly compiledPromptArtifactIds: readonly string[];
  readonly scenesToKeep: readonly string[];
  readonly scenesToRegenerate: readonly string[];
  readonly proposedImageBudget: number;
  readonly authorizedImageBudget: number;
  readonly usedImageBudget: number;
  readonly authorizationId: string | null;
  readonly authorizationEvidence: unknown;
  readonly promptOwnerGateApprovalId: string | null;
  readonly updatedAt: string;
}

export interface RequestVisualIterationInput {
  readonly workflowId: string;
  readonly contentId: string;
  readonly sourceVisualApprovalId: string;
  readonly sourceVisualGateState: string;
  readonly ownerDecision: string;
  readonly ownerRationale: string;
  readonly lineage: VisualIterationLineage;
  readonly scenesToKeep: readonly string[];
  readonly scenesToRegenerate: readonly string[];
  readonly proposedImageBudget: number;
  readonly providerConfigurationSnapshot?: unknown;
  readonly buildIdentitySnapshot?: unknown;
  readonly humanGatePolicySnapshot?: unknown;
}

function row(r: Record<string, unknown>): VisualIterationRecord {
  const strArray = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    visualIterationId: String(r.visual_iteration_id),
    workflowId: String(r.workflow_id),
    contentId: String(r.content_id),
    iterationNumber: Number(r.iteration_number),
    sourceVisualApprovalId: String(r.source_visual_approval_id),
    sourceVisualGateState: String(r.source_visual_gate_state),
    ownerDecision: r.owner_decision === null || r.owner_decision === undefined ? null : String(r.owner_decision),
    ownerRationale: r.owner_rationale === null || r.owner_rationale === undefined ? null : String(r.owner_rationale),
    status: String(r.status) as VisualIterationStatus,
    createdAt: String(r.created_at),
    authorizedAt: r.authorized_at === null || r.authorized_at === undefined ? null : String(r.authorized_at),
    completedAt: r.completed_at === null || r.completed_at === undefined ? null : String(r.completed_at),
    lineage: {
      sourceWriterArtifactId: (r.source_writer_artifact_id as string | null) ?? null,
      sourceBrandArtifactId: (r.source_brand_artifact_id as string | null) ?? null,
      sourceReviewArtifactId: (r.source_review_artifact_id as string | null) ?? null,
      sourceDirectorArtifactId: (r.source_director_artifact_id as string | null) ?? null,
      sourceNarrationArtifactId: (r.source_narration_artifact_id as string | null) ?? null,
      sourceTimelineArtifactId: (r.source_timeline_artifact_id as string | null) ?? null,
      sourceVisualArtifactIds: strArray(r.source_visual_artifact_ids),
      sourceSemanticQaArtifactIds: strArray(r.source_semantic_qa_artifact_ids),
      sourceTechnicalQaArtifactIds: strArray(r.source_technical_qa_artifact_ids),
    },
    visualDirectionContractArtifactId: (r.visual_direction_contract_artifact_id as string | null) ?? null,
    sceneContractArtifactIds: strArray(r.scene_contract_artifact_ids),
    compiledPromptArtifactIds: strArray(r.compiled_prompt_artifact_ids),
    scenesToKeep: strArray(r.scenes_to_keep),
    scenesToRegenerate: strArray(r.scenes_to_regenerate),
    proposedImageBudget: Number(r.proposed_image_budget ?? 0),
    authorizedImageBudget: Number(r.authorized_image_budget ?? 0),
    usedImageBudget: Number(r.used_image_budget ?? 0),
    authorizationId: (r.authorization_id as string | null) ?? null,
    authorizationEvidence: r.authorization_evidence ?? null,
    promptOwnerGateApprovalId: (r.prompt_owner_gate_approval_id as string | null) ?? null,
    updatedAt: String(r.updated_at),
  };
}

export class VisualIterationStore {
  constructor(private readonly pool: pg.Pool) {}

  /** Exactly-once creation under a per-workflow advisory lock. Duplicate or
   *  concurrent requests observe the existing iteration (same source approval
   *  or same next number) instead of creating a second row. */
  async requestVisualIteration(input: RequestVisualIterationInput): Promise<{ created: boolean; iteration: VisualIterationRecord }> {
    if (!input.workflowId || !input.contentId || !input.sourceVisualApprovalId) {
      throw new Error("VISUAL_ITERATION_IDENTITY_REQUIRED");
    }
    if (input.ownerDecision !== "REQUEST_VISUAL_ITERATION" && input.ownerDecision !== "REQUEST_ITERATION") {
      throw new Error("VISUAL_ITERATION_OWNER_DECISION_REQUIRED");
    }
    if (!Number.isSafeInteger(input.proposedImageBudget) || input.proposedImageBudget < 0) {
      throw new Error("VISUAL_ITERATION_PROPOSED_BUDGET_INVALID");
    }
    const client = await this.pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtext($1))", [`visual-iteration:${input.workflowId}`]);
      try {
        const existingApproval = await client.query(`SELECT * FROM visual_iterations WHERE source_visual_approval_id=$1`, [input.sourceVisualApprovalId]);
        if (existingApproval.rowCount) return { created: false, iteration: row(existingApproval.rows[0]) };
        const maxRow = await client.query(`SELECT max(iteration_number)::int AS m FROM visual_iterations WHERE workflow_id=$1`, [input.workflowId]);
        const iterationNumber = Number(maxRow.rows[0]?.m ?? 0) + 1;
        const visualIterationId = `visual-iteration-${input.workflowId}-${iterationNumber}`;
        const now = new Date().toISOString();
        const inserted = await client.query(
          `INSERT INTO visual_iterations (visual_iteration_id, workflow_id, content_id, iteration_number, source_visual_approval_id, source_visual_gate_state, owner_decision, owner_rationale, status, created_at, updated_at, source_writer_artifact_id, source_brand_artifact_id, source_review_artifact_id, source_director_artifact_id, source_narration_artifact_id, source_timeline_artifact_id, source_visual_artifact_ids, source_semantic_qa_artifact_ids, source_technical_qa_artifact_ids, scenes_to_keep, scenes_to_regenerate, proposed_image_budget, provider_configuration_snapshot, build_identity_snapshot, human_gate_policy_snapshot)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'REQUESTED',$9,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
           ON CONFLICT DO NOTHING RETURNING *`,
          [visualIterationId, input.workflowId, input.contentId, iterationNumber, input.sourceVisualApprovalId, input.sourceVisualGateState,
            input.ownerDecision, input.ownerRationale, now,
            input.lineage.sourceWriterArtifactId ?? null, input.lineage.sourceBrandArtifactId ?? null, input.lineage.sourceReviewArtifactId ?? null,
            input.lineage.sourceDirectorArtifactId ?? null, input.lineage.sourceNarrationArtifactId ?? null, input.lineage.sourceTimelineArtifactId ?? null,
            JSON.stringify(input.lineage.sourceVisualArtifactIds ?? []), JSON.stringify(input.lineage.sourceSemanticQaArtifactIds ?? []), JSON.stringify(input.lineage.sourceTechnicalQaArtifactIds ?? []),
            JSON.stringify(input.scenesToKeep), JSON.stringify(input.scenesToRegenerate), input.proposedImageBudget,
            input.providerConfigurationSnapshot === undefined ? null : JSON.stringify(input.providerConfigurationSnapshot),
            input.buildIdentitySnapshot === undefined ? null : JSON.stringify(input.buildIdentitySnapshot),
            input.humanGatePolicySnapshot === undefined ? null : JSON.stringify(input.humanGatePolicySnapshot)],
        );
        if (inserted.rowCount) return { created: true, iteration: row(inserted.rows[0]) };
        const settled = await client.query(`SELECT * FROM visual_iterations WHERE source_visual_approval_id=$1`, [input.sourceVisualApprovalId]);
        if (!settled.rowCount) throw new Error("VISUAL_ITERATION_CREATION_RACE_UNRESOLVED");
        return { created: false, iteration: row(settled.rows[0]) };
      } finally {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [`visual-iteration:${input.workflowId}`]).catch(() => undefined);
      }
    } finally {
      client.release();
    }
  }

  async getById(visualIterationId: string): Promise<VisualIterationRecord | null> {
    const q = await this.pool.query(`SELECT * FROM visual_iterations WHERE visual_iteration_id=$1`, [visualIterationId]);
    return q.rowCount ? row(q.rows[0]) : null;
  }

  async getBySourceApproval(sourceVisualApprovalId: string): Promise<VisualIterationRecord | null> {
    const q = await this.pool.query(`SELECT * FROM visual_iterations WHERE source_visual_approval_id=$1`, [sourceVisualApprovalId]);
    return q.rowCount ? row(q.rows[0]) : null;
  }

  async listByWorkflow(workflowId: string): Promise<VisualIterationRecord[]> {
    const q = await this.pool.query(`SELECT * FROM visual_iterations WHERE workflow_id=$1 ORDER BY iteration_number`, [workflowId]);
    return q.rows.map(row);
  }

  private async transition(visualIterationId: string, to: VisualIterationStatus, patch: Record<string, unknown> = {}): Promise<VisualIterationRecord> {
    const current = await this.getById(visualIterationId);
    if (!current) throw new Error("VISUAL_ITERATION_NOT_FOUND");
    if (!(ALLOWED[current.status] ?? []).includes(to)) {
      throw new Error(`VISUAL_ITERATION_ILLEGAL_TRANSITION:${current.status}->${to}`);
    }
    const sets = Object.entries(patch).map(([k], i) => `${k}=$${i + 2}`).join(", ");
    const q = await this.pool.query(
      `UPDATE visual_iterations SET status=$1${sets ? `, ${sets}` : ""}, updated_at=$${Object.keys(patch).length + 2} WHERE visual_iteration_id=$${Object.keys(patch).length + 3} AND status=$${Object.keys(patch).length + 4} RETURNING *`,
      [to, ...Object.values(patch).map((v) => typeof v === "object" && v !== null ? JSON.stringify(v) : v), new Date().toISOString(), visualIterationId, current.status],
    );
    if (!q.rowCount) throw new Error("VISUAL_ITERATION_TRANSITION_RACE");
    return row(q.rows[0]);
  }

  /** REQUESTED -> CONTRACT_REQUIRED (contract preparation may begin). */
  async requireContract(visualIterationId: string): Promise<VisualIterationRecord> {
    return this.transition(visualIterationId, "CONTRACT_REQUIRED");
  }

  /** Attach prepared contract/preview artifacts. CONTRACT_REQUIRED -> CONTRACT_PREPARED. */
  async attachContracts(visualIterationId: string, input: { visualDirectionContractArtifactId: string; sceneContractArtifactIds: readonly string[]; compiledPromptArtifactIds: readonly string[] }): Promise<VisualIterationRecord> {
    if (!input.visualDirectionContractArtifactId) throw new Error("VISUAL_ITERATION_CONTRACT_ARTIFACT_REQUIRED");
    return this.transition(visualIterationId, "CONTRACT_PREPARED", {
      visual_direction_contract_artifact_id: input.visualDirectionContractArtifactId,
      scene_contract_artifact_ids: JSON.stringify([...input.sceneContractArtifactIds]),
      compiled_prompt_artifact_ids: JSON.stringify([...input.compiledPromptArtifactIds]),
    });
  }

  /** Record scene dispositions + proposed budget pre-authorization (keep vs regenerate). */
  async setScenes(visualIterationId: string, input: { scenesToKeep: readonly string[]; scenesToRegenerate: readonly string[]; proposedImageBudget?: number }): Promise<VisualIterationRecord> {
    const current = await this.getById(visualIterationId);
    if (!current) throw new Error("VISUAL_ITERATION_NOT_FOUND");
    if (TERMINAL.has(current.status) || current.status === "AUTHORIZED" || current.status === "GENERATING") {
      throw new Error(`VISUAL_ITERATION_SCENES_FROZEN:${current.status}`);
    }
    if (input.proposedImageBudget !== undefined && (!Number.isSafeInteger(input.proposedImageBudget) || input.proposedImageBudget < 0)) {
      throw new Error("VISUAL_ITERATION_PROPOSED_BUDGET_INVALID");
    }
    const now = new Date().toISOString();
    const q = input.proposedImageBudget !== undefined
      ? await this.pool.query(
        `UPDATE visual_iterations SET scenes_to_keep=$1, scenes_to_regenerate=$2, proposed_image_budget=$3, updated_at=$4 WHERE visual_iteration_id=$5 RETURNING *`,
        [JSON.stringify([...input.scenesToKeep]), JSON.stringify([...input.scenesToRegenerate]), input.proposedImageBudget, now, visualIterationId],
      )
      : await this.pool.query(
        `UPDATE visual_iterations SET scenes_to_keep=$1, scenes_to_regenerate=$2, updated_at=$3 WHERE visual_iteration_id=$4 RETURNING *`,
        [JSON.stringify([...input.scenesToKeep]), JSON.stringify([...input.scenesToRegenerate]), now, visualIterationId],
      );
    return row(q.rows[0]);
  }

  /** CONTRACT_PREPARED -> OWNER_REVIEW_REQUIRED (prompt gate PENDING, created separately). */
  async openPromptReview(visualIterationId: string, promptOwnerGateApprovalId: string): Promise<VisualIterationRecord> {
    if (!promptOwnerGateApprovalId) throw new Error("VISUAL_ITERATION_PROMPT_GATE_REQUIRED");
    return this.transition(visualIterationId, "OWNER_REVIEW_REQUIRED", { prompt_owner_gate_approval_id: promptOwnerGateApprovalId });
  }

  /**
   * OWNER_REVIEW_REQUIRED -> AUTHORIZED. Explicit owner action only:
   * requires authorizedBy 'owner', a DECIDED/APPROVE prompt-gate record
   * passed in by the caller, and a positive budget. Exactly once.
   * Proposed budget NEVER converts implicitly.
   */
  async authorizeGeneration(visualIterationId: string, input: { authorizedBy: string; imageBudget: number; promptApproval: { status: string; ownerDecision: string | null } | null; authorizationId?: string }): Promise<VisualIterationRecord> {
    assertRecoveryHorizon("VISUAL_ITERATION", null, ["research", "planner-synthesis", "writer", "scenes", "visual-prompt"], ["visual-generation"]);
    if (input.authorizedBy !== "owner") throw new Error("VISUAL_ITERATION_NOT_OWNER_AUTHORIZED");
    if (!input.promptApproval || input.promptApproval.status !== "DECIDED" || input.promptApproval.ownerDecision !== "APPROVE") {
      throw new Error("VISUAL_ITERATION_PROMPT_APPROVAL_REQUIRED");
    }
    if (!Number.isSafeInteger(input.imageBudget) || input.imageBudget <= 0) throw new Error("VISUAL_ITERATION_BUDGET_INVALID");
    const now = new Date().toISOString();
    return this.transition(visualIterationId, "AUTHORIZED", {
      authorized_image_budget: input.imageBudget,
      authorized_at: now,
      authorization_id: input.authorizationId ?? `visual-iteration-auth-${visualIterationId}`,
      authorization_evidence: JSON.stringify({ authorizedBy: input.authorizedBy, imageBudget: input.imageBudget, promptApproval: input.promptApproval, authorizedAt: now }),
    });
  }

  /** AUTHORIZED -> GENERATING. */
  async beginGeneration(visualIterationId: string): Promise<VisualIterationRecord> {
    return this.transition(visualIterationId, "GENERATING");
  }

  /** GENERATING -> QA_REQUIRED (records consumed budget; must not exceed authorized). */
  async completeGeneration(visualIterationId: string, usedImageBudget: number): Promise<VisualIterationRecord> {
    const current = await this.getById(visualIterationId);
    if (!current) throw new Error("VISUAL_ITERATION_NOT_FOUND");
    if (!Number.isSafeInteger(usedImageBudget) || usedImageBudget < 0 || usedImageBudget > current.authorizedImageBudget) {
      throw new Error("VISUAL_ITERATION_USED_BUDGET_INVALID");
    }
    return this.transition(visualIterationId, "QA_REQUIRED", { used_image_budget: usedImageBudget });
  }

  /** QA_REQUIRED -> VISUAL_HUMAN_REVIEW_REQUIRED. */
  async openVisualReview(visualIterationId: string): Promise<VisualIterationRecord> {
    return this.transition(visualIterationId, "VISUAL_HUMAN_REVIEW_REQUIRED");
  }

  /** VISUAL_HUMAN_REVIEW_REQUIRED -> COMPLETED (requires DECIDED/APPROVE visual record passed in). */
  async completeIteration(visualIterationId: string, visualApproval: { status: string; ownerDecision: string | null } | null): Promise<VisualIterationRecord> {
    if (!visualApproval || visualApproval.status !== "DECIDED" || visualApproval.ownerDecision !== "APPROVE") {
      throw new Error("VISUAL_ITERATION_VISUAL_APPROVAL_REQUIRED");
    }
    return this.transition(visualIterationId, "COMPLETED", { completed_at: new Date().toISOString() });
  }

  /** Settle non-terminal iterations as REJECTED/FAILED/CANCELLED with no side effects. */
  async settle(visualIterationId: string, outcome: "REJECTED" | "FAILED" | "CANCELLED"): Promise<VisualIterationRecord> {
    return this.transition(visualIterationId, outcome);
  }
}
