/**
 * Program 2 Workstream A — canonical content domain (business objects).
 *
 * A content item is the Owner-facing identity for one Morroway Short.
 * It references canonical truth (workflows, artifacts, approvals,
 * publications, learning) but never duplicates it. Status is DERIVED
 * honestly from the linked lifecycle plus learning-chain presence.
 * No execution, no approvals, no authority changes happen here.
 */

export type ContentStatus =
  | "IDEA" | "PLANNING" | "SCRIPTING" | "PRODUCTION" | "QA"
  | "AWAITING_APPROVAL" | "READY_TO_PUBLISH" | "PUBLISHED"
  | "MEASURING" | "LEARNING" | "COMPLETED" | "FAILED";

export interface ContentItem {
  contentId: string; projectId: string; channel: string; format: string;
  title: string; objective: string; topic: string | null; notes: string | null;
  constraints: string | null; seedArtifactId: string | null;
  workflowId: string | null; experimentId: string | null;
  productionBrief: Record<string, unknown>; publicationMetadata: Record<string, unknown>;
  finalReviewStatus: string; canonicalFinalArtifactId: string | null;
  createdAt: string; updatedAt: string;
}

export interface ContentStatusInput {
  readonly workflowLinked: boolean;
  readonly overallState: string | null;
  readonly currentPhaseId: string | null;
  readonly publicStatus: string | null;
  readonly hasObservation: boolean;
  readonly hasLearning: boolean;
  readonly hasProposal: boolean;
}

