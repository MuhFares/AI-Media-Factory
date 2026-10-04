/** Provider-free Research synthesis status/candidate coherence suite. No network. */
import { describe, it } from "node:test";
import { strictEqual, ok, rejects } from "node:assert";
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
const EVIDENCE = [
  { title: "Suhaymi fixture", url: "https://example.test/suhaymi", snippet: "Documented fixture.", source: "example.test", rank: 1 },
];
const signal = { isCancelled: false, onCancelled() {}, throwIfCancelled() {} };

function candidate() {
  return {
    candidateId: "candidate-1", topic: "Bayt al-Suhaymi", factualAngle: "Ottoman domestic architecture",
    keyClaims: ["Mashrabiya screens shade the courtyard"], sourceIds: [1], supportingEvidenceIds: ["ev-probe"],
    sourceQualitySummary: "Field survey", visualPotential: "Courtyard footage", shortFormPotential: "30-second reveal",
    evidenceRisks: [], verificationStatus: "needs-verification",
    contentOpportunityAssessment: { level: "HIGH", basis: "Evergreen discovery" },
    factualVerification: { status: "STRONG", basis: "Institutional corroboration" },
    recommendedForProduction: true,
  };
}

function synthesisOutput(status, candidates, visual = undefined) {
  return {
    reportId: "11111111-1111-4111-8111-111111111111",
    taskId: "research-research",
    stage: "research",
    taskDescription: "Probe synthesis of Morroway factual candidates from retrieved evidence.",
    summary: "One dated candidate with field-survey provenance.",
    candidateStories: candidates,
    sources: [{ id: 1, title: "Suhaymi fixture", url: "https://example.test/suhaymi", snippet: "Documented fixture." }],
    confidence: status === "grounded" ? 0.8 : 0.05,
    citations: [{ sourceId: 1, text: "Documented fixture." }],
    evidenceRisks: status === "grounded" ? ["Single-source coverage."] : ["Insufficient corroboration."],
    status,
    ...(visual === undefined ? {} : { visual }),
    metadata: { createdAt: "2026-09-25T00:00:00.000Z", agentVersion: "research" },
  };
}

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

function synthesisPrompt(captured) {
  const synthesis = captured.filter((r) => r?.callIdentity?.callLeg === "FINAL_SYNTHESIS");
  strictEqual(synthesis.length, 1);
  const messages = synthesis[0]?.messages;
  ok(Array.isArray(messages));
  return messages.map((m) => String(m?.content ?? "")).join("\n");
}

describe("synthesis status/candidate coherence", () => {
  it("A. FINAL_SYNTHESIS prompt states the status/candidate invariant explicitly", async () => {
    const captured = [];
    await agentWithSynthesis(() => synthesisOutput("grounded", [candidate()]), captured).execute({ context: {}, input: baseInput() }, signal);
    const prompt = synthesisPrompt(captured);
    ok(prompt.includes('when status is "insufficient_evidence", candidateStories MUST be []'), "insufficient rule");
    ok(prompt.includes('When status is "grounded", candidateStories MUST contain at least one valid evidence-linked candidate'), "grounded rule");
    ok(prompt.includes('Never return candidate stories with "insufficient_evidence"'), "never-pair rule");
  });

  it("B. insufficient_evidence with [] validates", async () => {
    const result = await agentWithSynthesis(() => synthesisOutput("insufficient_evidence", [])).execute({ context: {}, input: baseInput() }, signal);
    strictEqual(result.output.status, "insufficient_evidence");
    strictEqual(result.output.candidateStories.length, 0);
  });

  it("C. insufficient_evidence with non-empty candidateStories rejects", async () => {
    await rejects(
      agentWithSynthesis(() => synthesisOutput("insufficient_evidence", [candidate()])).execute({ context: {}, input: baseInput() }, signal),
      /invalid report structure/,
    );
  });

  it("D. grounded with valid candidateStories validates", async () => {
    const result = await agentWithSynthesis(() => synthesisOutput("grounded", [candidate()])).execute({ context: {}, input: baseInput() }, signal);
    strictEqual(result.output.status, "grounded");
    strictEqual(result.output.candidateStories.length, 1);
  });

  it("E. grounded with [] rejects", async () => {
    await rejects(
      agentWithSynthesis(() => synthesisOutput("grounded", [])).execute({ context: {}, input: baseInput() }, signal),
      /invalid report structure/,
    );
  });

  it("F. grounded visual-null semantics unchanged", async () => {
    const nulled = await agentWithSynthesis(() => synthesisOutput("grounded", [candidate()], null)).execute({ context: {}, input: baseInput() }, signal);
    strictEqual(nulled.output.status, "grounded");
    strictEqual("visual" in nulled.output, false);
    await rejects(
      agentWithSynthesis(() => synthesisOutput("grounded", [candidate()], {})).execute({ context: {}, input: baseInput() }, signal),
      /malformed visual research contract/,
    );
  });

  it("G. strict synthesis schema still excludes provider-risky keywords", () => {
    const agent = createResearchAgent({ config: {}, execute: async () => { throw new Error("unused"); }, capabilityExecution: { async executeCapability() { throw new Error("unused"); } } });
    const schema = agent.getResearchResponseSchema(true);
    const counts = { oneOf: 0, anyOf: 0, const: 0, format: 0 };
    (function walk(node) {
      if (node === null || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node.oneOf !== undefined) counts.oneOf++;
      if (node.anyOf !== undefined) counts.anyOf++;
      if (node.const !== undefined) counts.const++;
      if (typeof node.format === "string") counts.format++;
      for (const value of Object.values(node)) walk(value);
    })(schema);
    strictEqual(counts.oneOf, 0);
    strictEqual(counts.anyOf, 0);
    strictEqual(counts.const, 0);
    strictEqual(counts.format, 0);
  });
});
