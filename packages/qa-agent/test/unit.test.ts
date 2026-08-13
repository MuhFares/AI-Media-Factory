import { strictEqual, ok, rejects } from "node:assert";
import { describe, it } from "node:test";
import { createQAAgent } from "../dist/index.js";

const contentInput = (artifacts, extra = {}) => ({
  requestId: "00000000-0000-4000-8000-000000000001",
  objective: "Validate the content chain",
  request: { scope: "content chain", requirements: ["brand approved"], expectedTests: ["content structure"] },
  ...extra,
  validatedArtifacts: artifacts,
});

const artifact = (overrides) => ({
  artifactId: "a-1",
  kind: "research_report",
  producerAgent: "research",
  workflowId: "workflow-1",
  correlationId: "correlation-1",
  status: "completed",
  createdAt: "2026-08-11T00:00:00.000Z",
  parentArtifact: undefined,
  payload: { reportId: "r", taskDescription: "Research", summary: "ok", sources: [], metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0" } },
  ...overrides,
});

function contentChain(overrides = {}) {
  const wf = overrides.workflowId ?? "workflow-1";
  const corr = overrides.correlationId ?? "correlation-1";
  const parent = (prev) => ({ artifactId: prev.artifactId, kind: prev.kind });
  const research = artifact({ artifactId: "a-research", kind: "research_report", workflowId: wf, correlationId: corr });
  const writer = artifact({ artifactId: "a-writer", kind: "writer_report", producerAgent: "writer", workflowId: wf, correlationId: corr, parentArtifact: parent(research), payload: { contentId: "w", taskDescription: "Write", objective: "Write", title: "Title", content: "Body.", summary: "sum", sourceReferences: [], status: "completed", metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0" } } });
  const seo = artifact({ artifactId: "a-seo", kind: "seo_report", producerAgent: "seo", workflowId: wf, correlationId: corr, parentArtifact: parent(writer), payload: { reportId: "s", taskDescription: "SEO", objective: "Optimize", optimizedTitle: "Optimized Title", optimizedDescription: "d", keywords: [], topics: [], searchIntent: "informational", contentStructure: [], status: "completed", metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0" } } });
  const brand = artifact({ artifactId: "a-brand", kind: "brand_report", producerAgent: "brand", workflowId: wf, correlationId: corr, parentArtifact: parent(seo), payload: { reportId: "b", taskDescription: "Brand", objective: "Gate", status: "approved", issues: [], passedChecks: [], failedChecks: [], recommendations: [], metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0" } } });
  const review = artifact({ artifactId: "a-review", kind: "review_report", producerAgent: "reviewer", workflowId: wf, correlationId: corr, parentArtifact: parent(brand), payload: { reportId: "v", taskDescription: "Review", status: "approved", summary: "ok", findings: [], metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0" } } });
  return [research, writer, seo, brand, review];
}

const contentOutput = (status = "passed") => ({ reportId: "00000000-0000-4000-8000-000000000002", requestId: "00000000-0000-4000-8000-000000000001", objective: "Validate the content chain", status, summary: "review", testResults: [], findings: [], risks: [], recommendations: [], metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0", executionEvidencePresent: false } });
const contentResponse = (output) => ({ output, raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 });
const contentAgent = (execute = async () => contentResponse(contentOutput())) => createQAAgent({ execute, config: {} });
const activeSignal = { throwIfCancelled() {} };

const input = { requestId: "00000000-0000-4000-8000-000000000001", objective: "Validate workflow quality", request: { scope: "workflow engine", requirements: ["retries work"], expectedTests: ["workflow smoke"] } };
const signal = { throwIfCancelled() {} };
const response = (output) => ({ output, raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 });
const validOutput = () => ({ reportId: "00000000-0000-4000-8000-000000000002", requestId: input.requestId, objective: input.objective, status: "reviewed", summary: "Reviewed supplied evidence", testResults: [{ testName: "workflow smoke", status: "passed", executed: false, source: "provided-result", evidence: "CI result supplied by requester" }], findings: [{ id: "f-1", severity: "medium", category: "coverage", description: "Coverage evidence is limited", evidence: "supplied result", recommendation: "Run the full suite" }], risks: [{ id: "r-1", description: "Unverified regression risk", severity: "medium", mitigation: "Execute regression tests" }], recommendations: [{ priority: "high", description: "Run unavailable tests", relatedFindingIds: ["f-1"] }], metadata: { createdAt: "2026-08-10T00:00:00.000Z", agentVersion: "1.0.0", executionEvidencePresent: false } });
function agent(execute = async (_context, _request, _signal) => response(validOutput())) { return createQAAgent({ execute, config: {} }); }

describe("QAAgent", () => {
  it("parses a valid structured QA report", async () => { const result = await agent().execute({ context: {}, input }, signal); strictEqual(result.output.status, "reviewed"); strictEqual(result.output.testResults[0].source, "provided-result"); });
  it("rejects missing required response fields", async () => { await rejects(() => agent(async () => response({})).execute({ context: {}, input }, signal), /missing required fields|invalid report structure/); });
  it("rejects malformed and invalid test results", async () => { const output = validOutput(); output.testResults = [{ testName: "x", status: "unknown", executed: false, source: "none" }]; await rejects(() => agent(async () => response(output)).execute({ context: {}, input }, signal), /invalid report structure|malformed test result/); const malformed = validOutput(); malformed.testResults = [{ testName: "x", status: "passed", executed: true, source: "runtime" }]; await rejects(() => agent(async () => response(malformed)).execute({ context: {}, input }, signal), /execution claim lacks evidence/); });
  it("rejects invalid finding severity and category", async () => { const output = validOutput(); output.findings[0].severity = "urgent"; await rejects(() => agent(async () => response(output)).execute({ context: {}, input }, signal), /malformed finding/); const other = validOutput(); other.findings[0].category = "style"; await rejects(() => agent(async () => response(other)).execute({ context: {}, input }, signal), /malformed finding/); });
  it("rejects incomplete QA requests and malformed supplied evidence", async () => { const incomplete = { ...input, objective: "" }; await rejects(() => agent().execute({ context: {}, input: incomplete }, signal), /Invalid QA input/); const malformed = { ...input, request: { ...input.request, suppliedEvidence: [{ testName: "x", status: "passed", executed: true, source: "provided-result" }] } }; await rejects(() => agent().execute({ context: {}, input: malformed }, signal), /Invalid QA input/); });
  it("distinguishes supplied results from actual execution", async () => { const output = validOutput(); const result = await agent(async () => response(output)).execute({ context: {}, input }, signal); strictEqual(result.output.testResults[0].executed, false); strictEqual(result.output.testResults[0].source, "provided-result"); strictEqual(result.output.metadata.executionEvidencePresent, false); });
  it("accepts actual execution only when matching runtime evidence is supplied", async () => { const actualInput = { ...input, request: { ...input.request, suppliedEvidence: [{ testName: "workflow smoke", status: "passed", executed: true, source: "runtime", evidence: "runner output: pass" }] } }; const output = validOutput(); output.status = "passed"; output.summary = "Runtime evidence confirms the test passed."; output.testResults = [{ testName: "workflow smoke", status: "passed", executed: true, source: "runtime", evidence: "runner output: pass" }]; output.metadata.executionEvidencePresent = true; const result = await agent(async () => response(output)).execute({ context: {}, input: actualInput }, signal); strictEqual(result.output.status, "passed"); strictEqual(result.output.metadata.executionEvidencePresent, true); });
  it("rejects contradictory execution metadata", async () => { const output = validOutput(); output.metadata.executionEvidencePresent = true; await rejects(() => agent(async () => response(output)).execute({ context: {}, input }, signal), /contradictory execution evidence/); });
  it("does not accept a successful execution claim without evidence", async () => { const output = validOutput(); output.status = "passed"; output.summary = "Tests passed after execution."; output.testResults = [{ testName: "workflow smoke", status: "passed", executed: false, source: "none" }]; const result = await agent(async () => response(output)).execute({ context: {}, input }, signal); strictEqual(result.output.status, "blocked"); strictEqual(result.output.testResults[0].status, "not_executed"); });
  it("normalizes unsupported passed or failed status without execution evidence", async () => { const output = validOutput(); output.status = "passed"; const result = await agent(async () => response(output)).execute({ context: {}, input }, signal); strictEqual(result.output.status, "reviewed"); });
  it("preserves execution context in the runtime request", async () => { let request; const result = await agent(async (_context, executionRequest) => { request = executionRequest; return response(validOutput()); }).execute({ context: { turnId: "qa-context-1" }, input }, signal); ok(result); ok(request.messages[1].content.includes("qa-context-1")); });
  it("applies factory defaults", () => { const created = agent(); strictEqual(created.name, "QA Agent"); });
});

describe("QAAgent content QA", () => {
  it("passes a valid content chain (research→writer→seo→brand→reviewer)", async () => {
    const chain = contentChain();
    const result = await contentAgent().execute({ context: {}, input: contentInput(chain) }, signal);
    strictEqual(result.output.status, "passed");
    strictEqual(result.output.validatedArtifacts.length, 5);
    strictEqual(result.output.metadata.executionEvidencePresent, false);
  });

  it("cannot pass when the Writer artifact is missing", async () => {
    const chain = contentChain().filter((a) => a.kind !== "writer_report");
    const result = await contentAgent().execute({ context: {}, input: contentInput(chain) }, signal);
    strictEqual(result.output.status, "blocked");
    ok(result.output.findings.some((f) => f.description.includes("requires the upstream chain")));
  });

  it("cannot pass an invalid Writer artifact (missing content)", async () => {
    const chain = contentChain();
    const writer = chain.find((a) => a.kind === "writer_report");
    writer.payload = { contentId: "w", taskDescription: "Write", objective: "Write", title: "Title", status: "completed", metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0" } };
    const result = await contentAgent().execute({ context: {}, input: contentInput(chain) }, signal);
    strictEqual(result.output.status, "blocked");
    ok(result.output.findings.some((f) => f.description.includes("missing required content")));
  });

  it("cannot pass when the SEO artifact is missing", async () => {
    const chain = contentChain().filter((a) => a.kind !== "seo_report");
    const result = await contentAgent().execute({ context: {}, input: contentInput(chain) }, signal);
    strictEqual(result.output.status, "blocked");
  });

  it("cannot pass an invalid SEO artifact (missing optimizedTitle)", async () => {
    const chain = contentChain();
    const seo = chain.find((a) => a.kind === "seo_report");
    seo.payload = { reportId: "s", taskDescription: "SEO", objective: "Optimize", status: "completed", metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0" } };
    const result = await contentAgent().execute({ context: {}, input: contentInput(chain) }, signal);
    strictEqual(result.output.status, "blocked");
    ok(result.output.findings.some((f) => f.description.includes("missing optimizedTitle")));
  });

  it("passes a content chain with Brand approved", async () => {
    const result = await contentAgent().execute({ context: {}, input: contentInput(contentChain()) }, signal);
    strictEqual(result.output.status, "passed");
  });

  it("cannot pass when Brand is blocked", async () => {
    const chain = contentChain();
    chain.find((a) => a.kind === "brand_report").payload = { reportId: "b", taskDescription: "Brand", objective: "Gate", status: "blocked", issues: [], passedChecks: [], failedChecks: [], recommendations: [], metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0" } };
    const result = await contentAgent().execute({ context: {}, input: contentInput(chain) }, signal);
    strictEqual(result.output.status, "blocked");
    ok(result.output.findings.some((f) => f.description.includes("Brand gate status")));
  });

  it("cannot pass when Brand is rejected", async () => {
    const chain = contentChain();
    chain.find((a) => a.kind === "brand_report").payload = { reportId: "b", taskDescription: "Brand", objective: "Gate", status: "rejected", issues: [], passedChecks: [], failedChecks: [], recommendations: [], metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0" } };
    const result = await contentAgent().execute({ context: {}, input: contentInput(chain) }, signal);
    strictEqual(result.output.status, "blocked");
    ok(result.output.findings.some((f) => f.description.includes("Brand gate status")));
  });

  it("passes when Reviewer approves the artifact", async () => {
    const result = await contentAgent().execute({ context: {}, input: contentInput(contentChain()) }, signal);
    strictEqual(result.output.status, "passed");
  });

  it("cannot pass when Reviewer is changes_requested", async () => {
    const chain = contentChain();
    chain.find((a) => a.kind === "review_report").payload = { reportId: "v", taskDescription: "Review", status: "changes_requested", summary: "needs work", findings: [], metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0" } };
    const result = await contentAgent().execute({ context: {}, input: contentInput(chain) }, signal);
    strictEqual(result.output.status, "blocked");
    ok(result.output.findings.some((f) => f.description.includes("Reviewer status")));
  });

  it("cannot pass when Reviewer is blocked", async () => {
    const chain = contentChain();
    chain.find((a) => a.kind === "review_report").payload = { reportId: "v", taskDescription: "Review", status: "blocked", summary: "blocked", findings: [], metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0" } };
    const result = await contentAgent().execute({ context: {}, input: contentInput(chain) }, signal);
    strictEqual(result.output.status, "blocked");
  });

  it("cannot pass when artifact lineage is broken", async () => {
    const chain = contentChain();
    chain[2].parentArtifact = { artifactId: "not-a-writer", kind: "writer_report" };
    const result = await contentAgent().execute({ context: {}, input: contentInput(chain) }, signal);
    strictEqual(result.output.status, "blocked");
    ok(result.output.findings.some((f) => f.description.includes("lineage is broken")));
  });

  it("cannot pass when workflowId is mismatched", async () => {
    const chain = contentChain();
    chain[1].workflowId = "other-workflow";
    const result = await contentAgent().execute({ context: {}, input: contentInput(chain) }, signal);
    strictEqual(result.output.status, "blocked");
    ok(result.output.findings.some((f) => f.description.includes("workflowId is inconsistent")));
  });

  it("cannot pass when correlationId is mismatched", async () => {
    const chain = contentChain();
    chain[3].correlationId = "other-correlation";
    const result = await contentAgent().execute({ context: {}, input: contentInput(chain) }, signal);
    strictEqual(result.output.status, "blocked");
    ok(result.output.findings.some((f) => f.description.includes("correlationId is inconsistent")));
  });

  it("cannot pass a blocked/failed upstream artifact", async () => {
    const chain = contentChain();
    chain[2].status = "blocked";
    const result = await contentAgent().execute({ context: {}, input: contentInput(chain) }, signal);
    strictEqual(result.output.status, "blocked");
    ok(result.output.findings.some((f) => f.description.includes("must not be treated as successful")));
  });

  it("preserves content QA findings and recommendations", async () => {
    const chain = contentChain();
    chain.find((a) => a.kind === "brand_report").payload.status = "rejected";
    const result = await contentAgent().execute({ context: {}, input: contentInput(chain) }, signal);
    strictEqual(result.output.status, "blocked");
    ok(result.output.findings.length > 0);
    ok(result.output.recommendations.some((r) => r.relatedFindingIds && r.relatedFindingIds.length > 0));
  });

  it("rejects a content input with a malformed artifact kind", async () => {
    const chain = contentChain();
    chain[0].kind = "qa_report";
    await rejects(() => contentAgent().execute({ context: {}, input: contentInput(chain) }, signal), /Invalid QA input/);
  });
});
