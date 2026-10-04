import test from "node:test";
import assert from "node:assert/strict";
import { createProductionAgentExecutor, openRouterResponseFormat, PRE_MEDIA_ORCHESTRATOR_REQUIRED, preMediaOrchestratorSystemPrompt, validatePreMediaOrchestratorPayload } from "../dist/production-executor.js";

class Store {
  artifacts = new Map();
  provenance = new Map();
  lifecycleHistory = [];
  lifecycleEvents = [];
  async saveArtifact(value) { this.artifacts.set(value.artifactId, structuredClone(value)); }
  async listArtifacts() { return [...this.artifacts.values()].map((value) => structuredClone(value)); }
  async saveExecutionProvenance(value) { this.provenance.set(value.executionId, structuredClone(value)); this.lifecycleHistory.push(structuredClone(value)); }
  async listExecutionProvenance() { return [...this.provenance.values()].map((value) => structuredClone(value)); }
  async claimReadyExecutionProvenance(executionId, details = {}) {
    const current = this.provenance.get(executionId);
    if (current?.configuration?.lifecycleState !== "READY_FOR_SUBMISSION") return false;
    current.configuration = { ...current.configuration, lifecycleState: "PROVIDER_SUBMISSION_INTENT", lifecycleDetails: { providerSubmissionStarted: true, maxTokens: details.maxTokens ?? null } };
    this.provenance.set(executionId, structuredClone(current));
    return true;
  }
  async appendExecutionLifecycleEvent(event) { this.lifecycleEvents.push(structuredClone(event)); }
  async listExecutionLifecycleEvents() { return this.lifecycleEvents.map((event) => structuredClone(event)); }
}

const originalFetch = global.fetch;
const originalProvider = process.env.TEXT_AGENT_PROVIDER;
const originalBaseUrl = process.env.OPENAI_BASE_URL;
const originalApiKey = process.env.OPENAI_API_KEY;

const validOrchestratorPayload = () => ({
  planId:"plan-1",stage:"INITIAL_CONTENT_PLAN",objective:"Select a factual story",topic:"Evidence-led selection",audience:"Morroway audience",platform:"YouTube Shorts",
  researchQuestions:["Which claim is best supported?"],researchObjectives:["Collect cited evidence"],desiredDeliverables:["research","brief"],tasks:[],status:"owner_decision_required",summary:"Research before recommending production.",
  productionAuthority:"OWNER_REQUIRED",mediaAuthority:"NOT_GRANTED",publicationAuthority:"NOT_GRANTED",
});

test("pre-media Orchestrator contract is explicit, deterministic, and authority-safe",()=>{
  assert.match(preMediaOrchestratorSystemPrompt(),/planId, stage, objective/);
  assert.deepEqual(validatePreMediaOrchestratorPayload(validOrchestratorPayload()),validOrchestratorPayload());
  assert.throws(()=>validatePreMediaOrchestratorPayload({status:"planned",summary:"short"}),e=>e.diagnostics.validationCode==="ORCHESTRATOR_REQUIRED_FIELD_MISSING"&&e.diagnostics.issuePaths.includes("$.planId"));
  assert.throws(()=>validatePreMediaOrchestratorPayload({...validOrchestratorPayload(),stage:4}),e=>e.diagnostics.validationCode==="ORCHESTRATOR_FIELD_TYPE_INVALID"&&e.diagnostics.issuePaths.includes("$.stage"));
  assert.throws(()=>validatePreMediaOrchestratorPayload({...validOrchestratorPayload(),stage:"MEDIA_PHASE"}),e=>e.diagnostics.validationCode==="ORCHESTRATOR_STAGE_INVALID"&&e.diagnostics.issuePaths[0]==="$.stage");
  assert.throws(()=>validatePreMediaOrchestratorPayload({...validOrchestratorPayload(),productionAuthority:"GRANTED"}),e=>e.diagnostics.validationCode==="ORCHESTRATOR_AUTHORITY_VIOLATION"&&e.diagnostics.hardFailReason==="OWNER_AUTHORITY_BOUNDARY");
  assert.throws(()=>validatePreMediaOrchestratorPayload({...validOrchestratorPayload(),tasks:[{action:"publish now"}]}),e=>e.diagnostics.validationCode==="ORCHESTRATOR_AUTHORITY_VIOLATION");
  for(const field of PRE_MEDIA_ORCHESTRATOR_REQUIRED){const payload=validOrchestratorPayload();delete payload[field];assert.throws(()=>validatePreMediaOrchestratorPayload(payload),e=>e.diagnostics.validationCode==="ORCHESTRATOR_REQUIRED_FIELD_MISSING"&&e.diagnostics.issuePaths.includes(`$.${field}`));}
});

test("OpenRouter forwards the declared Orchestrator schema instead of degrading it to JSON mode",()=>{
  const schema={type:"object",properties:{stage:{type:"string"}},required:["stage"],additionalProperties:true};
  assert.deepEqual(openRouterResponseFormat(undefined),{type:"json_object"});
  assert.deepEqual(openRouterResponseFormat(schema),{type:"json_schema",json_schema:{name:"amf_structured_response",strict:false,schema}});
});

test("HTTP-200 analysis-only Orchestrator output persists response, contract diagnostics, usage and cost without inventing an artifact",async()=>{
  const store=new Store(), reconciled=[];
  const routing={resolve:async()=>({provider:"openrouter",model:"openai/gpt-oss-20b",requestedModel:"openai/gpt-oss-20b",resolvedModel:"openai/gpt-oss-20b",routingVersionId:"route-v1",routingScope:"PROJECT",projectId:"morroway",role:"orchestrator",profile:"BALANCED",priceSnapshotId:"price-v1",fallbackUsed:false,fallbackReason:null}),preflight:async()=>({availabilityState:"AVAILABLE",liveHealthState:"HEALTHY",configurationFingerprint:"fixture",code:"PASS"})};
  const budget={reserve:async(input)=>({reservationId:"reservation-1",callKind:input.callKind}),reconcile:async(input)=>reconciled.push(input)};
  process.env.OPENROUTER_API_KEY="test";process.env.OPENROUTER_BASE_URL="https://mock.invalid/api/v1";
  global.fetch=async(_url,options)=>{const submitted=JSON.parse(options.body);assert.match(submitted.messages[0].content,/planId, stage, objective/);assert.equal(submitted.response_format.type,"json_schema");assert.deepEqual(submitted.response_format.json_schema.schema.required,PRE_MEDIA_ORCHESTRATOR_REQUIRED);const visible=JSON.stringify({analysis:"We need to produce JSON with required fields."});const event=`data: ${JSON.stringify({id:"gen-fixture",model:"openai/gpt-oss-20b",provider:"fixture",choices:[{delta:{content:visible},finish_reason:"stop"}],usage:{prompt_tokens:7,completion_tokens:3,total_tokens:10,completion_tokens_details:{reasoning_tokens:1},cost:0.00001}})}\n\ndata: [DONE]\n\n`;return new Response(event,{status:200});};
  try{
    const outcome=await createProductionAgentExecutor({persistence:store,modelRouting:routing,productionCallBudget:budget}).executeAgentStep({id:"orchestrator",agent:"orchestrator"},{workflowId:"wf-contract",correlationId:"corr-contract",data:{projectId:"morroway",productionPhase:"PRE_MEDIA_PHASE",mediaAuthority:"NOT_GRANTED"}});
    assert.equal(outcome.status,"failed");assert.equal(store.artifacts.size,0);
    const record=[...store.provenance.values()][0];
    assert.equal(record.errorClassification,"STRUCTURAL_VALIDATION_FAILED");
    assert.equal(record.configuration.providerFailure.validationCode,"ORCHESTRATOR_REQUIRED_FIELD_MISSING");
    assert.equal(record.configuration.providerResponse.sanitizedVisibleResponse,JSON.stringify({analysis:"We need to produce JSON with required fields."}));
    assert.deepEqual(record.configuration.providerResponse.parsedPayload,{analysis:"We need to produce JSON with required fields."});
    assert.deepEqual(record.usage,{inputTokens:7,outputTokens:3,totalTokens:10,reasoningTokens:1});
    assert.equal(record.cost,0.00001);assert.equal(reconciled.at(-1).calculableCostUsd,0.00001);
    const terminal=store.lifecycleEvents.at(-1);assert.equal(terminal.metadata.validationCode,"ORCHESTRATOR_REQUIRED_FIELD_MISSING");
    const restarted=structuredClone([...store.provenance.values()][0]);assert.deepEqual(Object.keys(restarted.configuration.providerResponse.parsedPayload),["analysis"]);
  }finally{global.fetch=originalFetch;delete process.env.OPENROUTER_API_KEY;delete process.env.OPENROUTER_BASE_URL;}
});

