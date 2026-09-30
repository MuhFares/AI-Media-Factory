import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type pg from "pg";
import { probeVideoFile } from "@ai-media-factory/tool-framework";

export const AUDITED_VIDEO_OUTPUT_IMPORT_CONFIRMATION = "program-04-audited-video-output-import-v1";
export const AUDITED_VIDEO_RECOVERY_STATUS = "RECOVERED_FROM_OWNER_VERIFIED_EXTERNAL_OUTPUT" as const;
export const OWNER_ATTESTED_PROVIDER_PROOF = "OWNER_ATTESTED_NOT_PROVIDER_VERIFIED" as const;
export const VERIFIED_LOCAL_OUTPUT_PROOF = "VERIFIED" as const;

export interface AuditedVideoOutputImportInput {
  videoExecutionId: string;
  filePath: string;
  expectedProjectId: string;
  expectedContentId: string;
  expectedWorkflowId: string;
  expectedSceneId: string;
  expectedSourceVisualArtifactId: string;
  expectedSourceVisualSha256: string;
  ownerSuppliedProviderJobId: string;
  ownerAuthorizationRef: string;
  ambiguityAcknowledgement: typeof OWNER_ATTESTED_PROVIDER_PROOF;
}

export interface LocalVideoTechnicalProof {
  path: string;
  bytes: number;
  sha256: string;
  width: number;
  height: number;
  durationMs: number;
  codec: string;
  container: "mp4";
}

export interface HistoricalVideoImportSource {
  workflowId: string;
  correlationId: string;
  projectId: string;
  contentId: string;
  sceneId: string;
  videoExecutionId: string;
  sourceVisualArtifactId: string;
  sourceVisualSha256: string;
  provider: string;
  model: string;
  providerJobId: string;
  configurationFingerprint: string;
  width: number;
  height: number;
  frameCount: number;
  steps: number;
  cfg: number;
  originalSubmissionCount: number;
  originalState: "RECONCILIATION_REQUIRED";
  videoBudgetLimit: number;
  videoBudgetUsed: number;
}

export interface AuditedVideoOutputImportReceipt {
  importExecutionId: string;
  artifactId: string;
  outcome: "IMPORTED" | "ALREADY_IMPORTED";
  recoveryStatus: typeof AUDITED_VIDEO_RECOVERY_STATUS;
  providerIdentityProof: typeof OWNER_ATTESTED_PROVIDER_PROOF;
  localOutputTechnicalProof: typeof VERIFIED_LOCAL_OUTPUT_PROOF;
  videoBudgetAdditionalConsumption: 0;
  technical: LocalVideoTechnicalProof;
}

export type LocalVideoInspector = (path: string) => Promise<LocalVideoTechnicalProof>;

const required = (name: string, value: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`AUDITED_VIDEO_IMPORT_REQUIRED:${name}`);
  return normalized;
};

export function importIdentity(videoExecutionId: string): { importExecutionId: string; artifactId: string } {
  const digest = createHash("sha256").update(required("videoExecutionId", videoExecutionId)).digest("hex").slice(0, 24);
  return { importExecutionId: `video-output-import-${digest}`, artifactId: `art-scene-video-import-${digest}` };
}

