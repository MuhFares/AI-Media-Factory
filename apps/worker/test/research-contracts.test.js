/**
 * Slice 5 remediation V2 — intent-aware contracts (no DB, no providers).
 * Matrix items 1-10, 12-20 (11 covered in strategic-runtime-integration).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyResearchIntent, researchContractFor, researchContractById, requestedFindingCount,
  internalAnalysisBudget, validateInternalAnalysis, validateInternalAnalysisV2, internalAnalysisSections,
  participantContract, effectiveExecutionPolicy, internalAnalysisWorstCaseBytes, internalAnalysisV1WorstCaseBytes,
  recommendsOwnerDecision,
} from "../dist/research-contracts.js";
import { GovernedAgentRuntime } from "../dist/governed-agent-runtime.js";

const OWNER_PROMPT = "Analyze the current Morroway project state and tell me the three most important things I should know as the Owner. Do not change anything.";

function validInternal(count = 3, actionable = 0) {
  const findings = [];
  for (let i = 0; i < count; i++) {
    findings.push({
      title: `Finding ${i + 1}`, priority: "high", finding: "Something matters.",
      evidence: ["platform context"], ownerImplication: "Watch it.",
      ownerActionRequired: actionable > 0,
    });
  }
  return {
    summary: "State in brief.", findings,
    ownerActionRequired: actionable > 0,
    recommendedNextStep: "Keep observing.", limitations: ["Thin evidence."],
  };
}

function validInternalV2(count = 3) {
  const findings = [];
  for (let i = 0; i < count; i++) {
    findings.push({
      title: `Finding ${i + 1}`, priority: "high", finding: "Something matters.",
      evidence: ["platform context"], ownerImplication: "Watch it.",
      ownerActionRequired: false, ownerDecisionId: null,
    });
  }
  return {
    summary: "State in brief.", findings,
    ownerActionRequired: false,
    recommendedNextStep: {
      action: "Keep observing.", actor: "team", actionType: "evidence_collection",
      requiresOwnerDecision: false, targetDecisionId: null,
    },
    limitations: ["Thin evidence."],
  };
}

test("1: internal project analysis classified; 2: content research default", async () => {
  assert.equal(classifyResearchIntent(OWNER_PROMPT), "INTERNAL_PROJECT_ANALYSIS");
  assert.equal(classifyResearchIntent("Research current short-form historical-content trends"), "CONTENT_RESEARCH");
  assert.equal(classifyResearchIntent("Research competitor activity on Instagram"), "CONTENT_RESEARCH");
  assert.equal(classifyResearchIntent("one idea"), "CONTENT_RESEARCH");
});

test("3: agent identity alone does not determine contract", async () => {
  assert.equal(researchContractFor(classifyResearchIntent(OWNER_PROMPT)).id, "INTERNAL_ANALYSIS_V2");
  assert.equal(researchContractById("INTERNAL_ANALYSIS_V1").id, "INTERNAL_ANALYSIS_V1", "V1 retained for historical readability");
  assert.equal(researchContractFor(classifyResearchIntent("Research competitors")).id, "CONTENT_RESEARCH_V1");
  assert.equal(researchContractFor("CONTENT_RESEARCH").grantsAuthority, false);
  assert.equal(researchContractFor("INTERNAL_PROJECT_ANALYSIS").grantsAuthority, false);
});

test("4/5: requested cardinality 3 and 5", async () => {
  assert.equal(requestedFindingCount(OWNER_PROMPT), 3);
  assert.equal(requestedFindingCount("What are the top 5 risks?"), 5);
  assert.equal(requestedFindingCount("Name two blockers"), 2);
  assert.equal(requestedFindingCount("one idea"), 3);
  assert.ok(validateInternalAnalysis(validInternal(3), { requestedCount: 3, actionableDecisions: 0 }).ok);
  assert.ok(validateInternalAnalysis(validInternal(5), { requestedCount: 5, actionableDecisions: 0 }).ok);
});

test("6: short output fails; 13: content fields not required; 14: content contract untouched", async () => {
  const short = { ...validInternal(3), findings: validInternal(3).findings.slice(0, 2) };
  assert.match(validateInternalAnalysis(short, { requestedCount: 3, actionableDecisions: 0 }).reason, /count/);
  const noContentKeys = validInternal(3);
  assert.ok(!("concept" in noContentKeys) && !("historicalAngle" in noContentKeys));
  assert.ok(validateInternalAnalysis(noContentKeys, { requestedCount: 3, actionableDecisions: 0 }).ok);
});

test("7/9/10: actionability truth governs ownerActionRequired", async () => {
  assert.ok(!validateInternalAnalysis(validInternal(3, 1), { requestedCount: 3, actionableDecisions: 0 }).ok, "superseded must not demand action");
  assert.ok(validateInternalAnalysis(validInternal(3, 1), { requestedCount: 3, actionableDecisions: 2 }).ok, "actionable may demand action");
  assert.ok(validateInternalAnalysis(validInternal(3, 0), { requestedCount: 3, actionableDecisions: 0 }).ok);
});

test("8: raw pending alone creates no action (operational builder)", async () => {
  const { resolveOperationalContext } = await import("../dist/project-context.js");
  const snap = await resolveOperationalContext({
    listApprovals: async () => [{ approvalId: "a1", status: "PENDING" }],
    approvalActionability: async () => ({ state: "SUPERSEDED" }),
    projectLifecycles: async () => [],
  }, "p");
  assert.equal(snap.approvals.pending, 1);
  assert.equal(snap.approvals.actionable, 0);
  assert.ok(!validateInternalAnalysis({ ...validInternal(3), ownerActionRequired: true }, { requestedCount: 3, actionableDecisions: snap.approvals.actionable }).ok);
});

test("12: no external research for internal analysis", async () => {
  assert.equal(researchContractFor("INTERNAL_PROJECT_ANALYSIS").externalResearchRequired, false);
});

test("15/16: sections render findings first-class, never empty", async () => {
  const out = validInternal(3);
  const sections = internalAnalysisSections(out);
  assert.equal(sections.length, out.findings.length + 2);
  assert.match(sections[0].title, /Summary/);
  assert.match(sections[1].title, /1\./);
  assert.ok(sections.every((s) => s.title && s.body));
});

test("multi-agent routing: shared intent, distinct perspectives, planning preserved", async () => {
  const internal = "Review the current Morroway project state independently and recommend the single most useful next step.";
  const r = participantContract("research", internal);
  const p = participantContract("planner", internal);
  assert.equal(r.kind, "INTERNAL_ANALYSIS");
  assert.equal(p.kind, "INTERNAL_ANALYSIS");
  assert.equal(r.contract.id, p.contract.id, "compatible shared contract");
  assert.notEqual(r.perspective, p.perspective, "role perspectives differ");
  assert.match(p.perspective, /sequencing|dependencies|readiness/i);
  assert.match(r.perspective, /evidence|facts/i);
  assert.equal(r.findingCount, p.findingCount, "shared cardinality");
  const plan = participantContract("planner", "Draft a launch plan with hook and structure");
  assert.equal(plan.kind, "ROLE_DEFAULT", "planning work keeps canonical contract");
  const ceo = participantContract("ceo", internal);
  assert.equal(ceo.kind, "ROLE_DEFAULT", "only research+planner participate in shared analysis");
  const writer = participantContract("writer", internal);
  assert.equal(writer.kind, "ROLE_DEFAULT", "agent identity alone never selects analysis contract");
});

test("multi-agent: independence, synthesis eligibility, partial failure, lineage", async () => {
  const seenPrompts = {};
  const internal = (agent) => ({
    summary: `${agent} view.`,
    findings: [
      { title: "One", priority: "high", finding: "F1.", evidence: ["platform context"], ownerImplication: "Watch.", ownerActionRequired: false, ownerDecisionId: null },
      { title: "Two", priority: "medium", finding: "F2.", evidence: ["platform context"], ownerImplication: "Note.", ownerActionRequired: false, ownerDecisionId: null },
      { title: "Three", priority: "low", finding: "F3.", evidence: ["platform context"], ownerImplication: "FYI.", ownerActionRequired: false, ownerDecisionId: null },
    ],
    ownerActionRequired: false,
    recommendedNextStep: { action: "Continue.", actor: "team", actionType: "planning", requiresOwnerDecision: false, targetDecisionId: null },
    limitations: ["Thin evidence."],
  });
  const saved = [];
  const fakePersistence = {
    saveArtifact: async (a) => { saved.push(a); },
    listArtifacts: async (wf) => saved.filter((a) => a.workflowId === wf).map((a) => ({ ...a, payload: a.payload })),
    saveExecutionProvenance: async () => {},
  };
  const stub = async (input) => {
    seenPrompts[input.agentId] = input.prompt + "\n" + input.system;
    return { output: internal(input.agentId), provider: "openrouter", model: "m", usage: { inputTokens: 1, outputTokens: 1 } };
  };
  const { GovernedAgentRuntime: R } = await import("../dist/governed-agent-runtime.js");
  const runtime = new R(fakePersistence, stub);
  const cfg = { provider: "openrouter", model: "m", source: "GLOBAL" };
  const msg = "Review the current project state independently and recommend the single most useful next step.";
  const r1 = await runtime.executeGovernedAgent({ workflowId: "wf-multi", projectId: "p", agentId: "research", prompt: msg, context: {}, config: cfg });
  const r2 = await runtime.executeGovernedAgent({ workflowId: "wf-multi", projectId: "p", agentId: "planner", prompt: msg, context: {}, config: cfg });
  assert.equal(r1.status, "COMPLETED");
  assert.equal(r2.status, "COMPLETED");
  assert.ok(!seenPrompts.planner.includes("F1.") && !seenPrompts.research.includes("F1."), "no cross-participant leakage");
  assert.ok(r1.artifactId && r2.artifactId && r1.artifactId !== r2.artifactId, "separate artifacts");
});

test("synthesis eligible only with validated outputs; disagreement honest", async () => {
  const saved = [];
  const fakePersistence = {
    saveArtifact: async (a) => { saved.push(a); },
    listArtifacts: async (wf) => saved.filter((a) => a.workflowId === wf).map((a) => ({ ...a, payload: a.payload })),
    saveExecutionProvenance: async () => {},
  };
  const ceoOut = {
    agreements: ["Both flag planning."], disagreements: ["Priority order differs."],
    evidence: ["platform context"], recommendation: "Finish planning first.",
    confidence: 0.7, missingEvidence: [], nextAction: "Review plan.",
  };
  const stub = async () => ({ output: ceoOut, provider: "openrouter", model: "m", usage: { inputTokens: 1, outputTokens: 1 } });
  const { GovernedAgentRuntime: R } = await import("../dist/governed-agent-runtime.js");
  const runtime = new R(fakePersistence, stub);
  const ok = await runtime.synthesizeAgentOutputs({
    workflowId: "wf-s", projectId: "p", prompt: "x", context: {},
    results: [
      { status: "COMPLETED", output: { a: 1 }, agentId: "research", artifactId: "art-1" },
      { status: "COMPLETED", output: { b: 2 }, agentId: "planner", artifactId: "art-2" },
    ],
    config: { provider: "openrouter", model: "m", source: "GLOBAL" },
  });
  assert.equal(ok.status, "COMPLETED");
  assert.deepEqual(ok.output.disagreements, ["Priority order differs."]);
  const blocked = await runtime.synthesizeAgentOutputs({
    workflowId: "wf-s", projectId: "p", prompt: "x", context: {},
    results: [], config: { provider: "openrouter", model: "m", source: "GLOBAL" },
  });
  assert.equal(blocked.status, "BLOCKED");
});

test("contract-budget matrix: every route fits; reasoning explicit; deterministic", async () => {
  const internal = "Review the current project state independently and recommend the single most useful next step.";
  const rows = [
    ["research", internal, "INTERNAL_ANALYSIS_V2"],
    ["planner", internal, "INTERNAL_ANALYSIS_V2"],
    ["research", "Research rival launches", "CONTENT_RESEARCH_V1"],
    ["planner", "Draft a launch plan with hook and structure", "ROLE_DEFAULT"],
    ["ceo", internal, "ROLE_DEFAULT"],
    ["writer", internal, "ROLE_DEFAULT"],
  ];
  for (const [agent, prompt, contractId] of rows) {
    const p1 = effectiveExecutionPolicy({ agentId: agent, prompt });
    const p2 = effectiveExecutionPolicy({ agentId: agent, prompt });
    assert.deepEqual(p1, p2, `${agent} deterministic`);
    assert.equal(p1.contractId, contractId, `${agent} contract`);
    assert.ok(p1.budget >= 500 && p1.budget <= 2800, `${agent} bounded budget`);
    if (p1.contractId === "INTERNAL_ANALYSIS_V2") {
      const worst = internalAnalysisWorstCaseBytes(p1.findingCount);
      assert.ok(worst < p1.budget * 3.5, `${agent} worst case fits budget`);
      assert.deepEqual(p1.reasoning, { effort: "none" }, `${agent} reasoning explicit`);
    }
  }
  const plannerPolicy = effectiveExecutionPolicy({ agentId: "planner", prompt: internal });
  const researchPolicy = effectiveExecutionPolicy({ agentId: "research", prompt: internal });
  assert.equal(plannerPolicy.budget, researchPolicy.budget, "same contract, same budget class");
  assert.deepEqual(plannerPolicy.reasoning, researchPolicy.reasoning, "same contract, same reasoning");
  // explicit overrides still win
  const over = effectiveExecutionPolicy({ agentId: "planner", prompt: internal, explicitBudget: 42, explicitReasoning: { effort: "none" } });
  assert.equal(over.budget, 42);
  // role defaults preserved
  assert.equal(effectiveExecutionPolicy({ agentId: "planner", prompt: "Draft a plan" }).budget, 500);
  assert.equal(effectiveExecutionPolicy({ agentId: "ceo", prompt: "x" }).budget, 700);
  assert.equal(effectiveExecutionPolicy({ agentId: "planner", prompt: "Draft a plan" }).reasoning, undefined);
});

test("field ceilings enforced: overlong, bad priority, oversized evidence rejected", async () => {
  const base = {
    summary: "S.", findings: [
      { title: "T", priority: "high", finding: "F.", evidence: ["platform context"], ownerImplication: "I.", ownerActionRequired: false },
      { title: "T", priority: "high", finding: "F.", evidence: ["platform context"], ownerImplication: "I.", ownerActionRequired: false },
      { title: "T", priority: "high", finding: "F.", evidence: ["platform context"], ownerImplication: "I.", ownerActionRequired: false },
    ],
    ownerActionRequired: false, recommendedNextStep: "N.", limitations: ["L."],
  };
  const over = structuredClone(base);
  over.findings[0].title = "x".repeat(121);
  assert.match(validateInternalAnalysis(over, { requestedCount: 3, actionableDecisions: 0 }).reason, /ceilings|priority/);
  const badPri = structuredClone(base);
  badPri.findings[1].priority = "urgent";
  assert.match(validateInternalAnalysis(badPri, { requestedCount: 3, actionableDecisions: 0 }).reason, /priority/);
  const bigEv = structuredClone(base);
  bigEv.findings[2].evidence = ["e", "e", "e", "e", "e", "e"];
  assert.match(validateInternalAnalysis(bigEv, { requestedCount: 3, actionableDecisions: 0 }).reason, /evidence/);
});

test("communicative ceilings: summaries fit, excess fails granularly", async () => {
  const base = {
    summary: "S.", findings: [
      { title: "T", priority: "high", finding: "F.", evidence: ["platform context"], ownerImplication: "I.", ownerActionRequired: false },
      { title: "T", priority: "high", finding: "F.", evidence: ["platform context"], ownerImplication: "I.", ownerActionRequired: false },
      { title: "T", priority: "high", finding: "F.", evidence: ["platform context"], ownerImplication: "I.", ownerActionRequired: false },
    ],
    ownerActionRequired: false, recommendedNextStep: "N.", limitations: ["L."],
  };
  const roomy = structuredClone(base);
  roomy.summary = "x".repeat(400);
  roomy.recommendedNextStep = "y".repeat(300);
  roomy.limitations = ["a", "b", "c", "d", "e"];
  assert.ok(validateInternalAnalysis(roomy, { requestedCount: 3, actionableDecisions: 0 }).ok);
  const over = structuredClone(base);
  over.summary = "x".repeat(401);
  assert.match(validateInternalAnalysis(over, { requestedCount: 3, actionableDecisions: 0 }).reason, /summary exceeds ceiling 401\/400/);
  const overNext = structuredClone(base);
  overNext.recommendedNextStep = "y".repeat(301);
  assert.match(validateInternalAnalysis(overNext, { requestedCount: 3, actionableDecisions: 0 }).reason, /recommendedNextStep exceeds ceiling/);
  const overLim = structuredClone(base);
  overLim.limitations = ["a", "b", "c", "d", "e", "f"];
  assert.match(validateInternalAnalysis(overLim, { requestedCount: 3, actionableDecisions: 0 }).reason, /limitations exceed ceilings/);
});

test("semantic invariant: text-level Owner-action detection", async () => {
  assert.equal(recommendsOwnerDecision("Complete the pending owner brand identity review."), true);
  assert.equal(recommendsOwnerDecision("Approve publication now."), true);
  assert.equal(recommendsOwnerDecision("Ask the Owner to decide on the gate."), true);
  assert.equal(recommendsOwnerDecision("Production is not granted and nothing is public."), false);
  assert.equal(recommendsOwnerDecision("Identify the single pending approval dependency for the brief."), false);
  assert.equal(recommendsOwnerDecision("Prepare a concise readiness brief and continue planning."), false);
  assert.equal(recommendsOwnerDecision("Reconcile the approved strategy with validation results."), false);
  assert.equal(recommendsOwnerDecision(null), false);
});

test("semantic invariant: nextStep/implication gated on actionable count", async () => {
  const clean = {
    summary: "S.", findings: [
      { title: "T", priority: "high", finding: "F.", evidence: ["platform context"], ownerImplication: "Watch it.", ownerActionRequired: false },
      { title: "T", priority: "high", finding: "F.", evidence: ["platform context"], ownerImplication: "Note it.", ownerActionRequired: false },
      { title: "T", priority: "high", finding: "F.", evidence: ["platform context"], ownerImplication: "FYI.", ownerActionRequired: false },
    ],
    ownerActionRequired: false, recommendedNextStep: "Prepare a readiness brief.", limitations: ["L."],
  };
  assert.ok(validateInternalAnalysis(clean, { requestedCount: 3, actionableDecisions: 0 }).ok);
  const badNext = { ...clean, recommendedNextStep: "Complete the pending owner brand identity review, then continue." };
  const r1 = validateInternalAnalysis(badNext, { requestedCount: 3, actionableDecisions: 0 });
  assert.ok(!r1.ok && /recommendedNextStep/.test(r1.reason));
  const badImpl = structuredClone(clean);
  badImpl.findings[0].ownerImplication = "The Owner must approve the pending gate now.";
  const r2 = validateInternalAnalysis(badImpl, { requestedCount: 3, actionableDecisions: 0 });
  assert.ok(!r2.ok && /implication/.test(r2.reason));
  // genuine actionable decisions lift the gate (targeted, still validated)
  const withAction = structuredClone(clean);
  withAction.ownerActionRequired = true;
  withAction.findings[0].ownerActionRequired = true;
  withAction.recommendedNextStep = "Review the waiting pre-production gate in Decision Center.";
  assert.ok(validateInternalAnalysis(withAction, { requestedCount: 3, actionableDecisions: 1 }).ok);
  const overclaim = structuredClone(clean);
  overclaim.findings[1].ownerActionRequired = true;
  assert.ok(!validateInternalAnalysis(overclaim, { requestedCount: 3, actionableDecisions: 0 }).ok);
});

test("synthesis obeys actionability truth (grounded, fail-closed)", async () => {
  const saved = [];
  const fakePersistence = {
    saveArtifact: async (a) => { saved.push(a); },
    listArtifacts: async (wf) => saved.filter((a) => a.workflowId === wf).map((a) => ({ ...a, payload: a.payload })),
    saveExecutionProvenance: async () => {},
  };
  const { GovernedAgentRuntime: R } = await import("../dist/governed-agent-runtime.js");
  const base = { provider: "openrouter", model: "m", source: "GLOBAL" };
  const goodOut = {
    agreements: ["a"], disagreements: ["Priority order differs."], evidence: ["platform context"],
    recommendation: "Finish planning first.", confidence: 0.7, missingEvidence: [], nextAction: "Review the plan.",
  };
  const runtime = new R(fakePersistence, async () => ({ output: goodOut, provider: "openrouter", model: "m", usage: { inputTokens: 1, outputTokens: 1 } }));
  const ctx = { _operational: { approvals: { pending: 1, actionable: 0 } } };
  const ok = await runtime.synthesizeAgentOutputs({
    workflowId: "wf-s", projectId: "p", prompt: "x", context: ctx,
    results: [
      { status: "COMPLETED", output: { a: 1 }, agentId: "research", artifactId: "art-1" },
      { status: "COMPLETED", output: { b: 2 }, agentId: "planner", artifactId: "art-2" },
    ],
    config: base,
  });
  assert.equal(ok.status, "COMPLETED");
  assert.deepEqual(ok.output.disagreements, ["Priority order differs."]);
  const badOut = { ...goodOut, recommendation: "Approve the pending gate now." };
  const runtime2 = new R(fakePersistence, async () => ({ output: badOut, provider: "openrouter", model: "m", usage: { inputTokens: 1, outputTokens: 1 } }));
  const bad = await runtime2.synthesizeAgentOutputs({
    workflowId: "wf-s", projectId: "p", prompt: "x", context: ctx,
    results: [
      { status: "COMPLETED", output: { a: 1 }, agentId: "research", artifactId: "art-1" },
      { status: "COMPLETED", output: { b: 2 }, agentId: "planner", artifactId: "art-2" },
    ],
    config: base,
  });
  assert.equal(bad.status, "FAILED");
  assert.match(bad.error, /SYNTHESIS_ACTIONABILITY_INVALID/);
  // without operational truth, structure-only validation applies (no truth source to contradict)
  const runtime3 = new R(fakePersistence, async () => ({ output: badOut, provider: "openrouter", model: "m", usage: { inputTokens: 1, outputTokens: 1 } }));
  const ungrounded = await runtime3.synthesizeAgentOutputs({
    workflowId: "wf-s", projectId: "p", prompt: "x", context: {},
    results: [{ status: "COMPLETED", output: { a: 1 }, agentId: "research", artifactId: "art-1" }],
    config: base,
  });
  assert.equal(ungrounded.status, "COMPLETED");
});

test("17/18/20: no authority, unknown cost, no secrets end to end (stubbed transport)", async () => {
  const saved = [];
  const fakePersistence = {
    saveArtifact: async (a) => { saved.push(a); },
    listArtifacts: async (wf) => saved.filter((a) => a.workflowId === wf).map((a) => ({ ...a, payload: a.payload })),
    saveExecutionProvenance: async (r) => { saved.push({ provenance: r }); },
  };
  const internal = validInternalV2(3);
  const stub = async () => ({ output: internal, provider: "openrouter", model: "m", usage: { inputTokens: 1, outputTokens: 1 } });
  const runtime = new GovernedAgentRuntime(fakePersistence, stub);
  const result = await runtime.executeGovernedAgent({
    workflowId: "wf-rc", projectId: "morroway", agentId: "research",
    prompt: OWNER_PROMPT, context: { projectId: "morroway" },
    config: { provider: "openrouter", model: "m", source: "GLOBAL" },
  });
  assert.equal(result.status, "COMPLETED");
  const art = saved.find((a) => a.artifactId);
  assert.ok(art.payload.sections.length > 0, "no empty Sections");
  assert.equal(art.payload.responseContract, "INTERNAL_ANALYSIS_V2");
  const dumped = JSON.stringify({ result: { ...result, provenance: undefined }, art });
  assert.doesNotMatch(dumped, /api[_-]?key\s*[:=]\s*\S+/i);
  assert.doesNotMatch(dumped, /production approval granted|publication authorized/i);
  const prov = saved.find((a) => a.provenance);
  assert.equal(prov.provenance.costKind, "UNKNOWN");
});

/**
 * Slice 5 remediation V5 — structured actionability matrix (no DB, no providers).
 * Authority = canonical truth + structured metadata. Prose never decides.
 */