async function runOrchestratorStream({visible,reasoning,finishReason="stop"}){
  const store=new Store();let submitted;
  const routing={resolve:async()=>({provider:"openrouter",model:"openai/gpt-oss-20b",requestedModel:"openai/gpt-oss-20b",resolvedModel:"openai/gpt-oss-20b",routingVersionId:"route-v1",routingScope:"PROJECT",projectId:"morroway",role:"orchestrator",profile:"BALANCED",priceSnapshotId:"price-v1",fallbackUsed:false,fallbackReason:null}),preflight:async()=>({availabilityState:"AVAILABLE",liveHealthState:"HEALTHY",configurationFingerprint:"fixture",code:"PASS"})};
  const budget={reserve:async(input)=>({reservationId:`reservation-${input.callKind}`,callKind:input.callKind,idempotencyKey:input.idempotencyKey}),reconcile:async()=>{}};
  process.env.OPENROUTER_API_KEY="test";process.env.OPENROUTER_BASE_URL="https://mock.invalid/api/v1";
  global.fetch=async(_url,options)=>{submitted=JSON.parse(options.body);const delta={...(reasoning===undefined?{}:{reasoning_content:reasoning}),...(visible===undefined?{}:{content:visible})};const event=`data: ${JSON.stringify({id:"gen-structured",model:"openai/gpt-oss-20b",provider:"fixture",choices:[{delta,finish_reason:finishReason}],usage:{prompt_tokens:4,completion_tokens:6,total_tokens:10,cost:0}})}\n\ndata: [DONE]\n\n`;return new Response(event,{status:200});};
  try{const outcome=await createProductionAgentExecutor({persistence:store,modelRouting:routing,productionCallBudget:budget}).executeAgentStep({id:"orchestrator",agent:"orchestrator"},{workflowId:`wf-${Math.random()}`,correlationId:"corr-structured",data:{projectId:"morroway",productionPhase:"PRE_MEDIA_PHASE",mediaAuthority:"NOT_GRANTED"}});return{outcome,store,submitted};}
  finally{global.fetch=originalFetch;delete process.env.OPENROUTER_API_KEY;delete process.env.OPENROUTER_BASE_URL;}
}

test("reasoning plus a valid final Orchestrator payload selects only final content",async()=>{
  const {outcome,store,submitted}=await runOrchestratorStream({reasoning:"private chain material",visible:JSON.stringify(validOrchestratorPayload())});
  assert.equal(outcome.status,"completed",outcome.error?.message);assert.equal(outcome.artifact.kind,"execution_plan");
  assert.equal(submitted.response_format.type,"json_schema");assert.equal(submitted.response_format.json_schema.schema.properties.stage.enum[0],"INITIAL_CONTENT_PLAN");
  assert.equal(JSON.stringify(outcome.artifact).includes("private chain material"),false);
  const record=[...store.provenance.values()][0];assert.equal(record.configuration.providerResponse.reasoningFieldPresent,true);assert.equal(record.configuration.providerResponse.parsedPayload.planId,"plan-1");
});

test("malformed and truncated Orchestrator responses fail closed without artifacts",async()=>{
  const malformed=await runOrchestratorStream({visible:"{not-json"});assert.equal(malformed.outcome.status,"failed");assert.equal(malformed.store.artifacts.size,0);
  const truncated=await runOrchestratorStream({visible:JSON.stringify(validOrchestratorPayload()),finishReason:"length"});assert.equal(truncated.outcome.status,"failed");assert.equal(truncated.store.artifacts.size,0);assert.match(truncated.outcome.error.message,/incomplete response/);
});

function context() {
  return { workflowId: "wf-lifecycle", correlationId: "corr-lifecycle", data: {
    strategyMode: "PRE_PUBLICATION_STRATEGY", objective: "bounded test objective", contentTopic: "test", referenceEvidence: { reels: [] }, marketEvidence: { sources: [] },
  } };
}

function strategyContext(modelOverride) {
  return { workflowId: "wf-lifecycle", correlationId: "corr-lifecycle", data: {
    strategyMode: "PRE_PUBLICATION_STRATEGY", objective: "bounded strategy objective", contentTopic: "test", audience: "global", platform: "Instagram Reels, YouTube Shorts, TikTok",
    ownerStrategicInput: { targetMarket: "GLOBAL", platformsToEvaluate: ["Instagram Reels", "YouTube Shorts", "TikTok"], budget: { priority: "LOW" }, brandModel: "OPEN", channelPortfolio: "OPEN" },
    referenceEvidence: { references: [
      { provider: "BRIGHT_DATA", referenceUrl: "https://example.test/one", response: { provider: "BRIGHT_DATA", results: [{ evidenceId: "one", canonicalUrl: "https://example.test/one", authorOrCreator: "creator-one", platform: "INSTAGRAM", caption: "A deliberately long reference caption that must be projected instead of copied as raw workflow evidence.", engagement: { likeCount: 1, commentCount: 2 }, provenance: "fixture" }] } },
      { provider: "BRIGHT_DATA", referenceUrl: "https://example.test/two", response: { provider: "BRIGHT_DATA", results: [{ evidenceId: "two", canonicalUrl: "https://example.test/two", authorOrCreator: "creator-two", platform: "INSTAGRAM", caption: "A second reference caption.", engagement: { likeCount: 3, commentCount: 4 }, provenance: "fixture" }] } },
    ] },
    strategyInputArtifactIds: ["owner-artifact", "reference-artifact", "envelope-artifact"],
    ...(modelOverride ? { agentRouterModelOverride: modelOverride } : {}),
  } };
}

function strategyFindings() {
  const finding = { label: "bounded", rationale: "Evidence-supported compact finding.", certainty: "OBSERVED" };
  return {
    referencePatterns: [finding], audienceOpportunities: [finding], contentTerritories: [finding], differentiationOpportunities: [finding], productionImplications: [finding], risks: [finding], assumptions: [finding], unknowns: [finding],
    platformFindings: ["Instagram Reels", "YouTube Shorts", "TikTok"].map((platform) => ({ ...finding, platform })),
  };
}

async function seedInitial(store) {
  await store.saveArtifact({ artifactId: "initial", kind: "execution_plan", workflowId: "wf-lifecycle", correlationId: "corr-lifecycle", producerAgent: "planner", status: "completed", createdAt: new Date().toISOString(), payload: { stage: "INITIAL_CONTENT_PLAN", objective: "test" } });
}

async function seedWriterBrief(store) {
  await store.saveArtifact({ artifactId: "research", kind: "research_report", workflowId: "wf-writer-lifecycle", correlationId: "corr-writer-lifecycle", producerAgent: "research", status: "completed", createdAt: new Date().toISOString(), payload: { researchStatus: "USABLE", candidateStories: [], sources: [], evidenceQuality: { ceoEligible: true } } });
  await store.saveArtifact({ artifactId: "brief", kind: "evidence_backed_content_brief", workflowId: "wf-writer-lifecycle", correlationId: "corr-writer-lifecycle", producerAgent: "planner", status: "completed", createdAt: new Date().toISOString(), parentArtifact: { artifactId: "research", kind: "research_report" }, payload: { stage: "POST_RESEARCH_SYNTHESIS", status: "completed", objective: "MW-HIS-001", finalAngle: "A concise evidence-bound angle", hookDirection: "Open on the central supported fact", claims: [], evidenceRefs: [], writerInstructions: [], researchSources: [] } });
}

function writerContext() {
  return { workflowId: "wf-writer-lifecycle", correlationId: "corr-writer-lifecycle", data: { directive: "produce", contentTopic: "MW-HIS-001", previousArtifact: { artifactId: "brief", kind: "evidence_backed_content_brief" } } };
}

test("response then validation failure becomes a durable terminal lifecycle record", async () => {
  const store = new Store(); await seedInitial(store);
  process.env.TEXT_AGENT_PROVIDER = "agentrouter"; process.env.OPENAI_BASE_URL = "https://mock.invalid/v1"; process.env.OPENAI_API_KEY = "test";
  global.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "{}", reasoning_content: "internal" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 2 } }), { status: 200, headers: { "x-request-id": "mock-request" } });
  try {
    const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "research-lifecycle", agent: "research" }, context());
    assert.equal(outcome.status, "failed");
    const [record] = await store.listExecutionProvenance();
    assert.equal(record.provider, "agentrouter-openai");
    assert.equal(record.configuration.lifecycleState, "STRUCTURAL_VALIDATION_FAILED");
    assert.equal(record.configuration.providerResponse.providerRequestId, "mock-request");
  } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENAI_BASE_URL = originalBaseUrl; process.env.OPENAI_API_KEY = originalApiKey; }
});

