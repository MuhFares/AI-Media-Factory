import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProductionResearchSearchQuery,
  createProductionAgentExecutor,
  evaluateResearchEvidenceQuality,
  groundResearchReport,
  isOffTopicEducationalSearchResult,
  isResearchContentSelectionQuery,
} from "../dist/production-executor.js";

const CANONICAL_CEO = "openai/gpt-6-luna";
const ROUTING_VERSION = "amf-balanced-production-routing-v1-morroway";

class Store {
  artifacts = new Map();
  provenance = new Map();
  lifecycleEvents = [];
  async saveArtifact(value) { this.artifacts.set(value.artifactId, structuredClone(value)); }
  async listArtifacts() { return [...this.artifacts.values()].map((value) => structuredClone(value)); }
  async saveExecutionProvenance(value) { this.provenance.set(value.executionId, structuredClone(value)); }
  async listExecutionProvenance() { return [...this.provenance.values()].map((value) => structuredClone(value)); }
  async claimReadyExecutionProvenance(executionId, details = {}) {
    const current = this.provenance.get(executionId);
    if (current?.configuration?.lifecycleState !== "READY_FOR_SUBMISSION") return false;
    current.configuration = { ...current.configuration, lifecycleState: "PROVIDER_SUBMISSION_INTENT", lifecycleDetails: { providerSubmissionStarted: true, maxTokens: details.maxTokens ?? null } };
    this.provenance.set(executionId, structuredClone(current));
    return true;
  }
  async appendExecutionLifecycleEvent(event) { this.lifecycleEvents.push(structuredClone(event)); }
}

const canonicalRouting = {
  async resolve(role, input) {
    if (input.projectId !== "morroway") throw new Error("CANONICAL_ROUTE_REQUIRED");
    const models = {
      orchestrator: "openai/gpt-oss-20b",
      research: "openai/gpt-6-luna",
      ceo: "openai/gpt-6-luna",
      planner: "openai/gpt-oss-20b",
      hooks: "z-ai/glm-5.3-flash",
      writer: "inclusionai/ling-3.0-flash",
      director: "inclusionai/ling-3.0-flash",
      "visual-director": "inclusionai/ling-3.0-flash",
      review: "openai/gpt-oss-20b",
      qa: "openai/gpt-oss-20b",
    };
    if (!models[role]) throw new Error(`CANONICAL_ROUTE_REQUIRED:${role}`);
    return {
      model: models[role], requestedModel: models[role], resolvedModel: models[role],
      provider: "openrouter", routingVersionId: ROUTING_VERSION, routingScope: "PROJECT",
      projectId: input.projectId, role, slot: "primary", profile: "BALANCED",
      priceSnapshotId: `price-${role}`, fallbackUsed: false, fallbackReason: null,
    };
  },
  async preflight(role, input) {
    const route = await this.resolve(role, input);
    return {
      ok: true, code: "READY", route, availabilityState: "AVAILABLE",
      liveHealthState: "HEALTHY", configurationFingerprint: `fixture-${role}`,
    };
  },
};

const ceoPayload = () => ({
  decision: "ADVANCE",
  rationale: "Grounded only in supplied evidence; Owner authority remains required and no media action is granted.",
  eligibleCandidateIds: ["candidate-provider-free"],
  warnings: ["Evidence coverage is bounded in this fixture."],
});

const sse = (model, payload) => {
  const visible = JSON.stringify(payload);
  const event = `data: ${JSON.stringify({ id: "gen-fixture", model, provider: "fixture", choices: [{ delta: { content: visible }, finish_reason: "stop" }], usage: { prompt_tokens: 11, completion_tokens: 13, total_tokens: 24, completion_tokens_details: { reasoning_tokens: 2 }, cost: 0.00002 } })}\n\ndata: [DONE]\n\n`;
  return new Response(event, { status: 200 });
};