/** Deterministic Owner-facing status from canonical signals. Fail honest. */
export function deriveContentStatus(input: ContentStatusInput): { status: ContentStatus; detail: string } {
  if (!input.workflowLinked) {
    return { status: "IDEA", detail: "Idea captured; production planning has not started." };
  }
  const state = input.overallState;
  if (state === "NEEDS_OWNER_ATTENTION") {
    return { status: "AWAITING_APPROVAL", detail: "The linked run needs an Owner decision in Decision Center." };
  }
  if (state === "FAILED_TERMINAL" || state === "BLOCKED" || state === "STATE_CONFLICT") {
    return { status: "FAILED", detail: "The linked run did not complete; inspect history for the honest reason." };
  }
  if (state === "IN_PROGRESS" || state === "RUNNING") {
    const phase = input.currentPhaseId || "";
    if (phase === "plan" || phase === "research") return { status: "PLANNING", detail: "Planning and research are running." };
    if (phase === "create") return { status: "SCRIPTING", detail: "Brief and script work are running." };
    if (phase === "media") return { status: "PRODUCTION", detail: "Media production is running." };
    if (phase === "review" || phase === "final-review" || phase === "publication") {
      return { status: "QA", detail: "Review and quality checks are running." };
    }
    if (phase === "analytics") return { status: "MEASURING", detail: "Analytics stage is running." };
    return { status: "PRODUCTION", detail: "Governed work is running." };
  }
  if (state === "MEDIA_COMPLETED") {
    return { status: "QA", detail: "Media is complete; validation and review continue." };
  }
  if (input.publicStatus === "PUBLISHED") {
    if (input.hasProposal) return { status: "COMPLETED", detail: "Published; learning produced a next-cycle proposal." };
    if (input.hasLearning || input.hasObservation) return { status: "LEARNING", detail: "Published; performance learning is accumulating." };
    return { status: "MEASURING", detail: "Published; awaiting measurement." };
  }
  if (state === "VALIDATION_COMPLETED" || state === "COMPLETED") {
    return { status: "READY_TO_PUBLISH", detail: "Validation complete; publication needs a separate Owner decision." };
  }
  return { status: "PLANNING", detail: "Linked run state is not yet classifiable; inspect the workflow." };
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const row = (r: any): ContentItem => ({
  contentId: r.content_id, projectId: r.project_id, channel: r.channel ?? "youtube",
  format: r.format ?? "short", title: r.title, objective: r.objective,
  topic: r.topic ?? null, notes: r.notes ?? null, constraints: r.constraints ?? null,
  seedArtifactId: r.seed_artifact_id ?? null, workflowId: r.workflow_id ?? null,
  experimentId: r.experiment_id ?? null,
  productionBrief: typeof r.production_brief === "string" ? JSON.parse(r.production_brief) : (r.production_brief ?? {}),
  publicationMetadata: typeof r.publication_metadata === "string" ? JSON.parse(r.publication_metadata) : (r.publication_metadata ?? {}),
  finalReviewStatus: r.final_review_status ?? "PENDING",
  canonicalFinalArtifactId: r.canonical_final_artifact_id ?? null,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

export interface CreateContentInput {
  readonly projectId: string; readonly title: string; readonly objective: string;
  readonly channel?: string; readonly format?: string;
  readonly topic?: string | null; readonly notes?: string | null;
  readonly constraints?: string | null; readonly seedArtifactId?: string | null;
  readonly experimentId?: string | null;
  readonly productionBrief?: Record<string, unknown>;
  readonly publicationMetadata?: Record<string, unknown>;
}

export class ContentStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly pool: any) {}

  async createContent(input: CreateContentInput): Promise<ContentItem> {
    if (!input.projectId) throw new Error("CONTENT_PROJECT_REQUIRED");
    if (!input.title.trim()) throw new Error("CONTENT_TITLE_REQUIRED");
    if (!input.objective.trim()) throw new Error("CONTENT_OBJECTIVE_REQUIRED");
    const now = new Date().toISOString();
    const id = generateId("content");
    await this.pool.query(
      `INSERT INTO content_items (content_id,project_id,channel,format,title,objective,topic,notes,constraints,seed_artifact_id,workflow_id,experiment_id,production_brief,publication_metadata,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,$11,$12,$13,$14,$14)`,
      [id, input.projectId, input.channel ?? "youtube", input.format ?? "short",
        input.title.trim(), input.objective.trim(), input.topic?.trim() || null,
        input.notes?.trim() || null, input.constraints?.trim() || null,
        input.seedArtifactId ?? null, input.experimentId ?? null,
        JSON.stringify(input.productionBrief ?? {}), JSON.stringify(input.publicationMetadata ?? {}), now]);
    const created = await this.getContent(id);
    if (!created) throw new Error("CONTENT_PERSISTENCE_FAILED");
    return created;
  }

  async getContent(contentId: string): Promise<ContentItem | null> {
    const q = await this.pool.query(`SELECT * FROM content_items WHERE content_id=$1`, [contentId]);
    return q.rowCount ? row(q.rows[0]) : null;
  }

  async listContent(projectId: string, limit = 100): Promise<ContentItem[]> {
    const n = Math.min(Math.max(limit, 1), 200);
    const q = await this.pool.query(
      `SELECT * FROM content_items WHERE project_id=$1 ORDER BY created_at DESC LIMIT ${n}`, [projectId]);
    return q.rows.map(row);
  }

  /** Link existing canonical records. Never starts execution, never mutates the linked records. */
  async linkRecords(contentId: string, input: {
    workflowId?: string | null; seedArtifactId?: string | null; experimentId?: string | null;
  }): Promise<ContentItem | null> {
    const current = await this.getContent(contentId);
    if (!current) return null;
    const now = new Date().toISOString();
    await this.pool.query(
      `UPDATE content_items SET workflow_id=COALESCE($2,workflow_id),
        seed_artifact_id=COALESCE($3,seed_artifact_id),
        experiment_id=COALESCE($4,experiment_id), updated_at=$5 WHERE content_id=$1`,
      [contentId, input.workflowId ?? null, input.seedArtifactId ?? null, input.experimentId ?? null, now]);
    return this.getContent(contentId);
  }

  async updateProductionBrief(contentId: string, brief: Record<string, unknown>): Promise<ContentItem | null> {
    await this.pool.query(`UPDATE content_items SET production_brief=$2,updated_at=$3 WHERE content_id=$1`, [contentId, JSON.stringify(brief), new Date().toISOString()]);
    return this.getContent(contentId);
  }

  async updatePublicationMetadata(contentId: string, metadata: Record<string, unknown>): Promise<ContentItem | null> {
    await this.pool.query(`UPDATE content_items SET publication_metadata=$2,updated_at=$3 WHERE content_id=$1`, [contentId, JSON.stringify(metadata), new Date().toISOString()]);
    return this.getContent(contentId);
  }

  async createRevision(input: { contentId:string; projectId:string; workflowId:string|null; layer:string; targetArtifactId?:string|null; previousArtifactId?:string|null; ownerFeedback:string; reason:string; resultingAction:string }): Promise<Record<string, unknown>> {
    const now=new Date().toISOString(), id=generateId("revision");
    const q=await this.pool.query(`INSERT INTO content_revision_requests (revision_id,content_id,project_id,workflow_id,layer,target_artifact_id,previous_artifact_id,owner_feedback,reason,resulting_action,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'REQUESTED',$11,$11) RETURNING *`,[id,input.contentId,input.projectId,input.workflowId,input.layer,input.targetArtifactId??null,input.previousArtifactId??null,input.ownerFeedback,input.reason,input.resultingAction,now]);
    return q.rows[0];
  }

  async listRevisions(contentId:string):Promise<Record<string,unknown>[]> { const q=await this.pool.query(`SELECT * FROM content_revision_requests WHERE content_id=$1 ORDER BY created_at DESC`,[contentId]); return q.rows; }

  async recordVisualReview(input:{contentId:string;projectId:string;workflowId:string|null;artifactId:string;sceneId?:string|null;technicalQa:Record<string,unknown>;semanticQa:string;semanticNotes?:string|null;ownerAcceptance?:string;ownerFeedback?:string|null}):Promise<Record<string,unknown>>{
    const now=new Date().toISOString(), id=generateId("visual-review");
    const q=await this.pool.query(`INSERT INTO content_visual_quality_reviews (review_id,content_id,project_id,workflow_id,artifact_id,scene_id,technical_qa,semantic_qa,semantic_notes,owner_acceptance,owner_feedback,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) ON CONFLICT (content_id,artifact_id) DO UPDATE SET technical_qa=EXCLUDED.technical_qa,semantic_qa=EXCLUDED.semantic_qa,semantic_notes=EXCLUDED.semantic_notes,owner_acceptance=EXCLUDED.owner_acceptance,owner_feedback=EXCLUDED.owner_feedback,updated_at=EXCLUDED.updated_at RETURNING *`,[id,input.contentId,input.projectId,input.workflowId,input.artifactId,input.sceneId??null,JSON.stringify(input.technicalQa),input.semanticQa,input.semanticNotes??null,input.ownerAcceptance??"PENDING",input.ownerFeedback??null,now]);
    return q.rows[0];
  }

  async listVisualReviews(contentId:string):Promise<Record<string,unknown>[]> { const q=await this.pool.query(`SELECT * FROM content_visual_quality_reviews WHERE content_id=$1 ORDER BY created_at DESC`,[contentId]); return q.rows; }

  async approveFinal(input:{contentId:string;projectId:string;workflowId:string|null;finalArtifactId:string;rationale:string}):Promise<Record<string,unknown>>{
    const now=new Date().toISOString(), id=generateId("content-decision");
    const q=await this.pool.query(`INSERT INTO content_review_decisions (decision_id,content_id,project_id,workflow_id,decision,rationale,final_artifact_id,created_at) VALUES ($1,$2,$3,$4,'APPROVE',$5,$6,$7) RETURNING *`,[id,input.contentId,input.projectId,input.workflowId,input.rationale,input.finalArtifactId,now]);
    await this.pool.query(`UPDATE content_items SET final_review_status='APPROVED',canonical_final_artifact_id=$2,updated_at=$3 WHERE content_id=$1`,[input.contentId,input.finalArtifactId,now]);
    return q.rows[0];
  }

  async listReviewDecisions(contentId:string):Promise<Record<string,unknown>[]> { const q=await this.pool.query(`SELECT * FROM content_review_decisions WHERE content_id=$1 ORDER BY created_at DESC`,[contentId]); return q.rows; }

  async preparePublication(input:{idempotencyKey:string;contentId:string;projectId:string;workflowId:string;channelId:string;bindingId?:string|null;artifactId:string;visibility:string;metadata:Record<string,unknown>;routeState:string;authorizationApprovalId?:string|null}):Promise<Record<string,unknown>>{
    const now=new Date().toISOString(), id=generateId("publication-prep");
    await this.pool.query(`INSERT INTO publication_preparations (preparation_id,idempotency_key,content_id,project_id,workflow_id,channel_id,binding_id,artifact_id,visibility,metadata,route_state,status,authorization_approval_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'AWAITING_AUTHORIZATION',$12,$13,$13) ON CONFLICT (idempotency_key) DO NOTHING`,[id,input.idempotencyKey,input.contentId,input.projectId,input.workflowId,input.channelId,input.bindingId??null,input.artifactId,input.visibility,JSON.stringify(input.metadata),input.routeState,input.authorizationApprovalId??null,now]);
    const q=await this.pool.query(`SELECT * FROM publication_preparations WHERE idempotency_key=$1`,[input.idempotencyKey]); return q.rows[0];
  }

  async listPublicationPreparations(contentId:string):Promise<Record<string,unknown>[]> { const q=await this.pool.query(`SELECT * FROM publication_preparations WHERE content_id=$1 ORDER BY created_at DESC`,[contentId]); return q.rows; }
}
