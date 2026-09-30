import { createHash } from "node:crypto";
import { normalizeFinalTechnicalQa, type NormalizedTechnicalQa } from "./final-technical-qa.js";

export const PUBLICATION_VALIDATOR_VERSION = "publication-integration-validator-v1";
export const PUBLICATION_VALIDATION_SCOPE = "PUBLICATION_INTEGRATION_VALIDATION";
export const PUBLIC_PUBLISH_SCOPE = "PUBLIC_PUBLISH";
export const PRIVATE_VALIDATION_SCOPE = "PRIVATE_VALIDATION";

export interface CanonicalPublicationPayload {
  title?: string;
  description?: string;
  tags?: readonly string[];
  visibility?: "public" | "unlisted" | "private";
  [key: string]: unknown;
}

export interface PublicationAuthority {
  approvalId: string;
  decision: "approved" | "rejected" | "iteration_requested" | "policy_bypass";
  scope?: string;
  projectId: string;
  workflowId: string;
  projectMode: string;
  finalMediaArtifactId: string;
  finalMediaSha256: string;
  finalProductReviewId: string;
  targetPlatform?: string;
  targetAccountId?: string;
  publicationPayloadHash?: string;
  publicationIdentity?: string;
}

export interface PublicationValidationInput {
  validationId: string;
  projectId: string;
  workflowId: string;
  projectMode: string;
  finalMediaArtifactId: string;
  expectedFinalMediaSha256: string;
  resolvedMediaSha256?: string;
  mediaExists: boolean;
  mediaBytes?: number;
  technicalQaPayload: unknown;
  finalProductReviewId?: string;
  finalProductReviewResult?: string;
  authority?: PublicationAuthority;
  targetPlatform: string;
  targetAccountId?: string;
  payload: CanonicalPublicationPayload;
  validatedAt: string;
}

export interface PublicationIntegrationValidation {
  kind: "PUBLICATION_INTEGRATION_VALIDATION";
  validationId: string;
  projectId: string;
  workflowId: string;
  projectMode: string;
  finalMediaArtifactId: string;
  finalMediaSha256: string;
  technicalQaNormalized: NormalizedTechnicalQa;
  finalProductReviewId: string | null;
  finalProductReviewResult: string | null;
  humanApprovalId: string | null;
  humanApprovalScope: string | null;
  targetPlatform: string;
  targetAccountIdentity: string | "NOT_RESOLVED";
  publicationPayloadHash: string;
  metadataHash: string;
  mediaHash: string;
  externalIdempotencyIdentity: string;
  externalIdentityComplete: boolean;
  validatorVersion: string;
  validationTimestamp: string;
  checksPerformed: readonly string[];
  checksPassed: readonly string[];
  checksBlocked: readonly string[];
  externalProviderCalls: 0;
  irreversiblePublishCalls: 0;
  publicVisibilityChange: false;
  readyForExternalPublish: boolean;
  blockingReasons: readonly string[];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export interface PublicationIdentityV2Input {
  projectId: string;
  workflowId: string;
  finalMediaSha256: string;
  targetPlatform: string;
  targetAccountId: string;
  publicationPayloadHash: string;
}

export function publicationIdentityV2(input: PublicationIdentityV2Input): string {
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== "string" || value.trim() === "") throw new Error(`Publication identity field ${key} is required`);
  }
  return `publish:v2:${sha256Canonical(input)}`;
}

export function validationPublicationIdentity(input: Omit<PublicationIdentityV2Input, "targetAccountId">): string {
  return `validation:v1:${sha256Canonical({ ...input, targetAccountId: "NOT_RESOLVED" })}`;
}

