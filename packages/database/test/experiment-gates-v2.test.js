/**
 * Slice 6 experiment gates v2 — pure transform tests (no DB, no providers).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildExperimentV2, v1PreconditionMet } from "../../../scripts/reconcile-experiment-gates-v2.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const V1 = {
  rule: "hypotheses, NOT permanent KPIs; promotion to permanent only via governed Owner decision",
  status: "EXPERIMENTAL",
  hypothesis: "pilot performance gates",
  observedTriggers: ["5% engagement across 10 Reels", "10k views threshold", "10% weekly follower growth", "$100 monetization"],
  validScaleDecisions: ["Scale", "Continue", "Iterate", "Retest", "Pause", "Retire"],
};

test("precondition gates creation on the exact reviewed shape", async () => {
  assert.equal(v1PreconditionMet(V1), true);
  assert.equal(v1PreconditionMet({ ...V1, observedTriggers: undefined }), false);
  assert.equal(v1PreconditionMet({ ...V1, status: "ACTIVE" }), false);
  assert.equal(v1PreconditionMet(null), false);
});

test("1+4+5+11: v1 untouched; hypothesis/rule/decisions preserved exactly", async () => {
  const frozen = JSON.parse(JSON.stringify(V1));
  const v2 = buildExperimentV2(V1);
  assert.deepEqual(V1, frozen, "v1 immutable in memory");
  assert.equal(v2.status, "EXPERIMENTAL");
  assert.equal(v2.hypothesis, "pilot performance gates");
  assert.equal(v2.rule, V1.rule);
  assert.deepEqual(v2.validScaleDecisions, ["Scale", "Continue", "Iterate", "Retest", "Pause", "Retire"]);
  assert.deepEqual(buildExperimentV2(v2), v2, "fixed point on re-application");
});

test("4+6+7+8: signals verbatim but never observed/trigger/KPI", async () => {
  const v2 = buildExperimentV2(V1);
  assert.deepEqual(v2.experimentalEvaluationSignals, V1.observedTriggers, "four values verbatim");
  assert.ok(!("observedTriggers" in v2), "misleading field name gone");
  assert.match(v2.signalSemantics, /NOT observed pilot results/);
  assert.match(v2.signalSemantics, /NOT automatic triggers/);
  assert.match(v2.signalSemantics, /NOT permanent KPIs/);
  assert.match(v2.sourceWordingNote, /retained verbatim for provenance/);
});

test("9+10+12: decision semantics governed; promotion stays Owner-decided", async () => {
  const v2 = buildExperimentV2(V1);
  assert.equal(v2.decisionUse, "Performance against these signals informs governed evaluation only.");
  assert.deepEqual(v2.decisionModel, ["PERFORMANCE_LED", "AGENT_RECOMMENDED", "OWNER_GOVERNED"]);
  assert.match(v2.automaticDecisionRule, /No signal crossing automatically selects Scale, Continue, Iterate, Retest, Pause, or Retire\./);
  assert.match(v2.rule, /promotion to permanent only via/);
});

test("grants nothing; script performs no approvals/activations/workflows/providers", async () => {
  const v2 = buildExperimentV2(V1);
  assert.doesNotMatch(JSON.stringify(v2), /"GRANTED"|APPROVE|production|publication/i);
  const source = fs.readFileSync(path.join(REPO, "scripts/reconcile-experiment-gates-v2.mjs"), "utf8");
  assert.doesNotMatch(source, /decideApproval|createApproval|\.activate\(/);
  assert.doesNotMatch(source, /\bfetch\s*\(|openrouter|agentrouter|[^a-z]llm[^a-z]/i);
});