function v2Finding(over = {}) {
  return {
    title: "T", priority: "high", finding: "F.", evidence: ["platform context"],
    ownerImplication: "Watch it.", ownerActionRequired: false, ownerDecisionId: null, ...over,
  };
}
function v2Next(over = {}) {
  return {
    action: "Prepare a readiness brief.", actor: "team", actionType: "planning",
    requiresOwnerDecision: false, targetDecisionId: null, ...over,
  };
}
function v2Payload(findingOvers = [{}, {}, {}], nextOver = {}, topOver = {}) {
  return {
    summary: "S.", findings: findingOvers.map((o) => v2Finding(o)),
    ownerActionRequired: false, recommendedNextStep: v2Next(nextOver),
    limitations: ["L."], ...topOver,
  };
}
const ZERO_V2 = { requestedCount: 3, actionableDecisions: 0, actionableIds: [] };

test("V5-1/3/4/7/8: zero actionable — team work passes, any Owner claim fails", async () => {
  assert.ok(validateInternalAnalysisV2(v2Payload(), ZERO_V2).ok, "team+planning+requires=false passes");
  assert.ok(validateInternalAnalysisV2(
    v2Payload([{}, {}, {}], { action: "Write the brief.", actor: "team", actionType: "documentation" }), ZERO_V2).ok, "team documentation passes");
  assert.ok(validateInternalAnalysisV2(
    v2Payload([{}, {}, {}], { action: "Gather evidence.", actor: "agent", actionType: "evidence_collection" }), ZERO_V2).ok, "agent evidence collection passes");
  const topClaim = validateInternalAnalysisV2(v2Payload(), { ...ZERO_V2 });
  assert.ok(topClaim.ok, "all-false top passes");
  const badTop = validateInternalAnalysisV2(v2Payload([{}, {}, {}], {}, { ownerActionRequired: true }), ZERO_V2);
  assert.ok(!badTop.ok && /top-level ownerActionRequired/.test(badTop.reason), "top claim fails");
  const badFinding = validateInternalAnalysisV2(
    v2Payload([{ ownerActionRequired: true, ownerDecisionId: "a1" }, {}, {}], {}, { ownerActionRequired: true }), ZERO_V2);
  assert.ok(!badFinding.ok && /zero actionable/.test(badFinding.reason), "finding claim fails on zero truth");
  const ownerTyped = validateInternalAnalysisV2(
    v2Payload([{}, {}, {}], { action: "Decide now.", actor: "owner", actionType: "owner_decision", requiresOwnerDecision: true, targetDecisionId: "a1" }, { ownerActionRequired: true }), ZERO_V2);
  assert.ok(!ownerTyped.ok && /zero actionable/.test(ownerTyped.reason), "owner_decision+requires=true fails on zero truth");
});

