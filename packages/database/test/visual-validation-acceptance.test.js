/**
 * Visual validation acceptance (in-band PENDING): validation_accepted_for_e2e
 * durably distinguishes validation from production approval.
 * Provider-free, isolated test DB.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate, VisualValidationAcceptanceStore } from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();

let pool;
let store;
before(async () => {
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  store = new VisualValidationAcceptanceStore(pool);
});
after(async () => { await pool.end(); });

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const base = (s) => ({
  workflowId: `wf-val-${s}`,
  visualIterationId: `visual-iteration-wf-val-${s}-1`,
  gateApprovalId: `approval-wf-val-${s}-visual-prompt-owner-review`,
  contractArtifactId: `art-${s}-contract`,
  promptPlanArtifactId: `art-${s}-plan`,
  targetCapability: "self-hosted-image",
  evidenceRefs: [`art-${s}-contract`, `art-${s}-plan`],
});

test("validation acceptance persists with exact binding, idempotent", async () => {
  const id = suffix();
  const first = await store.recordAcceptance(base(id));
  assert.equal(first.created, true);
  assert.equal(first.acceptance.workflowId, `wf-val-${id}`);
  assert.equal(first.acceptance.kind, "validation_accepted_for_e2e");
  const second = await store.recordAcceptance(base(id));
  assert.equal(second.created, false);
  assert.equal(second.acceptance.acceptanceId, first.acceptance.acceptanceId);
  assert.equal(await store.isValidationAcceptedForE2E(`wf-val-${id}`), true);
});

test("validation acceptance NEVER satisfies production publication authorization", async () => {
  const id = suffix();
  await store.recordAcceptance(base(id));
  assert.equal(await store.isProductionApproved(`wf-val-${id}`), false);
  assert.equal(await store.isValidationAcceptedForE2E(`wf-val-${id}`), true);
});

test("unknown workflow has no acceptance; production default is false", async () => {
  assert.equal(await store.isValidationAcceptedForE2E("wf-unknown-val"), false);
  assert.equal(await store.isProductionApproved("wf-unknown-val"), false);
});

test("missing identity rejected; no fake APPROVE fabricated", async () => {
  await assert.rejects(() => store.recordAcceptance({ workflowId: "", visualIterationId: "vi", gateApprovalId: "g" }), /IDENTITY_REQUIRED/);
  await assert.rejects(() => store.recordAcceptance({ workflowId: "wf", visualIterationId: "", gateApprovalId: "g" }), /IDENTITY_REQUIRED/);
});

test("historical queries parse without reclassification", async () => {
  const id = suffix();
  await store.recordAcceptance(base(id));
  const fetched = await store.getByWorkflow(`wf-val-${id}`);
  assert.equal(fetched.kind, "validation_accepted_for_e2e");
  assert.deepEqual(fetched.evidenceRefs, [`art-${id}-contract`, `art-${id}-plan`]);
});
