/**
 * Visual Director execution ledger (isolated test DB).
 * Canonical aliases stay unique; history is append-only; re-registration
 * observes instead of duplicating. Provider-free.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate, VisualDirectorLedgerStore } from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();

let pool;
let ledger;
before(async () => {
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  ledger = new VisualDirectorLedgerStore(pool);
});
after(async () => { await pool.end(); });

const runId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function makeAttempt(alias, overrides = {}) {
  return {
    visualDirectorAttemptId: alias,
    workflowId: `wf-ledger-${runId()}`,
    authorizationRef: `owner-${alias}`,
    submissionOrdinal: 1,
    executionId: `exec-${alias}`,
    inputArtifactId: `art-input-${alias}`,
    evidenceArtifactId: `art-evidence-${alias}`,
    provider: "openrouter",
    requestedModel: "nex-agi/nex-n2.5-pro:free",
    actualModel: "nex-agi/nex-n2.5-pro:free",
    transport: "STREAMING_SSE",
    reasoningConfig: { effort: "none" },
    maxTokens: 4096,
    httpStatus: 200,
    finishReason: "stop",
    visibleBytes: 100,
    reasoningTokens: 0,
    validationOutcome: "PASS",
    canonicalContractArtifactId: `art-contract-${alias}`,
    source: "live",
    ...overrides,
  };
}

test("four submissions register under unique canonical aliases", async () => {
  const suffix = runId();
  const aliases = ["001", "002", "003A", "003B"].map((n) => `VD-ATTEMPT-${n}-${suffix}`);
  for (const alias of aliases) {
    const { created, attempt } = await ledger.registerAttempt(makeAttempt(alias));
    assert.equal(created, true);
    assert.equal(attempt.visualDirectorAttemptId, alias);
  }
  // A: same execution re-registers idempotently; B: aliases never collide.
  const dup = await ledger.registerAttempt(makeAttempt(aliases[0]));
  assert.equal(dup.created, false);
  assert.equal(dup.attempt.visualDirectorAttemptId, aliases[0]);
  const listed = await ledger.listByWorkflow(dup.attempt.workflowId);
  assert.ok(listed.length >= 1);
});

test("null execution IDs still key on authorization+ordinal", async () => {
  const suffix = runId();
  const first = await ledger.registerAttempt(makeAttempt(`VD-NULL-1-${suffix}`, { executionId: null }));
  assert.equal(first.created, true);
  const second = await ledger.registerAttempt(makeAttempt(`VD-NULL-1-${suffix}`, { executionId: null }));
  assert.equal(second.created, false, "same authorization+ordinal observes");
  const other = await ledger.registerAttempt(makeAttempt(`VD-NULL-2-${suffix}`, { executionId: null, authorizationRef: `owner-VD-NULL-2-${suffix}` }));
  assert.equal(other.created, true, "distinct authorization creates distinctly");
});

test("missing identity is rejected", async () => {
  await assert.rejects(() => ledger.registerAttempt({ visualDirectorAttemptId: "", workflowId: "w", authorizationRef: "a" }), /IDENTITY_REQUIRED/);
  await assert.rejects(() => ledger.registerAttempt(makeAttempt("VD-BAD-ORD", { submissionOrdinal: 0 })), /ORDINAL_INVALID/);
});

test("aliases resolve with full outcome lineage", async () => {  const alias = `VD-LOOKUP-${runId()}`;
  await ledger.registerAttempt(makeAttempt(alias, { validationOutcome: "FAIL", canonicalContractArtifactId: null }));
  const found = await ledger.getByAlias(alias);
  assert.equal(found.validationOutcome, "FAIL");
  assert.equal(found.canonicalContractArtifactId, null);
  assert.equal(found.source, "live");
  assert.equal(await ledger.getByAlias("VD-NOPE"), null);
});

test("outcome records exactly once; rewrites refused", async () => {
  const alias = `VD-OUTCOME-${runId()}`;
  await ledger.registerAttempt(makeAttempt(alias, { validationOutcome: null }));
  const done = await ledger.recordOutcome(alias, {
    httpStatus: 200, finishReason: "stop", visibleBytes: 16858, reasoningTokens: 0,
    actualModel: "nex-agi/nex-n2.5-pro:free", validationOutcome: "PASS",
    canonicalContractArtifactId: "art-contract",
  });
  assert.equal(done.validationOutcome, "PASS");
  assert.equal(done.canonicalContractArtifactId, "art-contract");
  assert.equal(done.visibleBytes, 16858);
  await assert.rejects(() => ledger.recordOutcome(alias, { validationOutcome: "FAIL" }), /ALREADY_RECORDED/);
  await assert.rejects(() => ledger.recordOutcome("VD-NOPE", { validationOutcome: "FAIL" }), /ALREADY_RECORDED/);
});
