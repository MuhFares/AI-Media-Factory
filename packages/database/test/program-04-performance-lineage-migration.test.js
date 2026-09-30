import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import pg from "pg";
import {
  PROGRAM_04_PERFORMANCE_LINEAGE_COLUMNS,
  applyProgram04PerformanceLineageMigration,
  precheckProgram04PerformanceLineageMigration,
} from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();
const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
const schema = `p04_lineage_${randomUUID().replaceAll("-", "_")}`;

before(async () => {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  await pool.query(`CREATE TABLE "${schema}".performance_observations (observation_id TEXT PRIMARY KEY, metrics JSONB NOT NULL)`);
  await pool.query(`INSERT INTO "${schema}".performance_observations(observation_id,metrics) VALUES ('sentinel','{}')`);
  await pool.query(`CREATE TABLE "${schema}".unrelated_sentinel (id INTEGER PRIMARY KEY, value TEXT)`);
  await pool.query(`INSERT INTO "${schema}".unrelated_sentinel VALUES (1,'unchanged')`);
});

after(async () => {
  await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
  await pool.end();
});

test("narrow Program-4 lineage migration is additive, exact, and idempotent", async () => {
  const beforeState = await precheckProgram04PerformanceLineageMigration(pool, schema);
  assert.equal(beforeState.tableExists, true);
  assert.deepEqual(beforeState.missingColumns.sort(), Object.keys(PROGRAM_04_PERFORMANCE_LINEAGE_COLUMNS).sort());

  const afterFirst = await applyProgram04PerformanceLineageMigration(pool, schema);
  assert.deepEqual(afterFirst.missingColumns, []);
  assert.deepEqual(Object.keys(afterFirst.existingColumns).sort(), Object.keys(PROGRAM_04_PERFORMANCE_LINEAGE_COLUMNS).sort());
  for (const column of Object.values(afterFirst.existingColumns)) {
    assert.equal(column.dataType, "text");
    assert.equal(column.nullable, true);
  }

  const afterSecond = await applyProgram04PerformanceLineageMigration(pool, schema);
  assert.deepEqual(afterSecond, afterFirst);
  const original = await pool.query(`SELECT observation_id,metrics FROM "${schema}".performance_observations`);
  assert.deepEqual(original.rows, [{ observation_id: "sentinel", metrics: {} }]);
  const unrelated = await pool.query(`SELECT * FROM "${schema}".unrelated_sentinel`);
  assert.deepEqual(unrelated.rows, [{ id: 1, value: "unchanged" }]);
});

test("incompatible existing target column fails closed", async () => {
  const conflictSchema = `${schema}_conflict`;
  await pool.query(`CREATE SCHEMA "${conflictSchema}"`);
  try {
    await pool.query(`CREATE TABLE "${conflictSchema}".performance_observations (observation_id TEXT PRIMARY KEY, content_id INTEGER NOT NULL)`);
    await assert.rejects(
      () => applyProgram04PerformanceLineageMigration(pool, conflictSchema),
      /PROGRAM_04_MIGRATION_COLUMN_CONFLICT:content_id/,
    );
  } finally {
    await pool.query(`DROP SCHEMA "${conflictSchema}" CASCADE`);
  }
});
