/**
 * Provider-free Research synthesis contract matrix: every row mutates one
 * property of a known-good response and asserts the canonical outcome.
 * Covers valid permutations (A-G), adversarial rejections, and the
 * prompt-clause regression. No network. Only canonical invariants are
 * asserted: rows marked ACCEPT document actual normalizing behavior.
 */
import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual, ok, rejects } from "node:assert";
import { createResearchAgent, RESEARCH_SYNTHESIS_SEMANTIC_CLAUSES } from "../dist/index.js";

const task = {
  id: "research-research",
  name: "Research",
  description: "Production research for probe factual candidates with Morroway research context.",
  agent: "research",
  inputSchema: {},
  outputSchema: {},
  dependencies: [],
};
const contract = { taskId: "research-research", stage: "research" };
const EVIDENCE = [
  { title: "Suhaymi fixture", url: "https://example.test/suhaymi", snippet: "Documented fixture.", source: "example.test", rank: 1 },
  { title: "Second fixture", url: "https://example.test/second", snippet: "Second documented fixture.", source: "example.test", rank: 2 },
];
const signal = { isCancelled: false, onCancelled() {}, throwIfCancelled() {} };

const COMPLETE_VISUAL = {
  topic: "Suhaymi house", visualMode: "cinematic/editorial", referenceStrategy: "LOCATION_REFERENCE",
  imageRefs: [], sourceRefs: [], observations: ["Courtyard with mashrabiya"], provenance: "web",
};

function fullCandidate() {
  return {
    candidateId: "candidate-1", topic: "Bayt al-Suhaymi", factualAngle: "Ottoman domestic architecture",
    keyClaims: ["Mashrabiya screens shade the courtyard"], sourceIds: [1], supportingEvidenceIds: ["ev-probe"],
    sourceQualitySummary: "Field survey", visualPotential: "Courtyard footage", shortFormPotential: "30-second reveal",
    fitNote: "Strong visual fit", evidenceRisks: [], verificationStatus: "needs-verification",
    contentOpportunityAssessment: { level: "HIGH", basis: "Evergreen discovery" },
    factualVerification: { status: "STRONG", basis: "Institutional corroboration" },
    trendEvidence: [{ signal: "Heritage interest", source: "example.test" }],
    evergreenEvidence: ["Enduring craft appeal"],
    marketRelevance: null,
    recommendedForProduction: true,
  };
}

function baseGrounded() {
  return {
    reportId: "11111111-1111-4111-8111-111111111111",
    taskId: "research-research",
    stage: "research",
    taskDescription: "Probe synthesis of Morroway factual candidates from retrieved evidence.",
    summary: "One dated candidate with field-survey provenance.",
    candidateStories: [fullCandidate()],
    sources: [{ id: 1, title: "Suhaymi fixture", url: "https://example.test/suhaymi", snippet: "Documented fixture." }],
    confidence: 0.8,
    citations: [{ sourceId: 1, text: "Documented fixture." }],
    evidenceRisks: ["Single-source coverage."],
    status: "grounded",
    metadata: { createdAt: "2026-09-25T00:00:00.000Z", agentVersion: "research" },
  };
}

function baseInsufficient() {
  return {
    reportId: "22222222-2222-4222-8222-222222222222",
    taskId: "research-research",
    stage: "research",
    taskDescription: "Probe synthesis of Morroway factual candidates from retrieved evidence.",
    summary: "No candidate meets the evidence threshold.",
    candidateStories: [],
    sources: [{ id: 1, title: "Suhaymi fixture", url: "https://example.test/suhaymi", snippet: "Documented fixture." }],
    confidence: 0.05,
    citations: [{ sourceId: 1, text: "Documented fixture." }],
    evidenceRisks: ["Insufficient corroboration."],
    status: "insufficient_evidence",
    metadata: { createdAt: "2026-09-25T00:00:00.000Z", agentVersion: "research" },
  };
}

const clone = (value) => JSON.parse(JSON.stringify(value));

