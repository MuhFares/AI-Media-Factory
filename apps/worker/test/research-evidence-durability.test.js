import test from "node:test";
import assert from "node:assert/strict";
import { persistCapabilityResultDurably } from "../dist/index.js";

const scope = { workflowId: "wf-durable", correlationId: "corr-durable", agentId: "research" };
const result = {
  status: "success",
  resultId: "result-wf-durable:exec-1:lane-a:q1:a1",
  capabilityId: "web.search",
  output: { results: [{ title: "Museum", url: "https://museum.example/item" }] },
  evidence: { evidenceId: "evidence-wf-durable:exec-1:lane-a:q1:a1", succeeded: true, executedAt: "2026-10-03T00:00:00.000Z" },
};

function memoryPersistence(options = {}) {
  const capabilities = new Map();
  const evidence = new Map();
  return {
    capabilities,
    evidence,
    async saveCapabilityExecution(row) {
      const existing = capabilities.get(row.idempotencyKey);
      if (!existing) capabilities.set(row.idempotencyKey, structuredClone(row));
    },
    async saveExecutionEvidence(row) {
      if (options.failEvidence) throw new Error("fixture evidence write failed");
      const existing = evidence.get(row.idempotencyKey);
      if (!existing) evidence.set(row.idempotencyKey, structuredClone(row));
    },
    async listCapabilityExecutions(workflowId) {
      return [...capabilities.values()].filter((row) => row.workflowId === workflowId);
    },
  };
}

test("successful retrieval is durable before downstream synthesis", async () => {
  const persistence = memoryPersistence();
  await persistCapabilityResultDurably(persistence, scope, result);
  assert.equal(persistence.capabilities.size, 1);
  assert.equal(persistence.evidence.size, 1);
  assert.equal([...persistence.evidence.values()][0].succeeded, true);
});

test("same logical invocation replay is idempotent", async () => {
  const persistence = memoryPersistence();
  await persistCapabilityResultDurably(persistence, scope, result);
  await persistCapabilityResultDurably(persistence, scope, structuredClone(result));
  assert.equal(persistence.capabilities.size, 1);
  assert.equal(persistence.evidence.size, 1);
});

test("evidence write failure cannot roll back the already committed capability result", async () => {
  const persistence = memoryPersistence({ failEvidence: true });
  await assert.rejects(() => persistCapabilityResultDurably(persistence, scope, result), /fixture evidence write failed/);
  assert.equal(persistence.capabilities.size, 1);
  assert.equal(persistence.evidence.size, 0);
});

test("identity collision fails closed and preserves historical result", async () => {
  const persistence = memoryPersistence();
  await persistCapabilityResultDurably(persistence, scope, result);
  const conflicting = structuredClone(result);
  conflicting.output.results[0].title = "Conflicting payload";
  await assert.rejects(() => persistCapabilityResultDurably(persistence, scope, conflicting), /CAPABILITY_EVIDENCE_CONFLICT/);
  assert.equal([...persistence.capabilities.values()][0].payload.output.results[0].title, "Museum");
});