test("ordinary production Writer persists bounded success provenance before its canonical artifact", async () => {
  const store = new Store(); await seedWriterBrief(store);
  process.env.TEXT_AGENT_PROVIDER = "agentrouter"; process.env.OPENAI_BASE_URL = "https://mock.invalid/v1"; process.env.OPENAI_API_KEY = "test";
  let submitted;
  const report = { contentId: "00000000-0000-4000-8000-000000000001", taskDescription: "Write content for writer-lifecycle", objective: "MW-HIS-001", title: "عنوان", content: "نص قصير", summary: "ملخص", sourceReferences: [], status: "completed", metadata: { createdAt: "2026-09-05T00:00:00.000Z", agentVersion: "1.0.0", researchArtifactId: "brief" } };
  global.fetch = async (_url, options) => { submitted = JSON.parse(options.body); return new Response(JSON.stringify({ model: "glm-5.3", choices: [{ message: { content: JSON.stringify(report) }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 5 } }), { status: 200, headers: { "x-request-id": "writer-success" } }); };
  try {
    const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "writer-lifecycle", agent: "writer" }, writerContext());
    assert.equal(outcome.status, "completed", outcome.error?.message);
    assert.equal(submitted.max_tokens, 1000);
    const [record] = await store.listExecutionProvenance();
    assert.equal(record.status, "success"); assert.equal(record.configuration.lifecycleState, "COMPLETED");
    assert.equal(record.configuration.providerSubmissionStarted, true);
    assert.equal(record.configuration.requestedModel, "glm-5.3"); assert.equal(record.configuration.providerResponse.httpStatus, 200);
    assert.equal(record.configuration.providerResponse.visibleContentBytes > 0, true);
    assert.equal(record.configuration.providerResponse.maxTokens, 1000);
    assert.equal(record.configuration.providerResponse.providerRequestId, "writer-success");
    assert.deepEqual(record.artifactIds, ["art-wf-writer-lifecycle-writer-lifecycle"]);
  } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENAI_BASE_URL = originalBaseUrl; process.env.OPENAI_API_KEY = originalApiKey; }
});

test("ordinary production Writer terminal transport failure retains safe requested-route diagnostics and no artifact", async () => {
  const store = new Store(); await seedWriterBrief(store);
  process.env.TEXT_AGENT_PROVIDER = "agentrouter"; process.env.OPENAI_BASE_URL = "https://mock.invalid/v1"; process.env.OPENAI_API_KEY = "test";
  global.fetch = async () => { throw new TypeError("network down"); };
  try {
    const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "writer-transport", agent: "writer" }, writerContext());
    assert.equal(outcome.status, "failed");
    const [record] = await store.listExecutionProvenance();
    assert.equal(record.status, "failed"); assert.equal(record.configuration.lifecycleState, "PROVIDER_TRANSPORT_FAILED");
    assert.equal(record.configuration.providerSubmissionStarted, true);
    assert.equal(record.provider, "agentrouter-openai"); assert.equal(record.model, "glm-5.3");
    assert.equal(record.configuration.providerFailure.maxTokens, 1000);
    assert.equal(record.configuration.providerFailure.transport, "network_or_transport");
    assert.deepEqual(record.artifactIds, []); assert.equal(store.artifacts.has("art-wf-writer-lifecycle-writer-transport"), false);
  } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENAI_BASE_URL = originalBaseUrl; process.env.OPENAI_API_KEY = originalApiKey; }
});

test("ordinary production Review terminal failure is durably attributable before any artifact", async () => {
  const store = new Store();
  await store.saveArtifact({ artifactId: "writer-review", kind: "writer_report", workflowId: "wf-review-lifecycle", correlationId: "corr-review-lifecycle", producerAgent: "writer", status: "completed", createdAt: new Date().toISOString(), payload: { title: "title", content: "content" } });
  process.env.TEXT_AGENT_PROVIDER = "agentrouter"; process.env.OPENAI_BASE_URL = "https://mock.invalid/v1"; process.env.OPENAI_API_KEY = "test";
  global.fetch = async () => { throw new TypeError("network down"); };
  try {
    const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep(
      { id: "review-lifecycle", agent: "review" },
      { workflowId: "wf-review-lifecycle", correlationId: "corr-review-lifecycle", data: {} },
    );
    assert.equal(outcome.status, "failed");
    const [record] = await store.listExecutionProvenance();
    assert.equal(record.agentId, "review"); assert.equal(record.status, "failed");
    assert.equal(store.lifecycleEvents.at(-1).state, "FAILED");
    assert.equal(store.lifecycleEvents.at(-1).metadata.errorClassification, "PROVIDER_TRANSPORT_FAILED");
    assert.equal(record.configuration.lifecycleState, "PROVIDER_TRANSPORT_FAILED");
    assert.deepEqual(record.artifactIds, []);
  } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENAI_BASE_URL = originalBaseUrl; process.env.OPENAI_API_KEY = originalApiKey; }
});

test("ordinary production Review preserves its explicit structured route, validates, persists, and reloads the canonical artifact", async () => {
  const store = new Store();
  const workflowId = "wf-review-success"; const correlationId = "corr-review-success";
  await store.saveArtifact({ artifactId: "writer-review-success", kind: "writer_report", workflowId, correlationId, producerAgent: "writer", status: "completed", createdAt: new Date().toISOString(), payload: { title: "title", content: "content" } });
  await store.saveArtifact({ artifactId: "seo-review-success", kind: "seo_report", workflowId, correlationId, producerAgent: "seo", status: "completed", createdAt: new Date().toISOString(), payload: { optimizedTitle: "title" } });
  await store.saveArtifact({ artifactId: "brand-review-success", kind: "brand_report", workflowId, correlationId, producerAgent: "brand", status: "completed", createdAt: new Date().toISOString(), payload: { status: "approved" } });
  process.env.TEXT_AGENT_PROVIDER = "openrouter"; process.env.OPENROUTER_API_KEY = "test"; process.env.OPENROUTER_BASE_URL = "https://mock.invalid/api/v1";
  let submitted;
  const report = { reportId: "00000000-0000-4000-8000-000000000002", taskDescription: "Review content for review-success", summary: "Approved.", status: "approved", findings: [], recommendations: [], metadata: { createdAt: "2026-09-12T00:00:00.000Z", agentVersion: "1.0.0" } };
  global.fetch = async (_url, options) => { submitted = JSON.parse(options.body); const event = `data: ${JSON.stringify({ id: "review-success", model: "nex-agi/nex-n2.5-pro:free", choices: [{ delta: { content: JSON.stringify(report) }, finish_reason: "stop" }], usage: { prompt_tokens: 8, completion_tokens: 12, completion_tokens_details: { reasoning_tokens: 0 }, cost: 0 } })}\n\ndata: [DONE]\n\n`; return new Response(event, { status: 200, headers: { "x-request-id": "review-success" } }); };
  try {
    const executor = createProductionAgentExecutor({ persistence: store });
    const outcome = await executor.executeAgentStep({ id: "review-success", agent: "review" }, { workflowId, correlationId, data: { controlAgentOverrides: { review: { provider: "openrouter", model: "nex-agi/nex-n2.5-pro:free", source: "AGENT" } } } });
    assert.equal(outcome.status, "completed", outcome.error?.message);
    assert.equal(submitted.model, "nex-agi/nex-n2.5-pro:free"); assert.equal(submitted.max_tokens, 1000);
    assert.deepEqual(submitted.reasoning, { effort: "none" });
    assert.equal(outcome.artifact.kind, "review_report"); assert.equal(outcome.artifact.status, "completed");
    const [record] = await store.listExecutionProvenance();
    assert.equal(record.status, "success"); assert.equal(record.configuration.requestedModel, "nex-agi/nex-n2.5-pro:free");
    assert.equal(record.configuration.providerResponse.finishReason, "stop");
  } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENROUTER_API_KEY = undefined; process.env.OPENROUTER_BASE_URL = undefined; }
});

test("strategy Research uses a compact evidence projection and accepts bounded semantic findings", async () => {
  const store = new Store();
  process.env.TEXT_AGENT_PROVIDER = "agentrouter"; process.env.OPENAI_BASE_URL = "https://mock.invalid/v1"; process.env.OPENAI_API_KEY = "test";
  let submitted;
  const description = "V2 PRE_PUBLICATION_STRATEGY research for research-compact: evaluate the supplied owner and reference evidence without external research.";
  const output = { reportId: "00000000-0000-4000-8000-000000000000", taskDescription: description, summary: "Observed reference patterns support a globally testable short-form research brief with explicit uncertainty.", sources: [{ id: 1, title: "Reference one", url: "https://example.test/one", snippet: "Reference evidence." }, { id: 2, title: "Reference two", url: "https://example.test/two", snippet: "Reference evidence." }], confidence: 0.7, citations: [{ sourceId: 1, text: "Observed." }, { sourceId: 2, text: "Observed." }], metadata: { createdAt: "2026-09-05T00:00:00.000Z", agentVersion: "1.0.0" }, strategyFindings: strategyFindings() };
  global.fetch = async (_url, options) => { submitted = JSON.parse(options.body); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output), reasoning_content: "internal" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 2 } }), { status: 200 }); };
  try {
    const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "research-compact", agent: "research" }, strategyContext());
    assert.equal(outcome.status, "completed", outcome.error?.message);
    assert.equal(outcome.artifact.status, "completed");
    const userPrompt = submitted.messages[1].content;
    assert.match(userPrompt, /strategyFindings/);
    assert.doesNotMatch(userPrompt, /Existing market evidence/);
    assert.equal(JSON.stringify(submitted).includes("reference-artifact"), false);
    const [record] = await store.listExecutionProvenance();
    assert.deepEqual(record.configuration.inputArtifactIds, ["envelope-artifact", "owner-artifact", "reference-artifact"]);
  } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENAI_BASE_URL = originalBaseUrl; process.env.OPENAI_API_KEY = originalApiKey; }
});

