/** Unit tests for ResearchAgent. */

import { describe, it } from "node:test";
import { ok, rejects, strictEqual } from "node:assert";
import { createResearchAgent, diagnoseResearchStructure } from "../dist/index.js";

const task = {
  id: "research-1",
  name: "Research TypeScript",
  description: "Research TypeScript",
  agent: "research",
  inputSchema: {},
  outputSchema: {},
  dependencies: [],
};

function createAgent(overrides = {}) {
  return createResearchAgent({
    config: {},
    execute: async () => ({
      output: {
        reportId: "00000000-0000-4000-8000-000000000000",
        taskDescription: task.description,
        summary: "Typed JavaScript.",
        sources: [{ id: 1, title: "TypeScript", url: "https://www.typescriptlang.org/", snippet: "Official documentation." }],
        confidence: 0.9,
        citations: [{ sourceId: 1, text: "Official documentation." }],
        metadata: { createdAt: "2026-08-06T00:00:00.000Z", agentVersion: "1.0.0" },
      },
      raw: "{}",
      usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
      model: "test-model",
      provider: "test",
      latencyMs: 1,
    }),
    ...overrides,
  });
}

const activeSignal = {
  isCancelled: false,
  onCancelled() {},
  throwIfCancelled() {},
};

const strategyTask = { ...task, description: "V2 PRE_PUBLICATION_STRATEGY research for fixture." };
const strategyFinding = { label: "Observed pattern", rationale: "A bounded evidence-based finding.", certainty: "OBSERVED" };
function validStrategyFindings() {
  return {
    referencePatterns: [strategyFinding], audienceOpportunities: [strategyFinding], contentTerritories: [strategyFinding],
    differentiationOpportunities: [strategyFinding], productionImplications: [strategyFinding], risks: [strategyFinding], assumptions: [strategyFinding], unknowns: [strategyFinding],
    platformFindings: ["Instagram Reels", "YouTube Shorts", "TikTok"].map((platform) => ({ ...strategyFinding, platform })),
  };
}
function validStrategyOutput(overrides = {}) {
  return {
    reportId: "00000000-0000-4000-8000-000000000000", taskDescription: strategyTask.description,
    summary: "Compact evidence-based strategy research.", sources: [{ id: 1, title: "Evidence one", url: "https://example.test/evidence-one", snippet: "Evidence one." }, { id: 2, title: "Evidence two", url: "https://example.test/evidence-two", snippet: "Evidence two." }], confidence: 0.8,
    citations: [{ sourceId: 1, text: "Evidence one." }, { sourceId: 2, text: "Evidence two." }], metadata: { createdAt: "2026-08-06T00:00:00.000Z", agentVersion: "1.0.0" }, strategyFindings: validStrategyFindings(), ...overrides,
  };
}

