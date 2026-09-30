/**
 * E2E Operating Loop Proof M0 — decision-route validation-acceptance bit.
 * No DB: fake control store + real HTTP handler. Proves the route passes
 * the explicit bit through, maps fail-closed scope/action violations to
 * 409, and leaves existing validation behavior intact.
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { createWorkflowApiHandler } from "@ai-media-factory/api";

process.env.AMF_OWNER_TOKEN ??= "test-owner-token";
let server, base, calls;
const fakeRecord = (over = {}) => ({
  approvalId: "ap-1", projectId: "p", targetType: "publication_integration_validation_gate",
  targetId: "wf-1:v", agentRecommendation: {}, status: "DECIDED", ownerDecision: "APPROVE",
  ...over,
});
function startWith(impl) {
  calls = [];
  const control = {
    decideApproval: async (id, action, rationale, opts) => {
      calls.push({ id, action, rationale, opts });
      return impl(id, action, rationale, opts);
    },
  };
  const handler = createWorkflowApiHandler({ control });
  server = createServer((req, res) => void handler(req, res));
  return new Promise((r) => server.listen(0, "127.0.0.1", () => {
    base = `http://127.0.0.1:${server.address().port}`;
    r();
  }));
}
async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer test-owner-token" }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test("bit passes through on the exact scope (200)", async () => {
  await startWith(async () => fakeRecord({ agentRecommendation: { owner_validation_acceptance: true } }));
  try {
    const r = await post("/control/approvals/ap-1/decision", { action: "APPROVE", rationale: "explicit acceptance", validationAcceptance: true });
    assert.equal(r.status, 200);
    assert.deepEqual(calls[0].opts, { validationAcceptance: true });
  } finally { await new Promise((r) => server.close(r)); }
});

test("scope/action violations fail closed (409), row untouched", async () => {
  await startWith(async () => { throw new Error("VALIDATION_ACCEPTANCE_SCOPE_MISMATCH:workflow_gate"); });
  try {
    const r = await post("/control/approvals/ap-1/decision", { action: "APPROVE", rationale: "x", validationAcceptance: true });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /SCOPE_MISMATCH/);
  } finally { await new Promise((r) => server.close(r)); }
  await startWith(async () => { throw new Error("VALIDATION_ACCEPTANCE_REQUIRES_APPROVE"); });
  try {
    const r = await post("/control/approvals/ap-1/decision", { action: "REJECT", rationale: "x", validationAcceptance: true });
    assert.equal(r.status, 409);
  } finally { await new Promise((r) => server.close(r)); }
});

test("existing behavior intact without the bit", async () => {
  await startWith(async () => fakeRecord());
  try {
    const ok = await post("/control/approvals/ap-1/decision", { action: "APPROVE", rationale: "plain" });
    assert.equal(ok.status, 200);
    assert.equal(calls[0].opts, undefined);
    const bad = await post("/control/approvals/ap-1/decision", { action: "APPROVE" });
    assert.equal(bad.status, 400);
  } finally { await new Promise((r) => server.close(r)); }
  await startWith(async () => null);
  try {
    const missing = await post("/control/approvals/nope/decision", { action: "APPROVE", rationale: "x" });
    assert.equal(missing.status, 404);
  } finally { await new Promise((r) => server.close(r)); }
});
