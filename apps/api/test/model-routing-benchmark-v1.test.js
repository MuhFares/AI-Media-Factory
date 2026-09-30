import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildAgentTaskProfiles, buildBenchmarkRoleProfiles, buildRoleCandidatePools, buildBenchmarkExecutionPlan, normalizeModelIdentity, normalizedPriceClass, benchmarkDataset, executiveArchitecture, orchestratorArchitecture, routingProposals, costArchitecture, structuredUtilityClassification } from "../dist/model-routing-benchmark.js";
import { agentCatalog } from "../dist/agent-catalog.js";

test("complete registered roster is mapped and special executive classes remain governed",()=>{
  const roster=agentCatalog().filter(x=>x.registered),profiles=buildAgentTaskProfiles(roster);
  assert.equal(roster.length,24);assert.equal(profiles.length,roster.length);
  assert.deepEqual(new Set(profiles.map(x=>x.key)),new Set(roster.map(x=>x.key)));
  assert.equal(profiles.find(x=>x.key==="ceo").reasoning,"HIGH");
  assert.equal(executiveArchitecture.authority,"RECOMMENDATIONS_ONLY");
  assert.equal(executiveArchitecture.slots.PRIMARY.modelId,null);
  assert.equal(orchestratorArchitecture.creativityPrimary,false);
});

test("full-catalog funnel applies capability requirements without inventing quality",()=>{
  const caps={reasoning:"DECLARED",toolCalling:"DECLARED",structuredOutput:"DECLARED",vision:"NOT_DECLARED"};
  const models=[{provider_model_id:"a/free",canonical_name:"A",author:"a",availability:"AVAILABLE",price_class:"FREE",context_length:128000,capabilities:caps,pricing_normalized:{prompt:{usdPerMillion:0},completion:{usdPerMillion:0}},evaluation_state:"NOT_EVALUATED"},{provider_model_id:"b/paid",canonical_name:"B",author:"b",availability:"AVAILABLE",price_class:"PAID",context_length:200000,capabilities:caps,pricing_normalized:{prompt:{usdPerMillion:1},completion:{usdPerMillion:2}},evaluation_state:"NOT_EVALUATED"}];
  const profiles=buildAgentTaskProfiles(agentCatalog()),out=buildRoleCandidatePools(models,profiles);
  assert.equal(out.catalogModelsConsidered,2);assert.equal(out.qualityRankingCreated,false);
  assert.ok(out.pools.find(x=>x.role==="research").candidates.every(x=>x.qualityProven===false));
  assert.equal(out.pools.find(x=>x.role==="publisher").status,"NOT_AN_OPENROUTER_TEXT_ROLE");
});

test("Orchestrator is a benchmark role, not a 25th registered agent",()=>{
  const agents=buildAgentTaskProfiles(agentCatalog()),roles=buildBenchmarkRoleProfiles(agentCatalog()),o=roles.find(x=>x.key==="orchestrator");
  assert.equal(agents.length,24);assert.equal(roles.length,25);assert.equal(o.benchmarkRole,true);
  assert.deepEqual(o.requiredCapabilities,["structuredOutput","toolCalling","reasoning"]);
});

test("family identity separates route from family and batch does not duplicate quality candidates",()=>{
  assert.deepEqual(normalizeModelIdentity("openai/gpt-oss-20b:batch","openai"),{modelId:"openai/gpt-oss-20b:batch",modelFamilyId:"openai/gpt-oss-20b",routeVariant:"BATCH",provider:"openai",aliasStatus:"CANONICAL_ROUTE"});
  assert.equal(normalizeModelIdentity("openai/gpt-6-luna-pro","openai").modelFamilyId,"openai/gpt-6-luna");
  assert.equal(normalizeModelIdentity("openai/gpt-6-luna-pro","openai").routeVariant,"PRO_MODE");
  assert.equal(normalizeModelIdentity("openai/gpt-6-luna-pro:batch","openai").routeVariant,"BATCH_PRO");
  assert.equal(normalizeModelIdentity("~z-ai/glm-flash-latest","~z-ai").modelFamilyId,"z-ai/glm-flash");
  assert.equal(normalizeModelIdentity("~openai/gpt-luna-latest","openai").modelFamilyId,"openai/gpt-luna");
  assert.equal(normalizeModelIdentity("z-ai/glm-5.3-flash","z-ai").modelFamilyId,"z-ai/glm-flash");
  assert.equal(normalizedPriceClass({price_class:"UNKNOWN",pricing_normalized:{}}),"UNKNOWN");
});

