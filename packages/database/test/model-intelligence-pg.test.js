import test from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate, ModelIntelligenceStore } from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

test("catalog refresh detects price/capability/description changes and keeps prior snapshots immutable", async () => {
  assertTestDatabaseIsolation(); const pool=createPool({connectionString:TEST_DATABASE_URL,max:1}); const provider="openrouter-model-intelligence-test"; const id="example/model";
  try { await migrate(pool); const store=new ModelIntelligenceStore(pool);
    await store.ingestProviderCatalog({provider,sourceUrl:"https://example.invalid/models",retrievedAt:"2026-01-01T00:00:00.000Z",models:[{id,name:"Example",description:"first",architecture:{input_modalities:["text"],output_modalities:["text"]},supported_parameters:["tools"],pricing:{prompt:"0",completion:"0"}}]});
    await store.ingestProviderCatalog({provider,sourceUrl:"https://example.invalid/models",retrievedAt:"2026-01-02T00:00:00.000Z",models:[{id,name:"Example",description:"second",architecture:{input_modalities:["text","image"],output_modalities:["text"]},supported_parameters:["tools","structured_outputs"],pricing:{prompt:"0.000001",completion:"0.000002"}}]});
    const snapshots=await pool.query(`SELECT pricing_raw FROM provider_model_price_snapshots WHERE provider=$1 AND provider_model_id=$2 ORDER BY retrieved_at`,[provider,id]);
    assert.equal(snapshots.rowCount,2); assert.equal(snapshots.rows[0].pricing_raw.prompt,"0"); assert.equal(snapshots.rows[1].pricing_raw.prompt,"0.000001");
    const row=(await pool.query(`SELECT description,price_class,capabilities FROM provider_model_catalog WHERE provider=$1 AND provider_model_id=$2`,[provider,id])).rows[0];
    assert.equal(row.description,"second"); assert.equal(row.price_class,"PAID"); assert.equal(row.capabilities.vision,"DECLARED"); assert.equal(row.capabilities.structuredOutput,"DECLARED");
    const searched=await store.query(provider,{search:"example",capability:"vision",priceClass:"PAID",evaluation:"NOT_EVALUATED",page:1,pageSize:25,sort:"context",direction:"desc"});
    assert.equal(searched.total,1);assert.equal(searched.models[0].provider_model_id,id);assert.equal(searched.pageSize,25);
    const detail=await store.detail(provider,id);assert.equal(detail.provider_model_id,id);assert.equal(detail.evaluation_state,"NOT_EVALUATED");
    const history=await store.priceHistory(provider,id);assert.equal(history.length,2);assert.equal(Number(history[0].snapshot_count),2);
    const removed=await store.ingestProviderCatalog({provider,sourceUrl:"https://example.invalid/models",retrievedAt:"2026-01-03T00:00:00.000Z",models:[]}); assert.equal(removed.changes.REMOVED_OR_UNAVAILABLE_MODEL,1);
    assert.equal((await pool.query(`SELECT availability FROM provider_model_catalog WHERE provider=$1 AND provider_model_id=$2`,[provider,id])).rows[0].availability,"UNAVAILABLE_OR_REMOVED");
  } finally { await pool.query(`DELETE FROM provider_model_catalog_refreshes WHERE provider=$1`,[provider]).catch(()=>{}); await pool.query(`DELETE FROM provider_model_catalog WHERE provider=$1`,[provider]).catch(()=>{}); await pool.query(`DELETE FROM provider_model_price_snapshots WHERE provider=$1`,[provider]).catch(()=>{}); await pool.end(); }
});
