/**
 * Program 3 Content Factory V2 — subject/character identity graph + scenes.
 *
 * Subjects are metadata-only rows; image bytes stay in canonical artifacts
 * and are referenced by artifact ID (never duplicated, never silently
 * replaced). Scene specs bind scenes to canonical subjects with explicit
 * generation intent. Nothing here generates media, grants authority, or
 * starts execution.
 */

export interface SubjectProfile {
  subjectId: string; projectId: string; name: string; subjectType: string;
  description: string; traits: Record<string, unknown>; wardrobe: Record<string, unknown>;
  negatives: string[]; styleContext: string | null; voiceId: string | null;
  status: "DRAFT" | "APPROVED" | "RETIRED";
  approvedBy: string | null; approvedAt: string | null; approvalRationale: string | null;
  supersedes: string | null; createdAt: string; updatedAt: string;
}

export interface ReferenceAsset {
  referenceId: string; subjectId: string; projectId: string; artifactId: string;
  referenceKind: string; approved: boolean;
  approvedBy: string | null; approvedAt: string | null; createdAt: string;
}

export type ReferenceKind =
  | "front_portrait" | "three_quarter" | "side_profile" | "full_body"
  | "expression" | "wardrobe" | "style";
export const REFERENCE_KINDS: readonly string[] = [
  "front_portrait", "three_quarter", "side_profile", "full_body",
  "expression", "wardrobe", "style",
];

export interface SceneSubjectBinding {
  readonly subjectId: string;
  readonly pose?: string | null;
  readonly expression?: string | null;
  readonly wardrobeRef?: string | null;
  readonly framingNote?: string | null;
}

export interface SceneSpec {
  sceneId: string; contentId: string; projectId: string; sequence: number;
  durationMs: number | null; purpose: string | null; scriptRef: string | null;
  visual: string | null; subjects: SceneSubjectBinding[]; environment: string | null;
  shot: string | null; cameraAngle: string | null; movement: string | null;
  continuity: string[]; references: string[]; intent: Record<string, unknown>;
  audioRef: string | null; status: string; createdAt: string; updatedAt: string;
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const tryParse = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return v; }
};

const asRecord = (v: unknown): Record<string, unknown> => {
  const p = tryParse(v);
  return (typeof p === "object" && p !== null && !Array.isArray(p) ? p as Record<string, unknown> : {});
};
const asStrings = (v: unknown): string[] => {
  const p = tryParse(v);
  return (Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : []);
};

