/**
 * Provider-free synthesis failure taxonomy replay. Each row replays one
 * failure family through the real agent/validator (or a faithful error
 * shape for transport families) and asserts the canonical bounded
 * classification. No network. No validators weakened.
 */
import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import { createResearchAgent, classifySynthesisFailure } from "../dist/index.js";

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

const COMPLETE_VISUAL = {
  topic: "Suhaymi house", visualMode: "cinematic/editorial", referenceStrategy: "LOCATION_REFERENCE",
  imageRefs: [], sourceRefs: [], observations: ["Courtyard"], provenance: "web",
};

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

function report(status, candidates, visual = undefined) {
  return {
    reportId: "11111111-1111-4111-8111-111111111111",
    taskId: "research-research",
    stage: "research",
    taskDescription: "Probe synthesis of Morroway factual candidates from retrieved evidence.",
    summary: "Probe synthesis outcome.",
    candidateStories: candidates,
    sources: [{ id: 1, title: "Suhaymi fixture", url: "https://example.test/suhaymi", snippet: "Documented fixture." }],
    confidence: status === "grounded" ? 0.8 : 0.05,
    citations: [{ sourceId: 1, text: "Documented fixture." }],
    evidenceRisks: [],
    status,
    ...(visual === undefined ? {} : { visual }),
    metadata: { createdAt: "2026-09-25T00:00:00.000Z", agentVersion: "research" },
  };
}

function agentWithSynthesis(make) {
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

async function captureError(make) {
  try {
    await agentWithSynthesis(make).execute({ context: {}, input: baseInput() }, signal);
  } catch (error) {
    return error;
  }
  throw new Error("expected synthesis to fail");
}

function checkClassification(classification, family) {
  strictEqual(classification.family, family);
  ok(classification.paths.length <= 10, "paths bounded");
  ok(!JSON.stringify(classification).includes("Documented fixture"), "no evidence text retained");
}

describe("synthesis failure taxonomy replay", () => {
  it("A. fully valid grounded response validates (no failure family)", async () => {
    const result = await agentWithSynthesis(() => report("grounded", [candidate()], COMPLETE_VISUAL)).execute({ context: {}, input: baseInput() }, signal);
    strictEqual(result.output.status, "grounded");
  });

  it("B. insufficient + candidates contradiction classifies coherence failure", async () => {
    const error = await captureError(() => report("insufficient_evidence", [candidate()]));
    const classification = classifySynthesisFailure(error);
    checkClassification(classification, "STATUS_CANDIDATE_COHERENCE_FAILURE");
    deepStrictEqual(classification.paths, ["candidateStories"]);
  });

  it("C. visual={} classifies visual contract failure", async () => {
    const error = await captureError(() => report("grounded", [candidate()], {}));
    checkClassification(classifySynthesisFailure(error), "VISUAL_CONTRACT_FAILURE");
  });

  it("D. partial visual classifies visual contract failure", async () => {
    const partial = { ...COMPLETE_VISUAL };
    delete partial.provenance;
    const error = await captureError(() => report("grounded", [candidate()], partial));
    checkClassification(classifySynthesisFailure(error), "VISUAL_CONTRACT_FAILURE");
  });

  it("E. dangling candidate source classifies candidate semantic failure", async () => {
    const bad = candidate();
    bad.sourceIds = [999];
    const error = await captureError(() => report("grounded", [bad]));
    const classification = classifySynthesisFailure(error);
    checkClassification(classification, "CANDIDATE_SEMANTIC_FAILURE");
    deepStrictEqual(classification.paths, ["candidateStories[0].sourceIds"]);
  });

  it("F. dangling citation classifies citation linkage failure", async () => {
    const out = report("grounded", [candidate()]);
    out.citations = [{ sourceId: 999, text: "Dangling." }];
    const error = await captureError(() => out);
    checkClassification(classifySynthesisFailure(error), "CITATION_LINKAGE_FAILURE");
  });

  it("G. invalid confidence classifies confidence failure", async () => {
    const out = report("grounded", [candidate()]);
    out.confidence = 2;
    const error = await captureError(() => out);
    const classification = classifySynthesisFailure(error);
    checkClassification(classification, "CONFIDENCE_FAILURE");
    deepStrictEqual(classification.paths, ["confidence"]);
  });

  it("H. invalid identity classifies identity failure", async () => {
    const out = report("grounded", [candidate()]);
    out.taskId = "wrong-task";
    const error = await captureError(() => out);
    const classification = classifySynthesisFailure(error);
    checkClassification(classification, "IDENTITY_FAILURE");
    deepStrictEqual(classification.paths, ["taskId"]);
  });

  it("I. missing DONE marker classifies provider incomplete", async () => {
    const error = Object.assign(new Error("OpenRouter m missing [DONE]"), {
      diagnostics: { incomplete: true, terminationReason: "missing_done", httpStatus: 200 },
    });
    const classification = classifySynthesisFailure(error);
    checkClassification(classification, "PROVIDER_RESPONSE_INCOMPLETE");
    strictEqual(classification.code, "missing_done");
  });

  it("J. finish_reason=length classifies output token exhaustion", async () => {
    const error = Object.assign(new Error("OpenRouter m incomplete response (length)"), {
      diagnostics: { incomplete: true, terminationReason: "length", httpStatus: 200 },
    });
    const classification = classifySynthesisFailure(error);
    checkClassification(classification, "OUTPUT_TOKEN_LIMIT_EXHAUSTION");
    strictEqual(classification.code, "length");
  });

  it("K. unknown malformed structure classifies structural schema failure", async () => {
    const out = report("grounded", [candidate()]);
    out.candidateStories = "not-an-array";
    const error = await captureError(() => out);
    checkClassification(classifySynthesisFailure(error), "STRUCTURAL_SCHEMA_FAILURE");
  });

  it("L. HTTP error classifies provider HTTP error", async () => {
    const error = Object.assign(new Error("OpenRouter request failed (429)"), {
      diagnostics: { httpStatus: 429, model: "m" },
    });
    const classification = classifySynthesisFailure(error);
    checkClassification(classification, "PROVIDER_HTTP_ERROR");
    strictEqual(classification.code, "HTTP_429");
  });
});
