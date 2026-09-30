import test from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate, ProductionModelRoutingStore } from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

test("branded routing test uses isolated current dist and fails closed without an active project route", async () => {
  assertTestDatabaseIsolation();
  const pool=createPool({connectionString:TEST_DATABASE_URL}); await migrate(pool);
  const s=new ProductionModelRoutingStore(pool);
  await assert.rejects(s.resolve("ceo",{projectId:`program-02-no-route-${process.pid}`}),/NO_ACTIVE_ROUTING/);
  await pool.end();
});