test("V5-prose: live-failure wording passes once authority is structural", async () => {
  const nextWording = v2Payload([{}, {}, {}], { action: "Complete the pending owner brand identity review, then continue planning." });
  assert.ok(validateInternalAnalysisV2(nextWording, ZERO_V2).ok, "V2: next-step prose never creates authority");
  const implWording = v2Payload([{ ownerImplication: "The Owner must approve the pending gate now." }, {}, {}]);
  assert.ok(validateInternalAnalysisV2(implWording, ZERO_V2).ok, "V2: implication prose never creates authority");
  assert.ok(!validateInternalAnalysis(
    { ...validInternal(3), recommendedNextStep: "Complete the pending owner brand identity review, then continue." },
    { requestedCount: 3, actionableDecisions: 0 }).ok, "V1 still scans prose (historical behavior pinned)");
});

test("V5-5/6: raw pending and historical markers cannot ground Owner action", async () => {
  const { resolveOperationalContext } = await import("../dist/project-context.js");
  for (const state of ["SUPERSEDED", "HISTORICAL"]) {
    const snap = await resolveOperationalContext({
      listApprovals: async () => [{ approvalId: "a1", status: "PENDING" }],
      approvalActionability: async () => ({ state }),
      projectLifecycles: async () => [],
    }, "p");
    assert.equal(snap.approvals.actionable, 0, `${state} is not actionable`);
    assert.deepEqual(snap.approvals.actionableIds, [], `${state} yields no IDs`);
    const claim = v2Payload(
      [{ ownerActionRequired: true, ownerDecisionId: "a1" }, {}, {}],
      { action: "Decide.", actor: "owner", actionType: "owner_decision", requiresOwnerDecision: true, targetDecisionId: "a1" },
      { ownerActionRequired: true });
    const r = validateInternalAnalysisV2(claim, {
      requestedCount: 3, actionableDecisions: snap.approvals.actionable, actionableIds: snap.approvals.actionableIds,
    });
    assert.ok(!r.ok, `${state} marker cannot ground an Owner claim`);
  }
});

