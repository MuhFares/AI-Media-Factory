import test from "node:test";
import assert from "node:assert/strict";
import { buildDefaultEngine, createProductionAgentExecutor } from "../dist/index.js";
import { directiveToWorkflowDefinition } from "@ai-media-factory/orchestrator";

const expected = {
  orchestrator: "openai/gpt-oss-20b",
  research: "openai/gpt-6-luna",
  "research-synthesis": "mistralai/mistral-nemo",
  ceo: "openai/gpt-6-luna",
  planner: "openai/gpt-oss-20b",
  hooks: "z-ai/glm-5.3-flash",
  writer: "inclusionai/ling-3.0-flash",
  director: "inclusionai/ling-3.0-flash",
  "visual-director": "inclusionai/ling-3.0-flash",
  review: "openai/gpt-oss-20b",
  qa: "openai/gpt-oss-20b",
};

const routing = {
  async resolve(role, input) {
    if (input.projectId !== "morroway" || !expected[role]) throw new Error("CANONICAL_ROUTE_REQUIRED");
    return { model: expected[role], routingVersionId: "amf-balanced-production-routing-v1-morroway", profile: "BALANCED", priceSnapshotId: `price-${role}` };
  },
};

const clone = (value) => JSON.parse(JSON.stringify(value));
class MemoryPersistence {
  workflows = new Map(); checkpoints = new Map(); artifacts = new Map(); decisions = new Map();
  async saveWorkflow(value) { this.workflows.set(value.workflowId, clone(value)); }
  async loadWorkflow(id) { const value=this.workflows.get(id); return value ? clone(value) : null; }
  async saveCheckpoint(value) { this.checkpoints.set(value.workflowId, clone(value)); }
  async loadLatestCheckpoint(id) { const value=this.checkpoints.get(id); return value ? clone(value) : null; }
  async saveArtifact(value) { this.artifacts.set(value.artifactId, clone(value)); }
  async listArtifacts(id) { return [...this.artifacts.values()].filter((value)=>value.workflowId===id).map(clone); }
  async saveDecision(value) { this.decisions.set(value.decisionId, clone(value)); }
  async listDecisions(id) { return [...this.decisions.values()].filter((value)=>value.workflowId===id).map(clone); }
}

test("bounded real executor boundary resolves every Phase-1 role canonically before transport", async () => {
  const observed = [];
  const executor = createProductionAgentExecutor({ modelRouting: routing, routingDryRun: true, routingResolutionObserver: (value) => observed.push(value) });
  const definition = directiveToWorkflowDefinition("produce-pre-media");
  const agents = definition.steps.filter((step) => step.kind === "agent");
  for (const step of agents) {
    const outcome = await executor.executeAgentStep(step, { workflowId: "wf-phase1-proof", correlationId: "corr-phase1-proof", data: { projectId: "morroway", productionPhase: "PRE_MEDIA_PHASE", mediaAuthority: "NOT_GRANTED" } });
    assert.equal(outcome.status, "completed");
    assert.equal(outcome.output.model, expected[step.agent]);
  }
  assert.equal(observed.length, 9);
  assert.equal(definition.steps.some((step) => ["scene-image", "video", "tts", "composer", "publisher"].includes(step.agent)), false);
  assert.equal(definition.steps.at(-1).id, "owner-pre-media-gate");
});

test("Morroway project context fails closed and never falls through to legacy routing", async () => {
  const executor = createProductionAgentExecutor({ modelRouting: routing, routingDryRun: true });
  const unknown = await executor.executeAgentStep({ id: "unknown", agent: "unknown-role" }, { workflowId: "wf", correlationId: "corr", data: { projectId: "morroway", productionPhase: "PRE_MEDIA_PHASE" } });
  assert.equal(unknown.status, "failed");
  assert.match(unknown.error.message, /CANONICAL_ROUTE_REQUIRED/);
  const wrongProject = await executor.executeAgentStep({ id: "writer", agent: "writer" }, { workflowId: "wf", correlationId: "corr", data: { projectId: "other", productionPhase: "PRE_MEDIA_PHASE" } });
  assert.equal(wrongProject.status, "failed");
});

