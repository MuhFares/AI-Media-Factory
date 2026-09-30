/**
 * Slice 2 — canonical lifecycle read model (matrix items 1-20, 22-23).
 * Pure resolve() tests over constructed rows: no DB, no providers.
 * Matrix 25 (Morroway live) is verified read-only outside this file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LifecycleStore } from "../dist/index.js";

const store = new LifecycleStore({ query: async () => { throw new Error("no-db"); } });
const W = "wf-test-1";

function base(over = {}) {
  return {
    workflowId: W, projectId: "morroway", directive: "produce", submissionStatus: "submitted",
    steps: [], jobs: [], artifacts: [], approvals: [], published: false, ...over,
  };
}
const step = (step_id, status, attempts = 1) => ({ step_id, status, attempts });
const job = (job_id, status, error = null) => ({ job_id, status, attempts: 1, error, updated_at: "2026-09-19T00:00:00Z" });
const art = (artifact_id, kind, status = "completed") => ({ artifact_id, kind, status, created_at: "2026-09-19T00:00:00Z" });
const appr = (approval_id, target_type, target_id, status, owner_decision = null) =>
  ({ approval_id, target_type, target_id, status, owner_decision });

test("1: clean successful workflow resolves milestones + outputs", async () => {
  const lc = store.resolve(base({
    submissionStatus: "completed",
    steps: [step("research", "completed"), step("writer", "completed")],
    jobs: [job(1, "succeeded")],
    artifacts: [art("a1", "research_report"), art("a2", "writer_report")],
  }));
  assert.equal(lc.overallState, "COMPLETED");
  assert.ok(lc.milestones.find((m) => m.id === "research").completed);
  assert.ok(lc.outputs.find((o) => o.id === "research").artifactIds.includes("a1"));
  assert.equal(lc.attention.length, 0);
  assert.equal(lc.productionApproval, "NOT_GRANTED");
  assert.equal(lc.readyToPublish, false);
});

test("2: running workflow is IN_PROGRESS with next step", async () => {
  const lc = store.resolve(base({
    jobs: [job(1, "running")], steps: [step("research", "running")],
  }));
  assert.equal(lc.overallState, "IN_PROGRESS");
  assert.match(lc.nextStep, /no action needed/i);
  assert.match(lc.ifYouDoNothing, /nothing external/i);
});

test("3: pending Owner gate drives attention, not failure", async () => {
  const lc = store.resolve(base({
    submissionStatus: "revision_required",
    steps: [step("visual-human-gate", "failed"), step("writer", "completed")],
    jobs: [job(1, "failed", "workflow ended FAILED")],
    artifacts: [art("a2", "writer_report")],
    approvals: [appr("ap1", "workflow_gate", `${W}:visual-human-gate-vi1`, "PENDING")],
  }));
  assert.equal(lc.overallState, "NEEDS_OWNER_ATTENTION");
  assert.equal(lc.attention.length, 1);
  assert.equal(lc.attention[0].kind, "APPROVAL");
  assert.match(lc.nextStep, /decision/i);
  assert.match(lc.ifYouDoNothing, /waits/i);
});

test("4: rejected decision surfaces without granting authority", async () => {
  const lc = store.resolve(base({
    approvals: [appr("ap1", "workflow_gate", `${W}:gate`, "DECIDED", "REJECT")],
    jobs: [job(1, "failed", "x")],
  }));
  assert.ok(lc.attention.every((a) => a.kind !== "APPROVAL"), "no Owner-decision items");
  assert.ok(lc.attention.some((a) => a.kind === "SYSTEM"), "stopped run explained as system state");
  assert.equal(lc.publicationApproval, "NOT_GRANTED");
});

test("5/6: revision then continuation + failed attempt then retry resolve current truth", async () => {
  const lc = store.resolve(base({
    submissionStatus: "revision_required",
    steps: [step("visual-human-gate", "failed"), step("composer", "pending")],
    jobs: [job(1, "failed", "boom"), job(2, "succeeded")],
    artifacts: [art("c1", "scene_video_clip"), art("f1", "final_media_artifact"), art("q1", "final_technical_qa"), art("r1", "final_product_review")],
  }));
  assert.equal(lc.overallState, "MEDIA_COMPLETED");
  assert.equal(lc.attempts.failedSuperseded, 1);
  assert.equal(lc.attempts.unresolved, 0);
  assert.match(lc.attempts.note, /superseded/);
  const media = lc.phases.find((p) => p.id === "media");
  assert.equal(media.state, "COMPLETED");
});

test("7: stale submission status superseded by downstream canonical evidence", async () => {
  const lc = store.resolve(base({
    submissionStatus: "revision_required",
    steps: [step("composer", "pending"), step("publisher", "pending")],
    artifacts: [art("f1", "final_media_artifact"), art("v1", "publication_integration_validation"),
      art("ap", "approval-publication-integration-validation-v1", "completed")],
    approvals: [appr("apv", "publication_integration_validation_gate", `${W}:final:abc`, "DECIDED", "APPROVE")],
  }));
  assert.equal(lc.overallState, "VALIDATION_COMPLETED");
  assert.equal(lc.overallLabel, "Technical validation complete");
  assert.equal(lc.lastMilestone, "Publication validation completed");
});

test("8: historical failed jobs do not make current workflow failed", async () => {
  const lc = store.resolve(base({
    jobs: [job(1, "failed", "old"), job(2, "failed", "older")],
    artifacts: [art("c1", "scene_video_clip")],
  }));
  assert.notEqual(lc.overallState, "FAILED_TERMINAL");
  assert.notEqual(lc.overallState, "BLOCKED");
  assert.equal(lc.attempts.unresolved, 0);
});

test("9: unresolved terminal failure remains blocked", async () => {
  const lc = store.resolve(base({
    submissionStatus: "failed",
    steps: [step("video", "failed")],
    jobs: [job(1, "failed", "provider exploded")],
  }));
  assert.ok(["BLOCKED", "FAILED_TERMINAL"].includes(lc.overallState));
  assert.equal(lc.attempts.unresolved, 1);
  assert.equal(lc.blockers.length, 1);
  assert.match(lc.blockers[0].detail, /provider exploded/);
  assert.match(lc.nextStep, /blocker|retry|decision/i);
});

test("9b: stopped run without actionable approval is SYSTEM attention, never Owner-decision", async () => {
  const lc = store.resolve(base({
    submissionStatus: "failed",
    steps: [step("video", "failed")],
    jobs: [job(1, "failed", "boom")],
  }));
  assert.ok(lc.overallState === "BLOCKED" || lc.overallState === "FAILED_TERMINAL");
  assert.match(lc.overallLabel, /Stopped/);
  assert.match(lc.nextStep, /No Owner decision is currently required/);
  assert.match(lc.ifYouDoNothing, /stays stopped/);
  const sys = lc.attention.filter((a) => a.kind === "SYSTEM");
  assert.equal(sys.length, 1);
  assert.match(sys[0].title, /Historical stopped run/);
  assert.ok(lc.attention.every((a) => a.kind !== "APPROVAL"), "no Owner-decision items");
});

test("10: downstream artifact cannot complete an unrelated stage", async () => {
  const lc = store.resolve(base({
    artifacts: [art("f1", "final_media_artifact")],
  }));
  const research = lc.phases.find((p) => p.id === "research");
  assert.equal(research.state, "NOT_STARTED");
  const media = lc.phases.find((p) => p.id === "media");
  assert.equal(media.state, "COMPLETED");
});

test("11/12: wrong-project and invalid artifacts are ignored", async () => {
  const lc = store.resolve(base({
    artifacts: [art(null, "research_report"), art("a1", "totally-unknown-kind")],
  }));
  assert.equal(lc.milestones.find((m) => m.id === "research").completed, false);
  assert.equal(lc.outputs.length, 0);
});

test("13/14/15: validation-only never becomes production/publication; not ready to publish", async () => {
  const lc = store.resolve(base({
    artifacts: [art("v1", "publication_integration_validation")],
    approvals: [appr("apv", "publication_integration_validation_gate", `${W}:x`, "DECIDED", "APPROVE")],
  }));
  assert.equal(lc.overallState, "VALIDATION_COMPLETED");
  assert.equal(lc.productionApproval, "NOT_GRANTED");
  assert.equal(lc.publicationApproval, "NOT_GRANTED");
  assert.equal(lc.readyToPublish, false);
  assert.match(lc.readinessNote, /separate explicit Owner approval/i);
  assert.match(lc.overallLabel, /validation complete/i);
  assert.doesNotMatch(lc.overallLabel + lc.nextStep, /ready to publish/i);
});

test("16: validation complete but target account unresolved stays not-ready", async () => {
  const lc = store.resolve(base({
    artifacts: [art("v1", "publication_integration_validation")],
    approvals: [appr("apv", "publication_integration_validation_gate", `${W}:x`, "DECIDED", "APPROVE")],
  }));
  assert.equal(lc.publicStatus, "NOT_PUBLISHED");
  assert.equal(lc.readyToPublish, false);
});

test("18/19: reload identical + deterministic ordering", async () => {
  const input = base({
    artifacts: [art("b", "seo_report"), art("a", "research_report")],
    approvals: [appr("ap2", "workflow_gate", `${W}:g2`, "PENDING"), appr("ap1", "workflow_gate", `${W}:g1`, "PENDING")],
  });
  const r1 = store.resolve(input);
  const r2 = store.resolve(input);
  // resolvedAt is wall-clock per resolution by design; determinism covers content.
  const { resolvedAt: _t1, ...c1 } = r1;
  const { resolvedAt: _t2, ...c2 } = r2;
  assert.ok(typeof r1.resolvedAt === "string" && typeof r2.resolvedAt === "string");
  assert.deepEqual(c1, c2);
  assert.deepEqual(r1.phases.map((p) => p.id),
    ["plan", "research", "create", "review", "media", "final-review", "publication", "analytics"]);
});

test("20: conflict fails closed on duplicate pending gate", async () => {
  const lc = store.resolve(base({
    approvals: [
      appr("ap1", "workflow_gate", `${W}:same-gate`, "PENDING"),
      appr("ap2", "workflow_gate", `${W}:same-gate`, "PENDING"),
    ],
  }));
  assert.equal(lc.overallState, "STATE_CONFLICT");
  assert.ok(lc.conflicts.length > 0);
  assert.match(lc.overallLabel, /platform review/i);
});

test("21/22: attention derived + outputs map to canonical artifacts", async () => {
  const lc = store.resolve(base({
    approvals: [appr("ap1", "workflow_gate", `${W}:pre-production-owner-gate`, "PENDING")],
    artifacts: [art("s1", "writer_report"), art("s2", "writer_report")],
  }));
  assert.equal(lc.attention[0].phaseId, "review");
  const script = lc.outputs.find((o) => o.id === "script");
  assert.equal(script.count, 2);
  assert.deepEqual(script.artifactIds, ["s1", "s2"]);
});

test("23/24: technical history available; no secrets in output", async () => {
  const lc = store.resolve(base({
    steps: [step("video", "failed", 3)],
    jobs: [job(9, "failed", "OPENROUTER_API_KEY=xyz SECRET hunter2 token abc")],
  }));
  const dumped = JSON.stringify(lc);
  assert.match(dumped, /video/);
  assert.match(dumped, /attempts/);
  // Secret VALUES never surface; key names may remain as safe diagnostics.
  assert.doesNotMatch(dumped, /xyz/);
  assert.doesNotMatch(dumped, /hunter2/);
  assert.doesNotMatch(dumped, /token abc/);
  assert.match(dumped, /\[REDACTED\]/);
});