test("CEO real path transports the exact canonical model despite legacy overrides", async () => {
  const store = new Store();
  store.artifacts.set("art-research", {
    artifactId: "art-research",
    workflowId: "wf-ceo-proof",
    kind: "research_report",
    producerAgent: "research",
    correlationId: "corr-ceo-proof",
    status: "completed",
    payload: {
      summary: "Institutional evidence supports one bounded factual candidate.",
      evidenceStatus: "USABLE",
      candidateStories: [{
        candidateId: "candidate-provider-free",
        factualVerification: "STRONG",
        recommendedForProduction: true,
        supportingEvidenceIds: ["evidence-provider-free"],
        evidenceLineageValidated: true,
      }],
      sources: [{ sourceId: "source-provider-free" }],
    },
    contentType: "application/json",
    schemaVersion: "2",
    createdAt: "2026-09-14T00:00:00.000Z",
  });
  const reservations = [];
  const budget = {
    async reserve(input) { reservations.push(input); return { reservationId: "res-ceo-1", callKind: input.callKind }; },
    async reconcile() {},
  };
  const transports = [];
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalBase = process.env.OPENROUTER_BASE_URL;
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_BASE_URL = "https://mock.invalid/api/v1";
  global.fetch = async (_url, options) => {
    const submitted = JSON.parse(options.body);
    transports.push(submitted.model);
    return sse(CANONICAL_CEO, ceoPayload());
  };
  try {
    const executor = createProductionAgentExecutor({ persistence: store, modelRouting: canonicalRouting, productionCallBudget: budget });
    const outcome = await executor.executeAgentStep({ id: "ceo-recommendation", agent: "ceo" }, {
      workflowId: "wf-ceo-proof",
      correlationId: "corr-ceo-proof",
      data: {
        projectId: "morroway",
        productionPhase: "PRE_MEDIA_PHASE",
        mediaAuthority: "NOT_GRANTED",
        publicationAuthority: "NOT_GRANTED",
        objective: "Use Morroway strategy and governed evidence to recommend one factual Short.",
        // Legacy stale configuration that must NOT win over canonical routing.
        agentRouterModelOverride: "glm-5.3",
        controlAgentOverrides: {
          "*": { model: "dots-studio/dots-3-note-preview:free", provider: "openrouter" },
          ceo: { model: "nex-agi/nex-n2.5-pro:free", provider: "openrouter" },
        },
      },
    });
    assert.equal(outcome.status, "completed", JSON.stringify(outcome));
    assert.equal(reservations.length, 1);
    assert.equal(reservations[0].exactModelId, CANONICAL_CEO);
    assert.equal(reservations[0].priceSnapshotId, "price-ceo");
    assert.equal(reservations[0].routingVersionId, ROUTING_VERSION);
    assert.equal(transports.length, 1);
    assert.equal(transports[0], CANONICAL_CEO);
    assert.ok(!transports.includes("glm-5.3"));
    const record = [...store.provenance.values()][0];
    assert.equal(record.model, CANONICAL_CEO);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalKey;
    if (originalBase === undefined) delete process.env.OPENROUTER_BASE_URL; else process.env.OPENROUTER_BASE_URL = originalBase;
  }
});

test("research content-selection query is detected and rewritten with strategy intent", () => {
  const topic = "Select the strongest evidence-grounded factual micro-story for Morroway Pilot 1";
  const objective = "Use Morroway strategy, brand context, governed retrieval, and executive reasoning to choose and develop one genuinely publishable first factual YouTube Short.";
  assert.equal(isResearchContentSelectionQuery(topic, objective), true);
  const query = buildProductionResearchSearchQuery({ contentTopic: topic, objective, brandProject: "morroway", audience: "curious adults", platform: "youtube" });
  assert.ok(query.length <= 160);
  assert.match(query, /Morroway/i);
  assert.match(query, /candidate/i);
  assert.doesNotMatch(query.toLowerCase(), /textual evidence/);
  assert.doesNotMatch(query.toLowerCase(), /strongest evidence/);
  const normal = buildProductionResearchSearchQuery({ contentTopic: "Nubian vault architecture", objective: "Research Nubian vault architecture", brandProject: "morroway" });
  assert.match(normal, /Nubian vault architecture/);
});