test("reasoning-only finish=length fails closed without an output artifact", async () => {
  const store = new Store();
  process.env.TEXT_AGENT_PROVIDER = "agentrouter"; process.env.OPENAI_BASE_URL = "https://mock.invalid/v1"; process.env.OPENAI_API_KEY = "test";
  global.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "", reasoning_content: "internal only" }, finish_reason: "length" }], usage: { prompt_tokens: 1, completion_tokens: 8192, completion_tokens_details: { reasoning_tokens: 8189 } } }), { status: 200 });
  try {
    const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "research-reasoning-only", agent: "research" }, strategyContext());
    assert.equal(outcome.status, "failed");
    assert.match(outcome.error.message, /incomplete response \(length\)/);
    const [record] = await store.listExecutionProvenance();
    assert.equal(record.configuration.providerFailure.finishReason, "length");
    assert.equal(record.configuration.providerFailure.visibleContentBytes, 0);
  } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENAI_BASE_URL = originalBaseUrl; process.env.OPENAI_API_KEY = originalApiKey; }
});

test("an explicit strategy model override is sent and persisted without changing the default route", async () => {
  const store = new Store();
  process.env.TEXT_AGENT_PROVIDER = "agentrouter"; process.env.OPENAI_BASE_URL = "https://mock.invalid/v1"; process.env.OPENAI_API_KEY = "test";
  let submitted;
  const description = "V2 PRE_PUBLICATION_STRATEGY research for research-explicit-model: evaluate the supplied owner and reference evidence without external research.";
  const output = { reportId: "00000000-0000-4000-8000-000000000000", taskDescription: description, summary: "Compact strategy output for explicit route validation.", sources: [{ id: 1, title: "Reference one", url: "https://example.test/one", snippet: "Reference evidence." }, { id: 2, title: "Reference two", url: "https://example.test/two", snippet: "Reference evidence." }], confidence: 0.7, citations: [{ sourceId: 1, text: "Observed." }, { sourceId: 2, text: "Observed." }], metadata: { createdAt: "2026-09-05T00:00:00.000Z", agentVersion: "1.0.0" }, strategyFindings: strategyFindings() };
  global.fetch = async (_url, options) => { submitted = JSON.parse(options.body); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) }, finish_reason: "stop" }], usage: {} }), { status: 200 }); };
  try {
    const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "research-explicit-model", agent: "research" }, strategyContext("deepseek-v4-flash"));
    assert.equal(outcome.status, "completed", outcome.error?.message); assert.equal(submitted.model, "deepseek-v4-flash");
    const [record] = await store.listExecutionProvenance();
    assert.equal(record.model, "deepseek-v4-flash"); assert.equal(record.configuration.requestedModel, "deepseek-v4-flash");
  } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENAI_BASE_URL = originalBaseUrl; process.env.OPENAI_API_KEY = originalApiKey; }
});

test("restart refuses an ambiguous provider-submission intent without re-submitting", async () => {
  const store = new Store(); await seedInitial(store);
  process.env.TEXT_AGENT_PROVIDER = "agentrouter"; process.env.OPENAI_BASE_URL = "https://mock.invalid/v1"; process.env.OPENAI_API_KEY = "test";
  let fetchCalls = 0; global.fetch = async () => { fetchCalls += 1; throw new Error("must not submit"); };
  await store.saveExecutionProvenance({ executionId: "ambiguous", workflowId: "wf-lifecycle", correlationId: "corr-lifecycle", agentId: "research", stage: "research-restart", capability: "agent.execute", provider: "agentrouter-openai", model: "glm-5.3", runtime: "governed-agentrouter-llm", promptVersion: null, configurationFingerprint: null, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), latencyMs: 0, status: "blocked", usage: null, costKind: "UNKNOWN", cost: null, currency: "USD", artifactIds: [], parentExecutionIds: [], attemptNumber: 1, providerRequestId: null, providerJobId: null, errorClassification: null, configuration: { lifecycleState: "PROVIDER_SUBMISSION_INTENT" } });
  try {
    const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "research-restart", agent: "research" }, context());
    assert.equal(outcome.status, "failed");
    assert.match(outcome.error.message, /EXECUTION_RECONCILIATION_REQUIRED/);
    assert.equal(fetchCalls, 0);
  } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENAI_BASE_URL = originalBaseUrl; process.env.OPENAI_API_KEY = originalApiKey; }
});