test("V5-9/10/11/12: real actionable decisions ground by ID only", async () => {
  const truth = { requestedCount: 3, actionableDecisions: 1, actionableIds: ["a1"] };
  const good = v2Payload(
    [{ ownerActionRequired: true, ownerDecisionId: "a1" }, {}, {}],
    { action: "Decide the gate.", actor: "owner", actionType: "owner_decision", requiresOwnerDecision: true, targetDecisionId: "a1" },
    { ownerActionRequired: true });
  assert.ok(validateInternalAnalysisV2(good, truth).ok, "valid actionable ID grounds Owner action");
  const unknown = v2Payload(
    [{ ownerActionRequired: true, ownerDecisionId: "nope" }, {}, {}],
    { action: "Decide.", actor: "owner", actionType: "approval", requiresOwnerDecision: true, targetDecisionId: "nope" },
    { ownerActionRequired: true });
  const rUnknown = validateInternalAnalysisV2(unknown, truth);
  assert.ok(!rUnknown.ok && /not currently actionable/.test(rUnknown.reason), "unknown decision ID fails");
  const rPending = validateInternalAnalysisV2(good, ZERO_V2);
  assert.ok(!rPending.ok, "non-actionable pending decision fails");
  const dangling = validateInternalAnalysisV2(v2Payload([{}, {}, {}], { targetDecisionId: "a1" }), truth);
  assert.ok(!dangling.ok && /requiresOwnerDecision=false/.test(dangling.reason), "dangling targetDecisionId fails");
  const mistyped = validateInternalAnalysisV2(
    v2Payload([{}, {}, {}], { action: "Decide.", actor: "owner", actionType: "documentation", requiresOwnerDecision: true, targetDecisionId: "a1" }, { ownerActionRequired: true }), truth);
  assert.ok(!mistyped.ok && /actionType/.test(mistyped.reason), "requires=true with non-decision actionType fails");
  const wrongActor = validateInternalAnalysisV2(
    v2Payload([{}, {}, {}], { action: "Decide.", actor: "team", actionType: "owner_decision", requiresOwnerDecision: true, targetDecisionId: "a1" }, { ownerActionRequired: true }), truth);
  assert.ok(!wrongActor.ok && /actor/.test(wrongActor.reason), "requires=true with non-owner actor fails");
});

