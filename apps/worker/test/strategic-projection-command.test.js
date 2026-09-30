/**
 * Slice 6 budget remediation — command-path integration (no DB, no providers).
 * Real WorkflowWorker.runOnce + real resolveStrategicProjectContext consume
 * projections built by the REAL buildStrategicProjection over fixture
 * ACTIVE entities (only the DB fetch itself is faked). Proves ASK_AGENT,
 * MULTI_AGENT_REVIEW (per-participant projections), CEO synthesis, and
 * fail-closed projection failure with zero provider calls.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkflowWorker } from "../dist/worker.js";
import { resolveStrategicProjectContext } from "../dist/project-context.js";
import { buildStrategicProjection } from "@ai-media-factory/database";

const MSG = "Review the current Morroway project state independently and recommend the single most useful next step for the project at this stage. Do not change anything, do not start production, and do not authorize publication.";

function fixtureEntities() {
  const base = (type, key, version, payload) => ({
    entityId: `strat-p-${type}-${key}-v${version}`.toLowerCase(), projectId: "morroway",
    entityType: type, entityKey: key, version, status: "ACTIVE", payload,
    schemaVersion: "strategic-v1", sourceArtifactIds: ["docs/x.md"], supersedesVersion: null,
    createdBy: "test", createdAt: "t", activatedAt: "t", activatedByApprovalId: "approval-1",
  });
  return [
    base("STRATEGY", "primary", 1, {
      contentPillars: ["Historical POV", "AI Fantasy"], pilot: { model: "adaptive" },
      platforms: { primary: "Instagram Reels first" }, format: { direction: "short-form" },
    }),
    base("BRAND", "primary", 1, { brand: "Morroway", naming: { status: "CLOSED", winner: "Morroway" } }),
    base("CONTENT_SYSTEM", "primary", 1, {
      pilot: { model: "adaptive" },
      learningBatch: { note: "initial only", items: [{ id: "MW-HIS-001" }] },
      sourcing: { historicalPov: "real history", fantasy: "original" },
      governance: { qaRequired: true, publicationPolicy: { rule: "Policy governs.", currentMode: "OWNER_APPROVAL_REQUIRED", autonomousPublication: "Owner-authorized only." } },
    }),
    base("CONSTRAINTS", "primary", 1, { rules: ["Validation success is not production approval"] }),
    base("EXPERIMENT", "pilot-gates", 1, {
      hypothesis: "gates", status: "EXPERIMENTAL", experimentalEvaluationSignals: ["5% engagement"],
      decisionUse: "informs evaluation only", decisionModel: ["PERFORMANCE_LED"],
      automaticDecisionRule: "No signal crossing automatically selects.", rule: "hypotheses",
    }),
  ];
}

const RELEVANCE = {
  research: ["STRATEGY", "CONSTRAINTS", "EXPERIMENT"],
  planner: ["STRATEGY", "BRAND", "CONTENT_SYSTEM", "CONSTRAINTS", "EXPERIMENT"],
  ceo: ["STRATEGY", "BRAND", "CONTENT_SYSTEM", "CONSTRAINTS", "EXPERIMENT"],
};

function fakeStore(failWith = null) {
  return {
    resolve: async ({ projectId, agentId }) => {
      if (failWith) throw failWith;
      const taskClass = agentId;
      const included = fixtureEntities().filter((e) => (RELEVANCE[taskClass] ?? []).includes(e.entityType));
      const { context, meta } = buildStrategicProjection(included, taskClass);
      const entities = {};
      for (const e of included) {
        entities[e.entityType] = {
          key: e.entityKey, version: e.version, entityId: e.entityId, status: e.status,
          authority: { activatedByApprovalId: e.activatedByApprovalId, activatedAt: e.activatedAt },
          evidenceRefs: e.sourceArtifactIds, supersedesVersion: e.supersedesVersion, payload: e.payload,
        };
      }
      return {
        projectId, taskClass,
        entityRefs: included.map((e) => ({ entityId: e.entityId, entityType: e.entityType, entityKey: e.entityKey, version: e.version })),
        context: { projectId, taskClass, entities }, contextHash: "h-" + taskClass,
        resolverVersion: "strat-resolver-v2", includedTypes: Object.keys(entities),
        excludedTypes: [], conflicts: [], projectedContext: context, projection: meta, status: "RESOLVED",
      };
    },
    snapshotResolved: async () => ({ snapshotId: "snap-t" }),
  };
}

function v2Part(agent, count = 3) {
  const findings = [];
  for (let i = 0; i < count; i++) {
    findings.push({
      title: `${agent} finding ${i + 1}`, priority: "high", finding: "Something matters.",
      evidence: ["platform context"], ownerImplication: "Watch it.",
      ownerActionRequired: false, ownerDecisionId: null,
    });
  }
  return {
    summary: `${agent} state view.`, findings, ownerActionRequired: false,
    recommendedNextStep: {
      action: "Keep observing.", actor: "team", actionType: "evidence_collection",
      requiresOwnerDecision: false, targetDecisionId: null,
    },
    limitations: ["Thin evidence."],
  };
}

function ceoOut() {
  return {
    agreements: ["Both flag planning."], disagreements: ["Emphasis differs."],
    evidence: ["platform context"], recommendation: "Finish planning first.",
    confidence: 0.7, missingEvidence: [], nextAction: "Continue planning the pilot.",
  };
}

function harness({ outputs, storeFail = null }) {
  const updates = []; const acks = []; const subStatuses = []; const calls = [];
  const saved = [];
  const persistence = {
    saveArtifact: async (a) => { saved.push(a); },
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
    loadSubmissionByWorkflow: async () => null, // replaced per test
    acknowledge: async (jobId, status, message) => { acks.push({ jobId, status, message }); },
    updateSubmissionStatus: async (wf, status) => { subStatuses.push({ wf, status }); },
    recoverOrphanedJobs: async () => 0,
  };
  const control = { updateCommand: async (id, input) => { updates.push({ id, input }); } };
  const governedExecute = async (input) => {
    calls.push({ agentId: input.agentId, system: input.system, maxOutputTokens: input.maxOutputTokens, reasoning: input.reasoning ?? null });
    const out = outputs[input.agentId];
    if (out instanceof Error) throw out;
    return { output: out, provider: "openrouter", model: "m", usage: { inputTokens: 1, outputTokens: 1 } };
  };
  const store = fakeStore(storeFail);
  const worker = new WorkflowWorker({
    queue, persistence, executor: {}, pollMs: 1,
    resolveCommandConfiguration: async () => ({ "*": { provider: "openrouter", model: "m", source: "GLOBAL" } }),
    resolveOperationalContext: async () => ({ approvals: { pending: 0, actionable: 0, actionableIds: [] } }),
    resolveStrategicContext: (projectId, agentId, requested, operational) =>
      resolveStrategicProjectContext(store, projectId, requested, agentId, operational),
    governedExecute, control,
  });
  return { worker, queue, updates, acks, subStatuses, calls };
}

function submission(commandType, agents) {
  return {
    workflowId: "wf-t", correlationId: null, brandId: "morroway",
    commandContext: { commandId: "cmd-t", commandType, selectedAgents: agents, ownerMessage: MSG },
  };
}

test("ASK_AGENT uses projected research context", async () => {
  const h = harness({ outputs: { research: v2Part("research") } });
  h.queue.loadSubmissionByWorkflow = async () => submission("ASK_AGENT", ["research"]);
  assert.equal(await h.worker.runOnce(), true);
  const fin = h.updates[h.updates.length - 1].input;
  assert.equal(fin.status, "COMPLETED");
  const researchCall = h.calls.find((c) => c.agentId === "research");
  assert.match(researchCall.system, /Historical POV/);
  assert.match(researchCall.system, /5% engagement/);
  assert.ok(!researchCall.system.includes("CLOSED"), "research projection carries no brand domain");
  assert.deepEqual(researchCall.reasoning, { effort: "none" });
});

test("MULTI_AGENT_REVIEW projects per participant; synthesis gets ceo projection", async () => {
  const h = harness({ outputs: { research: v2Part("research"), planner: v2Part("planner"), ceo: ceoOut() } });
  h.queue.loadSubmissionByWorkflow = async () => submission("MULTI_AGENT_REVIEW", ["research", "planner"]);
  assert.equal(await h.worker.runOnce(), true);
  const fin = h.updates[h.updates.length - 1].input;
  assert.equal(fin.status, "COMPLETED");
  assert.deepEqual(fin.visibleResult.map((r) => r.status), ["COMPLETED", "COMPLETED"]);
  assert.ok(fin.synthesis && fin.synthesis.nextAction === "Continue planning the pilot.");
  assert.equal(fin.artifactRefs.length, 3, "separate artifacts");
  const researchSys = h.calls.find((c) => c.agentId === "research").system;
  const plannerSys = h.calls.find((c) => c.agentId === "planner").system;
  const ceoSys = h.calls.find((c) => c.agentId === "ceo").system;
  assert.ok(plannerSys.includes("CLOSED") && plannerSys.includes("OWNER_APPROVAL_REQUIRED"), "planner projection has brand authority facts");
  assert.ok(!researchSys.includes("CLOSED"), "research projection independent");
  assert.ok(ceoSys.includes("Morroway") && ceoSys.includes("OWNER_APPROVAL_REQUIRED"), "ceo projection is broad");
  assert.ok(h.calls.filter((c) => c.agentId === "ceo").every((c) => c.maxOutputTokens >= 1000));
  assert.deepEqual(h.subStatuses, [{ wf: "wf-t", status: "completed" }]);
});

test("projection failure fails closed before any provider call", async () => {
  const h = harness({
    outputs: { research: v2Part("research"), planner: v2Part("planner"), ceo: ceoOut() },
    storeFail: new Error("STRATEGIC_PROJECTED_CONTEXT_OVERSIZED:planner:9000>8000"),
  });
  h.queue.loadSubmissionByWorkflow = async () => submission("MULTI_AGENT_REVIEW", ["research", "planner"]);
  assert.equal(await h.worker.runOnce(), true);
  const fin = h.updates[h.updates.length - 1].input;
  assert.equal(fin.status, "FAILED");
  assert.equal(h.calls.length, 0, "no provider call after projection failure");
  assert.deepEqual(h.subStatuses, [{ wf: "wf-t", status: "failed" }]);
});