test("production reservation persists the nested canonical price snapshot and fails closed without it", async () => {
  const seen = [];
  const budget = {
    async reserve(input) { seen.push(input); return { reservationId: "reservation-1", callKind: input.callKind }; },
    async reconcile() {},
  };
  const executor = createProductionAgentExecutor({ modelRouting: routing, productionCallBudget: budget });
  const context = {
    workflowId: "wf-price-proof", correlationId: "corr-price-proof",
    data: {
      projectId: "morroway", productionPhase: "PRE_MEDIA_PHASE",
      controlAgentOverrides: { orchestrator: { model: "openai/gpt-oss-20b" } },
      canonicalRouting: { provider: "openrouter", model: "openai/gpt-oss-20b", canonicalRouting: {
        routingVersionId: "amf-balanced-production-routing-v1-morroway", priceSnapshotId: "price-orchestrator",
      } },
    },
  };
  await executor.reserveProductionCalls({ id: "orchestrator", agent: "orchestrator" }, context);
  assert.equal(seen[0].priceSnapshotId, "price-orchestrator");
  assert.equal(seen[0].routingVersionId, "amf-balanced-production-routing-v1-morroway");
  const recovery = clone(context); recovery.data.recoveryExecution = { recoveryExecutionId: "recovery-one" };
  await executor.reserveProductionCalls({ id: "orchestrator", agent: "orchestrator" }, recovery);
  assert.match(seen[1].idempotencyKey, /:recovery:recovery-one$/);
  const missing = clone(context); delete missing.data.canonicalRouting.canonicalRouting.priceSnapshotId;
  await assert.rejects(() => executor.reserveProductionCalls({ id: "orchestrator", agent: "orchestrator" }, missing), /PRODUCTION_PRICE_SNAPSHOT_REQUIRED/);
});

test("Research V2 selects isolated scoped Research text capacity when the envelope provides it", async () => {
  const seen=[];
  const budget={
    async budgets(){return[
      {callKind:"research",remaining:4},
      {callKind:"research_text_agent",remaining:2},
      {callKind:"text_agent",remaining:8},
    ];},
    async reserve(input){seen.push(input);return{reservationId:`reservation-${seen.length}`,callKind:input.callKind,idempotencyKey:input.idempotencyKey};},
    async reconcile(){},
  };
  const executor=createProductionAgentExecutor({productionCallBudget:budget});
  await executor.reserveProductionCalls({id:"research",agent:"research"},{
    workflowId:"wf-split-envelope",correlationId:"corr-split-envelope",
    data:{projectId:"morroway",productionPhase:"PRE_MEDIA_PHASE",budgetPhase:"MORROWAY_GOLDEN_CANARY_TEST",researchIntelligenceVersion:"V2",
      canonicalRouting:{canonicalRouting:{routingVersionId:"route",priceSnapshotId:"price-direction"}},
      controlAgentOverrides:{research:{model:"openai/gpt-6-luna"},"research-synthesis":{model:"mistralai/mistral-nemo",canonicalRouting:{routingVersionId:"route",priceSnapshotId:"price-synthesis"}}}},
  });
  assert.deepEqual(seen.map((entry)=>[entry.callKind,entry.callLeg]),[
    ["research","RETRIEVAL"],["research","RETRIEVAL"],["research","RETRIEVAL"],["research","RETRIEVAL"],
    ["research_text_agent","DIRECTION"],["research_text_agent","FINAL_SYNTHESIS"],
  ]);
});

test("provider-free real workflow path retains project context and reaches the Owner pre-media gate", async () => {
  const persistence = new MemoryPersistence();
  const observed=[];
  const executor=createProductionAgentExecutor({modelRouting:routing,routingDryRun:true,routingResolutionObserver:(value)=>observed.push(value)});
  const definition=directiveToWorkflowDefinition("produce-pre-media");
  const engine=buildDefaultEngine({persistence,executor,definitionLoader:async()=>definition});
  await engine.start({definition,workflowId:"wf-phase1-e2e",correlationId:"corr-phase1-e2e",brandId:"morroway",trigger:{projectId:"morroway",contentId:"content-proof",productionPhase:"PRE_MEDIA_PHASE",phaseAuthority:"OWNER_START_PRE_MEDIA",mediaAuthority:"NOT_GRANTED",publicationAuthority:"NOT_GRANTED"}});
  for(let i=0;i<100;i++){const state=(await persistence.loadWorkflow("wf-phase1-e2e"))?.state;if(state==="AWAITING_APPROVAL")break;await new Promise((resolve)=>setTimeout(resolve,5));}
  const instance=await persistence.loadWorkflow("wf-phase1-e2e");
  assert.equal(instance.state,"AWAITING_APPROVAL");
  assert.equal(instance.context.data.projectId,"morroway");
  assert.equal(instance.context.data.mediaAuthority,"NOT_GRANTED");
  assert.equal(instance.steps.find((step)=>step.status==="running").stepId,"owner-pre-media-gate");
  assert.equal(observed.length,9);
});