test("V5-13/14/15: research+planner internal paths aligned, perspectives differ", async () => {
  const msg = "Review the current Morroway project state independently and recommend the single most useful next step.";
  for (const agent of ["research", "planner"]) {
    const pc = participantContract(agent, msg);
    assert.equal(pc.contract.id, "INTERNAL_ANALYSIS_V2", `${agent} routes to V2`);
  }
  const saved = [];
  const fakePersistence = {
    saveArtifact: async (a) => { saved.push(a); },
    listArtifacts: async (wf) => saved.filter((a) => a.workflowId === wf).map((a) => ({ ...a, payload: a.payload })),
    saveExecutionProvenance: async () => {},
  };
  const zeroCtx = { _operational: { approvals: { pending: 0, actionable: 0, actionableIds: [] } } };
  const { GovernedAgentRuntime: R } = await import("../dist/governed-agent-runtime.js");
  const runtime = new R(fakePersistence, async () => ({ output: validInternalV2(3), provider: "openrouter", model: "m", usage: { inputTokens: 1, outputTokens: 1 } }));
  const cfg = { provider: "openrouter", model: "m", source: "GLOBAL" };
  for (const agent of ["research", "planner"]) {
    const r = await runtime.executeGovernedAgent({ workflowId: "wf-v5role", projectId: "morroway", agentId: agent, prompt: msg, context: zeroCtx, config: cfg });
    assert.equal(r.status, "COMPLETED", `${agent} internal analysis completes on zero truth`);
  }
});

