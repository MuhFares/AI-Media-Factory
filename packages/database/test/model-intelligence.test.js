import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProviderModel, buildShortlistV2, shortlistReasons } from "../dist/index.js";

test("OpenRouter normalization preserves raw prices, uses tri-state capabilities, and never treats unknown as free", () => {
  const free = normalizeProviderModel({ id: "provider/free", name: "Free", architecture: { input_modalities: ["text"], output_modalities: ["text"] }, supported_parameters: ["tools"], pricing: { prompt: "0", completion: "0" } });
  assert.equal(free.priceClass, "FREE"); assert.equal(free.pricingNormalized.prompt.usdPerMillion, 0); assert.equal(free.capabilities.toolCalling, "DECLARED"); assert.equal(free.capabilities.vision, "NOT_DECLARED");
  const unknown = normalizeProviderModel({ id: "provider/unknown", pricing: { prompt: "unknown" } });
  assert.equal(unknown.priceClass, "UNKNOWN"); assert.equal(unknown.pricingNormalized.prompt.raw, "unknown");
  assert.equal(normalizeProviderModel({ id: "provider/router", pricing: { prompt: "-1", completion: "-1" } }).priceClass, "UNKNOWN");
  const paid = normalizeProviderModel({ id: "provider/paid", pricing: { prompt: "0.000003", completion: "0.000015" } });
  assert.equal(paid.priceClass, "PAID"); assert.equal(paid.pricingNormalized.completion.usdPerMillion, 15);
  const paidWithOverrides = normalizeProviderModel({ id: "provider/paid-overrides", pricing: { prompt: "0.0000001", completion: "0.0000005", overrides: [{ min_prompt_tokens: 272000 }] } });
  assert.equal(paidWithOverrides.priceClass, "PAID"); assert.deepEqual(paidWithOverrides.pricingRaw.overrides, [{ min_prompt_tokens: 272000 }]);
});

const row=(id,author,price,capabilities,context=128000,description="")=>({provider_model_id:id,canonical_name:id,author,description,context_length:context,capabilities,pricing_normalized:{prompt:{usdPerMillion:price},completion:{usdPerMillion:price*2}},price_class:price===0?"FREE":"PAID",availability:"AVAILABLE",evaluation_state:"NOT_EVALUATED"});
test("V2 shortlist separates main groups, diversifies references, and produces evidence reasons",()=>{
  const broad={reasoning:"DECLARED",toolCalling:"DECLARED",structuredOutput:"DECLARED",vision:"DECLARED",audio:"NOT_DECLARED",imageGeneration:"NOT_DECLARED"};
  const rows=[row("free/a","alpha",0,broad),row("free/b","beta",0,broad),row("free/c","gamma",0,broad),row("free/d","delta",0,broad),row("free/e","epsilon",0,broad),row("paid/a","p1",.05,broad),row("paid/b","p2",.1,broad),row("paid/c","p3",.15,broad),row("paid/d","p4",.2,broad),row("paid/e","p5",.25,broad),row("ref/a","frontier1",5,broad,500000),row("ref/b","frontier2",6,broad,400000),row("ref/c","frontier3",7,broad,300000),row("ref/d","frontier4",8,broad,200000)];
  const s=buildShortlistV2(rows),ids=[...s.freeCandidates,...s.costEfficientPaidCandidates,...s.higherCapabilityReferenceCandidates].map(x=>x.modelId);
  assert.equal(new Set(ids).size,ids.length);assert.equal(new Set(s.higherCapabilityReferenceCandidates.map(x=>x.provider)).size,s.higherCapabilityReferenceCandidates.length);
  assert.ok(s.freeCandidates[0].whyShortlisted.includes("FREE"));assert.ok(s.higherCapabilityReferenceCandidates[0].whyShortlisted.includes("REFERENCE_FAMILY"));assert.equal(s.benchmarkStatus,"NOT_EXECUTED");
  assert.deepEqual(shortlistReasons(rows[0],"FREE").includes("TOOL_CALLING"),true);
});
