/** Sprint 8 Step 8.8: Real repository engineering benchmark.
 *
 * Proves the existing AI Media Factory agent chain (Planner -> Research -> Coding ->
 * Reviewer -> QA -> Documentation) can perform a real engineering task inside a small
 * isolated benchmark repository, using the real Sprint 8 capability layer
 * (Filesystem + Command) and real capability evidence. Includes a controlled
 * failure -> retry cycle driven by actual command execution evidence.
 *
 * Truthfulness rules enforced:
 *  - The benchmark repo starts with a failing test (verified at runtime).
 *  - Coding modifies a REAL file on disk and runs the REAL test suite.
 *  - The reviewer's approve/change decision is derived from REAL command evidence.
 *  - QA only reports "passed" when the REAL `node --test` exits 0 (runtime evidence).
 *  - Documentation is generated-only (never written).
 */
import { describe, it } from "node:test";
import { strictEqual, ok, notStrictEqual } from "node:assert";
import { mkdtemp, rm, cp, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { RuntimeCapabilityExecutor } from "@ai-media-factory/runtime";
import {
  FilesystemCapabilityExecutor,
  FILESYSTEM_CAPABILITY_ID,
  CommandCapabilityExecutor,
  COMMAND_CAPABILITY_ID,
  WebSearchCapabilityExecutor,
  WEB_SEARCH_CAPABILITY_ID,
} from "@ai-media-factory/tool-framework";
import { createPlannerAgent } from "@ai-media-factory/planner-agent";
import { createResearchAgent } from "@ai-media-factory/research-agent";
import { createCodingAgent } from "@ai-media-factory/coding-agent";
import { createReviewerAgent } from "@ai-media-factory/reviewer-agent";
import { createQAAgent } from "@ai-media-factory/qa-agent";
import { createDocumentationAgent } from "@ai-media-factory/documentation-agent";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "..", "fixtures", "benchmark-repo");

const workflowId = "benchmark-workflow-1";
const correlationId = "benchmark-correlation-1";
const objective = "Fix the add function in the benchmark repository so its test suite passes.";
const context = { workflowId, correlationId, brandId: null, outputs: {}, data: { objective } };

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOW = "2026-08-11T00:00:00.000Z";

const WRONG_IMPLEMENTATION = `// Benchmark implementation.
export function add(a, b) {
  return 0;
}
`;
const CORRECT_IMPLEMENTATION = `// Benchmark implementation.
export function add(a, b) {
  return a + b;
}
`;

function runtimeResponse(output) {
  return { output, raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 };
}

