import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { persistPublicationIntegrationValidation } from "../dist/index.js";

test("publication validation is local-only, durable, and preserves historical artifacts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "amf-publication-validation-"));
  try {
    const mediaPath = join(dir, "final.mp4");
    const bytes = Buffer.from("local-final-media-fixture");
    await writeFile(mediaPath, bytes);
    const sha = createHash("sha256").update(bytes).digest("hex");
    const originalQa = { verdict: "PASS", provenance: "historical" };
    const artifacts = [
      { artifactId: "media-1", kind: "final_media_artifact", payload: { sha256: sha } },
      { artifactId: "qa-1", kind: "final_technical_qa", payload: originalQa },
      { artifactId: "review-1", kind: "final_product_review", payload: { status: "human_review_required" } },
    ];
    const saved = [];
    const persistence = { listArtifacts: async () => artifacts, saveArtifact: async (value) => saved.push(value) };
    const result = await persistPublicationIntegrationValidation({
      persistence, validationId: "validation-1", projectId: "morroway", workflowId: "workflow-1",
      correlationId: "correlation-1", projectMode: "PLATFORM_VALIDATION_MODE",
      finalMediaArtifactId: "media-1", finalMediaPath: mediaPath, expectedFinalMediaSha256: sha,
      finalTechnicalQaArtifactId: "qa-1", finalProductReviewArtifactId: "review-1",
      authority: { approvalId: "approval-1", decision: "approved", scope: "PUBLICATION_INTEGRATION_VALIDATION", projectId: "morroway", workflowId: "workflow-1", projectMode: "PLATFORM_VALIDATION_MODE", finalMediaArtifactId: "media-1", finalMediaSha256: sha, finalProductReviewId: "review-1" },
      targetPlatform: "youtube", payload: { title: "Real title" }, validatedAt: "2026-09-18T00:00:00.000Z",
    });
    assert.equal(result.externalProviderCalls, 0);
    assert.equal(result.irreversiblePublishCalls, 0);
    assert.equal(result.publicVisibilityChange, false);
    assert.equal(result.technicalQaNormalized.passed, true);
    assert.equal(result.readyForExternalPublish, false);
    assert.ok(result.blockingReasons.includes("TARGET_ACCOUNT_NOT_RESOLVED"));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].kind, "publication_integration_validation");
    assert.equal(saved[0].parentArtifact.artifactId, "media-1");
    assert.deepEqual(originalQa, { verdict: "PASS", provenance: "historical" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("publication validation fails closed for missing local media", async () => {
  const saved = [];
  const persistence = { listArtifacts: async () => [
    { artifactId: "media-1", kind: "final_media_artifact", payload: {} },
    { artifactId: "qa-1", kind: "final_technical_qa", payload: { verdict: "PASS" } },
    { artifactId: "review-1", kind: "final_product_review", payload: { status: "approved" } },
  ], saveArtifact: async (value) => saved.push(value) };
  const result = await persistPublicationIntegrationValidation({ persistence, validationId: "validation-missing", projectId: "p", workflowId: "w", correlationId: "c", projectMode: "PLATFORM_VALIDATION_MODE", finalMediaArtifactId: "media-1", finalMediaPath: join(tmpdir(), "amf-definitely-missing.mp4"), expectedFinalMediaSha256: "a".repeat(64), finalTechnicalQaArtifactId: "qa-1", finalProductReviewArtifactId: "review-1", authority: { approvalId: "a", decision: "approved", scope: "PUBLICATION_INTEGRATION_VALIDATION", projectId: "p", workflowId: "w", projectMode: "PLATFORM_VALIDATION_MODE", finalMediaArtifactId: "media-1", finalMediaSha256: "a".repeat(64), finalProductReviewId: "review-1" }, targetPlatform: "youtube", payload: { title: "Title" } });
  assert.ok(result.blockingReasons.includes("FINAL_MEDIA_NOT_FOUND"));
  assert.equal(result.externalProviderCalls, 0);
  assert.equal(saved.length, 1);
});
