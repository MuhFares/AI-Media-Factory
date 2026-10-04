import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import pg from "pg";
import { applyArtifactStorageMigration } from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();
const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
const schema = `artifact_storage_${randomUUID().replaceAll("-", "_")}`;

before(async () => {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  await pool.query(`CREATE TABLE "${schema}".artifacts (artifact_id TEXT PRIMARY KEY)`);
  await pool.query(`INSERT INTO "${schema}".artifacts VALUES ('artifact-1')`);
  await pool.query(`INSERT INTO "${schema}".artifacts VALUES ('artifact-2')`);
});

after(async () => {
  await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
  await pool.end();
});

test("artifact storage migration is additive and idempotent", async () => {
  await applyArtifactStorageMigration(pool, schema);
  await applyArtifactStorageMigration(pool, schema);
  const columns = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='artifact_storage_records' ORDER BY ordinal_position", [schema]);
  assert.deepEqual(columns.rows.map((row) => row.column_name), [
    "storage_record_id", "artifact_id", "sha256", "byte_count", "mime_type", "storage_class",
    "storage_provider", "storage_key", "local_cache_path", "source_execution_id", "project_id",
    "content_id", "created_at", "retention_class", "durability_status", "verified_at", "is_current", "receipt",
  ]);
  const indexes = await pool.query("SELECT indexname FROM pg_indexes WHERE schemaname=$1 AND tablename='artifact_storage_records'", [schema]);
  assert.equal(indexes.rows.some((row) => row.indexname === "uq_artifact_storage_current"), true);
  assert.equal(indexes.rows.some((row) => row.indexname === "idx_artifact_storage_location"), true);
});

test("storage identity checks and current-location uniqueness fail closed", async () => {
  await applyArtifactStorageMigration(pool, schema);
  const insert = `INSERT INTO "${schema}".artifact_storage_records
    (storage_record_id,artifact_id,sha256,byte_count,mime_type,storage_class,storage_provider,storage_key,source_execution_id,project_id,created_at,retention_class,durability_status)
    VALUES ($1,'artifact-1',$2,$4,'video/mp4','CANONICAL_DURABLE','local-test',$3,'exec-1','morroway','2026-10-01T00:00:00.000Z','KEEP_WHILE_REFERENCED','VERIFIED')`;
  await pool.query(insert, ["record-1", "a".repeat(64), "morroway/aa/a", 10]);
  await assert.rejects(() => pool.query(insert, ["record-2", "b".repeat(64), "morroway/bb/b", 10]), /uq_artifact_storage_current|duplicate key/i);
  await assert.rejects(() => pool.query(insert, ["record-3", "c".repeat(64), "morroway/cc/c", 0]), /byte_count|check constraint/i);
  await pool.query(insert.replace("'artifact-1'", "'artifact-2'"), ["record-4", "a".repeat(64), "morroway/aa/a", 10]);
});
