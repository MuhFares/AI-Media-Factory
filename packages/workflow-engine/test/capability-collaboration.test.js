/** Real capability layer through the Runtime boundary in the Sprint 7 collaboration flow. */
import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RuntimeCapabilityExecutor } from "@ai-media-factory/runtime";
import {
  FilesystemCapabilityExecutor,
  FILESYSTEM_CAPABILITY_ID,
  CommandCapabilityExecutor,
  COMMAND_CAPABILITY_ID,
  WebSearchCapabilityExecutor,
  WEB_SEARCH_CAPABILITY_ID,
} from "@ai-media-factory/tool-framework";
import { createResearchAgent } from "@ai-media-factory/research-agent";
import { createCodingAgent } from "@ai-media-factory/coding-agent";
import { createQAAgent } from "@ai-media-factory/qa-agent";
import { CollaborationRunner } from "../dist/index.js";

const workflowId = "workflow-1";
const correlationId = "correlation-1";
const context = { workflowId, correlationId, brandId: null, outputs: {}, data: { objective: "Improve the media pipeline" } };

const researchTask = { id: "research-cap-1", name: "Research media pipeline", description: "Research modern media pipelines", agent: "research", inputSchema: {}, outputSchema: {}, dependencies: [] };
const codingTask = { id: "coding-cap-1", name: "Write a module", description: "Create a user module", agent: "coding", inputSchema: {}, outputSchema: {}, dependencies: [] };

function codingReport() {
  return {
    resultId: "00000000-0000-4000-8000-000000000002",
    taskDescription: codingTask.description,
    status: "completed",
    summary: "Created the user module file and verified the build.",
    actions: [{ id: "a-1", type: "create_file", description: "Create module", filePath: "src/user.ts", status: "completed", output: "File created" }],
    affectedFiles: [{ path: "src/user.ts", changeType: "created", description: "Created module" }],
    errors: [],
    recommendedTests: [],
    confidence: 0.9,
    metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0" },
  };
}

function qaReport(objective) {
  return {
    reportId: "00000000-0000-4000-8000-000000000003",
    requestId: "00000000-0000-4000-8000-000000000004",
    objective,
    status: "passed",
    summary: "Runtime evidence confirms the build test passed.",
    testResults: [{ testName: "node --version", status: "passed", executed: true, source: "runtime", evidence: "v20" }],
    findings: [],
    risks: [],
    recommendations: [],
    metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0", executionEvidencePresent: true },
  };
}

