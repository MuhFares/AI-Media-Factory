/** Provider-free Research synthesis provider-compatibility contract suite. No network. */
import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual, ok, rejects } from "node:assert";
import { createResearchAgent } from "../dist/index.js";

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
const SYNTHESIS_CONTRACT = "amf-research-synthesis-v1";
const EVIDENCE = [
  { title: "Qanat tunnels", url: "https://example.test/qanat", snippet: "Documented water tunnels.", source: "example.test", rank: 1 },
];
const signal = { isCancelled: false, onCancelled() {}, throwIfCancelled() {} };

const COMPLETE_VISUAL = {
  topic: "Qanat tunnels", visualMode: "cinematic/editorial", referenceStrategy: "LOCATION_REFERENCE",
  imageRefs: [], sourceRefs: [], observations: ["Underground channels"], provenance: "web",
};

function positiveOutput() {
  return {
    reportId: "11111111-1111-4111-8111-111111111111",
    taskId: "research-research",
    stage: "research",
    taskDescription: "Probe synthesis of Morroway factual candidates from retrieved evidence.",
    summary: "One dated candidate with field-survey provenance.",
    candidateStories: [{
      candidateId: "candidate-1", topic: "Qanat water tunnels", factualAngle: "Ancient Persian engineering",
      keyClaims: ["Qanat tunnels convey groundwater"], sourceIds: [1], supportingEvidenceIds: ["ev-probe"],
      sourceQualitySummary: "Field survey", visualPotential: "Tunnel footage", shortFormPotential: "30-second reveal",
      evidenceRisks: [], verificationStatus: "needs-verification",
      contentOpportunityAssessment: { level: "HIGH", basis: "Evergreen discovery" },
      factualVerification: { status: "STRONG", basis: "Institutional corroboration" },
      recommendedForProduction: true,
    }],
    sources: [{ id: 1, title: "Qanat tunnels", url: "https://example.test/qanat", snippet: "Documented water tunnels." }],
    confidence: 0.8,
    citations: [{ sourceId: 1, text: "Documented water tunnels." }],
    evidenceRisks: ["Single-source coverage."],
    status: "grounded",
    visual: COMPLETE_VISUAL,
    metadata: { createdAt: "2026-09-25T00:00:00.000Z", agentVersion: "research" },
  };
}

function negativeOutput(visual = null) {
  return {
    reportId: "22222222-2222-4222-8222-222222222222",
    taskId: "research-research",
    stage: "research",
    taskDescription: "Probe synthesis of Morroway factual candidates from retrieved evidence.",
    summary: "No candidate meets the evidence threshold.",
    candidateStories: [],
    sources: [{ id: 1, title: "Qanat tunnels", url: "https://example.test/qanat", snippet: "Documented water tunnels." }],
    confidence: 0.05,
    citations: [{ sourceId: 1, text: "Documented water tunnels." }],
    evidenceRisks: ["Insufficient corroboration."],
    status: "insufficient_evidence",
    ...(visual === undefined ? {} : { visual }),
    metadata: { createdAt: "2026-09-25T00:00:00.000Z", agentVersion: "research" },
  };
}

function fakeBoundary(results = EVIDENCE) {
  return {
    async executeCapability(request) {
      return {
        status: "success",
        resultId: `result-${request.requestId}`,
        capabilityId: request.capabilityId,
        output: { results, providerId: "probe" },
        evidence: { providerId: "probe", evidenceId: "ev-probe", succeeded: true, executedAt: "2026-09-25T00:00:00.000Z" },
      };
    },
  };
}

function agentWithSynthesis(synthesisOutput, captured = null) {
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
      const output = leg === "FINAL_SYNTHESIS" ? synthesisOutput() : plan;
      return { output, raw: "{}", usage: { inputTokens: 10, outputTokens: 20, costUsd: 0.00001 }, model: "test", provider: "test", latencyMs: 1 };
    },
    capabilityExecution: fakeBoundary(),
  });
}

