import { describe, it } from "node:test";
import { strictEqual } from "node:assert";
import { PublishingCapabilityExecutor, PUBLISH_CAPABILITY_ID, publicationIdentityV2, sha256Canonical } from "../dist/index.js";

const policy = { maxTitleLength: 200, maxDescriptionLength: 1000, maxAssetIdLength: 500, maxTags: 30, maxTagLength: 30, allowedVisibility: ["public", "unlisted", "private"] };
const resolver = { resolve: () => ({ capabilityId: PUBLISH_CAPABILITY_ID }), isAuthorized: () => true };
const store = { get: async () => null, save: async () => {} };
function fixture(authorityOverrides = {}, inputOverrides = {}) {
  const providerPayload = { assetId: "media-1", title: "Title", metadata: { workflowId: "workflow-1" } };
  const payloadHash = sha256Canonical(providerPayload);
  const identity = publicationIdentityV2({ projectId: "project-1", workflowId: "workflow-1", finalMediaSha256: "a".repeat(64), targetPlatform: "youtube", targetAccountId: "channel-1", publicationPayloadHash: payloadHash });
  const authority = { approvalId: "approval-1", decision: "approved", scope: "PUBLIC_PUBLISH", projectId: "project-1", workflowId: "workflow-1", projectMode: "PRODUCTION", finalMediaArtifactId: "media-1", finalMediaSha256: "a".repeat(64), finalProductReviewId: "review-1", targetPlatform: "youtube", targetAccountId: "channel-1", publicationPayloadHash: payloadHash, publicationIdentity: identity, ...authorityOverrides };
  const input = { projectId: "project-1", finalMediaArtifactId: "media-1", finalMediaSha256: "a".repeat(64), mediaTransportRef: { type: "HTTPS_URL", url: "https://media.example/media.mp4", expectedSha256: "a".repeat(64) }, targetAccountId: "channel-1", title: "Title", metadata: { workflowId: "workflow-1" }, idempotencyKey: identity, publicationAuthority: authority, ...inputOverrides };
  return { input };
}
function request(input) { return { requestId: "r", capabilityId: PUBLISH_CAPABILITY_ID, operation: "publish", agentId: "publisher", workflowId: "workflow-1", correlationId: "c", input, requestedAt: new Date().toISOString() }; }

describe("publisher authority guard", () => {
  it("permits only an exact PUBLIC_PUBLISH authority", async () => {
    let calls = 0;
    const executor = new PublishingCapabilityExecutor({ publish: async () => { calls++; return { providerId: "fake", status: "completed", publicationId: "p", url: "https://example.test/p" }; } }, store, resolver, policy);
    strictEqual((await executor.execute(request(fixture().input))).status, "success");
    strictEqual(calls, 1);
  });
  it("forbids validation, production, missing/legacy, rejected, iteration, policy bypass, and exact-binding mismatches before provider invocation", async () => {
    const cases = [
      fixture({ scope: "PUBLICATION_INTEGRATION_VALIDATION" }).input,
      fixture({ scope: "PRODUCTION" }).input,
      fixture({ scope: undefined }).input,
      fixture({ decision: "rejected" }).input,
      fixture({ decision: "iteration_requested" }).input,
      fixture({ decision: "policy_bypass" }).input,
      fixture({ finalMediaSha256: "b".repeat(64) }).input,
      fixture({ targetAccountId: "other" }).input,
      fixture({ publicationPayloadHash: "bad" }).input,
    ];
    for (const input of cases) {
      let calls = 0;
      const executor = new PublishingCapabilityExecutor({ publish: async () => { calls++; throw new Error("must not call"); } }, store, resolver, policy);
      strictEqual((await executor.execute(request(input))).status, "blocked");
      strictEqual(calls, 0);
    }
  });
});