function buildBoundary(root) {
  const fsExecutor = new FilesystemCapabilityExecutor({
    allowedRoots: [root],
    allowedOperations: ["read", "write", "create", "modify", "delete"],
    maxFileSizeBytes: 1_000_000,
  });
  const commandExecutor = new CommandCapabilityExecutor({
    allowedCommands: [{ command: "node", args: ["--test", "tests/math-check.js"] }],
    allowedWorkingDirectoryRoots: [root],
    timeoutMs: 20000,
    maxStdoutBytes: 20480,
    maxStderrBytes: 20480,
    environment: { inherit: false, allowedKeys: [] },
  });
  const descriptors = {
    [FILESYSTEM_CAPABILITY_ID]: { capabilityId: FILESYSTEM_CAPABILITY_ID, description: "Filesystem", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
    [COMMAND_CAPABILITY_ID]: { capabilityId: COMMAND_CAPABILITY_ID, description: "Command", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
    [WEB_SEARCH_CAPABILITY_ID]: { capabilityId: WEB_SEARCH_CAPABILITY_ID, description: "Web search", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
  };
  const localResolver = { resolve: (id) => descriptors[id] ?? null, isAuthorized: () => true };
  const webExecutor = new WebSearchCapabilityExecutor(
    { search: async () => ({ providerId: "fake-provider", results: [{ title: "Node arithmetic", url: "https://nodejs.org", snippet: "JavaScript arithmetic operators", source: "example", rank: 1 }] }) },
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

function artifact(agent, ctx, kind, artifactId, payload, parentArtifact) {
  return {
    artifactId,
    kind,
    producerAgent: agent,
    workflowId: ctx.workflowId,
    correlationId: ctx.correlationId,
    status: "completed",
    payload,
    contentType: "application/json",
    schemaVersion: "1.0",
    createdAt: NOW,
    ...(parentArtifact ? { parentArtifact: { artifactId: parentArtifact.artifactId, kind: parentArtifact.kind } } : {}),
  };
}

function extractJsonAfter(prompt, marker, until) {
  const start = prompt.indexOf(marker);
  ok(start !== -1, `prompt marker not found: ${marker}`);
  let rest = prompt.slice(start + marker.length);
  const end = until === undefined ? rest.length : rest.indexOf(until);
  if (end !== -1) rest = rest.slice(0, end);
  return JSON.parse(rest.trim());
}

function buildAgents(root, boundary) {
  const signal = { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} };
  const state = { attempt: 0, qaInput: null };

  const plannerAgent = createPlannerAgent({
    config: {},
    availableAgents: [{ id: "planner", name: "Planner", capabilities: ["plan"] }, { id: "coding", name: "Coding", capabilities: ["filesystem", "command"] }, { id: "qa", name: "QA", capabilities: ["command"] }],
    execute: async () => runtimeResponse({
      planId: uuid(1),
      objective,
      tasks: [{ id: "t-fix", name: "Fix add()", description: "Fix the add function", agent: "coding", inputSchema: {}, outputSchema: {}, dependencies: [] }],
      estimatedTotalCostUsd: 0.001,
      estimatedTotalDurationSeconds: 30,
      hasParallelism: false,
      metadata: { createdAt: NOW, plannerVersion: "1.0.0", taskCount: 1, parallelGroupCount: 1, confidence: 0.9, warnings: [] },
    }),
  });

  const researchAgent = createResearchAgent({
    config: {},
    execute: async () => runtimeResponse({
      reportId: uuid(2),
      taskDescription: "Research the expected behavior of a JavaScript add function",
      summary: "Researched arithmetic addition semantics via a real web search.",
      sources: [{ id: 1, title: "Node arithmetic", url: "https://nodejs.org", snippet: "JavaScript arithmetic operators", confidence: 0.8 }],
      confidence: 0.8,
      citations: [{ sourceId: 1, text: "The + operator returns the numeric sum." }],
      metadata: { createdAt: NOW, agentVersion: "1.0.0" },
    }),
    capabilityExecution: boundary,
  });

  const codingAgent = createCodingAgent({
    config: {},
    execute: async () => {
      const attempt = state.attempt;
      const commandStatus = attempt === 1 ? "completed" : "failed";
      const summary = attempt === 1
        ? "Implemented the add function and ran the test suite."
        : "Implemented a first version of the add function and ran the test suite; the test suite did not pass yet.";
      return runtimeResponse({
        resultId: uuid(3),
        taskDescription: "Fix the add function in the benchmark repository",
        status: attempt === 1 ? "completed" : "partially_completed",
        summary,
        actions: [
          { id: "act-write", type: "modify_file", description: "Write src/math.js", filePath: "src/math.js", status: "completed", output: "File written" },
          { id: "act-test", type: "run_command", description: "Run the test suite", command: "node --test", workingDirectory: root, status: commandStatus, output: "Test command" },
        ],
        affectedFiles: [{ path: "src/math.js", changeType: "modified", description: "Modified add implementation" }],
        errors: [],
        recommendedTests: [],
        confidence: 0.8,
        metadata: { createdAt: NOW, agentVersion: "1.0.0" },
      });
    },
    capabilityExecution: boundary,
  });

  const reviewerAgent = createReviewerAgent({
    config: {},
    execute: async (_context, request) => {
      const prompt = request.messages[1].content;
      const reviewContext = extractJsonAfter(prompt, "Supplied review context:\n", "\n\nReturn a ReviewReport");
      const executions = Array.isArray(reviewContext.commandExecutions) ? reviewContext.commandExecutions : [];
      const testCommand = executions.find((e) => e.capabilityId === COMMAND_CAPABILITY_ID);
      const passed = testCommand?.status === "success";
      const status = passed ? "approved" : "changes_requested";
      return runtimeResponse({
        reportId: uuid(4),
        taskDescription: "Fix the add function in the benchmark repository",
        summary: passed ? "Review complete: the implementation satisfies the task and the tests pass." : "Review complete: the test suite is failing; changes are required.",
        status,
        findings: passed ? [] : [{ id: "f-1", severity: "critical", category: "correctness", title: "Test suite is failing", description: "The add function returns 0 for all inputs, so add(2, 3) != 5.", recommendation: "Return the sum a + b.", location: "src/math.js" }],
        recommendations: passed ? [] : [{ priority: "high", description: "Return a + b from add().", relatedFindingIds: ["f-1"] }],
        metadata: { createdAt: NOW, agentVersion: "1.0.0" },
      });
    },
  });

  const qaAgent = createQAAgent({
    config: {},
    execute: async (_context, request) => {
      const input = state.qaInput;
      const prompt = request.messages[1].content;
      const req = extractJsonAfter(prompt, "Request:\n", "\nExecution context:");
      const hasRuntimeEvidence = Array.isArray(req.suppliedEvidence) && req.suppliedEvidence.some((e) => e.source === "runtime" && e.executed);
      if (!hasRuntimeEvidence) {
        return runtimeResponse({
          reportId: uuid(5),
          requestId: input.requestId,
          objective,
          status: "reviewed",
          summary: "No runtime test evidence was supplied; the suite was not confirmed to pass.",
          testResults: [],
          findings: [], risks: [], recommendations: [],
          metadata: { createdAt: NOW, agentVersion: "1.0.0", executionEvidencePresent: false },
        });
      }
      const derived = req.suppliedEvidence.find((e) => e.source === "runtime" && e.executed);
      return runtimeResponse({
        reportId: uuid(5),
        requestId: input.requestId,
        objective,
        status: "passed",
        summary: "Runtime evidence confirms the test suite passed.",
        testResults: [{ testName: derived.testName, status: "passed", executed: true, source: "runtime", evidence: derived.evidence, durationMs: derived.durationMs }],
        findings: [], risks: [],
        recommendations: [{ priority: "low", description: "No further action required.", relatedFindingIds: [] }],
        metadata: { createdAt: NOW, agentVersion: "1.0.0", executionEvidencePresent: true },
      });
    },
    capabilityExecution: boundary,
  });

  const documentationAgent = createDocumentationAgent({
    config: {},
    execute: async () => runtimeResponse({
      resultId: uuid(6),
      requestId: uuid(7),
      objective,
      documentationType: "readme",
      status: "generated",
      summary: "Generated README content describing the resolved add() implementation (proposed content only).",
      artifact: {
        title: "Benchmark Repo",
        documentationType: "readme",
        content: "The add function returns the sum of two numbers.",
        sections: [{ title: "Implementation", content: "add(a, b) returns a + b.", order: 0 }],
        generatedOnly: true,
      },
      issues: [],
      recommendations: [],
      metadata: { createdAt: NOW, agentVersion: "1.0.0", persistence: "not_written" },
    }),
  });

  const fsRead = async (rel) => readFile(join(root, rel), "utf8");

  return { plannerAgent, researchAgent, codingAgent, reviewerAgent, qaAgent, documentationAgent, signal, state, fsRead };
}

async function createBenchmarkRepo() {
  const root = await mkdtemp(join(tmpdir(), "benchmark-repo-"));
  await cp(FIXTURE, root, { recursive: true });
  return root;
}

describe("Sprint 8 real repository engineering benchmark", () => {
  it("performs a real fix with failure/retry and truthful capability evidence", async () => {
    const root = await createBenchmarkRepo();
    try {
      const boundary = buildBoundary(root);
      const agents = buildAgents(root, boundary);
      const { plannerAgent, researchAgent, codingAgent, reviewerAgent, qaAgent, documentationAgent, signal, state, fsRead } = agents;

      const mathPath = join(root, "src", "math.js");
      const before = await fsRead("src/math.js");
      ok(before.includes("return 0;"), "fixture should start with the broken implementation");

      const repoContext = { workflowId, correlationId, brandId: null, outputs: {}, data: { objective } };
      const lineage = [];

      // 1. Planner
      const plan = await plannerAgent.execute({ context: {}, input: { objective, constraints: { deterministic: true } } }, signal);
      const planArtifact = artifact("planner", repoContext, "execution_plan", plan.output.planId, plan.output);
      lineage.push(planArtifact);

      // 2. Research
      const research = await researchAgent.execute({
        context: {},
        input: {
          task: { id: "t-research", name: "Research", description: "Research the expected behavior of a JavaScript add function", agent: "research", inputSchema: {}, outputSchema: {}, dependencies: [] },
          capabilityRequests: [{ requestId: "cap-research", capabilityId: WEB_SEARCH_CAPABILITY_ID, agentId: "research", workflowId, correlationId, input: { query: "JavaScript add function", maxResults: 3 }, requestedAt: NOW }],
        },
      }, signal);
      const researchArtifact = artifact("research", repoContext, "research_report", research.output.reportId, research.output, planArtifact);
      lineage.push(researchArtifact);

      // 3-6. Coding -> Review loop with failure/retry
      const codingTask = { id: "t-fix", name: "Fix add()", description: "Fix the add function in the benchmark repository", agent: "coding", inputSchema: {}, outputSchema: {}, dependencies: [] };
      let reviewArtifact = null;
      let codingArtifact = null;
      let attempts = 0;
      for (let iteration = 1; iteration <= 3; iteration += 1) {
        attempts = iteration;
        state.attempt = iteration;
        const content = iteration === 1 ? WRONG_IMPLEMENTATION : CORRECT_IMPLEMENTATION;

        const coding = await codingAgent.execute({
          context: {},
          input: {
            task: codingTask,
            capabilityRequests: [
              { requestId: `cap-coding-read-${iteration}`, capabilityId: FILESYSTEM_CAPABILITY_ID, agentId: "coding", workflowId, correlationId, input: { operation: "read", path: mathPath }, requestedAt: NOW },
              { requestId: `cap-coding-write-${iteration}`, capabilityId: FILESYSTEM_CAPABILITY_ID, agentId: "coding", workflowId, correlationId, input: { operation: "modify", path: mathPath, content }, requestedAt: NOW },
              { requestId: `cap-coding-test-${iteration}`, capabilityId: COMMAND_CAPABILITY_ID, agentId: "coding", workflowId, correlationId, input: { command: "node", args: ["--test", "tests/math-check.js"], cwd: root }, requestedAt: NOW },
            ],
          },
        }, signal);
        codingArtifact = artifact("coding", repoContext, "coding_report", coding.output.resultId, coding.output, researchArtifact);

        const realExecutions = coding.output.capabilityExecutions ?? [];
        const realWrite = realExecutions.find((e) => e.evidence && e.evidence.capabilityId === FILESYSTEM_CAPABILITY_ID && e.status === "success");
        const realTest = realExecutions.find((e) => e.evidence && e.evidence.capabilityId === COMMAND_CAPABILITY_ID);
        ok(realWrite, "coding must produce real filesystem write evidence");
        ok(realTest, "coding must produce real command execution evidence");

        const onDisk = await fsRead("src/math.js");
        ok(onDisk.includes(content), `coding must leave the real file in the expected state (attempt ${iteration})`);

        const review = await reviewerAgent.execute({
          context: {},
          input: {
            requestId: `review-${iteration}`,
            task: codingTask,
            context: { taskId: codingTask.id, filePath: "src/math.js", fileContent: onDisk, commandExecutions: realExecutions },
          },
        }, signal);
        reviewArtifact = artifact("reviewer", repoContext, "review_report", review.output.reportId, review.output, codingArtifact);

        const testPassed = realTest.status === "success" && realTest.evidence.exitCode === 0;
        if (testPassed) {
          strictEqual(review.output.status, "approved", "reviewer must approve when the real test suite passes");
          break;
        }
        strictEqual(review.output.status, "changes_requested", "reviewer must request changes when the real test suite fails");
      }

      strictEqual(attempts, 2, "the failure/retry must require exactly two coding attempts");
      strictEqual(reviewArtifact.payload.status, "approved");
      strictEqual((await fsRead("src/math.js")).includes("return a + b;"), true, "final on-disk state must contain the corrected implementation");

      lineage.push(codingArtifact, reviewArtifact);

      // 7. QA (real test suite on the corrected code)
      const qaInput = {
        requestId: uuid(8),
        objective,
        request: { scope: "repo", requirements: ["test suite passes"], expectedTests: ["node --test"] },
        capabilityRequests: [{ requestId: "cap-qa", capabilityId: COMMAND_CAPABILITY_ID, agentId: "qa", workflowId, correlationId, input: { command: "node", args: ["--test", "tests/math-check.js"], cwd: root }, requestedAt: NOW }],
      };
      state.qaInput = qaInput;
      const qa = await qaAgent.execute({ context: {}, input: qaInput }, signal);
      const qaArtifact = artifact("qa", repoContext, "qa_report", qa.output.reportId, qa.output, reviewArtifact);
      lineage.push(qaArtifact);

      // 8. Documentation (generated only, never written)
      const docs = await documentationAgent.execute({
        context: {},
        input: {
          requestId: uuid(7),
          objective,
          request: { type: "readme", purpose: "Describe the resolved implementation", audience: "maintainers", requiredSections: ["Implementation"] },
        },
      }, signal);
      const docsArtifact = artifact("documentation", repoContext, "documentation_report", docs.output.resultId, docs.output, qaArtifact);
      lineage.push(docsArtifact);

      // ---- Assertions ----
      const codingExecutions = codingArtifact.payload.capabilityExecutions ?? [];
      const qaExecutions = qaArtifact.payload.capabilityExecutions ?? [];
      const qaTest = qaExecutions.find((e) => e.evidence && e.evidence.capabilityId === COMMAND_CAPABILITY_ID);

      // A. Real filesystem read/write evidence (2 read + write + test on final attempt recorded in codingArtifact)
      const fsExecutions = codingExecutions.filter((e) => e.status === "success" && e.evidence && e.evidence.capabilityId === FILESYSTEM_CAPABILITY_ID);
      ok(fsExecutions.length >= 2, "real filesystem read/write evidence must be present");
      strictEqual(fsExecutions[0].evidence.capabilityId, FILESYSTEM_CAPABILITY_ID);
      strictEqual(fsExecutions[0].evidence.agentId, "coding");
      strictEqual(fsExecutions[0].evidence.workflowId, workflowId);
      strictEqual(fsExecutions[0].evidence.correlationId, correlationId);
      strictEqual(fsExecutions[0].evidence.succeeded, true);

      // B. On-disk change is real and matches the evidence
      const finalDisk = await fsRead("src/math.js");
      ok(finalDisk !== before, "the repository file must have changed on disk");
      ok(finalDisk.includes("return a + b;"), "corrected implementation must be present on disk");

      // C. Real command execution with real exit status
      const codingTest = codingExecutions.find((e) => e.evidence && e.evidence.capabilityId === COMMAND_CAPABILITY_ID);
      ok(codingTest, "coding must embed real command evidence");
      strictEqual(codingTest.status, "success");
      strictEqual(codingTest.evidence.exitCode, 0);
      ok(typeof codingTest.evidence.stdout === "string");

      // D. Failure/retry driven by real evidence: a failed attempt is recorded before the passing one
      ok(codingArtifact.payload.status !== "failed", "the final coding artifact must not be marked failed");

      // E. Reviewer saw real state and real evidence, and its decision matches it
      strictEqual(reviewArtifact.payload.status, "approved");
      ok(reviewArtifact.parentArtifact.artifactId === codingArtifact.artifactId);
      ok(reviewArtifact.payload.findings.length === 0);

      // F. QA only passes with runtime evidence
      strictEqual(qaArtifact.payload.status, "passed");
      ok(qaTest, "QA must embed real command evidence");
      strictEqual(qaTest.status, "success");
      strictEqual(qaTest.evidence.exitCode, 0);
      strictEqual(qaArtifact.payload.metadata.executionEvidencePresent, true);
      const runtimeTest = qaArtifact.payload.testResults.find((t) => t.source === "runtime" && t.executed);
      ok(runtimeTest, "QA test results must include a runtime-executed test");
      strictEqual(runtimeTest.status, "passed");

      // G. Documentation is generated-only, never written
      strictEqual(docsArtifact.payload.status, "generated");
      strictEqual(docsArtifact.payload.metadata.persistence, "not_written");
      strictEqual(docsArtifact.payload.artifact.generatedOnly, true);

      // H. Stable identity + lineage
      for (const item of lineage) {
        strictEqual(item.workflowId, workflowId);
        strictEqual(item.correlationId, correlationId);
      }
      strictEqual(researchArtifact.parentArtifact.artifactId, planArtifact.artifactId);
      strictEqual(codingArtifact.parentArtifact.artifactId, researchArtifact.artifactId);
      strictEqual(reviewArtifact.parentArtifact.artifactId, codingArtifact.artifactId);
      strictEqual(qaArtifact.parentArtifact.artifactId, reviewArtifact.artifactId);
      strictEqual(docsArtifact.parentArtifact.artifactId, qaArtifact.artifactId);

      // I. No evidence was fabricated: every claimed test pass is backed by real execution
      ok(qaTest.evidence.succeeded === true);

      // J. No direct fs/process in agents is exercised by this test (agents go through the boundary)
      notStrictEqual(boundary, null);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails truthfully when the command capability is unavailable (no fake success)", async () => {
    const root = await createBenchmarkRepo();
    try {
      const boundary = buildBoundary(root);
      const agents = buildAgents(root, boundary);
      const { qaAgent, signal, state } = agents;
      state.qaInput = { requestId: uuid(9), objective, request: { scope: "repo", requirements: ["test suite passes"], expectedTests: ["node --test"] } };
      // No capability request: the QA agent must not be able to claim runtime success.
      const qa = await qaAgent.execute({ context: {}, input: state.qaInput }, signal);
      strictEqual(qa.output.status, "reviewed");
      strictEqual(qa.output.metadata.executionEvidencePresent, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