function baseInput() {
  return {
    task,
    contract,
    synthesisContract: SYNTHESIS_CONTRACT,
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

function schemaProfile(schema) {
  const counts = { oneOf: 0, anyOf: 0, allOf: 0, const: 0, format: 0, objects: 0, missingAdditionalFalse: 0 };
  (function walk(node) {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.oneOf !== undefined) counts.oneOf++;
    if (node.anyOf !== undefined) counts.anyOf++;
    if (node.allOf !== undefined) counts.allOf++;
    if (node.const !== undefined) counts.const++;
    if (typeof node.format === "string") counts.format++;
    if (node.type === "object" || (node.properties !== undefined && node.type === undefined)) {
      counts.objects++;
      if (node.additionalProperties !== false) counts.missingAdditionalFalse++;
    }
    for (const value of Object.values(node)) walk(value);
  })(schema);
  return counts;
}

describe("synthesis provider-compatibility contract", () => {
  it("Part 9: synthesis schema is strict-shaped with zero provider-risky keywords", () => {
    const agent = createResearchAgent({ config: {}, execute: async () => { throw new Error("unused"); }, capabilityExecution: fakeBoundary() });
    const schema = agent.getResearchResponseSchema(true);
    const profile = schemaProfile(schema);
    strictEqual(profile.oneOf, 0);
    strictEqual(profile.anyOf, 0);
    strictEqual(profile.const, 0);
    strictEqual(profile.format, 0);
    ok(profile.objects > 5);
    strictEqual(profile.missingAdditionalFalse, 0);
    deepStrictEqual(schema.properties.status.enum, ["grounded", "insufficient_evidence"]);
    for (const key of ["reportId", "taskDescription", "summary", "sources", "confidence", "citations", "candidateStories", "evidenceRisks", "status", "metadata"]) {
      ok(schema.required.includes(key), key);
    }
    const items = schema.properties.candidateStories.items;
    for (const key of [
      "candidateId", "topic", "factualAngle", "keyClaims", "sourceIds",
      "supportingEvidenceIds", "sourceQualitySummary", "visualPotential",
      "shortFormPotential", "evidenceRisks", "verificationStatus",
      "contentOpportunityAssessment", "factualVerification",
      "recommendedForProduction",
    ]) ok(items.required.includes(key), `candidate.${key}`);
  });

  it("Part 7: captured synthesis requests carry the strict schema (positive and negative)", async () => {
    for (const make of [positiveOutput, () => negativeOutput(null)]) {
      const captured = [];
      const agent = agentWithSynthesis(make, captured);
      const result = await agent.execute({ context: {}, input: baseInput() }, signal);
      ok(result.output);
      const synthesisRequests = captured.filter((r) => r?.callIdentity?.callLeg === "FINAL_SYNTHESIS");
      strictEqual(synthesisRequests.length, 1);
      const profile = schemaProfile(synthesisRequests[0].responseSchema);
      strictEqual(profile.oneOf, 0);
      strictEqual(profile.anyOf, 0);
      strictEqual(profile.const, 0);
      strictEqual(profile.format, 0);
      strictEqual(profile.missingAdditionalFalse, 0);
    }
  });

  it("A. valid production candidate accepted with lineage intact", async () => {
    const agent = agentWithSynthesis(positiveOutput);
    const result = await agent.execute({ context: {}, input: baseInput() }, signal);
    strictEqual(result.output.status, "grounded");
    strictEqual(result.output.candidateStories.length, 1);
    const ids = new Set(result.output.sources.map((s) => s.id));
    ok(result.output.candidateStories[0].sourceIds.every((id) => ids.has(id)));
    ok(result.output.citations.every((c) => ids.has(c.sourceId)));
    deepStrictEqual(result.output.visual, COMPLETE_VISUAL);
  });

  it("B+D. valid insufficient evidence accepted with absent or null visual", async () => {
    for (const visual of [undefined, null]) {
      const agent = agentWithSynthesis(() => negativeOutput(visual));
      const result = await agent.execute({ context: {}, input: baseInput() }, signal);
      strictEqual(result.output.status, "insufficient_evidence");
      strictEqual(result.output.candidateStories.length, 0);
      strictEqual("visual" in result.output, false);
    }
  });

  it("C. insufficient evidence with empty-object visual placeholder rejected", async () => {
    const agent = agentWithSynthesis(() => negativeOutput({}));
    await rejects(agent.execute({ context: {}, input: baseInput() }, signal), /malformed visual research contract/);
  });

  it("E. grounded visual forms: complete accepted, explicit-null normalized to absent, empty-object rejected", async () => {
    const nulled = { ...positiveOutput(), visual: null };
    const agent = agentWithSynthesis(() => nulled);
    const accepted = await agent.execute({ context: {}, input: baseInput() }, signal);
    strictEqual(accepted.output.status, "grounded");
    strictEqual("visual" in accepted.output, false);
    const absent = { ...positiveOutput() };
    delete absent.visual;
    const agent2 = agentWithSynthesis(() => absent);
    const result = await agent2.execute({ context: {}, input: baseInput() }, signal);
    strictEqual(result.output.status, "grounded");
    const emptyGrounded = { ...positiveOutput(), visual: {} };
    const agent3 = agentWithSynthesis(() => emptyGrounded);
    await rejects(agent3.execute({ context: {}, input: baseInput() }, signal), /malformed visual research contract/);
  });

  it("F. invalid status rejected", async () => {
    const agent = agentWithSynthesis(() => ({ ...positiveOutput(), status: "bogus" }));
    await rejects(agent.execute({ context: {}, input: baseInput() }, signal), issueAt("status"));
  });

  it("G. grounded candidate with empty evidence links rejected", async () => {
    const noLinks = { ...positiveOutput() };
    noLinks.candidateStories = [{ ...noLinks.candidateStories[0], sourceIds: [] }];
    const agent = agentWithSynthesis(() => noLinks);
    await rejects(agent.execute({ context: {}, input: baseInput() }, signal), issueAt("candidateStories[0].sourceIds"));
    const unknownLinks = { ...positiveOutput() };
    unknownLinks.candidateStories = [{ ...unknownLinks.candidateStories[0], sourceIds: [999] }];
    const agent2 = agentWithSynthesis(() => unknownLinks);
    await rejects(agent2.execute({ context: {}, input: baseInput() }, signal), /invalid report structure/);
  });

  it("H. malformed JSON output rejected", async () => {
    const agent = createResearchAgent({
      config: {},
      execute: async (_ctx, request) => {
        const leg = request?.callIdentity?.callLeg;
        const output = leg === "FINAL_SYNTHESIS" ? "{not-json" : {
          reportId: "00000000-0000-4000-8000-000000000000", taskId: "research-research", stage: "research",
          taskDescription: "Probe research for Morroway factual candidates.", summary: "Probe plan.",
          sources: [], confidence: 0.1, citations: [], metadata: { createdAt: "2026-09-25T00:00:00.000Z", agentVersion: "research" },
        };
        return { output, raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 };
      },
      capabilityExecution: fakeBoundary(),
    });
    await rejects(agent.execute({ context: {}, input: baseInput() }, signal), /invalid report structure/);
  });

  it("I. provider schema prohibits undeclared fields on every object", () => {
    const agent = createResearchAgent({ config: {}, execute: async () => { throw new Error("unused"); }, capabilityExecution: fakeBoundary() });
    for (const synthesis of [true, false]) {
      const profile = schemaProfile(agent.getResearchResponseSchema(synthesis));
      strictEqual(profile.missingAdditionalFalse, 0);
    }
  });

  it("J. reportId UUID shape and source URL syntax enforced at synthesis", async () => {
    const badId = { ...positiveOutput(), reportId: "not-a-uuid" };
    const agent = agentWithSynthesis(() => badId);
    await rejects(agent.execute({ context: {}, input: baseInput() }, signal), issueAt("reportId"));
    const badUrl = { ...positiveOutput() };
    badUrl.sources = [{ ...badUrl.sources[0], url: "not a url" }];
    const agent2 = agentWithSynthesis(() => badUrl);
    await rejects(agent2.execute({ context: {}, input: baseInput() }, signal), issueAt("sources[0].url"));
  });

  it("K+L. positive and negative artifacts persist canonically with valid lineage", async () => {
    const agent = agentWithSynthesis(positiveOutput);
    const result = await agent.execute({ context: {}, input: baseInput() }, signal);
    for (const key of ["reportId", "taskDescription", "summary", "sources", "confidence", "citations", "candidateStories", "evidenceRisks", "status", "metadata"]) {
      ok(result.output[key] !== undefined, key);
    }
    strictEqual(result.output.metadata.agentVersion, "research");
    const negative = await agentWithSynthesis(() => negativeOutput(null)).execute({ context: {}, input: baseInput() }, signal);
    strictEqual(negative.output.status, "insufficient_evidence");
    deepStrictEqual(negative.output.candidateStories, []);
  });
});
