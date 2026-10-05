/**
 * Provider-free leg-scoped routing entries: version-scoped leg rows resolve
 * independently while the role default is untouched. Isolated TEST database.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate, ProductionModelRoutingStore } from "../dist/index.js";

const TEST_URL = process.env.TEST_DATABASE_URL ?? (() => { if (!process.env.DATABASE_URL) return "postgresql://postgres@127.0.0.1:5432/ai_media_factory_test"; const value = new URL(process.env.DATABASE_URL); value.pathname = "/ai_media_factory_test"; return value.toString(); })();
if (new URL(TEST_URL).pathname !== "/ai_media_factory_test") throw new Error("leg routing tests must use the isolated test database");

const PROJECT = `leg-route-${Date.now().toString(36)}`;
const VERSION = `rv-leg-${Date.now().toString(36)}`;
let pool, store;

before(async () => {
  pool = createPool({ connectionString: TEST_URL });
  await migrate(pool);
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO model_benchmark_runs(benchmark_run_id,dataset_version,catalog_snapshot_id,candidate_plan_version,status,created_at,authorization_state,hard_spend_cap_usd,reserved_spend_usd,calculable_spend_usd,created_by,provenance) VALUES($1,'ds','cat','plan','CREATED',$2,'NOT_AUTHORIZED',1,0,0,'test','{}')`,
    [`bench-${PROJECT}`, now],
  );
  await pool.query(
    `INSERT INTO production_model_routing_versions(routing_version_id,profile,scope_type,project_id,benchmark_run_id,dataset_version,decision_source,owner_decision,active,activated_at,provenance) VALUES($1,'BALANCED','PROJECT',$2,$3,'ds','TEST','APPROVED',TRUE,$4,'{}')`,
    [VERSION, PROJECT, `bench-${PROJECT}`, now],
  );
  const entry = (role, model, snapshot) => pool.query(
    `INSERT INTO production_model_routing_entries(routing_version_id,role,primary_model_id,fallback_model_id,economy_model_id,premium_escalation_model_id,price_snapshot_ids,evidence) VALUES($1,$2,$3,NULL,NULL,NULL,$4,'{}')`,
    [VERSION, role, model, JSON.stringify({ [model]: snapshot })],
  );
  await entry("research", "openai/gpt-6-luna", "ps-luna");
  await entry("research-synthesis", "mistralai/mistral-nemo", "ps-nemo");
  store = new ProductionModelRoutingStore(pool);
});

after(async () => {
  if (pool) {
    await pool.query(`DELETE FROM production_model_routing_entries WHERE routing_version_id=$1`, [VERSION]);
    await pool.query(`DELETE FROM production_model_routing_versions WHERE routing_version_id=$1`, [VERSION]);
    await pool.query(`DELETE FROM model_benchmark_runs WHERE benchmark_run_id=$1`, [`bench-${PROJECT}`]);
    await pool.end();
  }
});

test("leg row resolves independently while the role default is untouched", async () => {
  const leg = await store.resolve("research-synthesis", { projectId: PROJECT });
  assert.equal(leg.resolvedModel, "mistralai/mistral-nemo");
  assert.equal(leg.priceSnapshotId, "ps-nemo");
  const role = await store.resolve("research", { projectId: PROJECT });
  assert.equal(role.resolvedModel, "openai/gpt-6-luna");
  assert.equal(role.priceSnapshotId, "ps-luna");
});

test("configuration map surfaces both role and leg keys", async () => {
  const map = await store.configurationMap(PROJECT);
  assert.equal(map.research.model, "openai/gpt-6-luna");
  assert.equal(map["research-synthesis"].model, "mistralai/mistral-nemo");
});

test("unknown leg role fails closed with no silent fallback", async () => {
  await assert.rejects(store.resolve("research-direction", { projectId: PROJECT }), /ROLE_NOT_MODEL_ROUTED/);
});
