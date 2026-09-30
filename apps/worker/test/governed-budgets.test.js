/**
 * Slice 5 remediation — bounded output budgets + reasoning control (no DB, no providers).
 * 1. Research contract worst case fits the research budget (byte-level, deterministic).
 * 2. Research governed executions request reasoning effort none + budget 1000.
 * 3. Incomplete/truncated JSON is never accepted (fail-closed, no artifact).
 * 4. Other roles keep proven budgets (change only on failure evidence).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { GovernedAgentRuntime, governedOutputBudget, GOVERNED_OUTPUT_BUDGETS } from "../dist/governed-agent-runtime.js";
import { resolveOperationalContext } from "../dist/project-context.js";

const BYTES_PER_TOKEN_CONSERVATIVE = 3.5;

test("internal-analysis ceiling fits its derived budget (exact schema math)", async () => {
  const { internalAnalysisBudget, internalAnalysisWorstCaseBytes } = await import("../dist/research-contracts.js");
  for (const n of [1, 3, 5]) {
    const bytes = internalAnalysisWorstCaseBytes(n);
    const budget = internalAnalysisBudget(n);
    assert.ok(bytes < budget * BYTES_PER_TOKEN_CONSERVATIVE,
      `n=${n}: worst-case ${bytes}B must fit ${budget} tokens`);
    // Bound follows the schema: V2 structured authority fields (next-step
    // object + decision IDs) raised the n=5 ceiling from 3050 to 3250.
    // Divisor (3.0) and rounding are unchanged — no arbitrary inflation.
    assert.ok(budget <= 3300, "bounded by formula ceiling");
  }
  assert.equal(GOVERNED_OUTPUT_BUDGETS.planner, 500);
  assert.equal(GOVERNED_OUTPUT_BUDGETS.ceo, 700);
  assert.equal(governedOutputBudget("writer"), 500);
  assert.equal(governedOutputBudget("research", 42), 42, "explicit override wins");
});

test("ceo synthesis ceiling fits its derived budget; reasoning explicit (finalization RCA)", async () => {
  const { ceoSynthesisBudget, ceoSynthesisWorstCaseBytes } = await import("../dist/research-contracts.js");
  const bytes = ceoSynthesisWorstCaseBytes();
  const budget = ceoSynthesisBudget();
  assert.ok(bytes < budget * BYTES_PER_TOKEN_CONSERVATIVE, `worst-case ${bytes}B must fit ${budget} tokens`);
  assert.ok(budget >= 1000, "never below the previously proven floor");
  assert.ok(budget <= 1200, "bounded by formula ceiling (same divisor/rounding as V2)");
});

test("research execution passes budget 1000 + reasoning none; others untouched", async () => {
  const seen = [];
  const fakePersistence = {
    saveArtifact: async () => {},
    listArtifacts: async () => [{ artifactId: "a", payload: { visibleOutput: { concept: "c", historicalAngle: "h", evidenceConsiderations: ["e"], sourceability: "s", risks: ["r"], recommendation: "rec" } } }],
    saveExecutionProvenance: async () => {},
  };
  const stub = async (input) => {
    seen.push({ agentId: input.agentId, maxOutputTokens: input.maxOutputTokens, reasoning: input.reasoning ?? null });
    return { output: { concept: "c", historicalAngle: "h", evidenceConsiderations: ["e"], sourceability: "s", risks: ["r"], recommendation: "rec" }, provider: "openrouter", model: "m", usage: { inputTokens: 1, outputTokens: 1 } };
  };
  const runtime = new GovernedAgentRuntime(fakePersistence, stub);
  const base = { workflowId: "wf", projectId: "p", prompt: "x", context: {}, config: { provider: "openrouter", model: "m", source: "GLOBAL" } };
  await runtime.executeGovernedAgent({ ...base, agentId: "research" });
  await runtime.executeGovernedAgent({ ...base, agentId: "writer" });
  const research = seen.find((s) => s.agentId === "research");
  const writer = seen.find((s) => s.agentId === "writer");
  assert.equal(research.maxOutputTokens, 1000, "content-research keeps proven role budget");
  assert.deepEqual(research.reasoning, { effort: "none" });
  assert.equal(writer.maxOutputTokens, 500);
  assert.equal(writer.reasoning, null);
});

test("planner internal-analysis inherits contract policy (live-validation regression)", async () => {
  const seen = [];
  const internal = {
    summary: "S.", findings: [
      { title: "One", priority: "high", finding: "F1.", evidence: ["platform context"], ownerImplication: "Watch.", ownerActionRequired: false, ownerDecisionId: null },
      { title: "Two", priority: "medium", finding: "F2.", evidence: ["platform context"], ownerImplication: "Note.", ownerActionRequired: false, ownerDecisionId: null },
      { title: "Three", priority: "low", finding: "F3.", evidence: ["platform context"], ownerImplication: "FYI.", ownerActionRequired: false, ownerDecisionId: null },
    ],
    ownerActionRequired: false,
    recommendedNextStep: { action: "Continue.", actor: "team", actionType: "planning", requiresOwnerDecision: false, targetDecisionId: null },
    limitations: ["Thin evidence."],
  };
  let savedArtifact = null;
  const fakePersistence = {
    saveArtifact: async (a) => { savedArtifact = a; },
    listArtifacts: async () => (savedArtifact ? [{ ...savedArtifact }] : []),
    saveExecutionProvenance: async () => {},
  };
  const stub = async (input) => {
    seen.push({ agentId: input.agentId, maxOutputTokens: input.maxOutputTokens, reasoning: input.reasoning ?? null });
    return { output: internal, provider: "openrouter", model: "m", usage: { inputTokens: 1, outputTokens: 1 } };
  };
  const { GovernedAgentRuntime: R } = await import("../dist/governed-agent-runtime.js");
  const runtime = new R(fakePersistence, stub);
  const msg = "Review the current project state independently and recommend the single most useful next step.";
  const result = await runtime.executeGovernedAgent({
    workflowId: "wf", projectId: "p", agentId: "planner", prompt: msg,
    context: { projectId: "p" }, config: { provider: "openrouter", model: "m", source: "GLOBAL" },
  });
  assert.equal(result.status, "COMPLETED");
  const got = seen.find((s) => s.agentId === "planner");
  assert.ok(got.maxOutputTokens >= 1000, "contract-sized budget, not legacy 500");
  assert.deepEqual(got.reasoning, { effort: "none" }, "reasoning controlled by contract, not agent identity");
});

test("truncated JSON string output is rejected, no artifact recorded", async () => {
  let artifacts = 0;
  const fakePersistence = {
    saveArtifact: async () => { artifacts++; },
    listArtifacts: async () => [],
    saveExecutionProvenance: async () => {},
  };
  const stub = async () => ({
    output: '{"concept": "half-written', provider: "openrouter", model: "m",
    usage: { inputTokens: 1, outputTokens: 1 },
  });
  const runtime = new GovernedAgentRuntime(fakePersistence, stub);
  const result = await runtime.executeGovernedAgent({
    workflowId: "wf", projectId: "p", agentId: "research", prompt: "x",
    context: {}, config: { provider: "openrouter", model: "m", source: "GLOBAL" },
  });
  assert.ok(result.status === "FAILED" || result.status === "BLOCKED", "fail-closed, never COMPLETED");
  assert.equal(result.output, null);
  assert.equal(artifacts, 0, "no success artifact from incomplete payload");
});

test("operational snapshot is bounded, deterministic, null-safe", async () => {
  const deps = {
    listApprovals: async () => [
      { approvalId: "a1", status: "PENDING" },
      { approvalId: "a2", status: "DECIDED" },
    ],
    approvalActionability: async (id) => id === "a1" ? { state: "ACTION_REQUIRED" } : null,
    projectLifecycles: async () => [{
      title: "T", overallState: "NEEDS_OWNER_ATTENTION", overallLabel: "L",
      attention: [{ kind: "APPROVAL" }], lastMilestone: "M",
      productionApproval: "NOT_GRANTED", publicationApproval: "NOT_GRANTED", publicStatus: "NOT_PUBLISHED",
    }],
  };
  const s1 = await resolveOperationalContext(deps, "p");
  const s2 = await resolveOperationalContext(deps, "p");
  assert.deepEqual(s1, s2);
  assert.equal(s1.latestWorkflow.title, "T");
  assert.equal(s1.approvals.actionable, 1);
  assert.deepEqual(s1.approvals.actionableIds, ["a1"], "actionable decisions ground by ID");
  assert.ok(Buffer.byteLength(JSON.stringify(s1), "utf8") <= 2000);
  const failing = { listApprovals: async () => { throw new Error("db down"); }, approvalActionability: async () => null, projectLifecycles: async () => [] };
  assert.equal(await resolveOperationalContext(failing, "p"), null);
});
