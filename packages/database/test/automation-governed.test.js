/**
 * Program 6 — Governed Automation proof (isolated TEST DB, provider-free).
 *
 * Proves the complete provider-free L2 loop for the deterministic fixture
 * project "AMF Automation Test Studio" plus the full negative (A–T) and
 * positive (A–L) matrices.
 *
 * Hard limits: 0 live provider calls, 0 LLM, 0 image, 0 video, 0 uploads,
 * 0 live analytics reads, 0 M4 consumption. All observations are
 * VALIDATION_FIXTURE/STUBBED; all execution is durable automation_* state.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  createPool, migrate, AutomationStore, ControlPlaneStore, ChannelStore,
  LearningLoopStore, defaultAutomationPolicy, normalizePolicyInput,
  evaluateActionEligibility, classifyFailure, shouldRetry,
  validateAgentAutomationContract,
} from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();
if (!process.env.TEST_DATABASE_URL) throw new Error("Program 6 proof requires isolated TEST_DATABASE_URL");

// Provider-call accounting: this file must never touch a provider adapter.
let REAL_PROVIDER_CALLS = 0;

const RID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const STUDIO = `auto-studio-${RID}`;
const nowIso = () => new Date().toISOString();
const pastIso = () => new Date(Date.now() - 60_000).toISOString();

let pool, auto, control, channels, learning;

before(async () => {
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  auto = new AutomationStore(pool);
  control = new ControlPlaneStore(pool);
  channels = new ChannelStore(pool);
  learning = new LearningLoopStore(pool);
  await control.registerProject({ projectId: STUDIO, displayName: "AMF Automation Test Studio" });
  await control.registerProject({ projectId: `${STUDIO}-b`, displayName: "AMF Automation Test Studio B" });
});
after(async () => { await pool.end(); });

const L2_INTERNAL = [
  "internal.prepare", "internal.plan", "workflow.resume", "analytics.schedule",
  "learning.evaluate", "learning.recommend", "learning.propose",
  "nextcycle.evaluate", "publication.prepare",
];

async function l2Policy(projectId, extra = {}) {
  return auto.setPolicy({
    projectId, enabled: true, level: "L2_GOVERNED",
    allowedOps: [...L2_INTERNAL, ...(extra.allowedOps ?? [])],
    humanGatedOps: [...(extra.humanGatedOps ?? [])],
    providerPolicy: { mode: "DENY_ALL" },
    publicationPolicy: "PREPARE_ONLY",
    nextCyclePolicy: extra.nextCyclePolicy ?? "OWNER_START_ONLY",
    updatedBy: "proof-fixture",
  });
}

async function makeApproval(projectId, targetId) {
  const id = `apr-${RID}-${Math.random().toString(36).slice(2, 8)}`;
  await control.createApproval({
    approvalId: id, projectId, targetType: "automation_gate", targetId,
    agentRecommendation: { gate: targetId }, agentConfidence: "high",
    evidenceRefs: [], status: "PENDING", supersedes: null, supersededBy: null,
    createdAt: nowIso(),
  });
  return id;
}

async function makeProposalChain(projectId, tag) {
  const obs = await learning.recordObservation({
    projectId, workflowId: `wf-${tag}`, lineageKind: "VALIDATION_FIXTURE",
    windowStart: "2026-09-01T00:00:00.000Z", windowEnd: "2026-09-15T00:00:00.000Z",
    metrics: { views: 1200, likes: 96 }, metricProvenance: "STUBBED", transportProvenance: "STUBBED",
  });
  const lr = await learning.recordLearning({
    projectId, observationIds: [obs.observation.observationId],
    finding: `fixture finding ${tag}`, evidence: { tag },
  });
  const rc = await learning.recommend({
    projectId, learningId: lr.learning.learningId, proposal: `follow-up ${tag}`,
    rationale: "fixture rationale", evidence: { tag },
  });
  assert.equal(rc.recommendation.requiresOwnerDecision, true);
  const pc = await learning.proposeNextCycle({
    projectId, recommendationId: rc.recommendation.recommendationId, summary: `cycle ${tag}`,
  });
  assert.equal(pc.proposal.status, "AWAITS_OWNER_DECISION");
  return { obs: obs.observation, learn: lr.learning, rec: rc.recommendation, proposal: pc.proposal };
}

// ---------------------------------------------------------------------------
// Negative proof matrix A–T
// ---------------------------------------------------------------------------

test("NEG A: automation OFF starts nothing", async () => {
  const p = await auto.getPolicy(`${STUDIO}-unknown-noprop`);
  assert.equal(p.enabled, false);
  assert.deepEqual(p.allowedOps, []);
  const t = await auto.tick(`${STUDIO}-unknown-noprose`, { maxActions: 5 });
  void t;
  const t2 = await auto.tick(`${STUDIO}-unknown-nopropose`, { maxActions: 5 });
  assert.equal(t2.acted, 0);
  assert.equal(t2.started, 0);
  const ex = await auto.explain(`${STUDIO}-unknown-nopropose2`);
  assert.ok(ex.notApplicable.some((r) => r.reasons.includes("AUTOMATION_DISABLED")));
});

test("NEG B: MANUAL mode starts nothing automatically", async () => {
  const pid = `${STUDIO}-manual`;
  await control.registerProject({ projectId: pid, displayName: "manual" });
  await auto.setPolicy({ projectId: pid, enabled: true, level: "L0_MANUAL", allowedOps: ["internal.prepare"], updatedBy: "proof" });
  await auto.scheduleJob({ projectId: pid, jobType: "eligible_work_evaluation", dueAt: pastIso(), payload: {}, idempotencyKey: `neg-b-${RID}` });
  const t = await auto.tick(pid, { maxActions: 5 });
  assert.equal(t.acted, 0);
  assert.equal(t.started, 0);
  const job = (await auto.listJobs(pid))[0];
  assert.ok(["PENDING", "SCHEDULED"].includes(job.state), "manual job left untouched");
});

test("NEG C: missing project scope fails closed", async () => {
  const r = evaluateActionEligibility(defaultAutomationPolicy("p"), "internal.prepare", {
    projectId: "p", actionProjectId: "",
  });
  assert.equal(r.verdict, "BLOCKED");
  assert.ok(r.reasons.includes("PROJECT_SCOPE_REQUIRED"));
});

test("NEG D: cross-project proposal rejected", async () => {
  const pidA = `${STUDIO}-dxa`;
  await control.registerProject({ projectId: pidA, displayName: "dxa" });
  await l2Policy(pidA, { nextCyclePolicy: "AUTO_START_AFTER_OWNER_APPROVAL" });
  const chain = await makeProposalChain(pidA, `dx-${RID}`);
  // Approval lives in ANOTHER project: attach and evaluate -> must fail closed.
  const foreignApproval = await makeApproval(`${STUDIO}-b`, chain.proposal.proposalId);
  await pool.query(`UPDATE next_cycle_proposals SET approval_id=$2 WHERE proposal_id=$1`, [chain.proposal.proposalId, foreignApproval]);
  const ev = await auto.evaluateNextCycleProposal(chain.proposal.proposalId);
  assert.equal(ev.eligibleToStart, false);
  assert.equal(ev.verdict, "BLOCKED");
  assert.ok(ev.reasons.includes("CROSS_PROJECT_DENIED"));
  // Pure cross-project eligibility also fails closed.
  const r = evaluateActionEligibility(defaultAutomationPolicy(pidA), "internal.prepare", {
    projectId: pidA, actionProjectId: `${STUDIO}-b`,
  });
  assert.equal(r.verdict, "BLOCKED");
});

test("NEG E: cross-project channel rejected", async () => {
  const ch = await channels.createChannel({ projectId: `${STUDIO}-b`, platform: "youtube", displayName: "foreign" });
  await assert.rejects(
    auto.scheduleAnalyticsMeasurement({ projectId: STUDIO, channelId: ch.channelId, idempotencyKey: `neg-e-${RID}` }),
    /CROSS_PROJECT/,
  );
});

test("NEG F: missing authority blocks governed external action", async () => {
  const pid = `${STUDIO}-negf`;
  await control.registerProject({ projectId: pid, displayName: "negf" });
  const policy = await auto.setPolicy({
    projectId: pid, enabled: true, level: "L2_GOVERNED", allowedOps: ["provider.llm"],
    providerPolicy: { mode: "ALLOW_LISTED", allowedProviderOps: ["provider.llm"] }, updatedBy: "proof",
  });
  await auto.setCallBudget({ projectId: pid, callKind: "llm", limitCount: 5 });
  const budget = await auto.checkCallBudget(pid, "llm", 1);
  assert.equal(budget.allowed, true);
  const r = evaluateActionEligibility(policy, "provider.llm", {
    projectId: pid, actionProjectId: pid, providerOp: "provider.llm",
    budgetCheck: { allowed: true, reason: "BUDGET_AVAILABLE", remaining: 5 },
    authorityPresent: false, inputsComplete: true,
  });
  assert.equal(r.verdict, "BLOCKED");
  assert.ok(r.reasons.includes("MISSING_AUTHORITY_FOR_EXTERNAL_ACTION"));
});

test("NEG G: missing budget blocks provider action", async () => {
  const pid = `${STUDIO}-negg`;
  await control.registerProject({ projectId: pid, displayName: "negg" });
  const policy = await auto.setPolicy({
    projectId: pid, enabled: true, level: "L2_GOVERNED", allowedOps: ["provider.image"],
    providerPolicy: { mode: "ALLOW_LISTED", allowedProviderOps: ["provider.image"] }, updatedBy: "proof",
  });
  const r = evaluateActionEligibility(policy, "provider.image", {
    projectId: pid, actionProjectId: pid, providerOp: "provider.image",
    authorityPresent: true, inputsComplete: true,
  });
  assert.equal(r.verdict, "BLOCKED");
  assert.ok(r.reasons.includes("BUDGET_NOT_CONFIGURED"));
});

test("NEG H: exhausted call budget blocks provider action", async () => {
  const pid = `${STUDIO}-negh`;
  await control.registerProject({ projectId: pid, displayName: "negh" });
  await auto.setCallBudget({ projectId: pid, callKind: "image", limitCount: 1 });
  await auto.consumeCallBudget(pid, "image", 1, "fixture-use");
  const check = await auto.checkCallBudget(pid, "image", 1);
  assert.equal(check.allowed, false);
  assert.equal(check.reason, "BUDGET_EXHAUSTED");
  await assert.rejects(auto.consumeCallBudget(pid, "image", 1, "double-spend"), /BUDGET_EXHAUSTED/);
  const after = await auto.checkCallBudget(pid, "image", 1);
  assert.equal(after.used, 1, "no double-spend recorded");
});

test("NEG I: human gate cannot be bypassed", async () => {
  const pid = `${STUDIO}-negi`;
  await control.registerProject({ projectId: pid, displayName: "negi" });
  await l2Policy(pid, { allowedOps: ["nextcycle.start.internal"], humanGatedOps: ["nextcycle.start.internal"], nextCyclePolicy: "L2_PREAUTHORIZED_INTERNAL_CYCLE" });
  const chain = await makeProposalChain(pid, `neg-i-${RID}`);
  const res = await auto.startNextCycle(chain.proposal.proposalId, "proof");
  assert.equal(res.started, false);
  assert.equal(res.evaluation.verdict, "REQUIRES_OWNER_DECISION");
});

test("NEG J: unresolved decision cannot resume", async () => {
  const pid = `${STUDIO}-negj`;
  await control.registerProject({ projectId: pid, displayName: "negj" });
  await l2Policy(pid, { humanGatedOps: ["workflow.resume"] });
  const approvalId = await makeApproval(pid, `gate-${RID}`);
  await auto.scheduleJob({ projectId: pid, jobType: "workflow_resume", dueAt: pastIso(), payload: { approvalId }, idempotencyKey: `neg-j-${RID}` });
  const t = await auto.tick(pid, { maxActions: 5 });
  const jobs = await auto.listJobs(pid);
  assert.equal(jobs[0].state, "SCHEDULED", "parked, not executed");
  const open = await auto.listAttention(pid, { status: "OPEN" });
  assert.ok(open.some((a) => a.kind === "DECISION_REQUIRED"));
  assert.equal(t.resumed, 0);
});

test("NEG K: rejected decision does not continue as approved", async () => {
  const pid = `${STUDIO}-negk`;
  await control.registerProject({ projectId: pid, displayName: "negk" });
  await l2Policy(pid, { humanGatedOps: ["workflow.resume"] });
  const approvalId = await makeApproval(pid, `gate-k-${RID}`);
  await auto.raiseAttention({ projectId: pid, kind: "DECISION_REQUIRED", subjectType: "control_approval", subjectId: approvalId, detail: {} });
  await control.decideApproval(approvalId, "REJECT", "not good enough");
  const t = await auto.tick(pid, { maxActions: 5 });
  assert.equal(t.resumed, 0);
  const jobs = await auto.listJobs(pid);
  assert.ok(!jobs.some((j) => j.jobType === "workflow_resume" && j.state === "SUCCEEDED"), "no resume executed");
  const events = await auto.listEvents(pid, 50);
  assert.ok(events.some((e) => e.kind === "gate.settled_rejected"));
});

test("NEG L: duplicate trigger does not duplicate execution", async () => {
  const pid = `${STUDIO}-negl`;
  await control.registerProject({ projectId: pid, displayName: "negl" });
  await l2Policy(pid, { nextCyclePolicy: "L2_PREAUTHORIZED_INTERNAL_CYCLE", allowedOps: ["nextcycle.start.internal"] });
  const chain = await makeProposalChain(pid, `neg-l-${RID}`);
  const first = await auto.startNextCycle(chain.proposal.proposalId, "proof");
  assert.equal(first.started, true);
  assert.equal(first.created, true);
  const second = await auto.startNextCycle(chain.proposal.proposalId, "proof");
  assert.equal(second.created, false);
  assert.equal(second.job.jobId, first.job.jobId);
  const rows = await pool.query(`SELECT count(*)::int n FROM automation_jobs WHERE idempotency_key=$1`, [`nextcycle-${chain.proposal.proposalId}`]);
  assert.equal(rows.rows[0].n, 1);
  const sched = await auto.scheduleJob({ projectId: pid, jobType: "eligible_work_evaluation", dueAt: pastIso(), payload: {}, idempotencyKey: `neg-l2-${RID}` });
  const dup = await auto.scheduleJob({ projectId: pid, jobType: "eligible_work_evaluation", dueAt: pastIso(), payload: {}, idempotencyKey: `neg-l2-${RID}` });
  assert.equal(sched.created, true);
  assert.equal(dup.created, false);
  assert.equal(dup.job.jobId, sched.job.jobId);
});

test("NEG M: runtime restart does not duplicate completed action", async () => {
  const pid = `${STUDIO}-negm`;
  await control.registerProject({ projectId: pid, displayName: "negm" });
  await l2Policy(pid);
  const { job } = await auto.scheduleJob({ projectId: pid, jobType: "eligible_work_evaluation", dueAt: pastIso(), payload: {}, idempotencyKey: `neg-m-${RID}` });
  await auto.tick(pid, { maxActions: 5 });
  const done = await auto.getJob(job.jobId, pid);
  assert.equal(done.state, "SUCCEEDED");
  const rec = await auto.recoverAfterRestart(pid);
  assert.equal(rec.recovered, 0);
  const still = await auto.getJob(job.jobId, pid);
  assert.equal(still.state, "SUCCEEDED");
  // Interrupted (CLAIMED) work is re-queued exactly once, never completed.
  const { job: j2 } = await auto.scheduleJob({ projectId: pid, jobType: "eligible_work_evaluation", dueAt: pastIso(), payload: {}, idempotencyKey: `neg-m2-${RID}` });
  await auto.claimDueJobs(pid, nowIso(), 5);
  const claimed = await auto.getJob(j2.jobId, pid);
  assert.equal(claimed.state, "CLAIMED");
  const rec2 = await auto.recoverAfterRestart(pid);
  assert.equal(rec2.recovered, 1);
  const back = await auto.getJob(j2.jobId, pid);
  assert.equal(back.state, "PENDING");
});

test("NEG N: non-retryable failure is not retried", async () => {
  const pid = `${STUDIO}-negn`;
  await control.registerProject({ projectId: pid, displayName: "negn" });
  await l2Policy(pid);
  const { job } = await auto.scheduleJob({ projectId: pid, jobType: "eligible_work_evaluation", dueAt: pastIso(), payload: {}, idempotencyKey: `neg-n-${RID}` });
  const res = await auto.failJob(job.jobId, pid, { errorCode: "VALIDATION_FAILED_SCHEMA", errorMessage: "permanent" });
  assert.equal(res.classification, "PERMANENT");
  assert.equal(res.retried, false);
  assert.equal(res.job.state, "DEAD_LETTER");
  const open = await auto.listAttention(pid, { status: "OPEN" });
  assert.ok(open.some((a) => a.kind === "FAILED" && a.subjectId === job.jobId));
});

test("NEG O: retryable failure obeys retry cap", async () => {
  const pid = `${STUDIO}-nego`;
  await control.registerProject({ projectId: pid, displayName: "nego" });
  await l2Policy(pid);
  const { job } = await auto.scheduleJob({ projectId: pid, jobType: "eligible_work_evaluation", dueAt: pastIso(), payload: {}, idempotencyKey: `neg-o-${RID}`, maxAttempts: 2 });
  const r1 = await auto.failJob(job.jobId, pid, { errorCode: "TIMEOUT", errorMessage: "transient" });
  assert.equal(r1.classification, "RETRYABLE");
  assert.equal(r1.retried, true);
  assert.equal(r1.job.state, "SCHEDULED");
  assert.ok(r1.job.nextEligibleAt);
  const r2 = await auto.failJob(job.jobId, pid, { errorCode: "TIMEOUT", errorMessage: "transient again" });
  assert.equal(r2.retried, false);
  assert.equal(r2.job.state, "DEAD_LETTER");
  assert.equal(r2.job.attemptCount, 2);
});

test("NEG P: unknown credential state fails closed", async () => {
  const pid = `${STUDIO}-negp`;
  await control.registerProject({ projectId: pid, displayName: "negp" });
  const policy = await l2Policy(pid);
  const r = evaluateActionEligibility(policy, "internal.prepare", {
    projectId: pid, actionProjectId: pid,
    credentialCheck: { known: false, valid: false }, inputsComplete: true,
  });
  assert.equal(r.verdict, "BLOCKED");
  assert.ok(r.reasons.includes("UNKNOWN_CREDENTIAL"));
});

test("NEG Q: unknown channel state fails closed", async () => {
  const pid = `${STUDIO}-negq`;
  await control.registerProject({ projectId: pid, displayName: "negq" });
  const policy = await l2Policy(pid);
  const r = evaluateActionEligibility(policy, "internal.prepare", {
    projectId: pid, actionProjectId: pid,
    channelCheck: { known: false, sameProject: false, verified: false, explicit: true }, inputsComplete: true,
  });
  assert.equal(r.verdict, "BLOCKED");
  assert.ok(r.reasons.includes("UNKNOWN_CHANNEL"));
});

test("NEG R: proposal does not imply next-cycle authority", async () => {
  const pid = `${STUDIO}-negr`;
  await control.registerProject({ projectId: pid, displayName: "negr" });
  await l2Policy(pid, { nextCyclePolicy: "OWNER_START_ONLY", allowedOps: ["nextcycle.start.internal"] });
  const chain = await makeProposalChain(pid, `neg-r-${RID}`);
  const res = await auto.startNextCycle(chain.proposal.proposalId, "proof");
  assert.equal(res.started, false);
  assert.ok(["REQUIRES_OWNER_DECISION", "WAITING"].includes(res.evaluation.verdict));
  const open = await auto.listAttention(pid, { status: "OPEN" });
  assert.ok(open.some((a) => a.kind === "READY_FOR_OWNER_START" && a.subjectId === chain.proposal.proposalId));
});

test("NEG S: recommendation does not imply proposal acceptance", async () => {
  const pid = `${STUDIO}-negs`;
  await control.registerProject({ projectId: pid, displayName: "negs" });
  const chain = await makeProposalChain(pid, `neg-s-${RID}`);
  assert.equal(chain.rec.requiresOwnerDecision, true);
  assert.equal(chain.proposal.status, "AWAITS_OWNER_DECISION");
  assert.equal(chain.proposal.approvalId, null);
  const subs = await pool.query(`SELECT count(*)::int n FROM workflow_submissions WHERE brand_id=$1`, [pid]);
  assert.equal(subs.rows[0].n, 0, "no workflow started by recommendation/proposal");
});

test("NEG T: readiness does not imply publication authority", async () => {
  const pid = `${STUDIO}-negt`;
  await control.registerProject({ projectId: pid, displayName: "negt" });
  const policy = await auto.setPolicy({
    projectId: pid, enabled: true, level: "L2_GOVERNED",
    allowedOps: ["publication.execute", "publication.prepare"],
    publicationPolicy: "PREAUTHORIZED_DESTINATION_SCOPE", updatedBy: "proof",
  });
  const r = evaluateActionEligibility(policy, "publication.execute", {
    projectId: pid, actionProjectId: pid, authorityPresent: true,
    channelCheck: { known: true, sameProject: true, verified: true, explicit: true },
    credentialCheck: { known: true, valid: true }, inputsComplete: true,
  });
  assert.equal(r.verdict, "BLOCKED");
  assert.ok(r.reasons.includes("AUTOMATIC_PUBLICATION_NOT_ENABLED"));
});

// ---------------------------------------------------------------------------
// Positive proof matrix A–L
// ---------------------------------------------------------------------------

test("POS A: eligible internal action can start under L2 policy", async () => {
  const pid = `${STUDIO}-posa`;
  await control.registerProject({ projectId: pid, displayName: "posa" });
  await l2Policy(pid);
  const ex = await auto.explain(pid);
  assert.ok(ex.eligible.length + ex.waiting.length + ex.blocked.length + ex.notApplicable.length >= 1);
  await auto.scheduleJob({ projectId: pid, jobType: "eligible_work_evaluation", dueAt: pastIso(), payload: {}, idempotencyKey: `pos-a-${RID}` });
  const t = await auto.tick(pid, { maxActions: 5 });
  assert.ok(t.acted >= 1);
  const jobs = await auto.listJobs(pid);
  assert.equal(jobs[0].state, "SUCCEEDED");
});

test("POS B: safe workflow progresses (internal checkpoints complete)", async () => {
  const pid = `${STUDIO}-posb`;
  await control.registerProject({ projectId: pid, displayName: "posb" });
  await l2Policy(pid);
  await auto.scheduleJob({ projectId: pid, jobType: "content_planning_checkpoint", dueAt: pastIso(), payload: { contentId: "ct-pos-b" }, idempotencyKey: `pos-b1-${RID}` });
  await auto.scheduleJob({ projectId: pid, jobType: "eligible_work_evaluation", dueAt: pastIso(), payload: {}, idempotencyKey: `pos-b2-${RID}` });
  const t = await auto.tick(pid, { maxActions: 5 });
  assert.equal(t.acted, 2);
  for (const j of await auto.listJobs(pid)) assert.equal(j.state, "SUCCEEDED");
});

test("POS C+D: required human gate pauses, canonical approval resumes", async () => {
  const pid = `${STUDIO}-poscd`;
  await control.registerProject({ projectId: pid, displayName: "poscd" });
  await l2Policy(pid, { humanGatedOps: ["workflow.resume"] });
  const approvalId = await makeApproval(pid, `gate-cd-${RID}`);
  await auto.scheduleJob({ projectId: pid, jobType: "workflow_resume", dueAt: pastIso(), payload: { approvalId }, idempotencyKey: `pos-cd-${RID}` });
  const paused = await auto.tick(pid, { maxActions: 5 });
  assert.equal(paused.resumed, 0);
  const parked = (await auto.listJobs(pid))[0];
  assert.equal(parked.state, "SCHEDULED");
  // Canonical Owner decision fixture (Decision Center path, not automation).
  await control.decideApproval(approvalId, "APPROVE", "proceed after review");
  const resumed = await auto.tick(pid, { maxActions: 5 });
  assert.equal(resumed.resumed, 1);
  const done = await auto.getJob(parked.jobId, pid);
  assert.equal(done.state, "SUCCEEDED");
});

test("POS E: scheduled job becomes eligible at due time", async () => {
  const pid = `${STUDIO}-pose`;
  await control.registerProject({ projectId: pid, displayName: "pose" });
  await l2Policy(pid);
  await auto.scheduleJob({
    projectId: pid, jobType: "eligible_work_evaluation",
    dueAt: new Date(Date.now() + 3600_000).toISOString(), payload: {}, idempotencyKey: `pos-e-${RID}`,
  });
  const due = await auto.listDueJobs(pid, nowIso(), 10);
  assert.equal(due.length, 0);
  const t = await auto.tick(pid, { maxActions: 5 });
  assert.equal(t.acted, 0, "future job untouched");
  const jobs = await auto.listJobs(pid);
  assert.ok(["PENDING", "SCHEDULED"].includes(jobs[0].state));
});

test("POS F: bounded retry works", async () => {
  const r = classifyFailure("ETIMEOUT transient");
  assert.equal(r, "RETRYABLE");
  assert.equal(shouldRetry("RETRYABLE", 0, 3), true);
  assert.equal(shouldRetry("RETRYABLE", 3, 3), false);
  assert.equal(shouldRetry("PERMANENT", 0, 3), false);
  assert.equal(classifyFailure("missing credential token"), "REQUIRES_CREDENTIAL");
  assert.equal(classifyFailure("owner gate approval"), "REQUIRES_OWNER");
  assert.equal(classifyFailure("weird unknown thing"), "NON_RETRYABLE");
});

test("POS G+H: learning chain progresses from valid observation; proposal generated", async () => {
  const pid = `${STUDIO}-posgh`;
  await control.registerProject({ projectId: pid, displayName: "posgh" });
  await l2Policy(pid);
  const obs = await learning.recordObservation({
    projectId: pid, workflowId: `wf-posgh-${RID}`, lineageKind: "VALIDATION_FIXTURE",
    windowStart: "2026-09-01T00:00:00.000Z", windowEnd: "2026-09-15T00:00:00.000Z",
    metrics: { views: 5000, likes: 400, comments: 40 }, metricProvenance: "STUBBED", transportProvenance: "STUBBED",
  });
  assert.equal(obs.created, true);
  const chain = await auto.progressLearningChain({ projectId: pid, observationId: obs.observation.observationId });
  assert.equal(chain.verdict, "ELIGIBLE");
  assert.ok(chain.learningId);
  assert.ok(chain.recommendationId);
  assert.ok(chain.proposalId);
  // Idempotent re-run returns the same deterministic chain, no duplicates.
  const again = await auto.progressLearningChain({ projectId: pid, observationId: obs.observation.observationId });
  assert.equal(again.proposalId, chain.proposalId);
  assert.deepEqual(again.created, { learning: false, recommendation: false, proposal: false });
});

test("POS I+J: governed starter evaluates proposal; Owner-required starter stops", async () => {
  const pid = `${STUDIO}-posij`;
  await control.registerProject({ projectId: pid, displayName: "posij" });
  await l2Policy(pid, { nextCyclePolicy: "OWNER_START_ONLY", allowedOps: ["nextcycle.start.internal"] });
  const chain = await makeProposalChain(pid, `pos-ij-${RID}`);
  const ev = await auto.evaluateNextCycleProposal(chain.proposal.proposalId);
  assert.equal(ev.eligibleToStart, false);
  assert.equal(ev.verdict, "REQUIRES_OWNER_DECISION");
  assert.ok(ev.checks && ev.checks.nextCyclePolicy === "OWNER_START_ONLY");
  const res = await auto.startNextCycle(chain.proposal.proposalId, "proof");
  assert.equal(res.started, false);
  const open = await auto.listAttention(pid, { status: "OPEN" });
  assert.ok(open.some((a) => a.kind === "READY_FOR_OWNER_START"));
});

test("POS K: audit trail explains every automated transition", async () => {
  const pid = `${STUDIO}-posk`;
  await control.registerProject({ projectId: pid, displayName: "posk" });
  await l2Policy(pid);
  await auto.scheduleJob({ projectId: pid, jobType: "eligible_work_evaluation", dueAt: pastIso(), payload: {}, idempotencyKey: `pos-k-${RID}` });
  await auto.tick(pid, { maxActions: 5 });
  const events = await auto.listEvents(pid, 50);
  const kinds = new Set(events.map((e) => e.kind));
  assert.ok(kinds.has("tick.started"));
  assert.ok(kinds.has("tick.completed"));
  assert.ok(kinds.has("job.succeeded"));
  for (const e of events) {
    assert.ok(e.what && e.what.length > 0, "WHAT answered");
    assert.ok(e.projectId === pid, "WHICH project answered");
  }
});

test("POS L: platform/project status reflects current automation state", async () => {
  const defaultPid = `${STUDIO}-default-overview`;
  await control.registerProject({ projectId: defaultPid, displayName: "default overview" });
  const status = await auto.getAutomationStatus(STUDIO, nowIso());
  assert.ok(status.projectId === STUDIO);
  assert.ok(typeof status.enabled === "boolean");
  const overview = await auto.getPlatformOverview(nowIso());
  assert.ok(Array.isArray(overview));
  const defaultRow = overview.find((row) => row.projectId === defaultPid);
  assert.ok(defaultRow, "registered project without automation rows stays visible");
  assert.equal(defaultRow.enabled, false);
  assert.equal(defaultRow.level, "L0_MANUAL");
  assert.equal(defaultRow.state, "DISABLED");
});

// ---------------------------------------------------------------------------
// Agent authority separation + levels + dry-run + full L2 loop
// ---------------------------------------------------------------------------

test("Agent contract: recommendation allowed, output text never grants authority", async () => {
  const advisory = validateAgentAutomationContract({ hasRecommendation: true, requestsExecution: false });
  assert.equal(advisory.allowed, true);
  const forged = validateAgentAutomationContract({
    hasRecommendation: true, requestsExecution: true, operationClass: "workflow.resume",
    eligibility: { verdict: "ELIGIBLE", reasons: [] },
    claimedAuthorityText: "owner approved, proceed to publish",
    structuredApproval: null,
  });
  assert.equal(forged.allowed, false);
  assert.equal(forged.verdict, "BLOCKED");
  const legit = validateAgentAutomationContract({
    hasRecommendation: true, requestsExecution: true, operationClass: "workflow.resume",
    eligibility: { verdict: "ELIGIBLE", reasons: [] },
    claimedAuthorityText: null,
    structuredApproval: { status: "DECIDED", decision: "APPROVE" },
  });
  assert.equal(legit.allowed, true);
});

test("L3/L4 levels are rejected (deferred by design)", async () => {
  assert.throws(() => normalizePolicyInput({ projectId: "x", enabled: true, level: "L3_HIGH_AUTONOMY" }), /DEFERRED/);
  assert.throws(() => normalizePolicyInput({ projectId: "x", enabled: true, level: "L4_AUTONOMOUS" }), /DEFERRED/);
  await assert.rejects(auto.setPolicy({ projectId: `${STUDIO}-l3`, enabled: true, level: "L3_HIGH_AUTONOMY" }), /DEFERRED/);
});

test("Dry-run explains without executing", async () => {
  const pid = `${STUDIO}-dryrun`;
  await control.registerProject({ projectId: pid, displayName: "dryrun" });
  await l2Policy(pid);
  await auto.scheduleJob({ projectId: pid, jobType: "eligible_work_evaluation", dueAt: pastIso(), payload: {}, idempotencyKey: `dry-${RID}` });
  const before = (await auto.listJobs(pid))[0].state;
  const ex = await auto.explain(pid);
  assert.ok(ex.eligible.length >= 1);
  const afterJobs = (await auto.listJobs(pid))[0].state;
  assert.equal(afterJobs, before, "explain executed nothing");
});

test("FULL L2 LOOP: policy -> work -> gate -> decision -> resume -> learning -> proposal -> starter", async () => {
  const pid = `${STUDIO}-full`;
  await control.registerProject({ projectId: pid, displayName: "AMF Automation Test Studio Loop" });
  await auto.setPolicy({
    projectId: pid, enabled: true, level: "L2_GOVERNED",
    allowedOps: [...L2_INTERNAL, "nextcycle.start.internal"],
    humanGatedOps: ["workflow.resume"],
    providerPolicy: { mode: "DENY_ALL" },
    publicationPolicy: "PREPARE_ONLY",
    nextCyclePolicy: "L2_PREAUTHORIZED_INTERNAL_CYCLE",
    updatedBy: "proof",
  });
  // 1. Eligible internal work progresses automatically.
  await auto.scheduleJob({ projectId: pid, jobType: "content_planning_checkpoint", dueAt: pastIso(), payload: { stage: "brief" }, idempotencyKey: `full-prep-${RID}` });
  const t1 = await auto.tick(pid, { maxActions: 5 });
  assert.ok(t1.acted >= 1);
  // 2. Human gate: automation stops.
  const approvalId = await makeApproval(pid, `loop-gate-${RID}`);
  await auto.scheduleJob({ projectId: pid, jobType: "workflow_resume", dueAt: pastIso(), payload: { approvalId }, idempotencyKey: `full-resume-${RID}` });
  const t2 = await auto.tick(pid, { maxActions: 5 });
  assert.equal(t2.resumed, 0);
  const parked = await auto.listJobs(pid, { state: "SCHEDULED" });
  assert.ok(parked.length >= 1, "gate parked the resume");
  // 3. Canonical Owner decision -> automatic resume (no reconstruction).
  await control.decideApproval(approvalId, "APPROVE", "loop fixture approval");
  const t3 = await auto.tick(pid, { maxActions: 5 });
  assert.equal(t3.resumed, 1);
  // 4. Stubbed observation -> evaluation -> learning -> recommendation -> proposal.
  const obs = await learning.recordObservation({
    projectId: pid, workflowId: `wf-full-${RID}`, lineageKind: "VALIDATION_FIXTURE",
    windowStart: "2026-09-01T00:00:00.000Z", windowEnd: "2026-09-15T00:00:00.000Z",
    metrics: { views: 8000, likes: 700 }, metricProvenance: "STUBBED", transportProvenance: "STUBBED",
  });
  const chain = await auto.progressLearningChain({ projectId: pid, observationId: obs.observation.observationId });
  assert.equal(chain.verdict, "ELIGIBLE");
  assert.ok(chain.proposalId);
  // 5. Governed starter starts the preauthorized internal cycle (idempotent).
  const start = await auto.startNextCycle(chain.proposalId, "proof");
  assert.equal(start.started, true);
  const dup = await auto.startNextCycle(chain.proposalId, "proof");
  assert.equal(dup.created, false);
  // 6. Publication boundary holds: nothing published, nothing spent.
  const jobs = await auto.listJobs(pid);
  assert.ok(!jobs.some((j) => j.jobType === "publication_execute"));
  const pubs = await pool.query(`SELECT count(*)::int n FROM provider_publications WHERE workflow_id LIKE $1`, [`%${RID}%`]);
  assert.equal(pubs.rows[0].n, 0);
  // 7. Audit trail covers the loop.
  const events = await auto.listEvents(pid, 100);
  const kinds = new Set(events.map((e) => e.kind));
  for (const k of ["tick.started", "tick.completed", "job.succeeded", "job.awaiting_owner", "gate.resumed", "learning.chain_progressed", "nextcycle.started"]) {
    assert.ok(kinds.has(k), `audit covers ${k}`);
  }
  assert.equal(REAL_PROVIDER_CALLS, 0);
});

test("Morroway has no automation policy row (backward compatible, still manual)", async () => {
  const morroway = await auto.getPolicy("morroway");
  assert.equal(morroway.enabled, false);
  assert.equal(morroway.level, "L0_MANUAL");
});