export function validateAuditedVideoOutputImport(
  input: AuditedVideoOutputImportInput,
  source: HistoricalVideoImportSource,
  technical: LocalVideoTechnicalProof,
): Omit<AuditedVideoOutputImportReceipt, "outcome"> {
  required("filePath", input.filePath);
  required("expectedProjectId", input.expectedProjectId);
  required("expectedContentId", input.expectedContentId);
  required("expectedWorkflowId", input.expectedWorkflowId);
  required("expectedSceneId", input.expectedSceneId);
  required("expectedSourceVisualArtifactId", input.expectedSourceVisualArtifactId);
  required("expectedSourceVisualSha256", input.expectedSourceVisualSha256);
  required("ownerSuppliedProviderJobId", input.ownerSuppliedProviderJobId);
  required("ownerAuthorizationRef", input.ownerAuthorizationRef);
  if (input.ambiguityAcknowledgement !== OWNER_ATTESTED_PROVIDER_PROOF) throw new Error("AUDITED_VIDEO_IMPORT_AMBIGUITY_ACK_REQUIRED");
  if (source.videoExecutionId !== input.videoExecutionId) throw new Error("AUDITED_VIDEO_IMPORT_EXECUTION_MISMATCH");
  if (source.projectId !== input.expectedProjectId || source.contentId !== input.expectedContentId || source.workflowId !== input.expectedWorkflowId || source.sceneId !== input.expectedSceneId) {
    throw new Error("AUDITED_VIDEO_IMPORT_WORKFLOW_CONTENT_MISMATCH");
  }
  if (source.sourceVisualArtifactId !== input.expectedSourceVisualArtifactId) throw new Error("AUDITED_VIDEO_IMPORT_SOURCE_ARTIFACT_MISMATCH");
  if (source.sourceVisualSha256.toLowerCase() !== input.expectedSourceVisualSha256.toLowerCase()) throw new Error("AUDITED_VIDEO_IMPORT_SOURCE_HASH_MISMATCH");
  if (source.provider !== "self-hosted-video" || source.model !== "wan2.2") throw new Error("AUDITED_VIDEO_IMPORT_PROVIDER_MODEL_MISMATCH");
  if (source.width !== 480 || source.height !== 832 || source.frameCount !== 81 || source.steps !== 10 || source.cfg !== 2 || !source.configurationFingerprint.trim()) {
    throw new Error("AUDITED_VIDEO_IMPORT_FROZEN_CONFIG_MISMATCH");
  }
  if (source.originalState !== "RECONCILIATION_REQUIRED") throw new Error("AUDITED_VIDEO_IMPORT_SOURCE_STATE_INVALID");
  if (source.originalSubmissionCount !== 1) throw new Error("AUDITED_VIDEO_IMPORT_SUBMISSION_COUNT_INVALID");
  if (source.videoBudgetUsed !== 1 || source.videoBudgetLimit !== 3) throw new Error("AUDITED_VIDEO_IMPORT_BUDGET_HISTORY_INVALID");
  if (technical.bytes <= 0 || technical.durationMs <= 0 || technical.width <= 0 || technical.height <= 0 || !technical.codec.trim()) throw new Error("AUDITED_VIDEO_IMPORT_TECHNICAL_PROOF_INVALID");
  if (!/^[a-f0-9]{64}$/iu.test(technical.sha256)) throw new Error("AUDITED_VIDEO_IMPORT_OUTPUT_HASH_INVALID");
  if (technical.container !== "mp4") throw new Error("AUDITED_VIDEO_IMPORT_CONTAINER_INVALID");
  if (technical.width !== source.width || technical.height !== source.height) throw new Error("AUDITED_VIDEO_IMPORT_DIMENSIONS_MISMATCH");
  const ids = importIdentity(input.videoExecutionId);
  return {
    ...ids,
    recoveryStatus: AUDITED_VIDEO_RECOVERY_STATUS,
    providerIdentityProof: OWNER_ATTESTED_PROVIDER_PROOF,
    localOutputTechnicalProof: VERIFIED_LOCAL_OUTPUT_PROOF,
    videoBudgetAdditionalConsumption: 0,
    technical,
  };
}

/** Provider-free reference ledger used to certify replay and conflict rules. */
export class InMemoryAuditedVideoOutputImportLedger {
  private readonly imports = new Map<string, AuditedVideoOutputImportReceipt>();

  import(input: AuditedVideoOutputImportInput, source: HistoricalVideoImportSource, technical: LocalVideoTechnicalProof): AuditedVideoOutputImportReceipt {
    const planned = validateAuditedVideoOutputImport(input, source, technical);
    const prior = this.imports.get(input.videoExecutionId);
    if (prior) {
      if (prior.artifactId !== planned.artifactId || prior.technical.sha256 !== technical.sha256) throw new Error("AUDITED_VIDEO_IMPORT_IDEMPOTENCY_CONFLICT");
      return { ...prior, outcome: "ALREADY_IMPORTED" };
    }
    const receipt: AuditedVideoOutputImportReceipt = { ...planned, outcome: "IMPORTED" };
    this.imports.set(input.videoExecutionId, receipt);
    return receipt;
  }
}