test("ready review resumes the same execution identity and submits once", async () => {
  const store = new Store(); const workflowId = "wf-ready-review"; const correlationId = "corr-ready-review";
  await store.saveArtifact({ artifactId: "writer-ready", kind: "writer_report", workflowId, correlationId, producerAgent: "writer", status: "completed", createdAt: new Date().toISOString(), payload: { title: "title", content: "content" } });
  const executionId = "ready-review-id";
  await store.saveExecutionProvenance({ executionId, workflowId, correlationId, agentId: "review", stage: "review-ready", capability: "agent.execute", provider: "openrouter", model: "nex-agi/nex-n2.5-pro:free", runtime: "governed-openrouter-llm", promptVersion: null, configurationFingerprint: null, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), latencyMs: 0, status: "blocked", usage: null, costKind: "UNKNOWN", cost: null, currency: "USD", artifactIds: [], parentExecutionIds: [], attemptNumber: 1, providerRequestId: null, providerJobId: null, errorClassification: null, configuration: { lifecycleState: "READY_FOR_SUBMISSION" } });
  process.env.TEXT_AGENT_PROVIDER = "openrouter"; process.env.OPENROUTER_API_KEY = "test"; process.env.OPENROUTER_BASE_URL = "https://mock.invalid/api/v1";
  let fetchCalls = 0;
  const report = { reportId: "00000000-0000-4000-8000-000000000003", taskDescription: "Review content for review-ready", summary: "Approved.", status: "approved", findings: [], recommendations: [], metadata: { createdAt: "2026-09-12T00:00:00.000Z", agentVersion: "1.0.0" } };
  global.fetch = async () => { fetchCalls += 1; return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(report) }, finish_reason: "stop" }], usage: {} })}\n\ndata: [DONE]\n\n`, { status: 200 }); };
  try {
    const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "review-ready", agent: "review" }, { workflowId, correlationId, data: { controlAgentOverrides: { review: { provider: "openrouter", model: "nex-agi/nex-n2.5-pro:free" } } } });
    assert.equal(outcome.status, "completed", outcome.error?.message); assert.equal(fetchCalls, 1);
    const [record] = await store.listExecutionProvenance(); assert.equal(record.executionId, executionId); assert.equal(record.configuration.lifecycleState, "COMPLETED");
  } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENROUTER_API_KEY = undefined; process.env.OPENROUTER_BASE_URL = undefined; }
});

test("only one concurrent worker can claim a ready review for transport", async () => {
  const store = new Store(); const workflowId = "wf-ready-concurrent"; const correlationId = "corr-ready-concurrent";
  await store.saveArtifact({ artifactId: "writer-concurrent", kind: "writer_report", workflowId, correlationId, producerAgent: "writer", status: "completed", createdAt: new Date().toISOString(), payload: { title: "title", content: "content" } });
  await store.saveExecutionProvenance({ executionId: "ready-concurrent-id", workflowId, correlationId, agentId: "review", stage: "review-concurrent", capability: "agent.execute", provider: "openrouter", model: "nex-agi/nex-n2.5-pro:free", runtime: "governed-openrouter-llm", promptVersion: null, configurationFingerprint: null, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), latencyMs: 0, status: "blocked", usage: null, costKind: "UNKNOWN", cost: null, currency: "USD", artifactIds: [], parentExecutionIds: [], attemptNumber: 1, providerRequestId: null, providerJobId: null, errorClassification: null, configuration: { lifecycleState: "READY_FOR_SUBMISSION" } });
  process.env.TEXT_AGENT_PROVIDER = "openrouter"; process.env.OPENROUTER_API_KEY = "test"; process.env.OPENROUTER_BASE_URL = "https://mock.invalid/api/v1";
  let fetchCalls = 0; global.fetch = async () => { fetchCalls += 1; return new Response("data: [DONE]\\n\\n", { status: 200 }); };
  try {
    const run = () => createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "review-concurrent", agent: "review" }, { workflowId, correlationId, data: { controlAgentOverrides: { review: { provider: "openrouter", model: "nex-agi/nex-n2.5-pro:free" } } } });
    const outcomes = await Promise.all([run(), run()]);
    assert.equal(fetchCalls, 1); assert.equal(outcomes.filter((outcome) => outcome.error?.message.includes("CLAIM_NOT_ACQUIRED")).length, 1);
  } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENROUTER_API_KEY = undefined; process.env.OPENROUTER_BASE_URL = undefined; }
});

for (const lifecycleState of ["STARTED", "PROVIDER_SUBMISSION_INTENT", "FETCH_INVOCATION_STARTED", "HTTP_RESPONSE_HEADERS_RECEIVED"]) test(`restart refuses ${lifecycleState} without re-submitting`, async () => {
  const store = new Store(); await seedInitial(store);
  process.env.TEXT_AGENT_PROVIDER = "agentrouter"; process.env.OPENAI_BASE_URL = "https://mock.invalid/v1"; process.env.OPENAI_API_KEY = "test";
  let fetchCalls = 0; global.fetch = async () => { fetchCalls += 1; throw new Error("must not submit"); };
  await store.saveExecutionProvenance({ executionId: `ambiguous-${lifecycleState}`, workflowId: "wf-lifecycle", correlationId: "corr-lifecycle", agentId: "research", stage: `research-restart-${lifecycleState}`, capability: "agent.execute", provider: "agentrouter-openai", model: "glm-5.3", runtime: "governed-agentrouter-llm", promptVersion: null, configurationFingerprint: null, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), latencyMs: 0, status: "blocked", usage: null, costKind: "UNKNOWN", cost: null, currency: "USD", artifactIds: [], parentExecutionIds: [], attemptNumber: 1, providerRequestId: null, providerJobId: null, errorClassification: null, configuration: { lifecycleState } });
  try {
    const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: `research-restart-${lifecycleState}`, agent: "research" }, context());
    assert.match(outcome.error.message, /EXECUTION_RECONCILIATION_REQUIRED/); assert.equal(fetchCalls, 0);
  } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENAI_BASE_URL = originalBaseUrl; process.env.OPENAI_API_KEY = originalApiKey; }
});

test("fetch invocation and response-header boundaries persist before response validation", async () => {
  const store = new Store(); await seedInitial(store);
  process.env.TEXT_AGENT_PROVIDER = "agentrouter"; process.env.OPENAI_BASE_URL = "https://mock.invalid/v1"; process.env.OPENAI_API_KEY = "test";
  global.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }), { status: 200, headers: { "x-request-id": "header-request" } });
  try {
    await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "research-fetch-boundaries", agent: "research" }, context());
    const [record] = await store.listExecutionProvenance();
    // The record may advance to validation failure, but its retained diagnostics
    // must prove headers were observed before parsing failed.
    assert.equal(record.configuration.providerResponse.providerRequestId, "header-request");
  } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENAI_BASE_URL = originalBaseUrl; process.env.OPENAI_API_KEY = originalApiKey; }
});

test("delayed provider body keeps the governed execution alive through body receipt, parsing, and validation", async () => {
  const store = new Store(); await seedInitial(store);
  process.env.TEXT_AGENT_PROVIDER = "agentrouter"; process.env.OPENAI_BASE_URL = "https://mock.invalid/v1"; process.env.OPENAI_API_KEY = "test";
  let release; const bodyReady = new Promise((resolve) => { release = resolve; });
  const encoder = new TextEncoder();
  global.fetch = async () => new Response(new ReadableStream({ start: async (controller) => {
    await bodyReady;
    controller.enqueue(encoder.encode(JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: {} })));
    controller.close();
  } }), { status: 200, headers: { "x-request-id": "delayed-body" } });
  try {
    const pending = createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "research-delayed-body", agent: "research" }, context());
    const deadline = Date.now() + 1000;
    while (!store.lifecycleHistory.some((record) => record.configuration?.lifecycleState === "HTTP_RESPONSE_HEADERS_RECEIVED") && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(store.lifecycleHistory.some((record) => record.configuration?.lifecycleState === "HTTP_RESPONSE_HEADERS_RECEIVED"));
    assert.equal(store.lifecycleHistory.some((record) => record.configuration?.lifecycleState === "HTTP_RESPONSE_BODY_RECEIVED"), false);
    release();
    const outcome = await pending;
    assert.equal(outcome.status, "failed");
    const states = store.lifecycleHistory.map((record) => record.configuration?.lifecycleState);
    assert.ok(states.includes("HTTP_RESPONSE_BODY_RECEIVED"));
    assert.ok(states.includes("RESPONSE_PARSED"));
    assert.ok(states.includes("VALIDATING"));
    assert.equal(states.at(-1), "STRUCTURAL_VALIDATION_FAILED");
  } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENAI_BASE_URL = originalBaseUrl; process.env.OPENAI_API_KEY = originalApiKey; }
});

test("provider transport failure reaches a durable terminal state", async () => {
  const store = new Store(); await seedInitial(store);
  process.env.TEXT_AGENT_PROVIDER = "agentrouter"; process.env.OPENAI_BASE_URL = "https://mock.invalid/v1"; process.env.OPENAI_API_KEY = "test";
  global.fetch = async () => { throw new TypeError("network down"); };
  try {
    const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "research-transport", agent: "research" }, context());
    assert.equal(outcome.status, "failed");
    const [record] = await store.listExecutionProvenance();
    assert.equal(record.configuration.lifecycleState, "PROVIDER_TRANSPORT_FAILED");
  } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENAI_BASE_URL = originalBaseUrl; process.env.OPENAI_API_KEY = originalApiKey; }
});

test("persistence failure before submission fails closed without provider invocation", async () => {
  const store = new Store(); await seedInitial(store);
  store.saveExecutionProvenance = async () => { throw new Error("persistence unavailable"); };
  process.env.TEXT_AGENT_PROVIDER = "agentrouter"; process.env.OPENAI_BASE_URL = "https://mock.invalid/v1"; process.env.OPENAI_API_KEY = "test";
  let fetchCalls = 0; global.fetch = async () => { fetchCalls += 1; throw new Error("must not submit"); };
  try {
    const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "research-persistence", agent: "research" }, context());
    assert.equal(outcome.status, "failed"); assert.equal(fetchCalls, 0);
  } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENAI_BASE_URL = originalBaseUrl; process.env.OPENAI_API_KEY = originalApiKey; }
});

test("canonical research directive planner stage creates the initial plan", async () => {
  const store = new Store();
  const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep(
    { id: "planner", agent: "planner" },
    { workflowId: "wf-canonical-research", correlationId: "corr-canonical-research", outputs: {}, data: { directive: "research" } },
  );
  assert.equal(outcome.status, "completed", outcome.error?.message);
  assert.equal(outcome.artifact.kind, "execution_plan");
  assert.equal(outcome.artifact.payload.stage, "INITIAL_CONTENT_PLAN");
});

const authorizedV3 = { executionId: "9abbeeab-6cc7-4345-96ad-8fba43dcea8a", parentId: "41559884-52e8-4d94-b027-25bc1857defd", originalId: "8467ccfb-e4c3-429e-8476-00438ad66c2d" };
async function seedRecoveryGuard(store, extraExecution, recoveryOfExecutionId = authorizedV3.parentId) {
  const workflowId = "wf-recovery-guard"; const correlationId = "corr-recovery-guard";
  for (const [artifactId, kind, producerAgent, payload] of [["writer-guard", "writer_report", "writer", { title: "title", content: "content" }], ["seo-guard", "seo_report", "seo", { optimizedTitle: "title" }], ["brand-guard", "brand_report", "brand", { status: "approved" }]]) await store.saveArtifact({ artifactId, kind, workflowId, correlationId, producerAgent, status: "completed", createdAt: new Date().toISOString(), payload });
  const record = (executionId, lifecycleState) => ({ executionId, workflowId, correlationId, agentId: "review", stage: "review", capability: "agent.execute", provider: "openrouter", model: "nex-agi/nex-n2.5-pro:free", runtime: "governed-openrouter-llm", promptVersion: null, configurationFingerprint: null, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), latencyMs: 0, status: "blocked", usage: null, costKind: "UNKNOWN", cost: null, currency: "USD", artifactIds: [], parentExecutionIds: [], attemptNumber: 1, providerRequestId: null, providerJobId: null, errorClassification: null, configuration: { lifecycleState } });
  await store.saveExecutionProvenance({ ...record(authorizedV3.executionId, "READY_FOR_SUBMISSION"), configuration: { lifecycleState: "READY_FOR_SUBMISSION", recoveryExecution: { recoveryOfExecutionId, originalExecutionId: authorizedV3.originalId, recoveryAuthorization: "OWNER_APPROVED" } } });
  await store.saveExecutionProvenance(record(authorizedV3.parentId, "VALIDATING"));
  if (extraExecution) await store.saveExecutionProvenance(record(extraExecution, "VALIDATING"));
  return { workflowId, correlationId, context: { workflowId, correlationId, data: { recoveryExecution: { recoveryOfExecutionId, originalExecutionId: authorizedV3.originalId, recoveryAuthorization: "OWNER_APPROVED" }, controlAgentOverrides: { review: { provider: "openrouter", model: "nex-agi/nex-n2.5-pro:free", reasoning: "none" } } } } };
}

test("only the exact authorized V3 parent is excluded from the ambiguity guard", async () => {
  const store = new Store(); const seeded = await seedRecoveryGuard(store); let fetchCalls = 0;
  const report = { reportId: "00000000-0000-4000-8000-000000000099", taskDescription: "Review content for review", summary: "Approved.", status: "approved", findings: [], recommendations: [], metadata: { createdAt: "2026-09-13T00:00:00.000Z", agentVersion: "1.0.0" } };
  process.env.TEXT_AGENT_PROVIDER = "openrouter"; process.env.OPENROUTER_API_KEY = "test"; process.env.OPENROUTER_BASE_URL = "https://mock.invalid/api/v1";
  global.fetch = async () => { fetchCalls += 1; return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(report) }, finish_reason: "stop" }], usage: {} })}\n\ndata: [DONE]\n\n`, { status: 200 }); };
  try { const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "review", agent: "review" }, seeded.context); assert.equal(outcome.status, "completed", outcome.error?.message); assert.equal(fetchCalls, 1); } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENROUTER_API_KEY = undefined; process.env.OPENROUTER_BASE_URL = undefined; }
});

