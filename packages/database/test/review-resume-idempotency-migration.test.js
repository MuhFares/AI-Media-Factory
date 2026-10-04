import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import pg from "pg";
import {
  applyReviewResumeIdempotencyMigration,
  precheckReviewResumeIdempotencyMigration,
  probeReviewResumeIdempotencyConstraint,
} from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();
const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
const schema = `review_resume_migration_${randomUUID().replaceAll("-", "_")}`;

before(async () => {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  await pool.query(`CREATE TABLE "${schema}".review_resume_dispatches (
    resume_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, workflow_id TEXT NOT NULL,
    revision_version INT NOT NULL, resume_attempt INT NOT NULL,
    failed_review_execution_id TEXT NOT NULL, frozen_writer_artifact_id TEXT NOT NULL,
    frozen_seo_artifact_id TEXT NOT NULL, frozen_brand_artifact_id TEXT NOT NULL,
    reason TEXT NOT NULL, authorization_status TEXT NOT NULL, job_id BIGINT, created_at TEXT NOT NULL
  )`);
  await pool.query(`INSERT INTO "${schema}".review_resume_dispatches VALUES
    ('historical-1','task-1','workflow-1',1,1,'review-1','writer-1','seo-1','brand-1','historical','OWNER_APPROVED',NULL,'2026-01-01T00:00:00Z')`);
});

after(async () => {
  await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
  await pool.end();
});

test("narrow migration is additive, idempotent, and preserves historical rows", async () => {
  const before = await precheckReviewResumeIdempotencyMigration(pool, schema);
  assert.equal(before.columnPresent, false);
  assert.equal(before.rowCount, 1);
  const applied = await applyReviewResumeIdempotencyMigration(pool, schema);
  assert.equal(applied.columnPresent, true);
  assert.equal(applied.uniqueIndexPresent, true);
  assert.equal(applied.indexDefinitionValid, true);
  assert.equal(applied.rowCount, 1);
  const reapplied = await applyReviewResumeIdempotencyMigration(pool, schema);
  assert.equal(reapplied.rowCount, 1);
  assert.equal((await pool.query(`SELECT idempotency_identity FROM "${schema}".review_resume_dispatches WHERE resume_id='historical-1'`)).rows[0].idempotency_identity, null);
});

test("duplicate non-null identity is rejected and probe leaves no rows", async () => {
  await applyReviewResumeIdempotencyMigration(pool, schema);
  assert.equal(await probeReviewResumeIdempotencyConstraint(pool, schema), "DUPLICATE_REJECTED_ROLLED_BACK");
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM "${schema}".review_resume_dispatches`)).rows[0].n, 1);
});