const badResults = [
  { title: "Finding Evidence in Text Quiz - English Study Guide ...", url: "https://quizlet.com/826984233/la-finding-evidence-in-the-text-quiz-flash-cards/", snippet: "What textual evidence is typically found in informational text? facts that support the main idea.", source: "quizlet.com" },
  { title: "Command of Textual Evidence Quizzes (SAT Information ...", url: "https://www.quiz-tree.com/sat-information-and-ideas/topic/command-of-textual-evidence", snippet: "You will practice choosing the piece of evidence from a passage.", source: "quiz-tree.com" },
  { title: "Answer Explanations to the ACT 2025 Reading Practice Test", url: "https://www.piqosity.com/answer-explanations-to-the-2025-act-practice-reading-test/", snippet: "Below are answer explanations to the full-length Reading test.", source: "piqosity.com" },
  { title: "What textual evidence is typically found in informational ...", url: "https://brainly.com/question/20173790", snippet: "A. Dialogue from characters in the passage.", source: "brainly.com" },
  { title: "English 9B Unit 10 Activity - Research and Fiction Writing-4 ...", url: "https://www.coursehero.com/file/47794408/English-9B-Unit-10-Activity-Research-and-Fiction-Writing-4doc/", snippet: "Unit Activity Unit: Argumentative and Research Writing.", source: "coursehero.com" },
];

const goodResults = [
  { title: "Qanat: ancient Persian water tunnels still in use", url: "https://example.test/qanat-persia", snippet: "Archaeologists document qanat tunnels in Iran supplying villages for two millennia.", source: "example.test" },
  { title: "Nubian vault: mud-brick roofing without timber", url: "https://example.test/nubian-vault", snippet: "Field survey records Nubian vault construction across Upper Egypt and Sudan.", source: "example.test" },
  { title: "Stepwells of Gujarat: monsoon water architecture", url: "https://example.test/stepwells", snippet: "Conservation report lists dated stepwell inscriptions and measured depths.", source: "example.test" },
];

const groundedSynthesis = {
  reportId: "11111111-1111-4111-8111-111111111111",
  taskDescription: "Production research for candidate stories",
  summary: "Three dated candidates with field-survey provenance.",
  sources: [{ id: 1, title: goodResults[0].title, url: goodResults[0].url, snippet: goodResults[0].snippet }],
  confidence: 0.8,
  citations: [{ sourceId: 1, text: goodResults[0].snippet.slice(0, 40) }],
  metadata: { createdAt: "2026-09-25T00:00:00.000Z", agentVersion: "research" },
};

const viableSources = [
  { id: 1, title: "Qanat: Persian water management", url: "https://www.si.edu/spotlight/qanat-water", snippet: "Smithsonian survey of qanat tunnel systems." },
  { id: 2, title: "Qanat | irrigation | Britannica", url: "https://www.britannica.com/technology/qanat", snippet: "Ancient irrigation tunnel system of Iran." },
];

const viableSynthesis = {
  reportId: "33333333-3333-4333-8333-333333333333",
  taskDescription: "Production research for candidate stories",
  summary: "One viable candidate with institutional and reputable sources.",
  candidateStories: [{
    candidateId: "candidate-1",
    topic: "Qanat water tunnels of Persia",
    factualAngle: "Two-millennia-old underground water engineering",
    keyClaims: ["Qanat tunnels convey groundwater"],
    sourceIds: [1, 2],
    supportingEvidenceIds: [1, 2],
    sourceQualitySummary: "Institutional plus reputable reference",
    visualPotential: "Tunnel cross-sections",
    shortFormPotential: "30-second reveal",
    evidenceRisks: [],
    verificationStatus: "needs-verification",
  }],
  sources: viableSources,
  confidence: 0.8,
  citations: [{ sourceId: 1, text: "Smithsonian survey" }, { sourceId: 2, text: "Britannica" }],
  status: "grounded",
  metadata: { createdAt: "2026-09-25T00:00:00.000Z", agentVersion: "research" },
};

const withSearch = (synthesis, results) => ({
  ...synthesis,
  capabilityExecutions: [{
    status: "success",
    capabilityId: "web.search",
    output: { results },
    evidence: { providerId: "serper", evidenceId: "evidence-1", succeeded: true, executedAt: "2026-09-25T00:00:00.000Z" },
  }],
});