export function validatePublicationIntegration(input: PublicationValidationInput): PublicationIntegrationValidation {
  const checksPerformed = [
    "FINAL_MEDIA_EXISTS", "FINAL_MEDIA_SHA", "FINAL_MEDIA_BYTES", "TECHNICAL_QA",
    "FINAL_PRODUCT_REVIEW", "VALIDATION_AUTHORITY", "TARGET_PLATFORM", "TARGET_ACCOUNT",
    "PUBLICATION_METADATA", "PUBLICATION_PAYLOAD", "EXTERNAL_IDENTITY", "PUBLIC_PUBLISH_AUTHORITY",
    "ZERO_EXTERNAL_SIDE_EFFECTS",
  ];
  const passed: string[] = [];
  const blocked: string[] = [];
  const block = (condition: boolean, check: string, reason: string): void => { (condition ? passed : blocked).push(condition ? check : reason); };
  const qa = normalizeFinalTechnicalQa(input.technicalQaPayload);
  const payloadHash = sha256Canonical(input.payload);
  const metadataHash = sha256Canonical({ title: input.payload.title, description: input.payload.description, tags: input.payload.tags });
  const mediaHash = input.resolvedMediaSha256 ?? "UNKNOWN";
  const account = input.targetAccountId?.trim() || "NOT_RESOLVED";

  block(input.mediaExists, "FINAL_MEDIA_EXISTS", "FINAL_MEDIA_NOT_FOUND");
  block(input.resolvedMediaSha256 === input.expectedFinalMediaSha256, "FINAL_MEDIA_SHA", "FINAL_MEDIA_SHA_MISMATCH");
  block(typeof input.mediaBytes === "number" && input.mediaBytes > 0, "FINAL_MEDIA_BYTES", "FINAL_MEDIA_BYTES_NOT_RESOLVED");
  block(qa.passed, "TECHNICAL_QA", `TECHNICAL_QA_${qa.state}`);
  block(Boolean(input.finalProductReviewId && input.finalProductReviewResult), "FINAL_PRODUCT_REVIEW", "FINAL_PRODUCT_REVIEW_MISSING");
  const authority = input.authority;
  const authorityMatches = authority?.decision === "approved"
    && authority.scope === PUBLICATION_VALIDATION_SCOPE
    && authority.projectId === input.projectId
    && authority.workflowId === input.workflowId
    && authority.projectMode === input.projectMode
    && authority.finalMediaArtifactId === input.finalMediaArtifactId
    && authority.finalMediaSha256 === input.expectedFinalMediaSha256
    && authority.finalProductReviewId === input.finalProductReviewId;
  block(authorityMatches, "VALIDATION_AUTHORITY", "VALIDATION_AUTHORITY_MISSING_OR_MISMATCHED");
  block(input.targetPlatform.trim().length > 0, "TARGET_PLATFORM", "TARGET_PLATFORM_NOT_CONFIGURED");
  block(account !== "NOT_RESOLVED", "TARGET_ACCOUNT", "TARGET_ACCOUNT_NOT_RESOLVED");
  block(typeof input.payload.title === "string" && input.payload.title.trim().length > 0, "PUBLICATION_METADATA", "PUBLICATION_METADATA_INCOMPLETE");
  block(Object.keys(input.payload).length > 0, "PUBLICATION_PAYLOAD", "PUBLICATION_PAYLOAD_INCOMPLETE");

  const identityBase = {
    projectId: input.projectId,
    workflowId: input.workflowId,
    finalMediaSha256: input.expectedFinalMediaSha256,
    targetPlatform: input.targetPlatform,
    publicationPayloadHash: payloadHash,
  };
  const identity = account === "NOT_RESOLVED"
    ? validationPublicationIdentity(identityBase)
    : publicationIdentityV2({ ...identityBase, targetAccountId: account });
  block(account !== "NOT_RESOLVED", "EXTERNAL_IDENTITY", "EXTERNAL_IDENTITY_INCOMPLETE_ACCOUNT_UNRESOLVED");
  blocked.push("PUBLIC_PUBLISH_AUTHORITY_NOT_GRANTED");
  passed.push("ZERO_EXTERNAL_SIDE_EFFECTS");

  // Public-publish authority is intentionally absent from validation-only
  // acceptance. It is reported, but does not make an otherwise complete
  // integration package operationally unready for a future separately
  // authorized publish.
  const readinessBlockers = blocked.filter((reason) => reason !== "PUBLIC_PUBLISH_AUTHORITY_NOT_GRANTED");

  return {
    kind: "PUBLICATION_INTEGRATION_VALIDATION",
    validationId: input.validationId,
    projectId: input.projectId,
    workflowId: input.workflowId,
    projectMode: input.projectMode,
    finalMediaArtifactId: input.finalMediaArtifactId,
    finalMediaSha256: input.expectedFinalMediaSha256,
    technicalQaNormalized: qa,
    finalProductReviewId: input.finalProductReviewId ?? null,
    finalProductReviewResult: input.finalProductReviewResult ?? null,
    humanApprovalId: authority?.approvalId ?? null,
    humanApprovalScope: authority?.scope ?? null,
    targetPlatform: input.targetPlatform,
    targetAccountIdentity: account,
    publicationPayloadHash: payloadHash,
    metadataHash,
    mediaHash,
    externalIdempotencyIdentity: identity,
    externalIdentityComplete: account !== "NOT_RESOLVED",
    validatorVersion: PUBLICATION_VALIDATOR_VERSION,
    validationTimestamp: input.validatedAt,
    checksPerformed,
    checksPassed: passed,
    checksBlocked: blocked,
    externalProviderCalls: 0,
    irreversiblePublishCalls: 0,
    publicVisibilityChange: false,
    readyForExternalPublish: readinessBlockers.length === 0,
    blockingReasons: blocked,
  };
}
