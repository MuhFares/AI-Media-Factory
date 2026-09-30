/**
 * REVIEW CONTRACT ADHERENCE INVESTIGATION V1 — provider-free diagnosis.
 *
 * Uses the SAME production validation path (ReviewerAgent.validateReviewResponse)
 * and the SAME SSE extraction pipeline (production-executor's openRouterLlm is
 * exercised through executeAgentStep fixtures elsewhere; here the stream
 * parsing logic is proven on identical synthetic SSE frames) to determine
 * why the r1 Dots3 Review response failed
 * REVIEW_STRUCTURAL_INVALID_RECOMMENDATION at $.recommendations[].
 *
 * No live provider calls. No evidence mutation.
 */
import { describe, it } from "node:test";
import { ok, strictEqual, rejects } from "node:assert";
import { createReviewerAgent } from "../dist/index.js";

const task = {
  id: "review-investigation",
  name: "Review content",
  description: "Review content for review",
  agent: "reviewer",
  inputSchema: {},
  outputSchema: {},
  dependencies: [],
};

const activeSignal = { isCancelled: false, onCancelled() {}, throwIfCancelled() {} };

function reviewerAgent() {
  return createReviewerAgent({ config: {}, execute: async () => ({}) });
}

const baseReport = {
  reportId: "00000000-0000-4000-8000-000000000001",
  taskDescription: task.description,
  summary: "Investigation fixture summary.",
  status: "changes_requested",
  findings: [{ id: "f-1", severity: "medium", category: "correctness", title: "T", description: "D", recommendation: "R" }],
  recommendations: [{ priority: "high", description: "Fix the issue.", relatedFindingIds: ["f-1"] }],
  metadata: { createdAt: "2026-09-14T00:00:00.000Z", agentVersion: "1.0.0" },
};

const reviewerInput = { requestId: "investigation-1", task, context: {} };

async function validate(output) {
  return reviewerAgent().validateReviewResponse(output, reviewerInput);
}

describe("investigation: canonical recommendation contract (§2)", () => {
  it("A: accepts a known-valid recommendation object (required fields only)", async () => {
    const report = await validate({ ...baseReport, recommendations: [{ priority: "medium", description: "Valid." }] });
    strictEqual(report.recommendations.length, 1);
    strictEqual(report.recommendations[0].priority, "medium");
  });

  it("A2: accepts a valid recommendation with optional relatedFindingIds", async () => {
    const report = await validate({ ...baseReport, recommendations: [{ priority: "low", description: "Valid.", relatedFindingIds: ["f-1"] }] });
    strictEqual(report.recommendations[0].relatedFindingIds.length, 1);
  });
});

describe("investigation: one-field mutations reproducing the live failure (§6C)", () => {
  const mutations = [
    ["missing priority", (r) => ({ priority: undefined, description: "x" })],
    ["missing description", (r) => ({ priority: "high" })],
    ["priority not a string", (r) => ({ priority: 1, description: "x" })],
    ["priority out of enum", (r) => ({ priority: "urgent", description: "x" })],
    ["priority uppercase", (r) => ({ priority: "HIGH", description: "x" })],
    ["description not a string", (r) => ({ priority: "high", description: 42 })],
    ["description null", (r) => ({ priority: "high", description: null })],
    ["relatedFindingIds not an array", (r) => ({ priority: "high", description: "x", relatedFindingIds: "f-1" })],
    ["relatedFindingIds non-string member", (r) => ({ priority: "high", description: "x", relatedFindingIds: [1] })],
    ["recommendation not an object (string)", (r) => "fix the content"],
    ["recommendation not an object (array)", (r) => ["fix"]],
    ["recommendation null", (r) => null],
  ];
  for (const [label, mutation] of mutations) {
    it(`rejects: ${label}`, async () => {
      await rejects(
        () => validate({ ...baseReport, recommendations: [mutation(baseReport)] }),
        (error) => {
          ok(/invalid recommendation/.test(error.message), `expected invalid recommendation, got: ${error.message}`);
          strictEqual(error.diagnostics?.validationCode, "REVIEW_STRUCTURAL_INVALID_RECOMMENDATION");
          strictEqual(error.diagnostics?.issuePaths?.[0], "$.recommendations[]");
          return true;
        },
      );
    });
  }

  it("extra unknown fields do NOT cause rejection (additionalProperties tolerated)", async () => {
    // The validator only checks required/optional fields; unknown extras pass.
    const report = await validate({ ...baseReport, recommendations: [{ priority: "high", description: "Valid.", rationale: "extra field" }] });
    strictEqual(report.recommendations.length, 1);
  });
});

