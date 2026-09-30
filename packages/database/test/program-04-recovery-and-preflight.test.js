import test from "node:test";
import assert from "node:assert/strict";
import { RECOVERY_MODE_REGISTRY, freezeRecoveryContext, publicationPreflight } from "../dist/index.js";

test("Program 4 video reconciliation uses shared recovery primitives and forbids blind resubmit", () => {
  const policy = RECOVERY_MODE_REGISTRY.VIDEO_RECONCILIATION;
  assert.equal(policy.executionMode, "LOCAL_RECONCILIATION");
  assert.equal(policy.budgetCallKind, "NONE");
  assert.ok(policy.forbiddenStages.includes("video-submit"));
  const frozen = freezeRecoveryContext({ mode: "VIDEO_RECONCILIATION", authorizationId: "auth", idempotencyKey: "idem", projectId: "project", workflowId: "wf", frozenArtifactIds: ["art-visual"], configurationFingerprint: "fp", authorizedBy: "owner", authorizedAt: "2026-09-28T00:00:00.000Z" }, "recovery-video");
  assert.equal(frozen.rewindTarget, null);
});

test("Program 4 publish-session resume preserves approved media and creates no media budget", () => {
  const policy = RECOVERY_MODE_REGISTRY.PUBLISH_SESSION_RESUME;
  assert.equal(policy.executionMode, "SPECIAL_EXECUTION");
  assert.equal(policy.budgetCallKind, "NONE");
  assert.ok(policy.preservedStages.includes("publisher-authorization"));
  assert.ok(policy.forbiddenStages.includes("composer"));
});

test("credential liveness states fail before upload unless VALID", () => {
  const base = { projectId: "p", channelProjectId: "p", channelStatus: "VERIFIED", channelId: "c", externalChannelId: "yt", bindingProjectId: "p", bindingChannelId: "c", bindingStatus: "ACTIVE", visibility: "private", supportedVisibilities: ["private"], title: "title", description: "description", titleLimit: 100, descriptionLimit: 1000, publicationIdentity: "pub" };
  assert.equal(publicationPreflight({ ...base, tokenState: "VALID" }).ok, true);
  assert.equal(publicationPreflight({ ...base, tokenState: "EXPIRED" }).code, "PUBLICATION_TOKEN_INVALID");
  assert.equal(publicationPreflight({ ...base, tokenState: "REVOKED" }).code, "PUBLICATION_TOKEN_INVALID");
  assert.equal(publicationPreflight({ ...base, tokenState: "UNKNOWN_REQUIRES_REFRESH" }).code, "TOKEN_LIVENESS_UNKNOWN_REQUIRES_REFRESH");
});