function agentWithSynthesis(make, captured = null) {
  const plan = {
    reportId: "00000000-0000-4000-8000-000000000000",
    taskId: "research-research",
    stage: "research",
    taskDescription: "Probe research for Morroway factual candidates.",
    summary: "Probe plan awaiting retrieval.",
    sources: [],
    confidence: 0.1,
    citations: [],
    metadata: { createdAt: "2026-09-25T00:00:00.000Z", agentVersion: "research" },
  };
  return createResearchAgent({
    config: {},
    execute: async (_ctx, request) => {
      if (captured !== null) captured.push(request);
      const leg = request?.callIdentity?.callLeg;
      const output = leg === "FINAL_SYNTHESIS" ? make() : plan;
      return { output, raw: "{}", usage: { inputTokens: 10, outputTokens: 20, costUsd: 0.00001 }, model: "test", provider: "test", latencyMs: 1 };
    },
    capabilityExecution: {
      async executeCapability(request) {
        return {
          status: "success",
          resultId: `result-${request.requestId}`,
          capabilityId: request.capabilityId,
          output: { results: EVIDENCE, providerId: "probe" },
          evidence: { providerId: "probe", evidenceId: "ev-probe", succeeded: true, executedAt: "2026-09-25T00:00:00.000Z" },
        };
      },
    },
  });
}

function baseInput() {
  return {
    task,
    contract,
    synthesisContract: "amf-research-synthesis-v1",
    capabilityRequests: [{ requestId: "cap-1", capabilityId: "web.search", agentId: "research", workflowId: "wf-1", correlationId: "corr-1", input: { query: "probe", maxResults: 5 }, requestedAt: "2026-09-25T00:00:00.000Z" }],
  };
}

function issueAt(path) {
  return (error) => {
    if (!(error instanceof Error)) return false;
    if (!/invalid report structure/.test(error.message)) return false;
    const issues = error.diagnostics?.issues ?? [];
    return issues.some((issue) => issue.path === path);
  };
}