describe("ResearchAgent", () => {
  it("embeds normalized source-router intelligence for downstream artifacts", async () => {
    const agent = createAgent({ sourceRouter: { execute: async () => ({ mode: "CONTENT_DISCOVERY", sources: [], keyFacts: [], unknowns: [], limitations: ["fixture"], confidence: "UNKNOWN", trendVerdict: "NOT_EVALUATED" }) } });
    const result = await agent.execute({ context: {}, input: { task, researchRequest: { mode: "CONTENT_DISCOVERY", topic: "Egypt travel", platforms: ["INSTAGRAM"] } } }, activeSignal);
    strictEqual(result.output.intelligence.mode, "CONTENT_DISCOVERY");
    strictEqual(result.output.intelligence.trendVerdict, "NOT_EVALUATED");
  });

  it("normalizes a runtime research response", async () => {
    let receivedRequest;
    const agent = createAgent({
      execute: async (_context, request) => {
        receivedRequest = request;
        return {
          output: {
            reportId: "00000000-0000-4000-8000-000000000000",
            taskDescription: task.description,
            summary: "Typed JavaScript.",
            sources: [{ id: 1, title: "TypeScript", url: "https://www.typescriptlang.org/", snippet: "Official documentation." }],
            confidence: 0.9,
            citations: [{ sourceId: 1, text: "Official documentation." }],
            metadata: { createdAt: "2026-08-06T00:00:00.000Z", agentVersion: "1.0.0" },
          },
          raw: "{}",
          usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
          model: "test-model",
          provider: "test",
          latencyMs: 1,
        };
      },
    });
    const result = await agent.execute({ context: {}, input: { task } }, activeSignal);

    strictEqual(result.response.model, "test-model");
    strictEqual(result.output.taskDescription, task.description);
    ok(Array.isArray(result.output.sources));
    strictEqual(receivedRequest.model, "openrouter/auto");
  });

  it("rejects citations that do not reference a source", async () => {
    const agent = createAgent({
      execute: async () => ({
        output: {
          reportId: "00000000-0000-4000-8000-000000000000",
          taskDescription: task.description,
          summary: "Typed JavaScript.",
          sources: [],
          confidence: 0.9,
          citations: [{ sourceId: 2, text: "Unknown source." }],
          metadata: { createdAt: "2026-08-06T00:00:00.000Z", agentVersion: "1.0.0" },
        },
        raw: "{}",
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
        model: "test-model",
        provider: "test",
        latencyMs: 1,
      }),
    });

    await rejects(
      () => agent.execute({ context: {}, input: { task } }, activeSignal),
      /unknown source/
    );
  });

  it("accepts compact, bounded strategy findings", async () => {
    const agent = createAgent({ execute: async () => ({ output: validStrategyOutput(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test-model", provider: "test", latencyMs: 1 }) });
    const result = await agent.execute({ context: {}, input: { task: strategyTask, strategyMode: "PRE_PUBLICATION_STRATEGY", strategyEvidence: {} } as any }, activeSignal);
    strictEqual(result.output.strategyFindings.platformFindings.length, 3);
  });

  it("rejects structurally valid but semantically empty strategy findings", async () => {
    const findings = validStrategyFindings(); findings.risks = [];
    const agent = createAgent({ execute: async () => ({ output: validStrategyOutput({ strategyFindings: findings }), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test-model", provider: "test", latencyMs: 1 }) });
    await rejects(() => agent.execute({ context: {}, input: { task: strategyTask, strategyMode: "PRE_PUBLICATION_STRATEGY", strategyEvidence: {} } as any }, activeSignal), /invalid report structure/);
  });

  it("rejects strategy findings that exceed their bounded field constraints", async () => {
    const findings = validStrategyFindings(); findings.referencePatterns = Array.from({ length: 6 }, () => strategyFinding);
    const agent = createAgent({ execute: async () => ({ output: validStrategyOutput({ strategyFindings: findings }), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test-model", provider: "test", latencyMs: 1 }) });
    await rejects(() => agent.execute({ context: {}, input: { task: strategyTask, strategyMode: "PRE_PUBLICATION_STRATEGY", strategyEvidence: {} } as any }, activeSignal), /invalid report structure/);
  });

  it("emits bounded, value-free structural diagnostics for representative strategy failures", () => {
    const input = { task: strategyTask, strategyMode: "PRE_PUBLICATION_STRATEGY", strategyEvidence: {} } as any;
    const missing = diagnoseResearchStructure(validStrategyOutput({ summary: undefined }), input);
    ok(missing.issues.some((issue) => issue.path === "summary" && issue.code === "missing_required"));
    const wrongType = diagnoseResearchStructure(validStrategyOutput({ confidence: "high" }), input);
    ok(wrongType.issues.some((issue) => issue.path === "confidence" && issue.code === "wrong_type"));
    const absentCategory = validStrategyOutput(); delete absentCategory.strategyFindings.risks;
    ok(diagnoseResearchStructure(absentCategory, input).issues.some((issue) => issue.path === "strategyFindings.risks"));
    const tooMany = validStrategyOutput(); tooMany.strategyFindings.referencePatterns = Array.from({ length: 6 }, () => strategyFinding);
    ok(diagnoseResearchStructure(tooMany, input).issues.some((issue) => issue.path === "strategyFindings.referencePatterns" && issue.code === "too_large"));
    const tooFewPlatforms = validStrategyOutput(); tooFewPlatforms.strategyFindings.platformFindings = [];
    ok(diagnoseResearchStructure(tooFewPlatforms, input).issues.some((issue) => issue.path === "strategyFindings.platformFindings" && issue.code === "too_small"));
    const invalidEnum = validStrategyOutput(); invalidEnum.strategyFindings.risks = [{ ...strategyFinding, certainty: "FACT" }];
    const enumDiagnostic = diagnoseResearchStructure(invalidEnum, input);
    ok(enumDiagnostic.issues.some((issue) => issue.path.endsWith("certainty") && issue.code === "invalid_enum"));
    strictEqual(JSON.stringify(enumDiagnostic).includes("Compact evidence-based"), false);
  });
});