test("a provider-backed non-approved Review completes with a durable business artifact", async () => {
  const store = new Store(); const seeded = await seedRecoveryGuard(store); let fetchCalls = 0;
  const report = { reportId: "00000000-0000-4000-8000-000000000098", taskDescription: "Review content for review", summary: "Changes required.", status: "changes_requested", findings: [], recommendations: [], metadata: { createdAt: "2026-09-13T00:00:00.000Z", agentVersion: "1.0.0" } };
  process.env.TEXT_AGENT_PROVIDER = "openrouter"; process.env.OPENROUTER_API_KEY = "test"; process.env.OPENROUTER_BASE_URL = "https://mock.invalid/api/v1";
  global.fetch = async () => { fetchCalls += 1; return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(report) }, finish_reason: "stop" }], usage: {} })}\n\ndata: [DONE]\n\n`, { status: 200 }); };
  try { const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "review", agent: "review" }, seeded.context); assert.equal(outcome.status, "completed"); assert.equal(outcome.reviewBusinessStatus, "changes_requested"); assert.equal(fetchCalls, 1); const events = await store.listExecutionLifecycleEvents(authorizedV3.executionId); assert.equal(events.at(-1).state, "COMPLETED"); assert.ok(events.some((event) => event.state === "VALIDATING")); assert.ok(events.some((event) => event.state === "ARTIFACT_PERSISTING")); const reviews = (await store.listArtifacts(seeded.workflowId)).filter((artifact) => artifact.kind === "review_report"); assert.equal(reviews.length, 1); assert.deepEqual(reviews[0].payload, report); } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENROUTER_API_KEY = undefined; process.env.OPENROUTER_BASE_URL = undefined; }
});

for (const [name, extra, parent] of [["unrelated ambiguous execution", "unrelated-validating", authorizedV3.parentId], ["wrong recovery parent", null, "wrong-parent"]]) test(`${name} still blocks the V3 provider boundary`, async () => {
  const store = new Store(); const seeded = await seedRecoveryGuard(store, extra, parent); let fetchCalls = 0;
  process.env.TEXT_AGENT_PROVIDER = "openrouter"; process.env.OPENROUTER_API_KEY = "test"; process.env.OPENROUTER_BASE_URL = "https://mock.invalid/api/v1"; global.fetch = async () => { fetchCalls += 1; throw new Error("must not submit"); };
  try { const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "review", agent: "review" }, seeded.context); assert.match(outcome.error.message, /EXECUTION_RECONCILIATION_REQUIRED/); assert.equal(fetchCalls, 0); } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENROUTER_API_KEY = undefined; process.env.OPENROUTER_BASE_URL = undefined; }
});

async function seedV4Guard(store, { unrelated = false, wrongParent = false } = {}) {
  const workflowId = "wf-1789233193749-gvydpiah", correlationId = "corr-v4-guard", childId = "fixture-v4-child";
  const parentId = "9abbeeab-6cc7-4345-96ad-8fba43dcea8a", ancestorId = "41559884-52e8-4d94-b027-25bc1857defd", originalId = "8467ccfb-e4c3-429e-8476-00438ad66c2d";
  for (const [artifactId, kind, producerAgent, payload] of [["writer-v4", "writer_report", "writer", { title: "title", content: "content" }], ["seo-v4", "seo_report", "seo", { optimizedTitle: "title" }], ["brand-v4", "brand_report", "brand", { status: "approved" }]]) await store.saveArtifact({ artifactId, kind, workflowId, correlationId, producerAgent, status: "completed", createdAt: new Date().toISOString(), payload });
  const record = (executionId, lifecycleState) => ({ executionId, workflowId, correlationId, agentId: "review", stage: "review", capability: "agent.execute", provider: "openrouter", model: "nex-agi/nex-n2.5-pro:free", runtime: "governed-openrouter-llm", promptVersion: null, configurationFingerprint: null, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), latencyMs: 0, status: "blocked", usage: null, costKind: "UNKNOWN", cost: null, currency: "USD", artifactIds: [], parentExecutionIds: [], attemptNumber: 1, providerRequestId: null, providerJobId: null, errorClassification: null, configuration: { lifecycleState } });
  await store.saveExecutionProvenance({ ...record(childId, "READY_FOR_SUBMISSION"), parentExecutionIds: [wrongParent ? "wrong-parent" : parentId, originalId], configuration: { lifecycleState: "READY_FOR_SUBMISSION" } });
  await store.saveExecutionProvenance(record(parentId, "VALIDATING"));
  await store.saveExecutionProvenance(record(ancestorId, "VALIDATING"));
  if (unrelated) await store.saveExecutionProvenance(record("unrelated-v4-validating", "VALIDATING"));
  return { childId, context: { workflowId, correlationId, data: { commandId: "command-1789233193749-33kswo20", recoveryExecution: { recoveryOfExecutionId: parentId, originalExecutionId: originalId, recoveryAuthorization: "OWNER_APPROVED", reuseCanonicalInputs: true, replayUpstreamStages: false }, controlAgentOverrides: { review: { provider: "openrouter", model: "nex-agi/nex-n2.5-pro:free", reasoning: "none" } } } } };
}

test("exact V4 lineage excludes only its two named ambiguous ancestors", async () => {
  const store = new Store(), seeded = await seedV4Guard(store); let fetchCalls = 0;
  const report = { reportId: "00000000-0000-4000-8000-000000000097", taskDescription: "Review content for review", summary: "Approved.", status: "approved", findings: [], recommendations: [], metadata: { createdAt: "2026-09-13T00:00:00.000Z", agentVersion: "1.0.0" } };
  process.env.TEXT_AGENT_PROVIDER = "openrouter"; process.env.OPENROUTER_API_KEY = "test"; process.env.OPENROUTER_BASE_URL = "https://mock.invalid/api/v1";
  global.fetch = async () => { fetchCalls += 1; return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(report) }, finish_reason: "stop" }], usage: {} })}\n\ndata: [DONE]\n\n`, { status: 200 }); };
  try { const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "review", agent: "review" }, seeded.context); assert.equal(outcome.status, "completed", outcome.error?.message); assert.equal(fetchCalls, 1); } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENROUTER_API_KEY = undefined; process.env.OPENROUTER_BASE_URL = undefined; }
});

for (const variant of ["unrelated", "wrongParent"]) test(`V4 ${variant} ambiguity remains fail-closed`, async () => {
  const store = new Store(), seeded = await seedV4Guard(store, { [variant]: true }); let fetchCalls = 0;
  process.env.TEXT_AGENT_PROVIDER = "openrouter"; process.env.OPENROUTER_API_KEY = "test"; process.env.OPENROUTER_BASE_URL = "https://mock.invalid/api/v1";
  global.fetch = async () => { fetchCalls += 1; throw new Error("must not submit"); };
  try { const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "review", agent: "review" }, seeded.context); assert.match(outcome.error.message, /EXECUTION_RECONCILIATION_REQUIRED/); assert.equal(fetchCalls, 0); } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENROUTER_API_KEY = undefined; process.env.OPENROUTER_BASE_URL = undefined; }
});

