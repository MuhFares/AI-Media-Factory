import { describe, it } from "node:test";
import { strictEqual, ok, rejects, deepStrictEqual } from "node:assert";
import { readFile } from "node:fs/promises";
import { createWriterAgent } from "../dist/index.js";

const SIGNAL = { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} };

const researchHandoff = {
  artifactId: "artifact-research-1",
  kind: "research_report",
  payload: {
    reportId: "00000000-0000-4000-8000-0000000000R1",
    taskDescription: "Research media pipelines",
    summary: "A summary of modern media pipelines.",
    sources: [
      { id: 1, title: "Source A", url: "https://example.com/a" },
      { id: 2, title: "Source B", url: "https://example.com/b" },
    ],
  },
};

function writerJson(overrides = {}) {
  return {
    contentId: "00000000-0000-4000-8000-0000000000W1",
    taskDescription: "Research media pipelines",
    objective: "Write an article about media pipelines",
    title: "Modern Media Pipelines",
    content: "Detailed content body.",
    summary: "A concise summary.",
    sourceReferences: [{ sourceId: 1, title: "Source A", url: "https://example.com/a" }],
    status: "completed",
    metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0", researchArtifactId: "artifact-research-1" },
    ...overrides,
  };
}

function build(executeOutput, overrides = {}) {
  return createWriterAgent({
    config: {},
    execute: async () => ({ output: executeOutput, raw: "{}", usage: { inputTokens: 2, outputTokens: 2, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }),
  });
}

const input = (research = researchHandoff, objective = "Write an article about media pipelines") => ({ context: {}, input: { objective, previousArtifact: research } });

describe("WriterAgent — production specialist contract", () => {
  it("1 — valid research handoff produces a completed, source-linked writer report", async () => {
    const agent = build(writerJson());
    const result = await agent.execute(input(), SIGNAL);
    strictEqual(result.output.status, "completed");
    strictEqual(result.output.contentId, "00000000-0000-4000-8000-0000000000W1");
    strictEqual(result.output.title, "Modern Media Pipelines");
    strictEqual(result.output.sourceReferences.length, 1);
    strictEqual(result.output.sourceReferences[0].sourceId, 1);
    strictEqual(result.output.metadata.researchArtifactId, "artifact-research-1");
    strictEqual(result.output.capabilityExecutions, undefined);
  });

  it("2 — missing research artifact is a controlled failure (never a success)", async () => {
    const agent = build(writerJson());
    await rejects(() => agent.execute({ context: {}, input: { objective: "Write something" } }, SIGNAL), /requires a research artifact/);
  });

  it("3a — non-research previous artifact is rejected", async () => {
    const agent = build(writerJson());
    const wrongKind = { ...researchHandoff, kind: "coding_report" };
    await rejects(() => agent.execute(input(wrongKind), SIGNAL), /research_report/);
  });

  it("3b — malformed research payload (missing sources) is rejected", async () => {
    const agent = build(writerJson());
    const malformed = { ...researchHandoff, payload: { reportId: "x", summary: "s" } };
    await rejects(() => agent.execute(input(malformed), SIGNAL), /malformed research artifact/);
  });

  it("4 — deterministic: identical input + model output yields identical report", async () => {
    const agent = build(writerJson());
    const a = await agent.execute(input(), SIGNAL);
    const b = await agent.execute(input(), SIGNAL);
    deepStrictEqual(a.output, b.output);
  });

  it("4b — a false source/fabricated reference is never accepted", async () => {
    const agent = build(writerJson({ sourceReferences: [{ sourceId: 99, title: "Invented", url: "https://example.com/fake" }] }));
    await rejects(() => agent.execute(input(), SIGNAL), /not present in the research report/);
  });

  it("4c — a mismatched source reference (title/url drift) is rejected", async () => {
    const agent = build(writerJson({ sourceReferences: [{ sourceId: 1, title: "Edited", url: "https://example.com/a" }] }));
    await rejects(() => agent.execute(input(), SIGNAL), /does not match the research report/);
  });

  it("4d — completed content must reference research sources when research provides them", async () => {
    const agent = build(writerJson({ sourceReferences: [] }));
    await rejects(() => agent.execute(input(), SIGNAL), /must reference research sources/);
  });

  it("4e — blocked status is preserved truthfully without fabricating success", async () => {
    const agent = build(writerJson({ status: "blocked", content: "insufficient research to write safely" }));
    const result = await agent.execute(input(), SIGNAL);
    strictEqual(result.output.status, "blocked");
  });

  it("6 — writer exposes no capability execution and fabricates no evidence", async () => {
    const agent = build(writerJson());
    const result = await agent.execute(input(), SIGNAL);
    ok(!("capabilityExecutions" in result.output));
    ok(!("evidence" in result.output));
  });

  it("7 — writer production source has no fs/process/network/provider imports", async () => {
    const root = new URL("..", import.meta.url);
    for (const name of ["src/writer-agent.ts", "src/types.ts", "src/index.ts"]) {
      const source = await readFile(new URL(name, root), "utf8");
      for (const forbidden of ["node:fs", "child_process", "axios", "undici", "node-fetch", "providers"]) {
        ok(!source.includes(forbidden), `${name} must not import ${forbidden}`);
      }
    }
  });
});