function buildBoundary(root) {
  const fsExecutor = new FilesystemCapabilityExecutor({
    allowedRoots: [root],
    allowedOperations: ["read", "write", "create", "modify", "delete"],
    maxFileSizeBytes: 1_000_000,
  });
  const commandExecutor = new CommandCapabilityExecutor({
    allowedCommands: [{ command: "node", args: ["--version"] }],
    allowedWorkingDirectoryRoots: [root],
    timeoutMs: 5000,
    maxStdoutBytes: 1024,
    maxStderrBytes: 1024,
    environment: { inherit: false, allowedKeys: [] },
  });
  const descriptors = {
    [FILESYSTEM_CAPABILITY_ID]: { capabilityId: FILESYSTEM_CAPABILITY_ID, description: "Filesystem", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
    [COMMAND_CAPABILITY_ID]: { capabilityId: COMMAND_CAPABILITY_ID, description: "Command", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
    [WEB_SEARCH_CAPABILITY_ID]: { capabilityId: WEB_SEARCH_CAPABILITY_ID, description: "Web search", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
  };
  const localResolver = { resolve: (id) => descriptors[id] ?? null, isAuthorized: () => true };
  const webExecutor = new WebSearchCapabilityExecutor(
    { search: async () => ({ providerId: "fake-provider", results: [{ title: "Media Pipeline", url: "https://example.com/pipeline", snippet: "A modern media pipeline", source: "example", rank: 1 }] }) },
    localResolver,
    { maxResults: 5, maxQueryLength: 200 },
  );
  const executor = {
    execute: (request) => {
      if (request.capabilityId === FILESYSTEM_CAPABILITY_ID) return fsExecutor.execute(request);
      if (request.capabilityId === COMMAND_CAPABILITY_ID) return commandExecutor.execute(request);
      if (request.capabilityId === WEB_SEARCH_CAPABILITY_ID) return webExecutor.execute(request);
      return { status: "blocked", resultId: `blocked-${request.requestId}`, capabilityId: request.capabilityId, reason: "Unknown capability" };
    },
  };
  return new RuntimeCapabilityExecutor({ resolver: localResolver, executor });
}

function makeRunners(root) {
  const boundary = buildBoundary(root);
  const signal = { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} };
  const researchAgent = createResearchAgent({
    config: {},
    execute: async () => ({
      output: {
        reportId: "00000000-0000-4000-8000-000000000001",
        taskDescription: researchTask.description,
        summary: "Researched media pipelines via a real web search.",
        sources: [{ id: 1, title: "Example", url: "https://example.com", snippet: "snippet" }],
        confidence: 0.8,
        citations: [{ sourceId: 1, text: "text" }],
        metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0" },
      },
      raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1,
    }),
    capabilityExecution: boundary,
  });
  const codingAgent = createCodingAgent({
    config: {},
    execute: async () => ({ output: codingReport(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }),
    capabilityExecution: boundary,
  });
  const qaAgent = createQAAgent({
    config: {},
    execute: async (context, executionRequest) => {
      const objective = executionRequest.messages[1].content.includes("Improve the media pipeline") ? "Improve the media pipeline" : "Validate workflow quality";
      return { output: qaReport(objective), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 };
    },
    capabilityExecution: boundary,
  });

  function artifact(step, ctx, kind, artifactId, payload) {
    const previous = ctx.data.previousArtifact;
    return {
      artifactId,
      kind,
      producerAgent: step.agent,
      workflowId: ctx.workflowId,
      correlationId: ctx.correlationId,
      status: "completed",
      payload,
      contentType: "application/json",
      schemaVersion: "1.0",
      createdAt: "2026-08-11T00:00:00.000Z",
      ...(previous ? { parentArtifact: { artifactId: previous.artifactId, kind: previous.kind } } : {}),
    };
  }

  const executor = {
    executeAgentStep: async (step, ctx) => {
      if (step.agent === "research") {
        const result = await researchAgent.execute({
          context: {},
          input: {
            task: researchTask,
            capabilityRequests: [{ requestId: "cap-research", capabilityId: WEB_SEARCH_CAPABILITY_ID, agentId: "research", workflowId: ctx.workflowId, correlationId: ctx.correlationId, input: { query: "media pipeline", maxResults: 3 }, requestedAt: "2026-08-11T00:00:00.000Z" }],
          },
        }, signal);
        return { status: "completed", artifact: artifact(step, ctx, "research_report", result.output.reportId, result.output) };
      }
      if (step.agent === "coding") {
        const result = await codingAgent.execute({
          context: {},
          input: {
            task: codingTask,
            capabilityRequests: [{ requestId: "cap-coding", capabilityId: FILESYSTEM_CAPABILITY_ID, agentId: "coding", workflowId: ctx.workflowId, correlationId: ctx.correlationId, input: { operation: "create", path: join(root, "user.ts"), content: "export const user = {};\n" }, requestedAt: "2026-08-11T00:00:00.000Z" }],
          },
        }, signal);
        return { status: "completed", artifact: artifact(step, ctx, "coding_report", result.output.resultId, result.output) };
      }
      if (step.agent === "qa") {
        const result = await qaAgent.execute({
          context: {},
          input: {
            requestId: "00000000-0000-4000-8000-000000000004",
            objective: "Improve the media pipeline",
            request: { scope: "workflow", requirements: ["build succeeds"], expectedTests: ["node --version"] },
            capabilityRequests: [{ requestId: "cap-qa", capabilityId: COMMAND_CAPABILITY_ID, agentId: "qa", workflowId: ctx.workflowId, correlationId: ctx.correlationId, input: { command: "node", args: ["--version"], cwd: root }, requestedAt: "2026-08-11T00:00:00.000Z" }],
          },
        }, signal);
        return { status: "completed", artifact: artifact(step, ctx, "qa_report", result.output.reportId, result.output) };
      }
      if (step.agent === "reviewer") {
        const previous = ctx.data.previousArtifact;
        const codingEvidence = previous && previous.payload && Array.isArray(previous.payload.capabilityExecutions)
          ? previous.payload.capabilityExecutions.filter((execution) => execution.status === "success")
          : [];
        return {
          status: "completed",
          artifact: artifact(step, ctx, "review_report", "review-1", {
            reportId: "review-1",
            taskDescription: "Review coding",
            status: "approved",
            summary: "Review complete",
            findings: [],
            evidenceReceived: codingEvidence.length,
          }),
        };
      }
      return {
        status: "completed",
        artifact: artifact(step, ctx, "execution_plan", "plan-1", { planId: "plan-1", objective: ctx.data.objective, tasks: [] }),
      };
    },
  };
  return { executor, root };
}

const fullStages = [
  { step: { id: "step-planner", kind: "agent", agent: "planner", emits: "plan" }, artifactKind: "execution_plan" },
  { step: { id: "step-research", kind: "agent", agent: "research", emits: "research" }, artifactKind: "research_report" },
  { step: { id: "step-coding", kind: "agent", agent: "coding", emits: "coding" }, artifactKind: "coding_report" },
  { step: { id: "step-reviewer", kind: "agent", agent: "reviewer", emits: "review" }, artifactKind: "review_report" },
  { step: { id: "step-qa", kind: "agent", agent: "qa", emits: "qa" }, artifactKind: "qa_report" },
];

describe("capability-backed collaboration workflow", () => {
  it("runs Planner → Research → Coding → Reviewer → QA with real capability evidence flowing through artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "wf-cap-"));
    try {
      const { executor } = makeRunners(root);
      const result = await new CollaborationRunner(executor).run(fullStages, context);
      strictEqual(result.status, "completed");
      strictEqual(result.output.kind, "qa_report");

      const research = result.lineage.find((item) => item.kind === "research_report");
      const coding = result.lineage.find((item) => item.kind === "coding_report");
      const review = result.lineage.find((item) => item.kind === "review_report");
      const qa = result.lineage.find((item) => item.kind === "qa_report");

      ok(research && research.payload.capabilityExecutions?.[0]?.status === "success");
      strictEqual(research.payload.capabilityExecutions[0].evidence.agentId, "research");

      ok(coding && coding.payload.capabilityExecutions?.[0]?.status === "success");
      strictEqual(coding.payload.capabilityExecutions[0].evidence.capabilityId, FILESYSTEM_CAPABILITY_ID);
      strictEqual(coding.payload.capabilityExecutions[0].evidence.agentId, "coding");
      strictEqual(coding.payload.capabilityExecutions[0].evidence.workflowId, workflowId);
      strictEqual(coding.payload.capabilityExecutions[0].evidence.correlationId, correlationId);
      strictEqual(coding.payload.capabilityExecutions[0].evidence.succeeded, true);

      ok(review);
      strictEqual(review.payload.evidenceReceived, 1);

      ok(qa && qa.payload.capabilityExecutions?.[0]?.status === "success");
      strictEqual(qa.payload.capabilityExecutions[0].evidence.capabilityId, COMMAND_CAPABILITY_ID);
      strictEqual(qa.payload.capabilityExecutions[0].evidence.agentId, "qa");
      strictEqual(qa.payload.capabilityExecutions[0].evidence.succeeded, true);
      strictEqual(qa.payload.executionEvidencePresent, undefined);
      strictEqual(qa.payload.metadata.executionEvidencePresent, true);

      strictEqual(coding.parentArtifact.artifactId, research.artifactId);
      strictEqual(review.parentArtifact.artifactId, coding.artifactId);
      strictEqual(qa.parentArtifact.artifactId, review.artifactId);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not allow a BLOCKED capability to produce a successful downstream artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "wf-cap-"));
    try {
      const signal = { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} };
      const fsExecutor = new FilesystemCapabilityExecutor({
        allowedRoots: [root],
        allowedOperations: ["read", "write", "create", "modify", "delete"],
        maxFileSizeBytes: 1_000_000,
      });
      const descriptor = { capabilityId: FILESYSTEM_CAPABILITY_ID, description: "Filesystem", inputSchema: { type: "object" }, outputSchema: { type: "object" } };
      const codingAgent = createCodingAgent({
        config: {},
        execute: async () => ({ output: codingReport(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }),
        capabilityExecution: new RuntimeCapabilityExecutor({
          resolver: { resolve: () => descriptor, isAuthorized: () => false },
          executor: { execute: (r) => fsExecutor.execute(r) },
        }),
      });
      const runnerExecutor = {
        executeAgentStep: async (step, ctx) => {
          const previous = ctx.data.previousArtifact;
          const result = await codingAgent.execute({
            context: {},
            input: {
              task: codingTask,
              capabilityRequests: [{ requestId: "cap-coding", capabilityId: FILESYSTEM_CAPABILITY_ID, agentId: "coding", workflowId: ctx.workflowId, correlationId: ctx.correlationId, input: { operation: "create", path: join(root, "user.ts"), content: "x" }, requestedAt: "2026-08-11T00:00:00.000Z" }],
            },
          }, signal);
          return {
            status: "completed",
            artifact: {
              artifactId: result.output.resultId,
              kind: "coding_report",
              producerAgent: "coding",
              workflowId: ctx.workflowId,
              correlationId: ctx.correlationId,
              status: "completed",
              payload: result.output,
              contentType: "application/json",
              schemaVersion: "1.0",
              createdAt: "2026-08-11T00:00:00.000Z",
              ...(previous ? { parentArtifact: { artifactId: previous.artifactId, kind: previous.kind } } : {}),
            },
          };
        },
      };
      const stages = [{ step: { id: "step-coding", kind: "agent", agent: "coding", emits: "coding" }, artifactKind: "coding_report" }];
      const result = await new CollaborationRunner(runnerExecutor).run(stages, context);
      strictEqual(result.status, "completed");
      const coding = result.lineage[0];
      strictEqual(coding.payload.capabilityExecutions[0].status, "blocked");
      strictEqual(coding.payload.status, "blocked");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