export async function inspectLocalMp4(path: string, ffprobeBin: string): Promise<LocalVideoTechnicalProof> {
  const absolute = resolve(required("filePath", path));
  if (extname(absolute).toLowerCase() !== ".mp4") throw new Error("AUDITED_VIDEO_IMPORT_MP4_REQUIRED");
  const info = await stat(absolute);
  if (!info.isFile() || info.size <= 0) throw new Error("AUDITED_VIDEO_IMPORT_FILE_INVALID");
  const bytes = await readFile(absolute);
  const probe = await probeVideoFile(absolute, { ffprobeBin, timeoutMs: 30_000 });
  return {
    path: absolute,
    bytes: info.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    width: probe.width,
    height: probe.height,
    durationMs: probe.durationMs,
    codec: probe.codec,
    container: "mp4",
  };
}

/**
 * Narrow Program-4 recovery store. It writes one canonical clip plus one audit
 * event in a transaction and deliberately never writes a budget table.
 */
export class AuditedVideoOutputImportStore {
  constructor(private readonly pool: pg.Pool, private readonly inspect: LocalVideoInspector) {}

  async import(input: AuditedVideoOutputImportInput): Promise<AuditedVideoOutputImportReceipt> {
    const technical = await this.inspect(input.filePath);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.videoExecutionId]);
      const auth = await client.query(
        `SELECT artifact_id,workflow_id,correlation_id,payload FROM artifacts
         WHERE kind='wan_authorization' AND payload->>'videoExecutionId'=$1 FOR UPDATE`,
        [input.videoExecutionId],
      );
      if (auth.rowCount !== 1) throw new Error("AUDITED_VIDEO_IMPORT_INTENT_NOT_UNIQUE");
      const row = auth.rows[0] as { artifact_id: string; workflow_id: string; correlation_id: string; payload: Record<string, unknown> };
      const payload = row.payload;
      const visual = await client.query(
        `SELECT artifact_id,workflow_id,payload FROM artifacts WHERE artifact_id=$1 AND kind='scene_visual_artifact'`,
        [input.expectedSourceVisualArtifactId],
      );
      if (visual.rowCount !== 1) throw new Error("AUDITED_VIDEO_IMPORT_SOURCE_VISUAL_MISSING");
      const vp = visual.rows[0].payload as Record<string, unknown>;
      if (visual.rows[0].workflow_id !== row.workflow_id || String(vp.projectId) !== String(payload.projectId) || String(vp.contentId) !== String(payload.contentId)) {
        throw new Error("AUDITED_VIDEO_IMPORT_WORKFLOW_CONTENT_MISMATCH");
      }
      if (String(vp.sha256).toLowerCase() !== input.expectedSourceVisualSha256.toLowerCase()) throw new Error("AUDITED_VIDEO_IMPORT_SOURCE_HASH_MISMATCH");
      const lifecycle = await client.query(
        `SELECT state,metadata FROM execution_lifecycle_events WHERE execution_id=$1 AND workflow_id=$2 ORDER BY event_id`,
        [input.videoExecutionId, row.workflow_id],
      );
      if (!lifecycle.rows.some((event: { state: string }) => event.state === "RECONCILIATION_REQUIRED")) throw new Error("AUDITED_VIDEO_IMPORT_RECONCILIATION_EVIDENCE_MISSING");
      const budget = await client.query(
        `SELECT limit_count,used_count FROM automation_call_budgets WHERE project_id=$1 AND call_kind='video_generation' FOR SHARE`,
        [String(payload.projectId)],
      );
      if (budget.rowCount !== 1) throw new Error("AUDITED_VIDEO_IMPORT_BUDGET_HISTORY_MISSING");
      const source: HistoricalVideoImportSource = {
        workflowId: row.workflow_id,
        correlationId: row.correlation_id,
        projectId: String(payload.projectId),
        contentId: String(payload.contentId),
        sceneId: String(payload.sceneId),
        videoExecutionId: String(payload.videoExecutionId),
        sourceVisualArtifactId: String(payload.sourceVisualArtifactId),
        sourceVisualSha256: String(payload.sourceVisualSha256),
        provider: String(payload.provider),
        model: String(payload.model),
        providerJobId: input.ownerSuppliedProviderJobId,
        configurationFingerprint: String(payload.configurationFingerprint),
        width: Number(payload.width), height: Number(payload.height), frameCount: Number(payload.frameCount),
        steps: Number(payload.steps), cfg: Number(payload.cfg),
        originalSubmissionCount: Number(payload.executionScopedMaxNewSubmissions),
        originalState: "RECONCILIATION_REQUIRED",
        videoBudgetLimit: Number(budget.rows[0].limit_count), videoBudgetUsed: Number(budget.rows[0].used_count),
      };
      const planned = validateAuditedVideoOutputImport(input, source, technical);
      const existing = await client.query(`SELECT artifact_id,payload FROM artifacts WHERE artifact_id=$1`, [planned.artifactId]);
      if (existing.rowCount === 1) {
        const prior = existing.rows[0].payload as Record<string, unknown>;
        if (String(prior.producerExecutionId) !== input.videoExecutionId || String(prior.videoSha256).toLowerCase() !== technical.sha256.toLowerCase() || String(prior.recoveryStatus) !== AUDITED_VIDEO_RECOVERY_STATUS) {
          throw new Error("AUDITED_VIDEO_IMPORT_IDEMPOTENCY_CONFLICT");
        }
        await client.query("COMMIT");
        return { ...planned, outcome: "ALREADY_IMPORTED" };
      }
      const competing = await client.query(
        `SELECT artifact_id FROM artifacts WHERE kind='scene_video_clip' AND payload->>'producerExecutionId'=$1`,
        [input.videoExecutionId],
      );
      if (competing.rowCount) throw new Error("AUDITED_VIDEO_IMPORT_SECOND_ARTIFACT_BLOCKED");
      const now = new Date().toISOString();
      const artifactPayload = {
        artifactId: planned.artifactId, status: "completed", stage: "video", workflowId: source.workflowId,
        projectId: source.projectId, contentId: source.contentId, correlationId: source.correlationId, sceneId: source.sceneId,
        producerExecutionId: source.videoExecutionId, sourceVisualArtifactId: source.sourceVisualArtifactId,
        sourceVisualSha256: source.sourceVisualSha256, provider: source.provider, model: source.model,
        providerJobId: source.providerJobId, configurationFingerprint: source.configurationFingerprint,
        width: technical.width, height: technical.height, durationMs: technical.durationMs, codec: technical.codec,
        container: technical.container, byteCount: technical.bytes, videoSha256: technical.sha256,
        videoPathOrReference: technical.path, createdAt: now, technicalValidation: { status: "PASS", localOutputTechnicalProof: VERIFIED_LOCAL_OUTPUT_PROOF },
        semanticStatus: "AWAITING_OWNER_REVIEW", approvedForComposition: false,
        recoveryStatus: AUDITED_VIDEO_RECOVERY_STATUS, providerIdentityProof: OWNER_ATTESTED_PROVIDER_PROOF,
        originalSubmissionState: "RECONCILIATION_REQUIRED", originalAcknowledgement: "TIMED_OUT",
        ownerSuppliedProviderJobId: input.ownerSuppliedProviderJobId, ownerAuthorizationRef: input.ownerAuthorizationRef,
        ambiguityAcknowledgement: input.ambiguityAcknowledgement, importExecutionId: planned.importExecutionId,
        videoBudgetAdditionalConsumption: 0,
      };
      await client.query(
        `INSERT INTO artifacts(artifact_id,workflow_id,kind,producer_agent,correlation_id,status,payload,content_type,schema_version,created_at,parent_artifact_id,parent_artifact_kind)
         VALUES($1,$2,'scene_video_clip','video',$3,'completed',$4::jsonb,'application/json','1',$5,$6,'scene_visual_artifact')`,
        [planned.artifactId, source.workflowId, source.correlationId, JSON.stringify(artifactPayload), now, source.sourceVisualArtifactId],
      );
      await client.query(
        `INSERT INTO execution_lifecycle_events(execution_id,workflow_id,stage,state,occurred_at,attempt_number,metadata)
         VALUES($1,$2,'video','AUDITED_VERIFIED_OUTPUT_IMPORTED',$3,1,$4::jsonb)`,
        [source.videoExecutionId, source.workflowId, now, JSON.stringify({ importExecutionId: planned.importExecutionId, artifactId: planned.artifactId, ownerAuthorizationRef: input.ownerAuthorizationRef, recoveryStatus: AUDITED_VIDEO_RECOVERY_STATUS, providerIdentityProof: OWNER_ATTESTED_PROVIDER_PROOF, localOutputTechnicalProof: VERIFIED_LOCAL_OUTPUT_PROOF, outputSha256: technical.sha256, originalState: "RECONCILIATION_REQUIRED", videoBudgetAdditionalConsumption: 0 })],
      );
      await client.query("COMMIT");
      return { ...planned, outcome: "IMPORTED" };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
