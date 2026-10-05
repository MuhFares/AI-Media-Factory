import test from "node:test";
import assert from "node:assert/strict";
import { createProductionAgentExecutor } from "../dist/production-executor.js";

const expected = { ceo:"model-ceo", orchestrator:"model-orchestrator", research:"model-research", planner:"model-planner", writer:"model-writer", director:"model-director", "visual-director":"model-visual", seo:"model-seo", brand:"model-brand", review:"model-review", qa:"model-qa", growth:"model-growth", finance:"model-finance" };
const synthesisModel = "model-research-synthesis";
const stageId = { ceo:"ceo-recommendation", planner:"planner-synthesis", director:"scenes", "visual-director":"visual-direction", qa:"phase1-qa" };
const routing = { async resolve(role, options = {}) {
  if (options.projectId !== "branded-project" || (!expected[role] && role !== "research-synthesis")) throw new Error("NO_ACTIVE_ROUTING");
  if (options.slot === "fallback") {
    if (!options.fallbackAuthorized || !options.fallbackReason) throw new Error("FALLBACK_NOT_AUTHORIZED");
    return { model:`fallback-${role}`,resolvedModel:`fallback-${role}`,requestedModel:`fallback-${role}`,provider:"openrouter",routingVersionId:"route-v1",routingScope:"PROJECT",projectId:options.projectId,profile:"test",role,slot:"fallback",priceSnapshotId:`price-fallback-${role}`,fallbackUsed:true,fallbackReason:options.fallbackReason };
  }
  if (options.slot === "premiumEscalation" && !options.premiumAuthorized) throw new Error("PREMIUM_ESCALATION_NOT_AUTHORIZED");
  const model = options.slot === "premiumEscalation" ? `premium-${role}` : (role === "research-synthesis" ? synthesisModel : expected[role]);
  return { model,resolvedModel:model,requestedModel:model,provider:"openrouter",routingVersionId:"route-v1",routingScope:"PROJECT",projectId:options.projectId,profile:"test",role,slot:options.slot ?? "primary",priceSnapshotId:`price-${model}`,fallbackUsed:false,fallbackReason:null };
} };

test("real worker executor resolves any branded project's canonical routes before transport", async () => {
  const seen=[]; const ex=createProductionAgentExecutor({modelRouting:routing,routingDryRun:true,routingResolutionObserver:x=>seen.push(x)});
  for(const[agent,model]of Object.entries(expected)){const outcome=await ex.executeAgentStep({id:stageId[agent]??agent,agent},{workflowId:"dry",correlationId:"dry",data:{projectId:"branded-project"}});assert.equal(outcome.status,"completed",`${agent}:${outcome.error?.message??""}`);assert.equal(outcome.output.model,model);}
  assert.equal(seen.length,Object.keys(expected).length);
  assert.equal((await ex.executeAgentStep({id:"dry",agent:"research"},{workflowId:"dry",data:{projectId:"project-without-route"}})).status,"failed");
});

test("fallback and premium routes are explicit and fail closed", async () => {
  const ex=createProductionAgentExecutor({modelRouting:routing,routingDryRun:true});
  const run=(agent,data={})=>ex.executeAgentStep({id:"dry",agent},{workflowId:"dry",correlationId:"dry",data:{projectId:"branded-project",...data}});
  assert.equal((await run("research",{primaryModelUnavailable:true})).status,"failed","generic unavailable flag cannot silently authorize fallback");
  assert.equal((await run("visual-director",{routingSlot:"premiumEscalation"})).status,"failed");
  assert.equal((await run("visual-director",{routingSlot:"premiumEscalation",premiumEscalationAuthorized:true})).output.model,"premium-visual-director");
  assert.equal((await run("unknown-model-role")).status,"failed");
});