const subjectRow = (r: any): SubjectProfile => ({
  subjectId: r.subject_id, projectId: r.project_id, name: r.name, subjectType: r.subject_type,
  description: r.description, traits: asRecord(r.traits),
  wardrobe: asRecord(r.wardrobe),
  negatives: asStrings(r.negatives),
  styleContext: r.style_context ?? null, voiceId: r.voice_id ?? null,
  status: r.status, approvedBy: r.approved_by ?? null, approvedAt: r.approved_at ?? null,
  approvalRationale: r.approval_rationale ?? null, supersedes: r.supersedes ?? null,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const refRow = (r: any): ReferenceAsset => ({
  referenceId: r.reference_id, subjectId: r.subject_id, projectId: r.project_id,
  artifactId: r.artifact_id, referenceKind: r.reference_kind,
  approved: Number(r.approved) === 1, approvedBy: r.approved_by ?? null,
  approvedAt: r.approved_at ?? null, createdAt: r.created_at,
});

const asBindings = (v: unknown): SceneSubjectBinding[] => {
  const raw = typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v;
  if (!Array.isArray(raw)) return [];
  return raw.filter((b): b is SceneSubjectBinding =>
    typeof b === "object" && b !== null && typeof (b as Record<string, unknown>).subjectId === "string");
};

const sceneRow = (r: any): SceneSpec => ({
  sceneId: r.scene_id, contentId: r.content_id, projectId: r.project_id,
  sequence: Number(r.sequence), durationMs: r.duration_ms ?? null,
  purpose: r.purpose ?? null, scriptRef: r.script_ref ?? null, visual: r.visual ?? null,
  subjects: asBindings(r.subjects),
  environment: r.environment ?? null, shot: r.shot ?? null, cameraAngle: r.camera_angle ?? null,
  movement: r.movement ?? null,
  continuity: asStrings(r.continuity),
  references: asStrings(r.reference_ids),
  intent: asRecord(r.intent),
  audioRef: r.audio_ref ?? null, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
});

export class SubjectStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly pool: any) {}

  async createSubject(input: {
    projectId: string; name: string; subjectType?: string; description: string;
    traits?: Record<string, unknown>; wardrobe?: Record<string, unknown>;
    negatives?: string[]; styleContext?: string | null; voiceId?: string | null;
    supersedes?: string | null;
  }): Promise<SubjectProfile> {
    if (!input.projectId) throw new Error("SUBJECT_PROJECT_REQUIRED");
    if (!input.name.trim()) throw new Error("SUBJECT_NAME_REQUIRED");
    if (!input.description.trim()) throw new Error("SUBJECT_DESCRIPTION_REQUIRED");
    const now = new Date().toISOString();
    const id = generateId("subject");
    await this.pool.query(
      `INSERT INTO subject_profiles (subject_id,project_id,name,subject_type,description,traits,wardrobe,negatives,style_context,voice_id,status,supersedes,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'DRAFT',$11,$12,$12)`,
      [id, input.projectId, input.name.trim(), input.subjectType ?? "person",
        input.description.trim(), JSON.stringify(input.traits ?? {}),
        JSON.stringify(input.wardrobe ?? {}), JSON.stringify(input.negatives ?? []),
        input.styleContext ?? null, input.voiceId ?? null, input.supersedes ?? null, now]);
    const created = await this.getSubject(id);
    if (!created) throw new Error("SUBJECT_PERSISTENCE_FAILED");
    return created;
  }

  async getSubject(subjectId: string): Promise<SubjectProfile | null> {
    const q = await this.pool.query(`SELECT * FROM subject_profiles WHERE subject_id=$1`, [subjectId]);
    return q.rowCount ? subjectRow(q.rows[0]) : null;
  }

  async listSubjects(projectId: string, limit = 100): Promise<SubjectProfile[]> {
    const n = Math.min(Math.max(limit, 1), 200);
    const q = await this.pool.query(
      `SELECT * FROM subject_profiles WHERE project_id=$1 ORDER BY created_at DESC LIMIT ${n}`, [projectId]);
    return q.rows.map(subjectRow);
  }

  /** Owner approval of a subject profile. Recorded, never rewrites history. */
  async approveSubject(subjectId: string, approvedBy: string, rationale: string): Promise<SubjectProfile | null> {
    if (!rationale.trim()) throw new Error("SUBJECT_APPROVAL_RATIONALE_REQUIRED");
    const now = new Date().toISOString();
    await this.pool.query(
      `UPDATE subject_profiles SET status='APPROVED',approved_by=$2,approved_at=$3,approval_rationale=$4,updated_at=$3
       WHERE subject_id=$1 AND status='DRAFT'`,
      [subjectId, approvedBy, now, rationale.trim()]);
    return this.getSubject(subjectId);
  }

  /** Attach an existing canonical artifact as a reference. Never duplicates bytes. */
  async attachReference(input: {
    subjectId: string; projectId: string; artifactId: string; referenceKind: string;
  }): Promise<ReferenceAsset> {
    if (!REFERENCE_KINDS.includes(input.referenceKind)) throw new Error("SUBJECT_REFERENCE_KIND_INVALID");
    const subject = await this.getSubject(input.subjectId);
    if (!subject || subject.projectId !== input.projectId) throw new Error("SUBJECT_NOT_FOUND");
    const id = generateId("ref");
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO subject_reference_assets (reference_id,subject_id,project_id,artifact_id,reference_kind,approved,created_at)
       VALUES ($1,$2,$3,$4,$5,0,$6) ON CONFLICT (subject_id,artifact_id,reference_kind) DO NOTHING`,
      [id, input.subjectId, input.projectId, input.artifactId, input.referenceKind, now]);
    const q = await this.pool.query(
      `SELECT * FROM subject_reference_assets WHERE subject_id=$1 AND artifact_id=$2 AND reference_kind=$3`,
      [input.subjectId, input.artifactId, input.referenceKind]);
    if (!q.rowCount) throw new Error("SUBJECT_REFERENCE_PERSISTENCE_FAILED");
    return refRow(q.rows[0]);
  }

  async approveReference(referenceId: string, approvedBy: string): Promise<ReferenceAsset | null> {
    const now = new Date().toISOString();
    await this.pool.query(
      `UPDATE subject_reference_assets SET approved=1,approved_by=$2,approved_at=$3 WHERE reference_id=$1`,
      [referenceId, approvedBy, now]);
    const q = await this.pool.query(`SELECT * FROM subject_reference_assets WHERE reference_id=$1`, [referenceId]);
    return q.rowCount ? refRow(q.rows[0]) : null;
  }

  async listReferences(subjectId: string): Promise<ReferenceAsset[]> {
    const q = await this.pool.query(
      `SELECT * FROM subject_reference_assets WHERE subject_id=$1 ORDER BY created_at`, [subjectId]);
    return q.rows.map(refRow);
  }

  /** Idempotent scene upsert by (content, scene). Never downgrades intent silently. */
  async saveScene(input: {
    sceneId: string; contentId: string; projectId: string; sequence: number;
    durationMs?: number | null; purpose?: string | null; scriptRef?: string | null;
    visual?: string | null; subjects?: SceneSubjectBinding[]; environment?: string | null;
    shot?: string | null; cameraAngle?: string | null; movement?: string | null;
    continuity?: string[]; references?: string[]; intent?: Record<string, unknown>;
    audioRef?: string | null; status?: string;
  }): Promise<SceneSpec> {
    if (!input.sceneId.trim() || !input.contentId) throw new Error("SCENE_IDENTITY_REQUIRED");
    for (const b of input.subjects ?? []) {
      if (!b.subjectId) throw new Error("SCENE_SUBJECT_ID_REQUIRED");
    }
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO scene_specs (scene_id,content_id,project_id,sequence,duration_ms,purpose,script_ref,visual,subjects,environment,shot,camera_angle,movement,continuity,reference_ids,intent,audio_ref,status,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)
       ON CONFLICT (content_id,scene_id) DO UPDATE SET sequence=$4,duration_ms=$5,purpose=$6,script_ref=$7,visual=$8,subjects=$9,environment=$10,shot=$11,camera_angle=$12,movement=$13,continuity=$14,reference_ids=$15,intent=$16,audio_ref=$17,status=$18,updated_at=$19`,
      [input.sceneId, input.contentId, input.projectId, input.sequence, input.durationMs ?? null,
        input.purpose ?? null, input.scriptRef ?? null, input.visual ?? null,
        JSON.stringify(input.subjects ?? []), input.environment ?? null, input.shot ?? null,
        input.cameraAngle ?? null, input.movement ?? null, JSON.stringify(input.continuity ?? []),
        JSON.stringify(input.references ?? []), JSON.stringify(input.intent ?? {}),
        input.audioRef ?? null, input.status ?? "PLANNED", now]);
    const q = await this.pool.query(
      `SELECT * FROM scene_specs WHERE content_id=$1 AND scene_id=$2`, [input.contentId, input.sceneId]);
    if (!q.rowCount) throw new Error("SCENE_PERSISTENCE_FAILED");
    return sceneRow(q.rows[0]);
  }

  async listScenes(contentId: string): Promise<SceneSpec[]> {
    const q = await this.pool.query(
      `SELECT * FROM scene_specs WHERE content_id=$1 ORDER BY sequence`, [contentId]);
    return q.rows.map(sceneRow);
  }
}
