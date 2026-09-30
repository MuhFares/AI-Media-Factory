import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import type { CollaborationArtifact, Json } from "@ai-media-factory/shared";
import type { PersistencePort } from "@ai-media-factory/workflow-engine";
import {
  validatePublicationIntegration,
  type CanonicalPublicationPayload,
  type PublicationAuthority,
  type PublicationIntegrationValidation,
} from "@ai-media-factory/tool-framework";

export interface PersistPublicationValidationOptions {
  persistence: Pick<PersistencePort, "listArtifacts" | "saveArtifact">;
  validationId: string;
  projectId: string;
  workflowId: string;
  correlationId: string;
  projectMode: string;
  finalMediaArtifactId: string;
  finalMediaPath: string;
  expectedFinalMediaSha256: string;
  finalTechnicalQaArtifactId: string;
  finalProductReviewArtifactId: string;
  authority: PublicationAuthority;
  targetPlatform: string;
  targetAccountId?: string;
  payload: CanonicalPublicationPayload;
  validatedAt?: string;
}

async function inspectLocalMedia(path: string): Promise<{ exists: boolean; bytes?: number; sha256?: string }> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return { exists: false };
    const bytes = await readFile(path);
    return { exists: true, bytes: info.size, sha256: createHash("sha256").update(bytes).digest("hex") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false };
    throw error;
  }
}

/** Local-only validator. It has no provider dependency and cannot publish. */
export async function persistPublicationIntegrationValidation(options: PersistPublicationValidationOptions): Promise<PublicationIntegrationValidation> {
  const artifacts = await options.persistence.listArtifacts(options.workflowId);
  const finalMedia = artifacts.find((item) => item.artifactId === options.finalMediaArtifactId && item.kind === "final_media_artifact");
  const technicalQa = artifacts.find((item) => item.artifactId === options.finalTechnicalQaArtifactId && item.kind === "final_technical_qa");
  const review = artifacts.find((item) => item.artifactId === options.finalProductReviewArtifactId && item.kind === "final_product_review");
  const media = await inspectLocalMedia(options.finalMediaPath);
  const reviewPayload = review?.payload as Record<string, unknown> | undefined;
  const validation = validatePublicationIntegration({
    validationId: options.validationId,
    projectId: options.projectId,
    workflowId: options.workflowId,
    projectMode: options.projectMode,
    finalMediaArtifactId: options.finalMediaArtifactId,
    expectedFinalMediaSha256: options.expectedFinalMediaSha256,
    resolvedMediaSha256: media.sha256,
    mediaExists: finalMedia !== undefined && media.exists,
    mediaBytes: media.bytes,
    technicalQaPayload: technicalQa?.payload,
    finalProductReviewId: review?.artifactId,
    finalProductReviewResult: typeof reviewPayload?.status === "string" ? reviewPayload.status : undefined,
    authority: options.authority,
    targetPlatform: options.targetPlatform,
    targetAccountId: options.targetAccountId,
    payload: options.payload,
    validatedAt: options.validatedAt ?? new Date().toISOString(),
  });
  const artifact = {
    artifactId: options.validationId,
    kind: "publication_integration_validation",
    producerAgent: "publisher",
    workflowId: options.workflowId,
    correlationId: options.correlationId,
    status: "completed",
    payload: { ...validation, artifactId: options.validationId, status: "completed" } as unknown as Record<string, Json>,
    contentType: "application/json",
    schemaVersion: "1.0",
    createdAt: validation.validationTimestamp,
    parentArtifact: { artifactId: options.finalMediaArtifactId, kind: "final_media_artifact" },
  } as unknown as CollaborationArtifact;
  await options.persistence.saveArtifact(artifact);
  return validation;
}
