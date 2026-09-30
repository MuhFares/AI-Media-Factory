/**
 * Program 1 Workstream B — server-side Owner authentication enforcement.
 * No DB: fake control store + real HTTP handler. Mutating routes deny
 * unauthenticated callers (401) and deny everything when unconfigured
 * (503); read-only GETs stay open.
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { createWorkflowApiHandler } from "@ai-media-factory/api";

let server, base;
function start(deps) {
  const handler = createWorkflowApiHandler(deps);
  server = createServer((req, res) => void handler(req, res));
  return new Promise((r) => server.listen(0, "127.0.0.1", () => {
    base = `http://127.0.0.1:${server.address().port}`;
    r();
  }));
}
async function post(path, body, headers = {}) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
const record = {
  approvalId: "ap-1", projectId: "p", targetType: "workflow_gate", targetId: "wf-1:g",
  agentRecommendation: {}, status: "DECIDED", ownerDecision: "APPROVE",
};
const deps = { control: { decideApproval: async () => record } };

test("mutations denied when token unconfigured (503), open reads unaffected", async () => {
  delete process.env.AMF_OWNER_TOKEN;
  await start(deps);
  try {
    const r = await post("/control/approvals/ap-1/decision", { action: "APPROVE", rationale: "x" }, { Authorization: "Bearer anything" });
    assert.equal(r.status, 503);
    const g = await fetch(`${base}/control/projects`);
    assert.ok([200, 500].includes(g.status), "GETs are not auth-gated");
  } finally { await new Promise((r) => server.close(r)); }
});

test("401 without or with wrong credentials; 200 with Owner token", async () => {
  process.env.AMF_OWNER_TOKEN = "test-owner-token";
  await start(deps);
  try {
    const missing = await post("/control/approvals/ap-1/decision", { action: "APPROVE", rationale: "x" });
    assert.equal(missing.status, 401);
    const wrong = await post("/control/approvals/ap-1/decision", { action: "APPROVE", rationale: "x" }, { Authorization: "Bearer wrong" });
    assert.equal(wrong.status, 401);
    const malformed = await post("/control/approvals/ap-1/decision", { action: "APPROVE", rationale: "x" }, { Authorization: "Token test-owner-token" });
    assert.equal(malformed.status, 401);
    const ok = await post("/control/approvals/ap-1/decision", { action: "APPROVE", rationale: "x" }, { Authorization: "Bearer test-owner-token" });
    assert.equal(ok.status, 200);
  } finally {
    await new Promise((r) => server.close(r));
    delete process.env.AMF_OWNER_TOKEN;
  }
});