test("floating aliases and batch routes are excluded while pinned GPT-6 Luna is role-selective",()=>{
  const caps={reasoning:"DECLARED",toolCalling:"DECLARED",structuredOutput:"DECLARED",vision:"DECLARED"};
  const mk=(id,author="openai")=>({provider_model_id:id,canonical_name:id,author,availability:"AVAILABLE",price_class:"PAID",context_length:1050000,capabilities:caps,pricing_normalized:{prompt:{usdPerMillion:.1},completion:{usdPerMillion:.5}},evaluation_state:"NOT_EVALUATED"});
  const x1=mk("x-ai/reference","x-ai"),z1=mk("z-ai/reference","z-ai");x1.context_length=2000000;z1.context_length=1800000;
  const models=[mk("openai/gpt-6-luna"),mk("openai/gpt-6-luna:batch"),mk("~openai/gpt-luna-latest"),x1,z1];
  const out=buildRoleCandidatePools(models,buildBenchmarkRoleProfiles(agentCatalog()));
  const ceo=out.pools.find(x=>x.role==="ceo").candidates,writer=out.pools.find(x=>x.role==="writer").candidates;
  assert.ok(ceo.some(x=>x.modelId==="openai/gpt-6-luna"));
  assert.ok(!writer.some(x=>x.modelId==="openai/gpt-6-luna"));
  assert.ok(out.pools.every(p=>p.candidates.every(x=>x.routeVariant==="INTERACTIVE")));
  assert.equal(out.floatingAliasPolicy,"EXCLUDED_UNLESS_PINNED_RESOLUTION_EVIDENCE_IS_STORED");
});

test("V1.1.1 dataset covers every model-backed role plus visual QA, CEO consistency, and Orchestrator",()=>{
  assert.equal(benchmarkDataset.version,"AMF-MRB-V1.1.1");
  for(const id of ["visual-qa-01","ceo-02","orchestrator-01","orchestrator-02"])assert.ok(benchmarkDataset.tasks.some(x=>x.id===id),id);
  for(const id of ["brand-01","finance-01","thumbnail-01"])assert.ok(benchmarkDataset.tasks.some(x=>x.id===id),id);
  assert.equal(benchmarkDataset.fixtures["visual-qa-01"].ocrRequired,false);
  assert.deepEqual(Object.keys(benchmarkDataset.fixtures["visual-qa-01"].requiredOutput),["VERDICT","ISSUES","SEVERITY","EVIDENCE","CONFIDENCE","RECOMMENDED_ACTION"]);
  assert.equal(structuredUtilityClassification,"BENCHMARK_DIMENSION_ONLY");
});

test("execution plan stages consistency selectively and remains fail-closed at zero authorization",()=>{
  const caps={reasoning:"DECLARED",toolCalling:"DECLARED",structuredOutput:"DECLARED",vision:"DECLARED"};
  const mk=(id,pc,price)=>({provider_model_id:id,canonical_name:id,author:id.split('/')[0],availability:"AVAILABLE",price_class:pc,context_length:200000,capabilities:caps,pricing_normalized:{prompt:{usdPerMillion:price},completion:{usdPerMillion:price}},evaluation_state:"NOT_EVALUATED"});
  const pools=buildRoleCandidatePools([mk("a/free","FREE",0),mk("b/cheap","PAID",.1),mk("c/ref","PAID",2)],buildBenchmarkRoleProfiles(agentCatalog()));
  const plan=buildBenchmarkExecutionPlan(pools);
  assert.ok(plan.stageCounts.A>0&&plan.stageCounts.B>0&&plan.stageCounts.C>0&&plan.stageCounts.D>0);assert.ok(plan.totalWorstCaseTokenCost>0);assert.equal(plan.hardCeilingUsd,10);assert.ok(plan.recommendedAuthorizationCapUsd<10);
  assert.equal(costArchitecture.benchmarkSpend.authorized,false);
});

test("benchmark is versioned, blind-review ready, zero-spend, and routing is proposal-only",()=>{
  assert.match(benchmarkDataset.version,/^AMF-MRB-V1/);assert.ok(benchmarkDataset.tasks.some(x=>x.role==="ceo"));assert.ok(benchmarkDataset.tasks.some(x=>x.role==="orchestrator"));
  assert.equal(benchmarkDataset.blindReview.identityDisplay,"Candidate A/B/C/...");
  assert.equal(costArchitecture.benchmarkSpend.authorized,false);assert.equal(costArchitecture.benchmarkSpend.spentUsd,0);assert.equal(costArchitecture.unknownIsZero,false);
  assert.ok(routingProposals(buildAgentTaskProfiles(agentCatalog())).every(x=>x.PRIMARY===null&&x.activation==="OWNER_APPROVAL_REQUIRED"));
});

test("Owner UI exposes active canonical routing and keeps benchmark execution disabled",()=>{
  const source=fs.readFileSync(new URL("../src/ai_media_factory/static/app.js",import.meta.url),"utf8");
  for(const text of ["Agents / Roles","Candidates","Blind Reviews","CEO / Brain","Cost","/api/model-intelligence/blind-reviews","ACTIVE ROUTING","Empirical Benchmark"])assert.ok(source.includes(text),text);
  assert.ok(source.includes("/api/model-intelligence/benchmark-runtime"));
  assert.equal(source.includes("/api/model-intelligence/benchmark-execute"),false);
});
