import { createHash } from "node:crypto";

export const PROGRAM_04_MEDIA_POLICY_VERSION = "amf-media-closed-loop-v1";

export type MediaFailureClass =
  | "PRECONDITION_FAILED" | "CONFIGURATION_INVALID" | "REFERENCE_UNAVAILABLE"
  | "PROVIDER_UNAVAILABLE" | "PROVIDER_REJECTED" | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_FAILED" | "AMBIGUOUS_SUBMISSION" | "RECONCILIATION_REQUIRED"
  | "OUTPUT_INVALID" | "TECHNICAL_QA_FAILED" | "HUMAN_REVIEW_REQUIRED"
  | "OWNER_REAUTH_REQUIRED";

export interface CanonicalMediaInput {
  projectId: string; contentId: string; workflowId: string;
  writerArtifactId: string; scenePlanArtifactId: string; visualDirectionArtifactId: string;
  scriptIdentity: string; narrationText: string; voiceId: string;
  aspectRatio: string; sceneIds: readonly string[]; ownerApprovalId: string;
}

export function assertCanonicalMediaInput(input: CanonicalMediaInput): void {
  for (const [field, value] of Object.entries(input)) {
    if (field === "sceneIds") continue;
    if (typeof value !== "string" || value.trim() === "") throw new Error(`MEDIA_INPUT_REQUIRED:${field}`);
  }
  if (!Array.isArray(input.sceneIds) || input.sceneIds.length === 0 || new Set(input.sceneIds).size !== input.sceneIds.length) {
    throw new Error("MEDIA_SCENE_IDENTITIES_INVALID");
  }
  if (!/^\d+:\d+$/.test(input.aspectRatio)) throw new Error("MEDIA_ASPECT_RATIO_INVALID");
}

export type ReferenceTransport =
  | { kind: "HTTPS_URL"; url: string; expiresAt?: string }
  | { kind: "DATA_URL"; dataUrl: string }
  | { kind: "LOCAL_PATH"; path: string };

export interface ReferenceAsset {
  referenceAssetId: string; projectId: string; contentId: string; subjectId: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  sha256: string; suitability: "APPROVED" | "REJECTED" | "PENDING_REVIEW";
  bytes?: number; width?: number; height?: number; transport: ReferenceTransport;
}

export interface ReferencePreflightContext {
  projectId: string; contentId: string; subjectId: string; now: string;
  providerAcceptsDataUrl: boolean; maxBytes?: number; minWidth?: number; minHeight?: number;
}

export type ReferencePreflightResult =
  | { ok: true; providerReference: string; transportKind: "HTTPS_URL" | "DATA_URL" }
  | { ok: false; failure: "REFERENCE_UNAVAILABLE" | "PRECONDITION_FAILED"; reason: string };

export function preflightReferenceAsset(asset: ReferenceAsset | null, context: ReferencePreflightContext): ReferencePreflightResult {
  if (!asset) return { ok: false, failure: "REFERENCE_UNAVAILABLE", reason: "REFERENCE_NOT_FOUND" };
  if (asset.projectId !== context.projectId || asset.contentId !== context.contentId || asset.subjectId !== context.subjectId) return { ok: false, failure: "PRECONDITION_FAILED", reason: "REFERENCE_OWNERSHIP_MISMATCH" };
  if (asset.suitability !== "APPROVED") return { ok: false, failure: "PRECONDITION_FAILED", reason: `REFERENCE_${asset.suitability}` };
  if (!/^[a-f0-9]{64}$/i.test(asset.sha256)) return { ok: false, failure: "PRECONDITION_FAILED", reason: "REFERENCE_HASH_INVALID" };
  if (context.maxBytes !== undefined && asset.bytes !== undefined && asset.bytes > context.maxBytes) return { ok: false, failure: "PRECONDITION_FAILED", reason: "REFERENCE_TOO_LARGE" };
  if ((context.minWidth !== undefined && asset.width !== undefined && asset.width < context.minWidth) || (context.minHeight !== undefined && asset.height !== undefined && asset.height < context.minHeight)) return { ok: false, failure: "PRECONDITION_FAILED", reason: "REFERENCE_DIMENSIONS_INVALID" };
  if (asset.transport.kind === "LOCAL_PATH") return { ok: false, failure: "REFERENCE_UNAVAILABLE", reason: "REMOTE_PROVIDER_CANNOT_FETCH_LOCAL_PATH" };
  if (asset.transport.kind === "DATA_URL") return context.providerAcceptsDataUrl && asset.transport.dataUrl.startsWith(`data:${asset.mimeType};base64,`)
    ? { ok: true, providerReference: asset.transport.dataUrl, transportKind: "DATA_URL" }
    : { ok: false, failure: "REFERENCE_UNAVAILABLE", reason: "REFERENCE_DATA_URL_UNSUPPORTED" };
  try {
    const url = new URL(asset.transport.url);
    if (url.protocol !== "https:") return { ok: false, failure: "REFERENCE_UNAVAILABLE", reason: "REFERENCE_URL_NOT_HTTPS" };
    if (asset.transport.expiresAt && Date.parse(asset.transport.expiresAt) <= Date.parse(context.now)) return { ok: false, failure: "REFERENCE_UNAVAILABLE", reason: "REFERENCE_URL_EXPIRED" };
    return { ok: true, providerReference: url.toString(), transportKind: "HTTPS_URL" };
  } catch { return { ok: false, failure: "REFERENCE_UNAVAILABLE", reason: "REFERENCE_URL_INVALID" }; }
}

