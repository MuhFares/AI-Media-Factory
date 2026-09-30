import { describe, it } from "node:test";
import { deepStrictEqual, rejects, strictEqual } from "node:assert";
import { evaluatePreWanGovernance, issueWanAuthorization, validateWanAuthorization } from "../dist/index.js";

const artifact = { artifactId: "image-a", sceneId: "scene-1", artifactPathOrReference: "C:/image-a.png", provider: "fixture-image", generationId: "gen-a", sha256: "aaa", integrityStatus: "VALID" };
const semantic = { artifactId: "image-a", sceneId: "scene-1", verdict: "PASS", automated: false, alignment: "PASS", reviewer: "human-review" };
const technical = { artifactId: "image-a", sceneId: "scene-1", verdict: "PASS", fileExists: true, decodable: true, dimensionsValid: true, advancedChecks: "NOT_AUTOMATED" };
const human = { approvalId: "human-1", workflowId: "wf-1", sceneId: "scene-1", artifactId: "image-a", artifactSha256: "aaa", outcome: "APPROVED", decidedAt: "2026-09-02T00:00:00Z", approver: "operator" };

describe("pre-Wan visual governance", () => {
  it("requires human review when semantic automation is unavailable", () => {
    deepStrictEqual(evaluatePreWanGovernance({ ...semantic, verdict: "UNAVAILABLE", automated: false, alignment: "UNKNOWN" }, technical), "HUMAN_REVIEW_REQUIRED");
  });

  it("blocks failed semantic, technical, and human decisions", () => {
    strictEqual(evaluatePreWanGovernance({ ...semantic, verdict: "FAIL" }, technical), "BLOCKED");
    strictEqual(evaluatePreWanGovernance(semantic, { ...technical, verdict: "FAIL" }), "BLOCKED");
    strictEqual(evaluatePreWanGovernance(semantic, technical, { ...human, outcome: "REJECTED" }), "BLOCKED");
  });

  it("issues authorization only for matching approved evidence", () => {
    const authorization = issueWanAuthorization({ workflowId: "wf-1", artifact, semantic, technical, human });
    strictEqual(validateWanAuthorization({ workflowId: "wf-1", artifact, authorization }).ok, true);
    rejects(async () => issueWanAuthorization({ workflowId: "wf-1", artifact: { ...artifact, artifactId: "image-b" }, semantic, technical, human }), /artifact identity mismatch/);
  });

  it("rejects missing and stale authorization at the execution boundary", () => {
    strictEqual(validateWanAuthorization({ workflowId: "wf-1", artifact }).code, "MISSING_WAN_AUTHORIZATION");
    const authorization = issueWanAuthorization({ workflowId: "wf-1", artifact, semantic, technical, human });
    strictEqual(validateWanAuthorization({ workflowId: "wf-1", artifact: { ...artifact, artifactId: "image-b" }, authorization }).code, "BLOCKED_STALE_APPROVAL");
  });
});
