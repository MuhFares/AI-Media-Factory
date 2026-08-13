import { describe, it } from "node:test";
import { strictEqual, ok, rejects, deepStrictEqual } from "node:assert";
import { readFile } from "node:fs/promises";
import { createBrandAgent } from "../dist/index.js";

const SIGNAL = { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} };

const seoHandoff = {
  artifactId: "artifact-seo-1",
  kind: "seo_report",
  payload: {
    reportId: "00000000-0000-4000-8000-0000000000S1",
    taskDescription: "Optimize the article",
    objective: "Optimize the article",
    optimizedTitle: "Build Scalable Media Pipelines",
    optimizedDescription: "A practical guide.",
    keywords: [{ keyword: "media pipeline", importance: "primary" }],
    topics: [{ topic: "scalability", presentInContent: true }],
    searchIntent: "informational",
    contentStructure: [{ heading: "Introduction", purpose: "Hook" }],
    sourceReferences: [{ sourceId: 1, title: "Pipeline Guide", url: "https://example.com/guide" }],
    status: "completed",
    metadata: { writerArtifactId: "artifact-writer-1" },
  },
};

function brandJson(overrides = {}) {
  return {
    reportId: "00000000-0000-4000-8000-0000000000B1",
    taskDescription: "Optimize the article",
    objective: "Gate the article for brand",
    status: "approved",
    issues: [],
    passedChecks: [{ code: "brand.tonality", message: "Matches provided guidelines" }],
    failedChecks: [],
    recommendations: [{ priority: "low", description: "Optional polish" }],
    metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0", seoArtifactId: "artifact-seo-1" },
    ...overrides,
  };
}

function build(executeOutput) {
  return createBrandAgent({
    config: {},
    execute: async () => ({ output: executeOutput, raw: "{}", usage: { inputTokens: 2, outputTokens: 2, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }),
  });
}

const input = (seo = seoHandoff) => ({ context: {}, input: { objective: "Gate the article for brand", previousArtifact: seo, brandConfig: "Use an approachable, factual tone." } });

describe("BrandGateAgent — production quality gate contract", () => {
  it("1 — valid approved content yields an approved brand review", async () => {
    const agent = build(brandJson());
    const result = await agent.execute(input(), SIGNAL);
    strictEqual(result.output.status, "approved");
    strictEqual(result.output.passedChecks.length, 1);
    strictEqual(result.output.failedChecks.length, 0);
    strictEqual(result.output.metadata.seoArtifactId, "artifact-seo-1");
    strictEqual(result.output.capabilityExecutions, undefined);
  });

  it("2 — needs_revision content is reported truthfully with failed checks", async () => {
    const agent = build(brandJson({ status: "needs_revision", issues: [{ code: "brand.tone", message: "Adjust tone" }], passedChecks: [], failedChecks: [{ code: "brand.tonality", message: "Does not match guidance" }] }));
    const result = await agent.execute(input(), SIGNAL);
    strictEqual(result.output.status, "needs_revision");
    strictEqual(result.output.failedChecks.length, 1);
    strictEqual(result.output.issues.length, 1);
  });

  it("3 — rejected content is reported truthfully", async () => {
    const agent = build(brandJson({ status: "rejected", issues: [{ code: "brand.accuracy", message: "Misrepresents brand" }], passedChecks: [], failedChecks: [{ code: "brand.accuracy", message: "Misrepresents brand" }], recommendations: [] }));
    const result = await agent.execute(input(), SIGNAL);
    strictEqual(result.output.status, "rejected");
    strictEqual(result.output.failedChecks.length, 1);
  });

  it("4 — missing SEO artifact is a controlled failure", async () => {
    const agent = build(brandJson());
    await rejects(() => agent.execute({ context: {}, input: { objective: "Gate" } }, SIGNAL), /requires an SEO artifact/);
  });

  it("4b — wrong artifact kind is rejected", async () => {
    const agent = build(brandJson());
    const wrongKind = { ...seoHandoff, kind: "writer_report" };
    await rejects(() => agent.execute(input(wrongKind), SIGNAL), /seo_report/);
  });

  it("4c — malformed SEO artifact is rejected", async () => {
    const agent = build(brandJson());
    const malformed = { ...seoHandoff, payload: { reportId: "x", optimizedTitle: "t" } };
    await rejects(() => agent.execute(input(malformed), SIGNAL), /malformed SEO artifact/);
  });

  it("4d — SEO artifact without writer lineage is rejected", async () => {
    const agent = build(brandJson());
    const noLineage = { ...seoHandoff, payload: { ...seoHandoff.payload, metadata: { seoArtifactId: "x", writerArtifactId: "", createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0" } } };
    await rejects(() => agent.execute(input(noLineage), SIGNAL), /writer lineage/);
  });

  it("5 — truthful status cross-checks: approved cannot contain failed checks", async () => {
    const agent = build(brandJson({ status: "approved", failedChecks: [{ code: "x", message: "failed" }] }));
    await rejects(() => agent.execute(input(), SIGNAL), /approved gate cannot contain failed checks/);
  });

  it("5b — approved gate must record passed checks", async () => {
    const agent = build(brandJson({ passedChecks: [] }));
    await rejects(() => agent.execute(input(), SIGNAL), /must record passed checks/);
  });

  it("5c — non-approved gate must record failed checks", async () => {
    const agent = build(brandJson({ status: "rejected", issues: [], passedChecks: [], failedChecks: [], recommendations: [] }));
    await rejects(() => agent.execute(input(), SIGNAL), /must record failed checks/);
  });

  it("5d — report must reference the handoff SEO artifact id", async () => {
    const agent = build(brandJson({ metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0", seoArtifactId: "artifact-other" } }));
    await rejects(() => agent.execute(input(), SIGNAL), /does not match the handoff/);
  });

  it("6 — deterministic: identical input yields identical report", async () => {
    const agent = build(brandJson());
    const a = await agent.execute(input(), SIGNAL);
    const b = await agent.execute(input(), SIGNAL);
    deepStrictEqual(a.output, b.output);
  });

  it("— no fabricated capability evidence", async () => {
    const agent = build(brandJson());
    const result = await agent.execute(input(), SIGNAL);
    ok(!("capabilityExecutions" in result.output));
    ok(!("evidence" in result.output));
  });

  it("— no direct fs/process/network/provider imports in production source", async () => {
    const root = new URL("..", import.meta.url);
    for (const name of ["src/brand-agent.ts", "src/types.ts", "src/index.ts"]) {
      const source = await readFile(new URL(name, root), "utf8");
      for (const forbidden of ["node:fs", "child_process", "axios", "undici", "node-fetch", "http", "providers"]) {
        ok(!source.includes(forbidden), `${name} must not import ${forbidden}`);
      }
    }
  });
});