async function seedV5Guard(store, { unrelated = false, wrongParent = false, wrongCommand = false } = {}) {
  const workflowId = "wf-1789233193749-gvydpiah", correlationId = "corr-v5-guard", childId = "fixture-v5-child";
  const parentId = "99bc45f5-d097-4136-9319-4b518674565d", originalId = "8467ccfb-e4c3-429e-8476-00438ad66c2d";
  for (const [artifactId, kind, producerAgent, payload] of [["writer-v5", "writer_report", "writer", { title: "title", content: "content" }], ["seo-v5", "seo_report", "seo", { optimizedTitle: "title" }], ["brand-v5", "brand_report", "brand", { status: "approved" }]]) await store.saveArtifact({ artifactId, kind, workflowId, correlationId, producerAgent, status: "completed", createdAt: new Date().toISOString(), payload });
  const record = (executionId, lifecycleState) => ({ executionId, workflowId, correlationId, agentId: "review", stage: "review", capability: "agent.execute", provider: "openrouter", model: "nex-agi/nex-n2.5-pro:free", runtime: "governed-openrouter-llm", promptVersion: null, configurationFingerprint: null, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), latencyMs: 0, status: "blocked", usage: null, costKind: "UNKNOWN", cost: null, currency: "USD", artifactIds: [], parentExecutionIds: [], attemptNumber: 1, providerRequestId: null, providerJobId: null, errorClassification: null, configuration: { lifecycleState } });
  await store.saveExecutionProvenance({ ...record(childId, "READY_FOR_SUBMISSION"), parentExecutionIds: [wrongParent ? "wrong-parent" : parentId, originalId] });
  for (const ancestor of ["9abbeeab-6cc7-4345-96ad-8fba43dcea8a", "41559884-52e8-4d94-b027-25bc1857defd"]) await store.saveExecutionProvenance(record(ancestor, "VALIDATING"));
  if (unrelated) await store.saveExecutionProvenance(record("unrelated-v5-validating", "VALIDATING"));
  return { childId, context: { workflowId, correlationId, data: { commandId: wrongCommand ? "wrong-command" : "command-1789233193749-33kswo20", recoveryExecution: { recoveryOfExecutionId: parentId, originalExecutionId: originalId, recoveryAuthorization: "OWNER_APPROVED", reuseCanonicalInputs: true, replayUpstreamStages: false }, controlAgentOverrides: { review: { provider: "openrouter", model: "nex-agi/nex-n2.5-pro:free", reasoning: "none" } } } } };
}

test("exact V5 lineage excludes only its two named immutable ambiguous ancestors", async () => {
  const store = new Store(), seeded = await seedV5Guard(store); let fetchCalls = 0;
  const report = { reportId: "00000000-0000-4000-8000-000000000096", taskDescription: "Review content for review", summary: "Approved.", status: "approved", findings: [], recommendations: [], metadata: { createdAt: "2026-09-13T00:00:00.000Z", agentVersion: "1.0.0" } };
  process.env.TEXT_AGENT_PROVIDER = "openrouter"; process.env.OPENROUTER_API_KEY = "test"; process.env.OPENROUTER_BASE_URL = "https://mock.invalid/api/v1";
  global.fetch = async () => { fetchCalls += 1; return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(report) }, finish_reason: "stop" }], usage: {} })}\n\ndata: [DONE]\n\n`, { status: 200 }); };
  try { const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "review", agent: "review" }, seeded.context); assert.equal(outcome.status, "completed", outcome.error?.message); assert.equal(fetchCalls, 1); } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENROUTER_API_KEY = undefined; process.env.OPENROUTER_BASE_URL = undefined; }
});

for (const variant of ["unrelated", "wrongParent", "wrongCommand"]) test(`V5 ${variant} ambiguity remains fail-closed`, async () => {
  const store = new Store(), seeded = await seedV5Guard(store, { [variant]: true }); let fetchCalls = 0;
  process.env.TEXT_AGENT_PROVIDER = "openrouter"; process.env.OPENROUTER_API_KEY = "test"; process.env.OPENROUTER_BASE_URL = "https://mock.invalid/api/v1";
  global.fetch = async () => { fetchCalls += 1; throw new Error("must not submit"); };
  try { const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "review", agent: "review" }, seeded.context); assert.match(outcome.error.message, /EXECUTION_RECONCILIATION_REQUIRED/); assert.equal(fetchCalls, 0); } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENROUTER_API_KEY = undefined; process.env.OPENROUTER_BASE_URL = undefined; }
});

async function seedV6Guard(store, { unrelated = false, wrongParent = false, wrongCommand = false } = {}) {
  const workflowId = "wf-1789233193749-gvydpiah", correlationId = "corr-v6-guard", childId = "fixture-v6-child";
  const parentId = "6b37b8e9-4fe5-42bd-a0c1-29b2ac68bf71", originalId = "8467ccfb-e4c3-429e-8476-00438ad66c2d";
  for (const [artifactId, kind, producerAgent, payload] of [["writer-v6", "writer_report", "writer", { title: "title", content: "content" }], ["seo-v6", "seo_report", "seo", { optimizedTitle: "title" }], ["brand-v6", "brand_report", "brand", { status: "approved" }]]) await store.saveArtifact({ artifactId, kind, workflowId, correlationId, producerAgent, status: "completed", createdAt: new Date().toISOString(), payload });
  const record = (executionId, lifecycleState) => ({ executionId, workflowId, correlationId, agentId: "review", stage: "review", capability: "agent.execute", provider: "openrouter", model: "nex-agi/nex-n2.5-pro:free", runtime: "governed-openrouter-llm", promptVersion: null, configurationFingerprint: null, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), latencyMs: 0, status: "blocked", usage: null, costKind: "UNKNOWN", cost: null, currency: "USD", artifactIds: [], parentExecutionIds: [], attemptNumber: 1, providerRequestId: null, providerJobId: null, errorClassification: null, configuration: { lifecycleState } });
  await store.saveExecutionProvenance({ ...record(childId, "READY_FOR_SUBMISSION"), parentExecutionIds: [wrongParent ? "wrong-parent" : parentId, originalId] });
  for (const ancestor of ["9abbeeab-6cc7-4345-96ad-8fba43dcea8a", "41559884-52e8-4d94-b027-25bc1857defd"]) await store.saveExecutionProvenance(record(ancestor, "VALIDATING"));
  if (unrelated) await store.saveExecutionProvenance(record("unrelated-v6-validating", "VALIDATING"));
  return { childId, context: { workflowId, correlationId, data: { commandId: wrongCommand ? "wrong-command" : "command-1789233193749-33kswo20", recoveryExecution: { recoveryOfExecutionId: parentId, originalExecutionId: originalId, recoveryAuthorization: "OWNER_APPROVED", reuseCanonicalInputs: true, replayUpstreamStages: false }, controlAgentOverrides: { review: { provider: "openrouter", model: "nex-agi/nex-n2.5-pro:free", reasoning: "none" } } } } };
}

test("exact V6 lineage excludes only its two named immutable ambiguous ancestors", async () => {
  const store = new Store(), seeded = await seedV6Guard(store); let fetchCalls = 0;
  const report = { reportId: "00000000-0000-4000-8000-000000000097", taskDescription: "Review content for review", summary: "Approved.", status: "approved", findings: [], recommendations: [], metadata: { createdAt: "2026-09-13T00:00:00.000Z", agentVersion: "1.0.0" } };
  process.env.TEXT_AGENT_PROVIDER = "openrouter"; process.env.OPENROUTER_API_KEY = "test"; process.env.OPENROUTER_BASE_URL = "https://mock.invalid/api/v1";
  global.fetch = async () => { fetchCalls += 1; return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(report) }, finish_reason: "stop" }], usage: {} })}\n\ndata: [DONE]\n\n`, { status: 200 }); };
  try { const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "review", agent: "review" }, seeded.context); assert.equal(outcome.status, "completed", outcome.error?.message); assert.equal(fetchCalls, 1); } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENROUTER_API_KEY = undefined; process.env.OPENROUTER_BASE_URL = undefined; }
});

for (const variant of ["unrelated", "wrongParent", "wrongCommand"]) test(`V6 ${variant} ambiguity remains fail-closed`, async () => {
  const store = new Store(), seeded = await seedV6Guard(store, { [variant]: true }); let fetchCalls = 0;
  process.env.TEXT_AGENT_PROVIDER = "openrouter"; process.env.OPENROUTER_API_KEY = "test"; process.env.OPENROUTER_BASE_URL = "https://mock.invalid/api/v1";
  global.fetch = async () => { fetchCalls += 1; throw new Error("must not submit"); };
  try { const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "review", agent: "review" }, seeded.context); assert.match(outcome.error.message, /EXECUTION_RECONCILIATION_REQUIRED/); assert.equal(fetchCalls, 0); } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENROUTER_API_KEY = undefined; process.env.OPENROUTER_BASE_URL = undefined; }
});