test("V5-19/20: synthesis valid team next-action passes, fabricated Owner action fails", async () => {
  const saved = [];
  const fakePersistence = {
    saveArtifact: async (a) => { saved.push(a); },
    listArtifacts: async (wf) => saved.filter((a) => a.workflowId === wf),
    saveExecutionProvenance: async () => {},
  };
  const { GovernedAgentRuntime: R } = await import("../dist/governed-agent-runtime.js");
  const base = { provider: "openrouter", model: "m", source: "GLOBAL" };
  const results = [
    { status: "COMPLETED", output: { a: 1 }, agentId: "research", artifactId: "art-1" },
    { status: "COMPLETED", output: { b: 2 }, agentId: "planner", artifactId: "art-2" },
  ];
  const ctx = { _operational: { approvals: { pending: 1, actionable: 0, actionableIds: [] } } };
  const goodOut = {
    agreements: ["a"], disagreements: ["Priority order differs."], evidence: ["platform context"],
    recommendation: "Finish planning first.", confidence: 0.7, missingEvidence: [], nextAction: "Continue planning the pilot.",
  };
  const rtGood = new R(fakePersistence, async () => ({ output: goodOut, provider: "openrouter", model: "m", usage: { inputTokens: 1, outputTokens: 1 } }));
  const ok = await rtGood.synthesizeAgentOutputs({ workflowId: "wf-s", projectId: "p", prompt: "x", context: ctx, results, config: base });
  assert.equal(ok.status, "COMPLETED");
  const badOut = { ...goodOut, nextAction: "Approve the pending gate now." };
  const rtBad = new R(fakePersistence, async () => ({ output: badOut, provider: "openrouter", model: "m", usage: { inputTokens: 1, outputTokens: 1 } }));
  const bad = await rtBad.synthesizeAgentOutputs({ workflowId: "wf-s", projectId: "p", prompt: "x", context: ctx, results, config: base });
  assert.equal(bad.status, "FAILED");
  assert.match(bad.error, /SYNTHESIS_ACTIONABILITY_INVALID/);
});

