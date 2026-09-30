import assert from "node:assert/strict";
import test from "node:test";
import { ProductionPolicyEnforcer } from "../dist/index.js";

const clone = (x) => JSON.parse(JSON.stringify(x));
class Store { decisions = new Map(); async saveDecision(a) { this.decisions.set(a.decisionId, clone(a)); } async listDecisions(id) { return [...this.decisions.values()].filter((a) => a.workflowId === id).map(clone); } }
const req = (overrides = {}) => ({ workflowId: "wf-policy", correlationId: "corr-policy", sourceStage: "research", targetStage: "planning", ruleId: "research-to-planning", requiredEvidence: ["research-report"], artifactIds: ["research-1"], ...overrides });

test("durable policy decisions allow, deny, and require human gates", async () => {
  const store = new Store(); const enforcer = new ProductionPolicyEnforcer(store);
  assert.equal((await enforcer.evaluate(req())).decision, "ALLOW");
  assert.equal((await enforcer.evaluate(req({ targetStage: "visual-human-gate", humanGate: true }))).decision, "HUMAN_GATE_REQUIRED");
  assert.equal((await enforcer.evaluate(req({ targetStage: "missing-evidence", requiredEvidence: [] }))).decision, "DENY");
  assert.equal((await store.listDecisions("wf-policy")).length, 3);
});

test("reload reuses only matching decisions and versioned decisions are distinct", async () => {
  const store = new Store(); await new ProductionPolicyEnforcer(store).evaluate(req());
  const reloaded = new ProductionPolicyEnforcer(store);
  assert.equal((await reloaded.evaluate(req())).reused, true);
  assert.equal((await reloaded.evaluate(req({ policyVersion: "v2" }))).reused, false);
  assert.equal((await reloaded.evaluate(req({ correlationId: "wrong", targetStage: "planning-wrong-correlation" }))).decision, "ALLOW");
});

test("missing evidence cannot be asserted as an allowed transition", async () => {
  const enforcer = new ProductionPolicyEnforcer(new Store());
  await assert.rejects(() => enforcer.assertAllowed(req({ requiredEvidence: [] })), /POLICY_DENY/);
});

test("stage evidence is workflow/correlation/lineage aware and invalidates ALLOW", async () => {
  const store = new Store(); const enforcer = new ProductionPolicyEnforcer(store);
  const evidence = [{ evidenceId: "e-research", workflowId: "wf-policy", correlationId: "corr-policy", artifactId: "research-1", artifactHash: "sha-1", lineage: ["research"], valid: true }];
  assert.equal((await enforcer.evaluate(req({ evidence }))).decision, "ALLOW");
  assert.equal((await enforcer.evaluate(req({ evidence: [{ ...evidence[0], artifactHash: "sha-2" }] }))).decision, "DENY");
  assert.equal((await enforcer.evaluate(req({ evidence: [{ ...evidence[0], correlationId: "wrong" }] }))).decision, "DENY");
  assert.equal((await enforcer.evaluate(req({ evidence: [{ ...evidence[0], superseded: true }] }))).decision, "DENY");
});

test("resume never synthesizes a missing historical policy decision", async () => {
  const enforcer = new ProductionPolicyEnforcer(new Store());
  await assert.rejects(() => enforcer.evaluate(req({ mode: "resume" })), (error) => error.code === "MISSING_POLICY_DECISION");
});