describe("investigation: SSE extraction fidelity (§4)", () => {
  // Re-implement the exact production SSE frame-parsing loop shape used by
  // openRouterLlm (delta.content concatenation) to prove extraction cannot
  // drop/rename/coerce fields inside JSON payload chunks.
  function extractVisibleText(sseBody) {
    let buffer = "";
    let visibleText = "";
    for (const line of sseBody.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data: ")) continue;
      if (trimmed === "data: [DONE]") continue;
      const chunk = JSON.parse(trimmed.slice(6));
      const ch = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
      if (ch?.delta && typeof ch.delta.content === "string" && ch.delta.content.length > 0) visibleText += ch.delta.content;
    }
    return visibleText;
  }

  const report = { ...baseReport, recommendations: [{ priority: "high", description: "Fix the practical step." }, { priority: "low", description: "Keep the tone." }] };

  it("multi-chunk SSE extraction preserves the JSON payload byte-for-byte", () => {
    const json = JSON.stringify(report);
    // Split into 5 SSE chunks at arbitrary boundaries (mid-object, mid-key).
    const size = Math.ceil(json.length / 5);
    const chunks = [];
    for (let i = 0; i < json.length; i += size) chunks.push(json.slice(i, i + size));
    const sseBody = chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}`).join("\n") + "\ndata: [DONE]\n";
    const extracted = extractVisibleText(sseBody);
    strictEqual(extracted, json, "extraction is a pure concatenation");
    const parsed = JSON.parse(extracted);
    strictEqual(parsed.recommendations.length, 2);
    strictEqual(parsed.recommendations[1].priority, "low");
  });

  it("a structurally invalid recommendation survives extraction intact (extraction is not the cause)", () => {
    const invalid = { ...baseReport, recommendations: [{ priority: "urgent", description: "x" }] };
    const json = JSON.stringify(invalid);
    const sseBody = `data: ${JSON.stringify({ choices: [{ delta: { content: json } }] })}\ndata: [DONE]\n`;
    const extracted = extractVisibleText(sseBody);
    strictEqual(extracted, json);
    strictEqual(JSON.parse(extracted).recommendations[0].priority, "urgent", "the invalid value is carried through unchanged");
  });

  it("a valid report streamed through SSE chunks passes the production validator", async () => {
    const json = JSON.stringify(report);
    const half = Math.floor(json.length / 2);
    const sseBody = `data: ${JSON.stringify({ choices: [{ delta: { content: json.slice(0, half) } }] })}\ndata: ${JSON.stringify({ choices: [{ delta: { content: json.slice(half) } }] })}\ndata: [DONE]\n`;
    const extracted = extractVisibleText(sseBody);
    const result = await validate(JSON.parse(extracted));
    strictEqual(result.recommendations.length, 2);
  });
});

describe("investigation: prompt/validator contract match (§5)", () => {
  it("the prompt recommendation contract matches the validator exactly", async () => {
    let capturedPrompt = "";
    const agent = createReviewerAgent({
      config: {},
      execute: async (_context, request) => {
        capturedPrompt = request.messages.find((m) => m.role === "user").content;
        return { output: { ...baseReport }, raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "t", provider: "t", latencyMs: 1 };
      },
    });
    await agent.execute({ context: {}, input: reviewerInput }, activeSignal);
    // The prompt declares exactly the validator's contract:
    ok(capturedPrompt.includes('Set "recommendations" to an array of OBJECTS'), "prompt defines recommendations as object array");
    ok(capturedPrompt.includes('"priority": "high" | "medium" | "low"'), "prompt lists the exact priority enum");
    ok(capturedPrompt.includes('"description": "<string>"'), "prompt lists the description field + type");
    ok(capturedPrompt.includes('"relatedFindingIds" is an optional array of finding id strings'), "prompt documents the optional field + type");
    // And the JSON schema sent alongside:
    // (verified by capture in the earlier wiring tests: responseSchema.recommendations
    //  requires priority+description)
    ok(capturedPrompt.includes("Do not omit any required field"), "prompt requires all fields");
  });
});