describe("synthesis contract matrix", () => {
  it("A. insufficient + [] + visual absent accepted", async () => {
    const result = await agentWithSynthesis(baseInsufficient).execute({ context: {}, input: baseInput() }, signal);
    strictEqual(result.output.status, "insufficient_evidence");
  });

  it("B. insufficient + [] + visual null accepted and normalized", async () => {
    const out = { ...baseInsufficient(), visual: null };
    const result = await agentWithSynthesis(() => out).execute({ context: {}, input: baseInput() }, signal);
    strictEqual("visual" in result.output, false);
  });

  it("C. grounded + valid + visual absent accepted", async () => {
    const result = await agentWithSynthesis(baseGrounded).execute({ context: {}, input: baseInput() }, signal);
    strictEqual(result.output.status, "grounded");
  });

  it("D. grounded + valid + visual null accepted and normalized", async () => {
    const out = { ...baseGrounded(), visual: null };
    const result = await agentWithSynthesis(() => out).execute({ context: {}, input: baseInput() }, signal);
    strictEqual("visual" in result.output, false);
  });

  it("E. grounded + valid + complete visual accepted intact", async () => {
    const out = { ...baseGrounded(), visual: clone(COMPLETE_VISUAL) };
    const result = await agentWithSynthesis(() => out).execute({ context: {}, input: baseInput() }, signal);
    deepStrictEqual(result.output.visual, COMPLETE_VISUAL);
  });

  it("F. multi-source evidence-linked candidate accepted", async () => {
    const out = baseGrounded();
    out.sources = [
      ...out.sources,
      { id: 2, title: "Second fixture", url: "https://example.test/second", snippet: "Second documented fixture." },
    ];
    out.candidateStories[0].sourceIds = [1, 2];
    out.citations = [...out.citations, { sourceId: 2, text: "Second documented fixture." }];
    const result = await agentWithSynthesis(() => out).execute({ context: {}, input: baseInput() }, signal);
    strictEqual(result.output.candidateStories[0].sourceIds.length, 2);
  });

  it("G. strongest positive: full-field candidate with complete visual accepted", async () => {
    const out = { ...baseGrounded(), visual: clone(COMPLETE_VISUAL) };
    const result = await agentWithSynthesis(() => out).execute({ context: {}, input: baseInput() }, signal);
    strictEqual(result.output.status, "grounded");
    strictEqual(result.output.candidateStories[0].factualVerification.status, "STRONG");
    strictEqual(result.output.candidateStories[0].recommendedForProduction, true);
  });

  it("1. insufficient + non-empty candidates rejected", async () => {
    const out = { ...baseInsufficient(), candidateStories: [fullCandidate()] };
    await rejects(agentWithSynthesis(() => out).execute({ context: {}, input: baseInput() }, signal), issueAt("candidateStories"));
  });

  it("2. grounded + [] rejected", async () => {
    const out = { ...baseGrounded(), candidateStories: [] };
    await rejects(agentWithSynthesis(() => out).execute({ context: {}, input: baseInput() }, signal), issueAt("candidateStories"));
  });

  it("3. visual={} rejected", async () => {
    const out = { ...baseGrounded(), visual: {} };
    await rejects(agentWithSynthesis(() => out).execute({ context: {}, input: baseInput() }, signal), /malformed visual research contract/);
  });

  it("4. partial visual (missing provenance) rejected", async () => {
    const partial = clone(COMPLETE_VISUAL);
    delete partial.provenance;
    const out = { ...baseGrounded(), visual: partial };
    await rejects(agentWithSynthesis(() => out).execute({ context: {}, input: baseInput() }, signal), /malformed visual research contract/);
  });

  it("5. malformed nested visual field rejected", async () => {
    const bad = { ...clone(COMPLETE_VISUAL), visualMode: "not-a-mode" };
    const out = { ...baseGrounded(), visual: bad };
    await rejects(agentWithSynthesis(() => out).execute({ context: {}, input: baseInput() }, signal), /malformed visual research contract/);
  });

  it("6. candidate referencing missing source rejected", async () => {
    const out = baseGrounded();
    out.candidateStories[0].sourceIds = [999];
    await rejects(agentWithSynthesis(() => out).execute({ context: {}, input: baseInput() }, signal), issueAt("candidateStories[0].sourceIds"));
  });

  it("7. citation referencing missing source rejected", async () => {
    const out = baseGrounded();
    out.citations = [{ sourceId: 999, text: "Dangling citation." }];
    await rejects(agentWithSynthesis(() => out).execute({ context: {}, input: baseInput() }, signal), /citation references an unknown source/);
  });

  it("8. citation missing text rejected", async () => {
    const out = baseGrounded();
    out.citations = [{ sourceId: 1 }];
    await rejects(agentWithSynthesis(() => out).execute({ context: {}, input: baseInput() }, signal), issueAt("citations[0].text"));
  });

  it("9. invalid URL rejected", async () => {
    const out = baseGrounded();
    out.sources = [{ ...out.sources[0], url: "not a url" }];
    await rejects(agentWithSynthesis(() => out).execute({ context: {}, input: baseInput() }, signal), issueAt("sources[0].url"));
  });

  it("10. invalid reportId rejected", async () => {
    const out = { ...baseGrounded(), reportId: "not-a-uuid" };
    await rejects(agentWithSynthesis(() => out).execute({ context: {}, input: baseInput() }, signal), issueAt("reportId"));
  });

  it("11. confidence below range rejected", async () => {
    const out = { ...baseGrounded(), confidence: -0.5 };
    await rejects(agentWithSynthesis(() => out).execute({ context: {}, input: baseInput() }, signal), issueAt("confidence"));
  });

  it("12. confidence above range rejected", async () => {
    const out = { ...baseGrounded(), confidence: 1.5 };
    await rejects(agentWithSynthesis(() => out).execute({ context: {}, input: baseInput() }, signal), issueAt("confidence"));
  });

  it("13. candidate missing topic rejected", async () => {
    const out = baseGrounded();
    delete out.candidateStories[0].topic;
    await rejects(agentWithSynthesis(() => out).execute({ context: {}, input: baseInput() }, signal), issueAt("candidateStories[0].topic"));
  });

  it("14. extra undeclared top-level field is stripped, response still accepted", async () => {
    const out = { ...baseGrounded(), xExtra: "not-in-contract" };
    const result = await agentWithSynthesis(() => out).execute({ context: {}, input: baseInput() }, signal);
    strictEqual(result.output.status, "grounded");
    strictEqual("xExtra" in result.output, false);
  });

  it("15. null topic rejected", async () => {
    const out = baseGrounded();
    out.candidateStories[0].topic = null;
    await rejects(agentWithSynthesis(() => out).execute({ context: {}, input: baseInput() }, signal), issueAt("candidateStories[0].topic"));
  });

  it("16. empty nested factualVerification object is dropped, response still accepted", async () => {
    const out = baseGrounded();
    out.candidateStories[0].factualVerification = {};
    const result = await agentWithSynthesis(() => out).execute({ context: {}, input: baseInput() }, signal);
    strictEqual(result.output.status, "grounded");
    strictEqual("factualVerification" in result.output.candidateStories[0], false);
  });

  it("17. malformed recommendation string normalizes to false, response still accepted", async () => {
    const out = baseGrounded();
    out.candidateStories[0].recommendedForProduction = "yes";
    const result = await agentWithSynthesis(() => out).execute({ context: {}, input: baseInput() }, signal);
    strictEqual(result.output.candidateStories[0].recommendedForProduction, false);
  });

  it("18. PARTIAL verification with recommended true normalizes per contract without rejection", async () => {
    const out = baseGrounded();
    out.candidateStories[0].factualVerification = { status: "PARTIAL", basis: "Single institutional source." };
    out.candidateStories[0].recommendedForProduction = true;
    const result = await agentWithSynthesis(() => out).execute({ context: {}, input: baseInput() }, signal);
    strictEqual(result.output.status, "grounded");
    ok(result.output.candidateStories[0].recommendedForProduction === true);
  });

  it("19. grounded with empty sources rejected (no evidence linkage possible)", async () => {
    const out = { ...baseGrounded(), sources: [], citations: [] };
    await rejects(agentWithSynthesis(() => out).execute({ context: {}, input: baseInput() }, signal), /invalid report structure|citation references an unknown source/);
  });

  it("20. insufficient with complete visual accepted (visual allowed on negative)", async () => {
    const out = { ...baseInsufficient(), visual: clone(COMPLETE_VISUAL) };
    const result = await agentWithSynthesis(() => out).execute({ context: {}, input: baseInput() }, signal);
    strictEqual(result.output.status, "insufficient_evidence");
    deepStrictEqual(result.output.visual, COMPLETE_VISUAL);
  });

  it("21. duplicate sourceIds accepted (deduplicated by linkage)", async () => {
    const out = baseGrounded();
    out.candidateStories[0].sourceIds = [1, 1];
    const result = await agentWithSynthesis(() => out).execute({ context: {}, input: baseInput() }, signal);
    strictEqual(result.output.status, "grounded");
  });

  it("22. grounded with zero confidence accepted (no confidence minimum in contract)", async () => {
    const out = { ...baseGrounded(), confidence: 0 };
    const result = await agentWithSynthesis(() => out).execute({ context: {}, input: baseInput() }, signal);
    strictEqual(result.output.status, "grounded");
  });

  it("P. prompt carries every canonical semantic clause", async () => {
    ok(RESEARCH_SYNTHESIS_SEMANTIC_CLAUSES.length >= 8, "clauses exported");
    const captured = [];
    await agentWithSynthesis(baseGrounded, captured).execute({ context: {}, input: baseInput() }, signal);
    const synthesis = captured.filter((r) => r?.callIdentity?.callLeg === "FINAL_SYNTHESIS");
    strictEqual(synthesis.length, 1);
    const prompt = synthesis[0].messages.map((m) => String(m?.content ?? "")).join("\n");
    for (const clause of RESEARCH_SYNTHESIS_SEMANTIC_CLAUSES) {
      ok(prompt.includes(clause), `missing clause: ${clause.slice(0, 60)}…`);
    }
  });
});
