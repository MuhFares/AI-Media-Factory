/**
 * Program 1 Workstream A — visibility-aware publicStatus matrix.
 * Isolated TEST DB only. Provider confirmation must never imply public
 * visibility: only exact public visibility yields PUBLISHED.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  createPool, migrate, PostgresQueue, PostgresPublishStore, LifecycleStore,
} from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();

let pool, queue, lifecycle, store;
const PID = `vis-${Date.now().toString(36)}`;
const PROJ = `${PID}-proj`;
before(async () => {
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  queue = new PostgresQueue(pool);
  lifecycle = new LifecycleStore(pool);
  store = new PostgresPublishStore(pool);
});
after(async () => { await pool.end(); });

async function fixture(suffix) {
  const wf = `wf-${PID}-${suffix}`;
  await queue.submit({
    submissionKey: `${PID}-sub-${suffix}`, workflowId: wf, directive: "research",
    correlationId: `${PID}-corr-${suffix}`, brandId: PROJ, definition: { stages: [] },
    status: "submitted",
  });
  return wf;
}
async function completedRow(key, visibility) {
  await store.save(key, {
    status: "completed", providerId: "youtube", publicationId: "vid-1",
    url: "https://www.youtube.com/watch?v=vid-1",
    publishedAt: new Date().toISOString(),
    ...(visibility === undefined ? {} : { visibility }),
  });
}

test("A: no publication renders NOT_PUBLISHED with null provider record", async () => {
  const lc = await lifecycle.workflowLifecycle(await fixture("none"));
  assert.equal(lc.publicStatus, "NOT_PUBLISHED");
  assert.equal(lc.providerPublication, null);
});

test("B: confirmed private renders NOT_PUBLISHED with visible provider record", async () => {
  const wf = await fixture("private");
  await completedRow(`${PID}-private`, "private");
  await pool.query(`UPDATE provider_publications SET workflow_id=$2, asset_id=$3 WHERE idempotency_key=$1`,
    [`${PID}-private`, wf, `art-${PID}`]);
  const lc = await lifecycle.workflowLifecycle(wf);
  assert.equal(lc.publicStatus, "NOT_PUBLISHED");
  assert.deepEqual(lc.providerPublication, { confirmed: true, visibility: "private" });
});

test("C: confirmed unlisted renders NOT_PUBLISHED", async () => {
  const wf = await fixture("unlisted");
  await completedRow(`${PID}-unlisted`, "unlisted");
  await pool.query(`UPDATE provider_publications SET workflow_id=$2 WHERE idempotency_key=$1`, [`${PID}-unlisted`, wf]);
  const lc = await lifecycle.workflowLifecycle(wf);
  assert.equal(lc.publicStatus, "NOT_PUBLISHED");
  assert.equal(lc.providerPublication.visibility, "unlisted");
});

test("D: confirmed public renders PUBLISHED", async () => {
  const wf = await fixture("public");
  await completedRow(`${PID}-public`, "public");
  await pool.query(`UPDATE provider_publications SET workflow_id=$2 WHERE idempotency_key=$1`, [`${PID}-public`, wf]);
  const lc = await lifecycle.workflowLifecycle(wf);
  assert.equal(lc.publicStatus, "PUBLISHED");
  assert.equal(lc.providerPublication.visibility, "public");
});

test("E+F: submitted and failed rows never publish", async () => {
  const wf = await fixture("pending");
  await pool.query(
    `INSERT INTO provider_publications (idempotency_key,status,provider_id,workflow_id,created_at,updated_at)
     VALUES ($1,'failed','youtube',$2,$3,$3)`,
    [`${PID}-failed`, wf, new Date().toISOString()]);
  const lc = await lifecycle.workflowLifecycle(wf);
  assert.equal(lc.publicStatus, "NOT_PUBLISHED");
  assert.equal(lc.providerPublication, null);
});

test("G: unknown and missing visibility fail closed", async () => {
  const wf = await fixture("unknown");
  await completedRow(`${PID}-unknown`, undefined);
  await pool.query(`UPDATE provider_publications SET workflow_id=$2, visibility=NULL WHERE idempotency_key=$1`, [`${PID}-unknown`, wf]);
  const lc = await lifecycle.workflowLifecycle(wf);
  assert.equal(lc.publicStatus, "NOT_PUBLISHED");
  assert.deepEqual(lc.providerPublication, { confirmed: true, visibility: "unknown" });
  const wf2 = await fixture("weird");
  await completedRow(`${PID}-weird`, "someday-public");
  await pool.query(`UPDATE provider_publications SET workflow_id=$2 WHERE idempotency_key=$1`, [`${PID}-weird`, wf2]);
  const lc2 = await lifecycle.workflowLifecycle(wf2);
  assert.equal(lc2.publicStatus, "NOT_PUBLISHED");
});

test("H: M4 private video shape renders NOT_PUBLISHED", async () => {
  const wf = await fixture("m4");
  await completedRow("m4-private-youtube-art-m4-fixture", "private");
  await pool.query(`UPDATE provider_publications SET workflow_id=$2, asset_id=$3 WHERE idempotency_key=$1`,
    ["m4-private-youtube-art-m4-fixture", wf, "art-m4-fixture"]);
  const lc = await lifecycle.workflowLifecycle(wf);
  assert.equal(lc.publicStatus, "NOT_PUBLISHED");
  assert.equal(lc.providerPublication.visibility, "private");
  assert.equal(lc.productionApproval, "NOT_GRANTED");
  assert.equal(lc.publicationApproval, "NOT_GRANTED");
});

test("I+J+K: confirmation visible separately; authority and history intact", async () => {
  const wf = await fixture("sep");
  await completedRow(`${PID}-sep`, "private");
  await pool.query(`UPDATE provider_publications SET workflow_id=$2 WHERE idempotency_key=$1`, [`${PID}-sep`, wf]);
  const lc = await lifecycle.workflowLifecycle(wf);
  assert.ok(lc.providerPublication && lc.providerPublication.confirmed, "confirmation visible");
  assert.equal(lc.productionApproval, "NOT_GRANTED");
  assert.equal(lc.publicationApproval, "NOT_GRANTED");
  const rows = await pool.query(`SELECT visibility FROM provider_publications WHERE idempotency_key=$1`, [`${PID}-sep`]);
  assert.equal(rows.rows[0].visibility, "private", "stored visibility preserved verbatim");
});
