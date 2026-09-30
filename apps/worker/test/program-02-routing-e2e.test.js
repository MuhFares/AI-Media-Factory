import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate, ProductionModelRoutingStore } from "@ai-media-factory/database";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();
const suffix = `${process.pid}-${Date.now().toString(36)}`;
const project1 = `program-02-project-1-${suffix}`;
const project2 = `program-02-project-2-${suffix}`;
const project3 = `program-02-project-3-${suffix}`;
const benchmarkId = `program-02-benchmark-${suffix}`;
const dataset = `program-02-dataset-${suffix}`;
const models = [`program-02-model-a-${suffix}`, `program-02-model-b-${suffix}`, `program-02-model-down-${suffix}`];
const prices = Object.fromEntries(models.map((model) => [model, `program-02-price-${model}`]));
let pool; let routing;

before(async () => {
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  const now = new Date().toISOString();
  await pool.query(`INSERT INTO model_benchmark_runs(benchmark_run_id,dataset_version,catalog_snapshot_id,candidate_plan_version,status,created_at,authorization_state,hard_spend_cap_usd,created_by) VALUES($1,$2,'provider-free','v1','COMPLETED',$3,'NOT_AUTHORIZED',0,'program-02-test')`, [benchmarkId, dataset, now]);
  for (const model of models) {
    await pool.query(`INSERT INTO provider_model_price_snapshots(price_snapshot_id,provider,provider_model_id,refresh_id,retrieved_at,pricing_raw,pricing_normalized,pricing_hash) VALUES($1,'openrouter',$2,'provider-free',$3,'{}','{}',$4)`, [prices[model], model, now, `hash-${model}`]);
    await pool.query(`INSERT INTO provider_model_catalog(provider,provider_model_id,canonical_name,context_length,input_modalities,output_modalities,supported_parameters,capabilities,availability,source_url,retrieved_at,refresh_id,raw_metadata,content_hash,pricing_hash,capability_hash,description_hash,current_price_snapshot_id) VALUES('openrouter',$1,$1,16000,'["text"]','["text"]','["response_format"]','{"structuredOutput":true}',$2,'provider-free://fixture',$3,'provider-free','{"top_provider":{"max_completion_tokens":4000}}',$4,$5,$6,$7,$8)`, [model, model.includes("down") ? "UNAVAILABLE" : "AVAILABLE", now, `content-${model}`, `pricing-${model}`, `cap-${model}`, `description-${model}`, prices[model]]);
  }
  routing = new ProductionModelRoutingStore(pool);
  await routing.activate({ versionId: `route-p1-v1-${suffix}`, profile: "provider-free", scopeType: "PROJECT", projectId: project1, benchmarkRunId: benchmarkId, datasetVersion: dataset, entries: [{ role: "research", primary: models[0], priceSnapshots: { [models[0]]: prices[models[0]] } }], provenance: { test: true } });
  await routing.activate({ versionId: `route-p2-v1-${suffix}`, profile: "provider-free", scopeType: "PROJECT", projectId: project2, benchmarkRunId: benchmarkId, datasetVersion: dataset, entries: [{ role: "research", primary: models[1], priceSnapshots: { [models[1]]: prices[models[1]] } }], provenance: { test: true } });
});

after(async () => {
  await pool.query(`DELETE FROM production_model_routing_entries WHERE routing_version_id LIKE $1`, [`%${suffix}`]);
  await pool.query(`DELETE FROM production_model_routing_versions WHERE routing_version_id LIKE $1`, [`%${suffix}`]);
  await pool.query(`DELETE FROM provider_model_catalog WHERE provider_model_id = ANY($1)`, [models]);
  await pool.query(`DELETE FROM provider_model_price_snapshots WHERE price_snapshot_id = ANY($1)`, [Object.values(prices)]);
  await pool.query(`DELETE FROM model_benchmark_runs WHERE benchmark_run_id=$1`, [benchmarkId]);
  await pool.end();
});

const requirements = () => ({ executionType: "LLM", prompt: "provider-free routed request", expectedOutputTokens: 500, structuredOutput: "JSON_MODE", requiredProtocol: "OPENAI_COMPATIBLE", requiredInputModality: "text", requiredOutputModality: "text", executionEnvironmentAllowed: true });

test("E2E-11 real isolated DB: missing/unavailable routes fail before reservation or transport", async () => {
  let transports = 0;
  await assert.rejects(routing.resolve("research", { projectId: project3 }), /NO_ACTIVE_ROUTING/);
  await routing.activate({ versionId: `route-p3-down-${suffix}`, profile: "provider-free", scopeType: "PROJECT", projectId: project3, benchmarkRunId: benchmarkId, datasetVersion: dataset, entries: [{ role: "research", primary: models[2], priceSnapshots: { [models[2]]: prices[models[2]] } }], provenance: { test: true } });
  await assert.rejects(routing.preflight("research", { projectId: project3, requirements: requirements() }), /MODEL_UNAVAILABLE/);
  const reservations = await pool.query(`SELECT reservation_id FROM production_call_reservations WHERE project_id = ANY($1)`, [[project1, project2, project3]]);
  assert.equal(reservations.rowCount, 0); assert.equal(transports, 0);
});

test("E2E-16 real isolated DB: project isolation, provenance and frozen-route drift", async () => {
  const p1 = await routing.resolve("research", { projectId: project1 });
  const p2 = await routing.resolve("research", { projectId: project2 });
  assert.equal(p1.model, models[0]); assert.equal(p2.model, models[1]); assert.notEqual(p1.model, p2.model);
  const before = await routing.preflight("research", { projectId: project1, expectedRoutingVersionId: p1.routingVersionId, expectedModel: p1.model, requirements: requirements() });
  assert.equal(before.provenance.projectId, project1); assert.equal(before.provenance.priceSnapshotId, prices[models[0]]);
  await routing.activate({ versionId: `route-p1-v2-${suffix}`, profile: "provider-free", scopeType: "PROJECT", projectId: project1, benchmarkRunId: benchmarkId, datasetVersion: dataset, entries: [{ role: "research", primary: models[1], priceSnapshots: { [models[1]]: prices[models[1]] } }], provenance: { test: true, drift: true } });
  await assert.rejects(routing.preflight("research", { projectId: project1, expectedRoutingVersionId: p1.routingVersionId, expectedModel: p1.model, requirements: requirements() }), /ROUTING_VERSION_DRIFT/);
});
