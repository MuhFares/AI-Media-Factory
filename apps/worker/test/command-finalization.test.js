/**
 * Slice 5 finalization RCA — command-1789912080235 (no DB, no providers).
 *
 * Proven defect: both participants COMPLETED and synthesis executed with a
 * persisted artifact, yet command FAILED — the synthesis post-hoc gate
 * false-positived on NEGATED safety language ("without ... authorizing
 * publication"), and the failed synthesis output was still persisted and
 * rendered as canonical success. V6 fixes both generally:
 * negation-aware gate + canonical synthesis stored iff COMPLETED.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkflowWorker } from "../dist/worker.js";
import { recommendsOwnerDecision } from "../dist/research-contracts.js";

const MSG = "Review the current Morroway project state independently and recommend the single most useful next step for the project at this stage. Do not change anything, do not start production, and do not authorize publication.";
const LIVE_REC = "Prepare one consolidated adaptive-pilot plan for the initial four-item batch, including real-world source rules, formats, learning hypotheses, dependencies, and explicit production/publication handoff gates.";
const LIVE_NEXT = "Draft the consolidated adaptive-pilot plan without starting production or authorizing publication.";

function v2Part(agent) {
  const research = agent === "research";
  const f = (title, priority, finding, ownerImplication) => ({
    title, priority, finding, evidence: ["platform context"], ownerImplication,
    ownerActionRequired: false, ownerDecisionId: null,
  });
  return {
    summary: research
      ? "Research view: current evidence shows the brand basis is approved and validation is complete."
      : "Planner view: sequencing shows pilot planning is the next feasible work after validation.",
    findings: research ? [
      f("Current brand evidence", "high", "Naming is closed and architecture evidence is approved.", "Stable evidence base."),
      f("Validation evidence", "medium", "Latest workflow reached validation completed.", "Evidence current."),
      f("Pilot evidence state", "low", "Pilot remains planning with a four-item batch.", "FYI."),
    ] : [
      f("Next feasible sequence", "high", "Consolidate validation evidence before pilot planning.", "Sequencing first."),
      f("Readiness gap", "medium", "Readiness brief is the smallest useful next work.", "Ready next."),
      f("Dependency order", "low", "Handoffs gate production and publication.", "Order matters."),
    ],
    ownerActionRequired: false,
    recommendedNextStep: research ? {
      action: "Collect and file the current-state evidence dossier.", actor: "agent", actionType: "evidence_collection",
      requiresOwnerDecision: false, targetDecisionId: null,
    } : {
      action: "Draft the sequenced pilot-readiness brief.", actor: "team", actionType: "planning",
      requiresOwnerDecision: false, targetDecisionId: null,
    },
    limitations: ["Thin evidence."],
  };
}

function ceoOut(next = LIVE_NEXT, rec = LIVE_REC) {
  return {
    agreements: ["Both agree brand settled."], disagreements: ["Emphasis differs."],
    evidence: ["platform context"], recommendation: rec, confidence: 0.9,
    missingEvidence: [], nextAction: next,
  };
}

function harness({ outputs, failCeoSave = false }) {
  const updates = []; const acks = []; const subStatuses = []; const calls = [];
  const saved = [];
  const persistence = {
    saveArtifact: async (a) => {
      if (failCeoSave && a.producerAgent === "ceo") throw new Error("ARTIFACT_STORE_DOWN");
      saved.push(a);
    },
    listArtifacts: async (wf) => saved.filter((a) => a.workflowId === wf).map((a) => ({ ...a, payload: a.payload })),
    saveExecutionProvenance: async () => {},
  };
  let claimed = false;
  const queue = {
    claimNextJob: async () => {
      if (claimed) return null;
      claimed = true;
      return { jobId: "job-1", workflowId: "wf-t" };
    },
    loadSubmissionByWorkflow: async () => ({
      workflowId: "wf-t", correlationId: null, brandId: "morroway",
      commandContext: {
        commandId: "cmd-t", commandType: "MULTI_AGENT_REVIEW",
        selectedAgents: ["research", "planner"], ownerMessage: MSG,
      },
    }),
    acknowledge: async (jobId, status, message) => { acks.push({ jobId, status, message }); },
    updateSubmissionStatus: async (wf, status) => { subStatuses.push({ wf, status }); },
    recoverOrphanedJobs: async () => 0,
  };
  const control = { updateCommand: async (id, input) => { updates.push({ id, input }); } };
  const governedExecute = async (input) => {
    calls.push({ agentId: input.agentId, maxOutputTokens: input.maxOutputTokens, reasoning: input.reasoning ?? null });
    const out = outputs[input.agentId];
    if (out instanceof Error) throw out;
    return { output: out, provider: "openrouter", model: "m", usage: { inputTokens: 1, outputTokens: 1 } };
  };
  const worker = new WorkflowWorker({
    queue, persistence, executor: {}, pollMs: 1,
    resolveCommandConfiguration: async () => ({ "*": { provider: "openrouter", model: "m", source: "GLOBAL" } }),
    resolveOperationalContext: async () => ({ approvals: { pending: 0, actionable: 0, actionableIds: [] } }),
    governedExecute, control,
  });
  return { worker, updates, acks, subStatuses, calls };
}

const finalUpdate = (updates) => updates[updates.length - 1].input;

test("V6-negation: safety refusals are not Owner instructions; affirmative ones still fail", async () => {
  assert.equal(recommendsOwnerDecision(LIVE_NEXT), false, "live negated nextAction passes");
  assert.equal(recommendsOwnerDecision(LIVE_REC), false, "live recommendation passes");
  assert.equal(recommendsOwnerDecision("Do not approve the pending gate."), false);
  assert.equal(recommendsOwnerDecision("Never authorize publication."), false);
  assert.equal(recommendsOwnerDecision("Approve the pending gate now."), true, "affirmative instruction still fails");
  assert.equal(recommendsOwnerDecision("Complete the pending owner brand identity review."), true);
  assert.equal(recommendsOwnerDecision("Ask the Owner to decide on the gate."), true);
});

test("V6-1/7/8/11/12: full canonical success → command COMPLETED, no stale override, no retry/fallback", async () => {
  const h = harness({ outputs: { research: v2Part("research"), planner: v2Part("planner"), ceo: ceoOut() } });
  assert.equal(await h.worker.runOnce(), true);
  assert.equal(h.updates[0].input.status, "WORKING");
  const fin = finalUpdate(h.updates);
  assert.equal(fin.status, "COMPLETED");
  assert.deepEqual(fin.synthesis, ceoOut(), "canonical synthesis persisted");
  assert.equal(fin.artifactRefs.length, 3, "all three artifacts");
  assert.deepEqual(fin.visibleResult.map((r) => r.status), ["COMPLETED", "COMPLETED"]);
  assert.notDeepEqual(fin.visibleResult[0].output, fin.visibleResult[1].output, "independent perspectives, not copies");
  assert.match(JSON.stringify(fin.visibleResult[0].output), /evidence/i);
  assert.match(JSON.stringify(fin.visibleResult[1].output), /sequenc|readiness/i);
  assert.deepEqual(h.subStatuses, [{ wf: "wf-t", status: "completed" }], "workflow terminal matches command");
  assert.equal(h.acks[0].status, "succeeded");
  assert.deepEqual(h.calls.map((c) => c.agentId), ["research", "planner", "ceo"], "exactly one attempt each, no retry");
  assert.ok(h.calls.every((c) => c.maxOutputTokens >= 1000), "contract-sized budgets");
  const dumped = JSON.stringify(h.updates);
  assert.doesNotMatch(dumped, /production approval granted|publication authorized|authority to publish/i);
});

test("V6-2: research FAILED → command FAILED, no synthesis executed", async () => {
  const h = harness({ outputs: { research: { bogus: 1 }, planner: v2Part("planner"), ceo: ceoOut() } });
  await h.worker.runOnce();
  const fin = finalUpdate(h.updates);
  assert.equal(fin.status, "FAILED");
  assert.equal(fin.synthesis, undefined, "no synthesis persisted");
  assert.ok(!h.calls.some((c) => c.agentId === "ceo"), "synthesis not executed");
  assert.equal(fin.visibleResult.find((r) => r.agentId === "research").status, "FAILED");
  assert.equal(fin.visibleResult.find((r) => r.agentId === "planner").status, "COMPLETED", "sibling artifact preserved");
  assert.deepEqual(h.subStatuses, [{ wf: "wf-t", status: "failed" }]);
});

test("V6-3: planner FAILED → command FAILED, no synthesis executed", async () => {
  const h = harness({ outputs: { research: v2Part("research"), planner: { bogus: 1 }, ceo: ceoOut() } });
  await h.worker.runOnce();
  const fin = finalUpdate(h.updates);
  assert.equal(fin.status, "FAILED");
  assert.equal(fin.synthesis, undefined);
  assert.ok(!h.calls.some((c) => c.agentId === "ceo"), "synthesis not executed");
});

test("V6-4/6/9: synthesis FAILED validation → command FAILED, transient output never canonical", async () => {
  const h = harness({
    outputs: { research: v2Part("research"), planner: v2Part("planner"), ceo: ceoOut("Approve the pending gate now.") },
  });
  await h.worker.runOnce();
  const fin = finalUpdate(h.updates);
  assert.equal(fin.status, "FAILED", "real synthesis failure still fails closed");
  assert.equal(fin.synthesis, undefined, "failed synthesis output must not read as canonical success");
  assert.deepEqual(fin.visibleResult.map((r) => r.status), ["COMPLETED", "COMPLETED"]);
  assert.deepEqual(h.subStatuses, [{ wf: "wf-t", status: "failed" }]);
});

test("V6-5: synthesis artifact persistence failure → command FAILED", async () => {
  const h = harness({
    outputs: { research: v2Part("research"), planner: v2Part("planner"), ceo: ceoOut() },
    failCeoSave: true,
  });
  await h.worker.runOnce();
  const fin = finalUpdate(h.updates);
  assert.equal(fin.status, "FAILED");
  assert.equal(fin.synthesis, undefined);
  assert.equal(fin.artifactRefs.length, 2, "only participant artifacts");
});

test("LATEST-6: truncated synthesis (length, reasoning consumed cap) → FAILED, no canonical synthesis", async () => {
  const incomplete = new Error("OpenRouter incomplete response (length)");
  incomplete.diagnostics = { finishReason: "length", reasoningEffort: "none", maxTokens: 1100, responseFormat: "json_object", visibleContentBytes: 0 };
  const h = harness({ outputs: { research: v2Part("research"), planner: v2Part("planner"), ceo: incomplete } });
  await h.worker.runOnce();
  const fin = finalUpdate(h.updates);
  assert.equal(fin.status, "FAILED");
  assert.equal(fin.synthesis, undefined, "no canonical synthesis from truncated output");
  assert.deepEqual(fin.visibleResult.map((r) => r.status), ["COMPLETED", "COMPLETED"], "sibling artifacts preserved");
  assert.deepEqual(h.subStatuses, [{ wf: "wf-t", status: "failed" }]);
  assert.deepEqual(h.calls.map((c) => c.agentId), ["research", "planner", "ceo"], "single attempt each, no retry");
});

test("LATEST-7: structurally invalid synthesis → FAILED, no canonical synthesis", async () => {
  const bad = { ...ceoOut(), agreements: "not-an-array", confidence: "high" };
  const h = harness({ outputs: { research: v2Part("research"), planner: v2Part("planner"), ceo: bad } });
  await h.worker.runOnce();
  const fin = finalUpdate(h.updates);
  assert.equal(fin.status, "FAILED");
  assert.equal(fin.synthesis, undefined);
});

test("LATEST-synthesis-policy: synthesis executes with ceiling budget + effort:none by default", async () => {
  const h = harness({ outputs: { research: v2Part("research"), planner: v2Part("planner"), ceo: ceoOut() } });
  await h.worker.runOnce();
  const { ceoSynthesisBudget } = await import("../dist/research-contracts.js");
  const ceoCall = h.calls.find((c) => c.agentId === "ceo");
  assert.equal(ceoCall.maxOutputTokens, ceoSynthesisBudget(), "contract-derived synthesis budget");
  assert.deepEqual(ceoCall.reasoning, { effort: "none" }, "synthesis reasoning controlled by contract by default");
  assert.equal(finalUpdate(h.updates).status, "COMPLETED");
});

test("RELIABILITY-6: planner field over ceiling → command FAILED with exact field-path error", async () => {
  const badPlanner = v2Part("planner");
  badPlanner.findings[1] = { ...badPlanner.findings[1], title: "x".repeat(121) };
  const h = harness({ outputs: { research: v2Part("research"), planner: badPlanner, ceo: ceoOut() } });
  await h.worker.runOnce();
  const fin = finalUpdate(h.updates);
  assert.equal(fin.status, "FAILED");
  assert.equal(fin.synthesis, undefined, "no synthesis after participant failure");
  assert.match(fin.visibleResult.find((r) => r.agentId === "planner").error, /findings\[1\]\.title length 121 exceeds 120/);
  assert.ok(!h.calls.some((c) => c.agentId === "ceo"), "synthesis not executed");
});

test("RELIABILITY-7: invalid priority → command FAILED with exact field-path error", async () => {
  const badPlanner = v2Part("planner");
  badPlanner.findings[2] = { ...badPlanner.findings[2], priority: "critical" };
  const h = harness({ outputs: { research: v2Part("research"), planner: badPlanner, ceo: ceoOut() } });
  await h.worker.runOnce();
  const fin = finalUpdate(h.updates);
  assert.equal(fin.status, "FAILED");
  assert.match(fin.visibleResult.find((r) => r.agentId === "planner").error, /findings\[2\]\.priority invalid value "critical"/);
});