test("A: relevant factual sources plus grounded synthesis pass the evidence gate", () => {
  const evaluation = evaluateResearchEvidenceQuality({ retrievalResults: goodResults, synthesisSources: groundedSynthesis.sources, synthesisConfidence: groundedSynthesis.confidence, synthesisCitations: groundedSynthesis.citations });
  assert.equal(evaluation.status, "USABLE");
  const grounded = groundResearchReport(withSearch(groundedSynthesis, goodResults));
  assert.equal(grounded.confidence, 0.8);
});

test("A2: viable candidates with authority make the result CEO-eligible", () => {
  const grounded = groundResearchReport(withSearch(viableSynthesis, viableSources));
  assert.equal(grounded.researchStatus, "USABLE");
  assert.equal(grounded.evidenceQuality.ceoEligible, true);
  assert.equal(grounded.evidenceQuality.evidenceStatus, "USABLE");
});

test("B: five off-topic educational quiz results fail evidence quality", () => {
  assert.equal(badResults.filter(isOffTopicEducationalSearchResult).length, 5);
  const evaluation = evaluateResearchEvidenceQuality({ retrievalResults: badResults, synthesisSources: [{ id: 1, title: "x", url: "https://x.test", snippet: "x" }], synthesisConfidence: 0.6, synthesisCitations: [{ sourceId: 1, text: "x" }] });
  assert.equal(evaluation.status, "NEEDS_RESEARCH_RETRY");
  assert.equal(evaluation.retrievalQuality, "OFF_TOPIC");
});

test("C: retrieval exists but synthesis returns no sources fails", () => {
  const evaluation = evaluateResearchEvidenceQuality({ retrievalResults: goodResults, synthesisSources: [], synthesisConfidence: 0.4, synthesisCitations: [] });
  assert.equal(evaluation.status, "NEEDS_RESEARCH_RETRY");
});

test("D: synthesis confidence zero is preserved and never becomes 0.75", () => {
  const synthesis = {
    reportId: "22222222-2222-4222-8222-222222222222",
    taskDescription: "Production research for candidate stories",
    summary: "No research topic, question, or subject was provided.",
    sources: [],
    confidence: 0,
    citations: [],
    metadata: { createdAt: "2026-09-25T00:00:00.000Z", agentVersion: "research" },
  };
  const grounded = groundResearchReport(withSearch(synthesis, badResults));
  assert.equal(grounded.confidence, 0);
  assert.equal(grounded.researchStatus, "INSUFFICIENT_EVIDENCE");
  assert.equal(grounded.evidenceQuality.status, "NEEDS_RESEARCH_RETRY");
  assert.equal(grounded.evidenceQuality.ceoEligible, false);
});

test("current pilot bad research (5 off-topic plus confidence 0) is rejected", () => {
  const synthesis = {
    reportId: "d53c0e9b-97ef-4f4b-9b0c-20cb814db6e4",
    taskDescription: "Production research",
    summary: "No research topic, question, or subject was provided, so a substantive investigation could not be conducted.",
    sources: [],
    confidence: 0,
    citations: [],
    metadata: { createdAt: "2025-03-08T00:00:00Z", agentVersion: "research" },
  };
  const grounded = groundResearchReport(withSearch(synthesis, badResults));
  assert.equal(grounded.confidence, 0);
  assert.notEqual(grounded.confidence, 0.75);
  assert.equal(grounded.researchStatus, "INSUFFICIENT_EVIDENCE");
});

test("F: sufficient evidence is eligible for CEO consumption", () => {
  const evaluation = evaluateResearchEvidenceQuality({ retrievalResults: goodResults, synthesisSources: groundedSynthesis.sources, synthesisConfidence: groundedSynthesis.confidence, synthesisCitations: groundedSynthesis.citations });
  assert.equal(evaluation.status, "USABLE");
  const grounded = groundResearchReport(withSearch(viableSynthesis, viableSources));
  assert.equal(grounded.researchStatus, "USABLE");
  assert.equal(grounded.evidenceQuality.ceoEligible, true);
});
