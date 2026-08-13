import { describe, it } from "node:test";
import { strictEqual, ok, rejects, deepStrictEqual } from "node:assert";
import { readFile } from "node:fs/promises";
import { createSEOAgent } from "../dist/index.js";

const SIGNAL = { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} };

const writerHandoff = {
  artifactId: "artifact-writer-1",
  kind: "writer_report",
  payload: {
    contentId: "00000000-0000-4000-8000-0000000000W1",
    taskDescription: "Write the media pipeline article",
    objective: "Write an article about media pipelines",
    title: "Modern Media Pipelines",
    content: "Event-driven pipelines enable scalable media production.",
    summary: "A grounded article.",
    sourceReferences: [
      { sourceId: 1, title: "Pipeline Guide", url: "https://example.com/guide" },
      { sourceId: 2, title: "Streaming Best Practices", url: "https://example.com/streaming" },
    ],
    status: "completed",
  },
};

function seoJson(overrides = {}) {
  return {
    reportId: "00000000-0000-4000-8000-0000000000S1",
    taskDescription: "Write the media pipeline article",
    objective: "Write an article about media pipelines",
    optimizedTitle: "Build Scalable Media Pipelines in 2026",
    optimizedDescription: "A practical guide to event-driven media pipelines.",
    keywords: [
      { keyword: "media pipeline", importance: "primary" },
      { keyword: "streaming", importance: "secondary" },
    ],
    topics: [
      { topic: "scalability", presentInContent: true },
      { topic: "event-driven", presentInContent: true },
    ],
    searchIntent: "informational",
    contentStructure: [
      { heading: "Introduction", purpose: "Hook the reader" },
      { heading: "Architecture", purpose: "Explain the pipeline" },
    ],
    sourceReferences: [{ sourceId: 1, title: "Pipeline Guide", url: "https://example.com/guide" }],
    status: "completed",
    metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0", writerArtifactId: "artifact-writer-1" },
    ...overrides,
  };
}

function build(executeOutput) {
  return createSEOAgent({
    config: {},
    execute: async () => ({ output: executeOutput, raw: "{}", usage: { inputTokens: 2, outputTokens: 2, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }),
  });
}

const input = (writer = writerHandoff, objective = "Write an article about media pipelines") => ({ context: {}, input: { objective, previousArtifact: writer } });

describe("SEOAgent — production specialist contract", () => {
  it("1/5 — valid writer handoff produces a completed SEO report", async () => {
    const agent = build(seoJson());
    const result = await agent.execute(input(), SIGNAL);
    strictEqual(result.output.status, "completed");
    strictEqual(result.output.reportId, "00000000-0000-4000-8000-0000000000S1");
    strictEqual(result.output.optimizedTitle, "Build Scalable Media Pipelines in 2026");
    strictEqual(result.output.searchIntent, "informational");
    strictEqual(result.output.keywords.length, 2);
    strictEqual(result.output.topics.length, 2);
    strictEqual(result.output.metadata.writerArtifactId, "artifact-writer-1");
    strictEqual(result.output.capabilityExecutions, undefined);
  });

  it("2 — missing writer artifact is a controlled failure", async () => {
    const agent = build(seoJson());
    await rejects(() => agent.execute({ context: {}, input: { objective: "Optimize" } }, SIGNAL), /requires a writer artifact/);
  });

  it("3 — wrong artifact kind is rejected", async () => {
    const agent = build(seoJson());
    const wrongKind = { ...writerHandoff, kind: "research_report" };
    await rejects(() => agent.execute(input(wrongKind), SIGNAL), /writer_report/);
  });

  it("4 — malformed writer payload is rejected", async () => {
    const agent = build(seoJson());
    const malformed = { ...writerHandoff, payload: { contentId: "x", title: "t" } };
    await rejects(() => agent.execute(input(malformed), SIGNAL), /malformed writer artifact/);
  });

  it("4b — completed report must include keywords, topics, and content structure", async () => {
    const agent = build(seoJson({ keywords: [] }));
    await rejects(() => agent.execute(input(), SIGNAL), /must include keywords/);
  });

  it("6 — source/reference traceability: fabrication and drift are rejected", async () => {
    const agent = build(seoJson({ sourceReferences: [{ sourceId: 99, title: "Invented", url: "https://example.com/fake" }] }));
    await rejects(() => agent.execute(input(), SIGNAL), /not present in the writer artifact/);
    const drift = build(seoJson({ sourceReferences: [{ sourceId: 1, title: "Edited", url: "https://example.com/guide" }] }));
    await rejects(() => drift.execute(input(), SIGNAL), /does not match the writer artifact/);
  });

  it("7 — truthful status handling: blocked is preserved without fabricating success", async () => {
    const agent = build(seoJson({ status: "blocked", optimizedTitle: "", contentStructure: [] }));
    const result = await agent.execute(input(), SIGNAL);
    strictEqual(result.output.status, "blocked");
  });

  it("7b — determinism: identical input yields identical report", async () => {
    const agent = build(seoJson());
    const a = await agent.execute(input(), SIGNAL);
    const b = await agent.execute(input(), SIGNAL);
    deepStrictEqual(a.output, b.output);
  });

  it("— no fabricated capability evidence", async () => {
    const agent = build(seoJson());
    const result = await agent.execute(input(), SIGNAL);
    ok(!("capabilityExecutions" in result.output));
    ok(!("evidence" in result.output));
  });

  it("— production source has no fs/process/web/http/provider imports", async () => {
    const root = new URL("..", import.meta.url);
    for (const name of ["src/seo-agent.ts", "src/types.ts", "src/index.ts"]) {
      const source = await readFile(new URL(name, root), "utf8");
      for (const forbidden of ["node:fs", "child_process", "axios", "undici", "node-fetch", "http", "providers"]) {
        ok(!source.includes(forbidden), `${name} must not import ${forbidden}`);
      }
    }
  });
});