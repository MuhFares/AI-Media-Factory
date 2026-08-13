/** Unit tests for ReviewerAgent. */

import { describe, it } from "node:test";
import { ok, rejects, strictEqual } from "node:assert";
import { createReviewerAgent } from "../dist/index.js";

const task = {
  id: "review-1",
  name: "Review change",
  description: "Review the supplied service change",
  agent: "reviewer",
  inputSchema: {},
  outputSchema: {},
  dependencies: [],
};

const activeSignal = {
  isCancelled: false,
  onCancelled() {},
  throwIfCancelled() {},
};

function response(output: object) {
  return {
    output,
    raw: "{}",
    usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
    model: "test-model",
    provider: "test",
    latencyMs: 1,
  };
}

describe("ReviewerAgent", () => {
  it("normalizes runtime review findings", async () => {
    let receivedRequest;
    const agent = createReviewerAgent({
      config: {},
      execute: async (_context, request) => {
        receivedRequest = request;
        return response({
          reportId: "00000000-0000-4000-8000-000000000000",
          taskDescription: task.description,
          summary: "The change is safe with one follow-up.",
          status: "changes_requested",
          findings: [{ id: "f-1", severity: "medium", category: "correctness", title: "Missing validation", description: "Input validation is incomplete.", recommendation: "Validate the input before processing." }],
          recommendations: [{ priority: "high", description: "Add validation.", relatedFindingIds: ["f-1"] }],
          metadata: { createdAt: "2026-08-10T00:00:00.000Z", agentVersion: "1.0.0" },
        });
      },
    });

    const result = await agent.execute({ context: {}, input: { requestId: "request-1", task, context: { code: "return value;" } } }, activeSignal);

    strictEqual(result.response.model, "test-model");
    strictEqual(result.output.status, "changes_requested");
    strictEqual(result.output.findings[0].severity, "medium");
    ok(receivedRequest.responseSchema);
    ok(receivedRequest.messages[1].content.includes("return value;"));
  });

  it("rejects a response with missing findings", async () => {
    const agent = createReviewerAgent({
      config: {},
      execute: async () => response({
        reportId: "00000000-0000-4000-8000-000000000000",
        taskDescription: task.description,
        summary: "Missing findings",
        status: "blocked",
        recommendations: [],
        metadata: { createdAt: "2026-08-10T00:00:00.000Z", agentVersion: "1.0.0" },
      }),
    });

    await rejects(
      () => agent.execute({ context: {}, input: { requestId: "request-1", task } }, activeSignal),
      /Invalid review response: invalid report structure/
    );
  });

  it("accepts a response with empty findings", async () => {
    const agent = createReviewerAgent({
      config: {},
      execute: async () => response({
        reportId: "00000000-0000-4000-8000-000000000000",
        taskDescription: task.description,
        summary: "No findings identified.",
        status: "approved",
        findings: [],
        recommendations: [],
        metadata: { createdAt: "2026-08-10T00:00:00.000Z", agentVersion: "1.0.0" },
      }),
    });

    const result = await agent.execute({ context: {}, input: { requestId: "request-1", task } }, activeSignal);
    strictEqual(result.output.findings.length, 0);
  });

  it("rejects an invalid review status", async () => {
    const agent = createReviewerAgent({
      config: {},
      execute: async () => response({
        reportId: "00000000-0000-4000-8000-000000000000",
        taskDescription: task.description,
        summary: "Invalid status",
        status: "invalid",
        findings: [],
        recommendations: [],
        metadata: { createdAt: "2026-08-10T00:00:00.000Z", agentVersion: "1.0.0" },
      }),
    });

    await rejects(
      () => agent.execute({ context: {}, input: { requestId: "request-1", task } }, activeSignal),
      /Invalid review response: invalid report structure/
    );
  });

  it("rejects an invalid finding category", async () => {
    const agent = createReviewerAgent({
      config: {},
      execute: async () => response({
        reportId: "00000000-0000-4000-8000-000000000000",
        taskDescription: task.description,
        summary: "Invalid category",
        status: "changes_requested",
        findings: [{ id: "f-1", severity: "medium", category: "invalid", title: "Bad category", description: "Invalid category.", recommendation: "Fix category." }],
        recommendations: [],
        metadata: { createdAt: "2026-08-10T00:00:00.000Z", agentVersion: "1.0.0" },
      }),
    });

    await rejects(
      () => agent.execute({ context: {}, input: { requestId: "request-1", task } }, activeSignal),
      /Invalid review response: invalid finding/
    );
  });

  it("rejects malformed findings", async () => {
    const agent = createReviewerAgent({
      config: {},
      execute: async () => response({
        reportId: "00000000-0000-4000-8000-000000000000",
        taskDescription: task.description,
        summary: "Invalid finding",
        status: "changes_requested",
        findings: [{ id: "f-1", severity: "invalid", category: "correctness", title: "Bad", description: "Bad", recommendation: "Fix" }],
        recommendations: [],
        metadata: { createdAt: "2026-08-10T00:00:00.000Z", agentVersion: "1.0.0" },
      }),
    });

    await rejects(
      () => agent.execute({ context: {}, input: { requestId: "request-1", task } }, activeSignal),
      /Invalid review response: invalid finding/
    );
  });

  it("derives the review mode from the artifact kind", async () => {
    let mode;
    let sawPayload = false;
    const agent = createReviewerAgent({
      config: {},
      execute: async (_context, request) => {
        mode = /Review domain: (\w+)/.exec(request.messages[1].content)?.[1];
        sawPayload = request.messages[1].content.includes('"optimizedTitle"');
        return response({ ...validApproved(), status: "approved" });
      },
    });

    const result = await agent.execute(
      { context: {}, input: { requestId: "request-1", task, context: { artifact: { kind: "seo_report", artifactId: "seo-1", payload: { reportId: "r", optimizedTitle: "title", status: "completed" } } } } },
      activeSignal,
    );
    strictEqual(mode, "seo");
    strictEqual(sawPayload, true);
    strictEqual(result.output.status, "approved");
  });

  it("rejects an unsupported artifact kind", async () => {
    const agent = createReviewerAgent({
      config: {},
      execute: async () => response({ ...validApproved(), status: "approved" }),
    });

    await rejects(
      () => agent.execute(
        { context: {}, input: { requestId: "request-1", task, context: { artifact: { kind: "unknown_report", artifactId: "x", payload: { status: "completed" } } } } },
        activeSignal,
      ),
      /Invalid review input: unsupported artifact kind/
    );
  });

  it("reviews a valid writer_report and preserves the approved verdict", async () => {
    const agent = createReviewerAgent({
      config: {},
      execute: async () => response({ ...validApproved(), status: "approved" }),
    });

    const result = await agent.execute(
      { context: {}, input: { requestId: "request-1", task, context: { artifact: { kind: "writer_report", artifactId: "writer-1", payload: { contentId: "w", title: "T", content: "Body.", status: "completed" } } } } },
      activeSignal,
    );
    strictEqual(result.output.status, "approved");
    strictEqual(result.output.findings.length, 0);
  });

  it("does not approve an invalid writer_report (gate forces blocked)", async () => {
    const agent = createReviewerAgent({
      config: {},
      execute: async () => response({ ...validApproved(), status: "approved" }),
    });

    const result = await agent.execute(
      { context: {}, input: { requestId: "request-1", task, context: { artifact: { kind: "writer_report", artifactId: "writer-1", payload: { contentId: "w", status: "completed" } } } } },
      activeSignal,
    );
    strictEqual(result.output.status, "blocked");
    ok(result.output.findings.some((finding) => finding.title === "Artifact failed the review gate"));
  });

  it("reviews a valid seo_report", async () => {
    const agent = createReviewerAgent({
      config: {},
      execute: async () => response({ ...validApproved(), status: "approved" }),
    });

    const result = await agent.execute(
      { context: {}, input: { requestId: "request-1", task, context: { artifact: { kind: "seo_report", artifactId: "seo-1", payload: { reportId: "r", optimizedTitle: "T", status: "completed" } } } } },
      activeSignal,
    );
    strictEqual(result.output.status, "approved");
  });

  it("reviews an approved brand_report as approved", async () => {
    const agent = createReviewerAgent({
      config: {},
      execute: async () => response({ ...validApproved(), status: "approved" }),
    });

    const result = await agent.execute(
      { context: {}, input: { requestId: "request-1", task, context: { artifact: { kind: "brand_report", artifactId: "brand-1", payload: { reportId: "b", status: "approved", issues: [], passedChecks: [], failedChecks: [], recommendations: [] } } } } },
      activeSignal,
    );
    strictEqual(result.output.status, "approved");
  });

  it("keeps a brand rejection visible to the reviewer (gate forces blocked)", async () => {
    const agent = createReviewerAgent({
      config: {},
      execute: async () => response({ ...validApproved(), status: "approved" }),
    });

    const result = await agent.execute(
      { context: {}, input: { requestId: "request-1", task, context: { artifact: { kind: "brand_report", artifactId: "brand-1", payload: { reportId: "b", status: "rejected", issues: [{ code: "brand.tonality" }], passedChecks: [], failedChecks: [], recommendations: [] } } } } },
      activeSignal,
    );
    strictEqual(result.output.status, "blocked");
    ok(result.output.findings.some((finding) => finding.title === "Brand compliance gate rejected this artifact"));
  });

  it("rejects an invalid brand_report status", async () => {
    const agent = createReviewerAgent({
      config: {},
      execute: async () => response({ ...validApproved(), status: "approved" }),
    });

    const result = await agent.execute(
      { context: {}, input: { requestId: "request-1", task, context: { artifact: { kind: "brand_report", artifactId: "brand-1", payload: { reportId: "b", status: "weird", issues: [] } } } } },
      activeSignal,
    );
    strictEqual(result.output.status, "blocked");
  });

  it("derives the thumbnail review mode from the thumbnail_report kind", async () => {
    let mode;
    const agent = createReviewerAgent({
      config: {},
      execute: async (_context, request) => {
        mode = /Review domain: (\w+)/.exec(request.messages[1].content)?.[1];
        return response({ ...validApproved(), status: "approved" });
      },
    });

    const result = await agent.execute(
      { context: {}, input: { requestId: "request-1", task, context: { artifact: { kind: "thumbnail_report", artifactId: "thumb-1", payload: { reportId: "t", status: "completed", imageId: "img-1", imageUrl: "https://cdn.example.com/img-1.png", imageTitle: "T", providerId: "fake-image", executionEvidencePresent: true } } } } },
      activeSignal,
    );
    strictEqual(mode, "thumbnail");
    strictEqual(result.output.status, "approved");
  });

  it("does not approve a thumbnail_report lacking runtime evidence", async () => {
    const agent = createReviewerAgent({
      config: {},
      execute: async () => response({ ...validApproved(), status: "approved" }),
    });

    const result = await agent.execute(
      { context: {}, input: { requestId: "request-1", task, context: { artifact: { kind: "thumbnail_report", artifactId: "thumb-1", payload: { reportId: "t", status: "completed", imageId: "img-1", imageUrl: "https://cdn.example.com/img-1.png", executionEvidencePresent: false } } } } },
      activeSignal,
    );
    strictEqual(result.output.status, "blocked");
    ok(result.output.findings.some((finding) => finding.title === "Artifact failed the review gate"));
  });

  it("does not approve a thumbnail_report missing an image reference", async () => {
    const agent = createReviewerAgent({
      config: {},
      execute: async () => response({ ...validApproved(), status: "approved" }),
    });

    const result = await agent.execute(
      { context: {}, input: { requestId: "request-1", task, context: { artifact: { kind: "thumbnail_report", artifactId: "thumb-1", payload: { reportId: "t", status: "completed", imageId: "", imageUrl: "", executionEvidencePresent: true } } } } },
      activeSignal,
    );
    strictEqual(result.output.status, "blocked");
  });
});

function validApproved() {
  return {
    reportId: "00000000-0000-4000-8000-000000000000",
    taskDescription: task.description,
    summary: "Nothing to fix.",
    status: "approved",
    findings: [],
    recommendations: [],
    metadata: { createdAt: "2026-08-10T00:00:00.000Z", agentVersion: "1.0.0" },
  };
}