test("V5-21/22/23/24/25/26: fail-closed — bad payloads, single attempt, no fallback", async () => {
  const artifacts = [];
  const fakePersistence = {
    saveArtifact: async (a) => { artifacts.push(a); },
    listArtifacts: async (wf) => artifacts.filter((a) => a.workflowId === wf),
    saveExecutionProvenance: async () => {},
  };
  const { GovernedAgentRuntime: R } = await import("../dist/governed-agent-runtime.js");
  const cfg = { provider: "openrouter", model: "m", source: "GLOBAL" };
  const msg = "Review the current Morroway project state independently and recommend the single most useful next step.";
  const zeroCtx = { _operational: { approvals: { pending: 0, actionable: 0, actionableIds: [] } } };
  let calls = 0;
  const rtBad = new R(fakePersistence, async () => {
    calls++;
    return { output: '{"summary": "half-written', provider: "openrouter", model: "m", usage: { inputTokens: 1, outputTokens: 1 } };
  });
  const bad = await rtBad.executeGovernedAgent({ workflowId: "wf-v5bad", projectId: "p", agentId: "research", prompt: msg, context: zeroCtx, config: cfg });
  assert.notEqual(bad.status, "COMPLETED", "invalid JSON never completes");
  assert.equal(bad.output, null);
  assert.equal(artifacts.length, 0, "no artifact from invalid JSON");
  calls = 0;
  const invalidAuthority = v2Payload(
    [{ ownerActionRequired: true, ownerDecisionId: "ghost" }, {}, {}],
    { action: "Decide.", actor: "owner", actionType: "owner_decision", requiresOwnerDecision: true, targetDecisionId: "ghost" },
    { ownerActionRequired: true });
  const rtAuth = new R(fakePersistence, async () => {
    calls++;
    return { output: invalidAuthority, provider: "openrouter", model: "m", usage: { inputTokens: 1, outputTokens: 1 } };
  });
  const auth = await rtAuth.executeGovernedAgent({ workflowId: "wf-v5auth", projectId: "p", agentId: "planner", prompt: msg, context: zeroCtx, config: cfg });
  assert.equal(auth.status, "FAILED", "invalid structured authority fails closed");
  assert.equal(auth.output, null);
  assert.equal(auth.artifactId, null);
  assert.equal(calls, 1, "no automatic retry");
  assert.equal(auth.provider, "openrouter", "no provider fallback");
  assert.equal(auth.requestedModel, "m", "no model fallback");
  assert.equal(auth.actualModel, null);
});

