/**
 * Program 2 Workstream A — content domain unit + persistence matrix.
 * Pure deriveContentStatus tests need no DB; store tests use the isolated
 * TEST DB only. Creation/linking never starts execution or decides.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate, ContentStore, deriveContentStatus } from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();

const base = (over = {}) => ({
  workflowLinked: false, overallState: null, currentPhaseId: null,
  publicStatus: null, hasObservation: false, hasLearning: false,
  hasProposal: false, ...over,
});

test("1: lifecycle mapping across states", () => {
  assert.equal(deriveContentStatus(base()).status, "IDEA");
  assert.equal(deriveContentStatus(base({ workflowLinked: true, overallState: "NEEDS_OWNER_ATTENTION" })).status, "AWAITING_APPROVAL");
  assert.equal(deriveContentStatus(base({ workflowLinked: true, overallState: "FAILED_TERMINAL" })).status, "FAILED");
  assert.equal(deriveContentStatus(base({ workflowLinked: true, overallState: "BLOCKED" })).status, "FAILED");
  assert.equal(deriveContentStatus(base({ workflowLinked: true, overallState: "IN_PROGRESS", currentPhaseId: "plan" })).status, "PLANNING");
  assert.equal(deriveContentStatus(base({ workflowLinked: true, overallState: "IN_PROGRESS", currentPhaseId: "create" })).status, "SCRIPTING");
  assert.equal(deriveContentStatus(base({ workflowLinked: true, overallState: "IN_PROGRESS", currentPhaseId: "media" })).status, "PRODUCTION");
  assert.equal(deriveContentStatus(base({ workflowLinked: true, overallState: "IN_PROGRESS", currentPhaseId: "review" })).status, "QA");
  assert.equal(deriveContentStatus(base({ workflowLinked: true, overallState: "IN_PROGRESS", currentPhaseId: "analytics" })).status, "MEASURING");
  assert.equal(deriveContentStatus(base({ workflowLinked: true, overallState: "MEDIA_COMPLETED" })).status, "QA");
  assert.equal(deriveContentStatus(base({ workflowLinked: true, overallState: "VALIDATION_COMPLETED" })).status, "READY_TO_PUBLISH");
  assert.equal(deriveContentStatus(base({ workflowLinked: true, overallState: "VALIDATION_COMPLETED", publicStatus: "PUBLISHED" })).status, "MEASURING");
  assert.equal(deriveContentStatus(base({ workflowLinked: true, overallState: "VALIDATION_COMPLETED", publicStatus: "PUBLISHED", hasObservation: true })).status, "LEARNING");
  assert.equal(deriveContentStatus(base({ workflowLinked: true, overallState: "COMPLETED", publicStatus: "PUBLISHED", hasProposal: true })).status, "COMPLETED");
  assert.equal(deriveContentStatus(base({ workflowLinked: true, overallState: "COMPLETED" })).status, "READY_TO_PUBLISH");
});

test("2: project isolation between content lists", async () => {
  const pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  try {
    const store = new ContentStore(pool);
    const a = await store.createContent({ projectId: "proj-a", title: "A", objective: "oa" });
    await store.createContent({ projectId: "proj-b", title: "B", objective: "ob" });
    assert.deepEqual((await store.listContent("proj-a")).map((x) => x.contentId), [a.contentId]);
    assert.equal((await store.listContent("proj-b")).length, 1);
  } finally { await pool.end(); }
});

test("3+4: creation validates input and links existing records only", async () => {
  const pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  try {
    const store = new ContentStore(pool);
    await assert.rejects(store.createContent({ projectId: "p", title: " ", objective: "o" }), /CONTENT_TITLE_REQUIRED/);
    await assert.rejects(store.createContent({ projectId: "p", title: "t", objective: " " }), /CONTENT_OBJECTIVE_REQUIRED/);
    const item = await store.createContent({ projectId: "p", title: "T", objective: "O", topic: "seed" });
    assert.equal(item.channel, "youtube");
    assert.equal(item.format, "short");
    assert.equal(item.workflowId, null);
    assert.equal(await store.linkRecords("content-missing", { workflowId: "wf-x" }), null);
    const linked = await store.linkRecords(item.contentId, { seedArtifactId: "art-1", experimentId: "exp-1" });
    assert.equal(linked.seedArtifactId, "art-1");
    assert.equal(linked.workflowId, null, "linking seeds never fabricates a workflow");
  } finally { await pool.end(); }
});
