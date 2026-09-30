import { describe, it } from "node:test";
import { deepStrictEqual, notStrictEqual, strictEqual, ok } from "node:assert";
import {
  normalizeFinalTechnicalQa,
  publicationIdentityV2,
  sha256Canonical,
  validatePublicationIntegration,
} from "../dist/index.js";

describe("Final Technical QA normalization", () => {
  it("normalizes legacy PASS and FAIL without mutation", () => {
    const pass = { verdict: "PASS", evidence: ["original"] };
    const before = JSON.stringify(pass);
    strictEqual(normalizeFinalTechnicalQa(pass).passed, true);
    strictEqual(JSON.stringify(pass), before);
    strictEqual(normalizeFinalTechnicalQa({ verdict: "FAIL" }).state, "FAILED");
  });
  it("supports canonical legacy status and fails closed on unknown, missing, malformed, and conflicts", () => {
    strictEqual(normalizeFinalTechnicalQa({ status: "passed" }).passed, true);
    strictEqual(normalizeFinalTechnicalQa({ status: "failed" }).state, "FAILED");
    strictEqual(normalizeFinalTechnicalQa({ verdict: "MAYBE" }).state, "UNKNOWN");
    strictEqual(normalizeFinalTechnicalQa({}).state, "UNKNOWN");
    strictEqual(normalizeFinalTechnicalQa("PASS").state, "MALFORMED");
    strictEqual(normalizeFinalTechnicalQa({ verdict: "PASS", status: "failed" }).state, "MALFORMED");
  });
});

const base = (overrides = {}) => ({
  validationId: "validation-1", projectId: "project-1", workflowId: "workflow-1",
  projectMode: "PLATFORM_VALIDATION_MODE", finalMediaArtifactId: "media-1",
  expectedFinalMediaSha256: "a".repeat(64), resolvedMediaSha256: "a".repeat(64),
  mediaExists: true, mediaBytes: 42, technicalQaPayload: { verdict: "PASS" },
  finalProductReviewId: "review-1", finalProductReviewResult: "approved", targetPlatform: "youtube",
  targetAccountId: "channel-1", payload: { title: "Canonical title", description: "Description", visibility: "private" },
  validatedAt: "2026-09-18T00:00:00.000Z",
  authority: {
    approvalId: "approval-1", decision: "approved", scope: "PUBLICATION_INTEGRATION_VALIDATION",
    projectId: "project-1", workflowId: "workflow-1", projectMode: "PLATFORM_VALIDATION_MODE",
    finalMediaArtifactId: "media-1", finalMediaSha256: "a".repeat(64), finalProductReviewId: "review-1",
  },
  ...overrides,
});

describe("side-effect-free publication integration validator", () => {
  it("validates local state but never claims public-publish authority", () => {
    const result = validatePublicationIntegration(base());
    strictEqual(result.externalProviderCalls, 0);
    strictEqual(result.irreversiblePublishCalls, 0);
    strictEqual(result.publicVisibilityChange, false);
    ok(result.checksPassed.includes("VALIDATION_AUTHORITY"));
    ok(result.blockingReasons.includes("PUBLIC_PUBLISH_AUTHORITY_NOT_GRANTED"));
  });
  it("reports missing media, SHA mismatch, QA failure, review and authority failures", () => {
    const result = validatePublicationIntegration(base({ mediaExists: false, resolvedMediaSha256: "b".repeat(64), technicalQaPayload: { verdict: "FAIL" }, finalProductReviewId: undefined, authority: undefined }));
    for (const reason of ["FINAL_MEDIA_NOT_FOUND", "FINAL_MEDIA_SHA_MISMATCH", "TECHNICAL_QA_FAILED", "FINAL_PRODUCT_REVIEW_MISSING", "VALIDATION_AUTHORITY_MISSING_OR_MISMATCHED"]) ok(result.blockingReasons.includes(reason));
  });
  it("fails closed for wrong scope, rejected, iteration, policy bypass, missing scope, and legacy ambiguous approval", () => {
    for (const authority of [
      { ...base().authority, scope: "PRODUCTION" },
      { ...base().authority, decision: "rejected" },
      { ...base().authority, decision: "iteration_requested" },
      { ...base().authority, decision: "policy_bypass" },
      { ...base().authority, scope: undefined },
      { approvalId: "legacy", decision: "approved" },
    ]) ok(validatePublicationIntegration(base({ authority })).blockingReasons.includes("VALIDATION_AUTHORITY_MISSING_OR_MISMATCHED"));
  });
  it("distinguishes incomplete metadata and unresolved account", () => {
    const result = validatePublicationIntegration(base({ targetAccountId: undefined, payload: { description: "no title" } }));
    strictEqual(result.externalIdentityComplete, false);
    ok(result.externalIdempotencyIdentity.startsWith("validation:v1:"));
    ok(result.blockingReasons.includes("TARGET_ACCOUNT_NOT_RESOLVED"));
    ok(result.blockingReasons.includes("PUBLICATION_METADATA_INCOMPLETE"));
  });
  it("identity is deterministic and changes with payload, media, and account", () => {
    const seed = { projectId: "p", workflowId: "w", finalMediaSha256: "a", targetPlatform: "youtube", targetAccountId: "acct", publicationPayloadHash: sha256Canonical({ title: "one" }) };
    strictEqual(publicationIdentityV2(seed), publicationIdentityV2(seed));
    notStrictEqual(publicationIdentityV2(seed), publicationIdentityV2({ ...seed, publicationPayloadHash: sha256Canonical({ title: "two" }) }));
    notStrictEqual(publicationIdentityV2(seed), publicationIdentityV2({ ...seed, finalMediaSha256: "b" }));
    notStrictEqual(publicationIdentityV2(seed), publicationIdentityV2({ ...seed, targetAccountId: "other" }));
  });
});