export interface FrozenMediaConfiguration {
  fingerprint: string; voiceId: string; ttsProvider: string; ttsModel: string;
  imageProvider: string; imageModel: string; videoProvider: string; videoModel: string;
  authorizedBy: string; authorizationId: string;
}

export function mediaConfigurationFingerprint(input: Omit<FrozenMediaConfiguration, "fingerprint" | "authorizedBy" | "authorizationId">): string {
  return createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b))))).digest("hex");
}

export function evaluateMediaConfigurationAuthorization(frozen: FrozenMediaConfiguration, current: Omit<FrozenMediaConfiguration, "fingerprint" | "authorizedBy" | "authorizationId">): "AUTHORIZED" | "OWNER_REAUTH_REQUIRED" {
  return frozen.fingerprint === mediaConfigurationFingerprint(current) ? "AUTHORIZED" : "OWNER_REAUTH_REQUIRED";
}

export type CaptionVerification = "BURNED_IN_VERIFIED" | "SIDECAR_ONLY" | "HUMAN_REVIEW_REQUIRED" | "MISSING";
export function evaluateCaptionVerification(input: { required: boolean; sidecarPresent: boolean; rendererBurnInReceipt?: { outputSha256: string; captionTrackSha256: string }; pixelSemanticReview?: "PASS" | "FAIL" | "UNAVAILABLE" }): CaptionVerification {
  if (!input.required) return "BURNED_IN_VERIFIED";
  if (!input.sidecarPresent) return "MISSING";
  if (!input.rendererBurnInReceipt?.outputSha256 || !input.rendererBurnInReceipt.captionTrackSha256) return "SIDECAR_ONLY";
  return input.pixelSemanticReview === "PASS" ? "BURNED_IN_VERIFIED" : "HUMAN_REVIEW_REQUIRED";
}

export function evaluateVisualContinuity(input: { requiredSubjectIds: readonly string[]; boundReferenceSubjectIds: readonly string[]; visualMode: string; expectedVisualMode: string; semanticInspection: "PASS" | "FAIL" | "UNAVAILABLE" }): "PASS" | "FAIL" | "HUMAN_REVIEW_REQUIRED" {
  if (input.visualMode !== input.expectedVisualMode || input.requiredSubjectIds.some((id) => !input.boundReferenceSubjectIds.includes(id))) return "FAIL";
  return input.semanticInspection === "PASS" ? "PASS" : input.semanticInspection === "FAIL" ? "FAIL" : "HUMAN_REVIEW_REQUIRED";
}

export interface VideoSubmissionIntent {
  logicalExecutionId: string; sourceVisualArtifactId: string; sourceVisualSha256: string;
  promptFingerprint: string; provider: string; model: string; expectedDurationMs: number; aspectRatio: string;
}
export type VideoSubmissionState = "INTENT_PERSISTED" | "SUBMITTING" | "ACKNOWLEDGED" | "COMPLETED" | "RECONCILIATION_REQUIRED";
export interface VideoSubmissionRecord extends VideoSubmissionIntent {
  state: VideoSubmissionState; providerJobId?: string;
  submitStartedAt?: string; providerAcceptedAt?: string; jobIdReceivedAt?: string;
  generationStartedAt?: string; generationCompletedAt?: string; resultDownloadedAt?: string;
}

export class InMemoryVideoSubmissionLedger {
  private readonly rows = new Map<string, VideoSubmissionRecord>();
  persistIntent(intent: VideoSubmissionIntent): VideoSubmissionRecord {
    const prior = this.rows.get(intent.logicalExecutionId);
    if (prior) {
      if (JSON.stringify(prior, Object.keys(intent).sort()) !== JSON.stringify({ ...intent, state: prior.state }, Object.keys(intent).sort())) throw new Error("VIDEO_SUBMISSION_IDENTITY_CONFLICT");
      return prior;
    }
    const row: VideoSubmissionRecord = { ...intent, state: "INTENT_PERSISTED" }; this.rows.set(intent.logicalExecutionId, row); return row;
  }
  markTransportStarted(id: string, at = new Date().toISOString()): VideoSubmissionRecord { const row = this.must(id); row.state = "SUBMITTING"; row.submitStartedAt = at; return { ...row }; }
  markAcknowledged(id: string, providerJobId: string, at = new Date().toISOString()): VideoSubmissionRecord {
    const row = this.must(id); if (row.state !== "SUBMITTING") throw new Error("VIDEO_SUBMISSION_NOT_SUBMITTING");
    if (!providerJobId.trim()) throw new Error("VIDEO_PROVIDER_JOB_ID_REQUIRED");
    row.providerJobId = providerJobId; row.state = "ACKNOWLEDGED"; row.providerAcceptedAt = at; row.jobIdReceivedAt = at; return { ...row };
  }
  markAmbiguous(id: string): VideoSubmissionRecord { const row = this.must(id); row.state = "RECONCILIATION_REQUIRED"; return { ...row }; }
  reconcile(id: string, providerJobId?: string): VideoSubmissionRecord {
    const row = this.must(id);
    if (row.state !== "RECONCILIATION_REQUIRED") throw new Error("VIDEO_RECONCILIATION_NOT_REQUIRED");
    if (!providerJobId) return { ...row };
    row.providerJobId = providerJobId; row.state = "ACKNOWLEDGED"; row.providerAcceptedAt = new Date().toISOString(); row.jobIdReceivedAt = row.providerAcceptedAt; return { ...row };
  }
  maySubmit(id: string): boolean { return this.must(id).state === "INTENT_PERSISTED"; }
  get(id: string): VideoSubmissionRecord | null { const row = this.rows.get(id); return row ? { ...row } : null; }
  private must(id: string): VideoSubmissionRecord { const row = this.rows.get(id); if (!row) throw new Error("VIDEO_SUBMISSION_INTENT_MISSING"); return row; }
}