async function seedV7Guard(store, { unrelated = false, wrongParent = false, wrongCommand = false } = {}) {
  const workflowId = "wf-1789233193749-gvydpiah", correlationId = "corr-v7-guard", childId = "fixture-v7-child";
  const parentId = "59d440c3-8120-42b3-895a-2df1e4e8801a", originalId = "8467ccfb-e4c3-429e-8476-00438ad66c2d";
  for (const [artifactId, kind, producerAgent, payload] of [["writer-v7", "writer_report", "writer", { title: "title", content: "content" }], ["seo-v7", "seo_report", "seo", { optimizedTitle: "title" }], ["brand-v7", "brand_report", "brand", { status: "approved" }]]) await store.saveArtifact({ artifactId, kind, workflowId, correlationId, producerAgent, status: "completed", createdAt: new Date().toISOString(), payload });
  const record = (executionId, lifecycleState) => ({ executionId, workflowId, correlationId, agentId: "review", stage: "review", capability: "agent.execute", provider: "openrouter", model: "dots-studio/dots-3-note-preview:free", runtime: "governed-openrouter-llm", promptVersion: null, configurationFingerprint: null, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), latencyMs: 0, status: "blocked", usage: null, costKind: "UNKNOWN", cost: null, currency: "USD", artifactIds: [], parentExecutionIds: [], attemptNumber: 1, providerRequestId: null, providerJobId: null, errorClassification: null, configuration: { lifecycleState } });
  await store.saveExecutionProvenance({ ...record(childId, "READY_FOR_SUBMISSION"), parentExecutionIds: [wrongParent ? "wrong-parent" : parentId, originalId] });
  for (const ancestor of ["9abbeeab-6cc7-4345-96ad-8fba43dcea8a", "41559884-52e8-4d94-b027-25bc1857defd"]) await store.saveExecutionProvenance(record(ancestor, "VALIDATING"));
  if (unrelated) await store.saveExecutionProvenance(record("unrelated-v7-validating", "VALIDATING"));
  return { childId, context: { workflowId, correlationId, data: { commandId: wrongCommand ? "wrong-command" : "command-1789233193749-33kswo20", recoveryExecution: { recoveryOfExecutionId: parentId, originalExecutionId: originalId, recoveryAuthorization: "OWNER_APPROVED", reuseCanonicalInputs: true, replayUpstreamStages: false }, controlAgentOverrides: { review: { provider: "openrouter", model: "dots-studio/dots-3-note-preview:free", reasoning: "none" } } } } };
}

test("exact V7 lineage excludes only its two named immutable ambiguous ancestors", async () => {
  const store = new Store(), seeded = await seedV7Guard(store); let fetchCalls = 0;
  const report = { reportId: "00000000-0000-4000-8000-000000000095", taskDescription: "Review content for review", summary: "Approved.", status: "approved", findings: [], recommendations: [], metadata: { createdAt: "2026-09-13T00:00:00.000Z", agentVersion: "1.0.0" } };
  process.env.TEXT_AGENT_PROVIDER = "openrouter"; process.env.OPENROUTER_API_KEY = "test"; process.env.OPENROUTER_BASE_URL = "https://mock.invalid/api/v1";
  global.fetch = async () => { fetchCalls += 1; return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(report) }, finish_reason: "stop" }], usage: {} })}\n\ndata: [DONE]\n\n`, { status: 200 }); };
  try { const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "review", agent: "review" }, seeded.context); assert.equal(outcome.status, "completed", outcome.error?.message); assert.equal(fetchCalls, 1); } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENROUTER_API_KEY = undefined; process.env.OPENROUTER_BASE_URL = undefined; }
});

for (const variant of ["unrelated", "wrongParent", "wrongCommand"]) test(`V7 ${variant} ambiguity remains fail-closed`, async () => {
  const store = new Store(), seeded = await seedV7Guard(store, { [variant]: true }); let fetchCalls = 0;
  process.env.TEXT_AGENT_PROVIDER = "openrouter"; process.env.OPENROUTER_API_KEY = "test"; process.env.OPENROUTER_BASE_URL = "https://mock.invalid/api/v1";
  global.fetch = async () => { fetchCalls += 1; throw new Error("must not submit"); };
  try { const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "review", agent: "review" }, seeded.context); assert.match(outcome.error.message, /EXECUTION_RECONCILIATION_REQUIRED/); assert.equal(fetchCalls, 0); } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENROUTER_API_KEY = undefined; process.env.OPENROUTER_BASE_URL = undefined; }
});

// Revision Cycle V1 guard fixtures: an owner-authorized revision cycle seeded
// from the live V7 Review may exclude the same two immutable VALIDATING
// ancestors for its fresh Review; every other shape remains fail-closed.
const REVISION_SOURCE_REVIEW_EXECUTION = "9b0ed3d3-f28b-460f-8cdc-a9f85904c439";
const REVISION_SOURCE_REVIEW_ARTIFACT = "art-wf-1789233193749-gvydpiah-review-20260913T194937663Z";

async function seedRevisionGuard(store, { unrelated = false, wrongCommand = false, wrongSourceArtifact = false, unauthorized = false, noMarker = false } = {}) {
  const workflowId = "wf-1789233193749-gvydpiah", correlationId = "corr-revision-guard";
  for (const [artifactId, kind, producerAgent, payload] of [["writer-rev", "writer_report", "writer", { title: "title", content: "content" }], ["seo-rev", "seo_report", "seo", { optimizedTitle: "title" }], ["brand-rev", "brand_report", "brand", { status: "approved" }]]) await store.saveArtifact({ artifactId, kind, workflowId, correlationId, producerAgent, status: "completed", createdAt: new Date().toISOString(), payload });
  const record = (executionId, lifecycleState) => ({ executionId, workflowId, correlationId, agentId: "review", stage: "review", capability: "agent.execute", provider: "openrouter", model: "dots-studio/dots-3-note-preview:free", runtime: "governed-openrouter-llm", promptVersion: null, configurationFingerprint: null, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), latencyMs: 0, status: "blocked", usage: null, costKind: "UNKNOWN", cost: null, currency: "USD", artifactIds: [], parentExecutionIds: [], attemptNumber: 1, providerRequestId: null, providerJobId: null, errorClassification: null, configuration: { lifecycleState } });
  for (const ancestor of ["9abbeeab-6cc7-4345-96ad-8fba43dcea8a", "41559884-52e8-4d94-b027-25bc1857defd"]) await store.saveExecutionProvenance(record(ancestor, "VALIDATING"));
  if (unrelated) await store.saveExecutionProvenance(record("unrelated-revision-validating", "VALIDATING"));
  const revisionExecution = noMarker ? undefined : {
    revisionTaskId: "revision-wf-1789233193749-gvydpiah-art-wf-1789233193749-gvydpiah-review-20260913T194937663Z",
    revisionVersion: 1,
    reviewArtifactId: wrongSourceArtifact ? "wrong-review-artifact" : REVISION_SOURCE_REVIEW_ARTIFACT,
    reviewExecutionId: REVISION_SOURCE_REVIEW_EXECUTION,
    priorWriterArtifactId: "art-wf-1789233193749-gvydpiah-writer",
    priorSeoArtifactId: "art-wf-1789233193749-gvydpiah-seo",
    priorBrandArtifactId: "art-wf-1789233193749-gvydpiah-brand",
    revisionAuthorization: unauthorized ? "PENDING" : "OWNER_APPROVED",
    replayUpstreamStages: false,
  };
  return { context: { workflowId, correlationId, data: { commandId: wrongCommand ? "wrong-command" : "command-1789233193749-33kswo20", ...(revisionExecution === undefined ? {} : { revisionExecution }), controlAgentOverrides: { review: { provider: "openrouter", model: "dots-studio/dots-3-note-preview:free", reasoning: "none" } } } } };
}

test("an owner-authorized revision cycle excludes only its two named immutable ambiguous ancestors", async () => {
  const store = new Store(), seeded = await seedRevisionGuard(store); let fetchCalls = 0;
  const report = { reportId: "00000000-0000-4000-8000-000000000094", taskDescription: "Review content for review", summary: "Approved.", status: "approved", findings: [], recommendations: [], metadata: { createdAt: "2026-09-13T00:00:00.000Z", agentVersion: "1.0.0" } };
  process.env.TEXT_AGENT_PROVIDER = "openrouter"; process.env.OPENROUTER_API_KEY = "test"; process.env.OPENROUTER_BASE_URL = "https://mock.invalid/api/v1";
  global.fetch = async () => { fetchCalls += 1; return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(report) }, finish_reason: "stop" }], usage: {} })}\n\ndata: [DONE]\n\n`, { status: 200 }); };
  try { const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "review", agent: "review" }, seeded.context); assert.equal(outcome.status, "completed", outcome.error?.message); assert.equal(fetchCalls, 1); } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENROUTER_API_KEY = undefined; process.env.OPENROUTER_BASE_URL = undefined; }
});

for (const variant of ["unrelated", "wrongCommand", "wrongSourceArtifact", "unauthorized", "noMarker"]) test(`revision cycle ${variant} ambiguity remains fail-closed`, async () => {
  const store = new Store(), seeded = await seedRevisionGuard(store, { [variant]: true }); let fetchCalls = 0;
  process.env.TEXT_AGENT_PROVIDER = "openrouter"; process.env.OPENROUTER_API_KEY = "test"; process.env.OPENROUTER_BASE_URL = "https://mock.invalid/api/v1";
  global.fetch = async () => { fetchCalls += 1; throw new Error("must not submit"); };
  try {
    const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "review", agent: "review" }, seeded.context);
    assert.match(outcome.error.message, /EXECUTION_RECONCILIATION_REQUIRED|REVISION_EXECUTION_OWNER_AUTHORIZATION_REQUIRED/);
    assert.equal(fetchCalls, 0);
  } finally { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENROUTER_API_KEY = undefined; process.env.OPENROUTER_BASE_URL = undefined; }
});
