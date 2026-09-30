/**
 * Slice 5 multi-agent reliability review (no DB, no providers).
 *
 * Latest live Planner rejection (command-1789914560953) proved the V2
 * validator's combined message ("fields exceed ceilings or priority
 * invalid") cannot identify the exact property. This suite pins:
 * precise field-path errors, prompt/validator/budget single-source truth,
 * ceiling-boundary behavior, contract budget proofs, harmless wording
 * variation under structured semantics, and context precedence labeling.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INTERNAL_ANALYSIS_LIMITS, NEXT_STEP_ACTORS, NEXT_STEP_ACTION_TYPES,
  researchContractFor, validateInternalAnalysisV2, internalAnalysisWorstCaseBytes,
  internalAnalysisBudget, effectiveExecutionPolicy, ceoSynthesisWorstCaseBytes,
  ceoSynthesisBudget, recommendsOwnerDecision,
} from "../dist/research-contracts.js";

const ZERO = { requestedCount: 3, actionableDecisions: 0, actionableIds: [] };

function baseFinding(over = {}) {
  return {
    title: "T", priority: "high", finding: "F.", evidence: ["platform context"],
    ownerImplication: "Watch it.", ownerActionRequired: false, ownerDecisionId: null, ...over,
  };
}
function basePayload(findingOvers = [{}, {}, {}], nextOver = {}, topOver = {}) {
  return {
    summary: "S.", findings: findingOvers.map((o) => baseFinding(o)),
    ownerActionRequired: false,
    recommendedNextStep: {
      action: "Prepare a brief.", actor: "team", actionType: "planning",
      requiresOwnerDecision: false, targetDecisionId: null, ...nextOver,
    },
    limitations: ["L."], ...topOver,
  };
}

test("RELIABILITY-exact-paths: every bounded V2 field names its path, length, and limit", async () => {
  const L = INTERNAL_ANALYSIS_LIMITS;
  assert.match(validateInternalAnalysisV2(basePayload([{ title: "x".repeat(L.title + 1) }, {}, {}]), ZERO).reason, /findings\[0\]\.title length 121 exceeds 120/);
  const pri = basePayload([{ priority: "critical" }, {}, {}]);
  assert.match(validateInternalAnalysisV2(pri, ZERO).reason, /findings\[0\]\.priority invalid value "critical" \(expected high\|medium\|low\)/);
  const fin = basePayload([{}, { finding: "y".repeat(L.finding + 1) }, {}]);
  assert.match(validateInternalAnalysisV2(fin, ZERO).reason, /findings\[1\]\.finding length 221 exceeds 220/);
  const imp = basePayload([{}, {}, { ownerImplication: "z".repeat(L.ownerImplication + 1) }]);
  assert.match(validateInternalAnalysisV2(imp, ZERO).reason, /findings\[2\]\.ownerImplication length 221 exceeds 220/);
  const ev = basePayload([{ evidence: ["ok", "w".repeat(L.evidenceItemChars + 1)] }, {}, {}]);
  assert.match(validateInternalAnalysisV2(ev, ZERO).reason, /findings\[0\]\.evidence\[1\] length 161 exceeds 160/);
  const evCount = basePayload([{ evidence: ["e", "e", "e", "e", "e", "e"] }, {}, {}]);
  assert.match(validateInternalAnalysisV2(evCount, ZERO).reason, /findings\[0\]\.evidence must hold 1-5 items \(got 6\)/);
  const lim = { ...basePayload(), limitations: ["ok", "v".repeat(L.limitationChars + 1)] };
  assert.match(validateInternalAnalysisV2(lim, ZERO).reason, /limitations\[1\] length 161 exceeds 160/);
  const act = basePayload([{}, {}, {}], { action: "a".repeat(L.nextStepAction + 1) });
  assert.match(validateInternalAnalysisV2(act, ZERO).reason, /recommendedNextStep\.action length 301 exceeds 300/);
  const sum = { ...basePayload(), summary: "s".repeat(L.summary + 1) };
  assert.match(validateInternalAnalysisV2(sum, ZERO).reason, /summary exceeds ceiling 401\/400/);
  const nonString = basePayload([{ title: { text: "not a string" } }, {}, {}]);
  assert.match(validateInternalAnalysisV2(nonString, ZERO).reason, /findings\[0\]\.title is not a string/);
});

test("RELIABILITY-at-ceiling: every field exactly at its limit passes", async () => {
  const L = INTERNAL_ANALYSIS_LIMITS;
  const out = {
    summary: "s".repeat(L.summary),
    findings: Array.from({ length: 3 }, () => ({
      title: "t".repeat(L.title), priority: "low", finding: "f".repeat(L.finding),
      evidence: Array.from({ length: L.evidenceItems }, () => "e".repeat(L.evidenceItemChars)),
      ownerImplication: "i".repeat(L.ownerImplication), ownerActionRequired: false, ownerDecisionId: null,
    })),
    ownerActionRequired: false,
    recommendedNextStep: {
      action: "a".repeat(L.nextStepAction), actor: "unspecified", actionType: "other",
      requiresOwnerDecision: false, targetDecisionId: null,
    },
    limitations: Array.from({ length: L.limitations }, () => "l".repeat(L.limitationChars)),
  };
  assert.ok(validateInternalAnalysisV2(out, ZERO).ok, "ceiling-exact payload is valid");
});

test("RELIABILITY-ssot: prompt appendix derives from INTERNAL_ANALYSIS_LIMITS and authority enums", async () => {
  const L = INTERNAL_ANALYSIS_LIMITS;
  const appendix = researchContractFor("INTERNAL_PROJECT_ANALYSIS").promptAppendix;
  for (const n of [L.summary, L.title, L.finding, L.evidenceItemChars, L.ownerImplication, L.nextStepAction, L.limitationChars, L.decisionId]) {
    assert.ok(appendix.includes(`at most ${n}`), `prompt states ceiling ${n}`);
  }
  assert.ok(appendix.includes(NEXT_STEP_ACTORS.join("|")), "prompt actor list matches enum");
  assert.ok(appendix.includes(NEXT_STEP_ACTION_TYPES.join("|")), "prompt actionType list matches enum");
  assert.ok(appendix.includes("high|medium|low"), "prompt priority list matches validator");
  assert.ok(appendix.includes("_operational"), "precedence labels the current-truth block");
  assert.ok(appendix.includes("never overrides"), "precedence: stale markers cannot override current truth");
});

test("RELIABILITY-budget-proof: worst-case bytes fit every governed budget at the 3.0 assumption", async () => {
  for (const n of [1, 2, 3, 4, 5]) {
    const bytes = internalAnalysisWorstCaseBytes(n);
    const budget = internalAnalysisBudget(n);
    assert.ok(bytes <= budget * 3.0, `n=${n}: ${bytes}B fits ${budget} tokens at 3.0 B/tok`);
  }
  const ceoBytes = ceoSynthesisWorstCaseBytes();
  assert.ok(ceoBytes <= ceoSynthesisBudget() * 3.0, `ceo: ${ceoBytes}B fits ${ceoSynthesisBudget()} tokens at 3.0 B/tok`);
  const msg = "Review the current Morroway project state independently and recommend the single most useful next step.";
  for (const agent of ["research", "planner"]) {
    const p = effectiveExecutionPolicy({ agentId: agent, prompt: msg });
    assert.equal(p.contractId, "INTERNAL_ANALYSIS_V2");
    assert.deepEqual(p.reasoning, { effort: "none" }, `${agent} reasoning default none`);
    assert.ok(p.budget * 3.0 >= internalAnalysisWorstCaseBytes(p.findingCount), `${agent} budget fits contract`);
  }
  assert.equal(
    effectiveExecutionPolicy({ agentId: "research", prompt: msg }).budget,
    effectiveExecutionPolicy({ agentId: "planner", prompt: msg }).budget,
    "same contract, same budget class",
  );
});

test("RELIABILITY-variation: harmless wording follows structured semantics, never prose", async () => {
  const L = INTERNAL_ANALYSIS_LIMITS;
  const variants = [
    basePayload([{ finding: "Brief noted." }, {}, {}]),
    basePayload([{}, { finding: "f".repeat(L.finding) }, {}]),
    basePayload([{ evidence: ["e".repeat(L.evidenceItemChars)] }, {}, {}]),
    basePayload([{}, {}, { ownerImplication: "i".repeat(L.ownerImplication) }]),
    basePayload([{ finding: "Well-documented, source-backed state; follow-up needed." }, {}, {}]),
    basePayload([{}, {}, {}], { action: "Do not authorize publication; keep planning." }),
    basePayload([{}, {}, { ownerImplication: "Relevant without authorizing publication." }]),
    basePayload([{ finding: "Production remains unauthorized and nothing is public." }, {}, {}]),
    basePayload([{}, { ownerImplication: "Owner decision is not required now." }, {}]),
    basePayload([{}, {}, {}], { action: "Team should prepare the readiness brief.", actor: "team", actionType: "documentation" }),
    basePayload([{}, {}, {}], { action: "Project should document dependencies.", actor: "system", actionType: "documentation" }),
    basePayload([{ ownerImplication: "Evidence should be collected before later review." }, {}, {}]),
  ];
  for (const [k, v] of variants.entries()) {
    assert.ok(validateInternalAnalysisV2(v, ZERO).ok, `harmless variant ${k} passes on structured semantics`);
  }
  // Structural controls still fail closed on zero truth.
  const fabricated = basePayload(
    [{ ownerActionRequired: true, ownerDecisionId: "ghost" }, {}, {}],
    { action: "Decide.", actor: "owner", actionType: "owner_decision", requiresOwnerDecision: true, targetDecisionId: "ghost" },
    { ownerActionRequired: true },
  );
  assert.ok(!validateInternalAnalysisV2(fabricated, ZERO).ok, "fabricated Owner action fails");
  const mistyped = basePayload([{}, {}, {}], { action: "Decide.", actor: "owner", actionType: "documentation", requiresOwnerDecision: true, targetDecisionId: "a1" }, { ownerActionRequired: true });
  assert.ok(!validateInternalAnalysisV2(mistyped, { requestedCount: 3, actionableDecisions: 1, actionableIds: ["a1"] }).ok);
});

test("RELIABILITY-ceo-audit: synthesis matcher stays conservative in both directions", async () => {
  // Documented residual risk: the CEO contract has no structured authority
  // fields, so the negation-aware matcher remains the backstop. It must
  // catch affirmative instructions and spare negated safety language.
  assert.equal(recommendsOwnerDecision("Kindly grant the gate's authorization at your earliest convenience."), true);
  assert.equal(recommendsOwnerDecision("Please confirm the plan is sound before we proceed."), false);
  assert.equal(recommendsOwnerDecision("Draft the plan without starting production or authorizing publication."), false);
  assert.equal(recommendsOwnerDecision("Approve the pending gate now."), true);
});