test("V5-27/28/29: production, publication, and visibility authority unchanged", async () => {
  const { resolveOperationalContext } = await import("../dist/project-context.js");
  const snap = await resolveOperationalContext({
    listApprovals: async () => [],
    approvalActionability: async () => null,
    projectLifecycles: async () => [{
      title: "T", overallState: "IDLE", overallLabel: "L", attention: [], lastMilestone: "M",
      productionApproval: "NOT_GRANTED", publicationApproval: "NOT_GRANTED", publicStatus: "NOT_PUBLISHED",
    }],
  }, "p");
  assert.equal(snap.production, "NOT_GRANTED");
  assert.equal(snap.publication, "NOT_GRANTED");
  assert.equal(snap.publicStatus, "NOT_PUBLISHED");
  const out = v2Payload();
  assert.ok(!("production" in out) && !("publication" in out) && !("publicStatus" in out), "V2 claims no production/publication authority");
  assert.ok(validateInternalAnalysisV2(out, { requestedCount: 3, actionableDecisions: 0, actionableIds: [] }).ok);
});

test("V5-30/31: historical V1 readable, V2 persists and renders natively", async () => {
  const v1 = validInternal(3);
  assert.ok(validateInternalAnalysis(v1, { requestedCount: 3, actionableDecisions: 0 }).ok, "V1 still validates");
  const v1Sections = internalAnalysisSections(v1);
  assert.equal(v1Sections.length, v1.findings.length + 2);
  assert.equal(v1Sections[v1Sections.length - 1].body, "Keep observing.", "V1 string next-step renders as-is");
  const v2 = validInternalV2(3);
  assert.ok(validateInternalAnalysisV2(v2, ZERO_V2).ok, "V2 validates");
  const v2Sections = internalAnalysisSections(v2);
  const nextBody = v2Sections[v2Sections.length - 1].body;
  assert.match(nextBody, /Keep observing\./, "V2 renders model action text");
  assert.match(nextBody, /Owner decision required: No/, "V2 renders deterministic authority line");
});