export interface CanonicalFinalMedia {
  artifactId: string; projectId: string; contentId: string; workflowId: string; storageReference: string;
  bytes: number; sha256: string; durationMs: number; width: number; height: number;
  videoCodec: string; audioCodec: string; compositionStrategy: string;
  sourceArtifactIds: readonly string[]; captionMode: CaptionVerification; narrationFit: "PASS" | "FAIL";
}
export function assertCanonicalFinalMedia(media: CanonicalFinalMedia): void {
  for (const field of [media.artifactId, media.projectId, media.contentId, media.workflowId, media.storageReference, media.videoCodec, media.audioCodec, media.compositionStrategy]) if (!field.trim()) throw new Error("FINAL_MEDIA_IDENTITY_INVALID");
  if (!(media.bytes > 0 && media.durationMs > 0 && media.width > 0 && media.height > 0) || !/^[a-f0-9]{64}$/i.test(media.sha256)) throw new Error("FINAL_MEDIA_TECHNICAL_INVALID");
  if (!media.sourceArtifactIds.length || media.narrationFit !== "PASS") throw new Error("FINAL_MEDIA_LINEAGE_INVALID");
  if (media.captionMode !== "BURNED_IN_VERIFIED" && media.captionMode !== "HUMAN_REVIEW_REQUIRED") throw new Error("FINAL_MEDIA_CAPTION_INVALID");
}

export interface CanonicalAnalyticsJoin {
  projectId: string; contentId: string; workflowId: string; finalMediaArtifactId: string; finalMediaSha256: string;
  publishedReportId: string; providerPublicationId: string; channelId: string;
}
export function assertCanonicalAnalyticsJoin(join: CanonicalAnalyticsJoin): void {
  for (const [key, value] of Object.entries(join)) if (typeof value !== "string" || value.trim() === "") throw new Error(`ANALYTICS_JOIN_REQUIRED:${key}`);
  if (!/^[a-f0-9]{64}$/i.test(join.finalMediaSha256)) throw new Error("ANALYTICS_JOIN_MEDIA_HASH_INVALID");
}

export function assertLearningEvidenceBinding(observationMetrics: Record<string, unknown>, citedMetrics: readonly string[]): void {
  for (const metric of citedMetrics) if (!Object.prototype.hasOwnProperty.call(observationMetrics, metric)) throw new Error(`LEARNING_METRIC_NOT_OBSERVED:${metric}`);
}

export const LEGACY_MEDIA_POLICY = Object.freeze({ thumbnail_report: "LEGACY_READ_ONLY", video_report: "LEGACY_READ_ONLY" } as const);
export function assertCanonicalNewProductionArtifact(kind: string): void {
  if (kind in LEGACY_MEDIA_POLICY) throw new Error(`LEGACY_MEDIA_NEW_WRITE_FORBIDDEN:${kind}`);
}

export type CostProvenance = "PROVIDER_REPORTED" | "CALCULATED" | "STUBBED_NOT_BILLABLE" | "UNKNOWN";
export interface MediaAccountingIdentity { callKind: "TTS" | "IMAGE" | "VIDEO" | "PUBLICATION" | "ANALYTICS"; reservationId: string; logicalExecutionId: string; costUsd: number | null; costProvenance: CostProvenance; }
export function assertMediaAccountingIdentity(value: MediaAccountingIdentity): void {
  if (!value.reservationId || !value.logicalExecutionId) throw new Error("MEDIA_ACCOUNTING_IDENTITY_INVALID");
  if (value.costProvenance === "UNKNOWN" && value.costUsd !== null) throw new Error("UNKNOWN_COST_MUST_REMAIN_NULL");
  if (value.costProvenance === "STUBBED_NOT_BILLABLE" && value.costUsd !== 0) throw new Error("STUB_COST_MUST_BE_ZERO");
}
