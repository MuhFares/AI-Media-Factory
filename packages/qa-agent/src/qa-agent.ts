import type { AgentId, Json } from "@ai-media-factory/runtime";
import { BaseAgent, type AgentExecutionInput, type AgentExecutionOutput, type CancellationToken, type ExecutionContext, type ExecutionRequest, type ExecutionResponse, type JsonSchema } from "@ai-media-factory/runtime";
import type { CapabilityResult } from "@ai-media-factory/runtime";
import type { QAAgentDependencies, QAConfig, QAContentArtifact, QAContentKind, QAEvidenceSource, QAExecutionEvidence, QAFinding, QAFindingCategory, QAFindingSeverity, QAInput, QAMode, QAPriority, QAReport, QAReportStatus, QARisk, QATestResult, QATestStatus, QARecommendation } from "./qa-types.js";

type JsonRecord = { [key: string]: Json };
const testStatuses: QATestStatus[] = ["passed", "failed", "skipped", "not_executed"];
const reportStatuses: QAReportStatus[] = ["passed", "failed", "blocked", "not_executed", "reviewed"];
const severities: QAFindingSeverity[] = ["critical", "high", "medium", "low", "info"];
const categories: QAFindingCategory[] = ["correctness", "regression", "coverage", "reliability", "performance", "security", "process"];
const priorities: QAPriority[] = ["high", "medium", "low"];
const sources: QAEvidenceSource[] = ["runtime", "provided-result", "none"];
const contentKinds: QAContentKind[] = ["research_report", "writer_report", "seo_report", "brand_report", "review_report"];
const contentOrder: readonly QAContentKind[] = ["research_report", "writer_report", "seo_report", "brand_report", "review_report"];

function record(value: Json): value is JsonRecord { return value !== null && typeof value === "object" && !Array.isArray(value); }
function oneOf<T extends string>(value: Json, values: T[]): value is T { return typeof value === "string" && values.includes(value as T); }
function validInput(value: Json): value is JsonRecord & QAInput {
  if (!record(value) || typeof value.requestId !== "string" || typeof value.objective !== "string" || value.objective.trim() === "" || !record(value.request)) return false;
  const request = value.request;
  const validRequest = typeof request.scope === "string" && request.scope.trim() !== "" && Array.isArray(request.requirements) && request.requirements.length > 0 && request.requirements.every((item) => typeof item === "string" && item.trim() !== "") && Array.isArray(request.expectedTests) && request.expectedTests.length > 0 && request.expectedTests.every((item) => typeof item === "string" && item.trim() !== "") && (request.suppliedEvidence === undefined || (Array.isArray(request.suppliedEvidence) && request.suppliedEvidence.every((item) => record(item) && thisEvidence(item))));
  if (!validRequest) return false;
  if (value.capabilityRequests !== undefined
    && !(Array.isArray(value.capabilityRequests)
      && value.capabilityRequests.every((item) => record(item)
        && typeof item.requestId === "string"
        && typeof item.capabilityId === "string"
        && record(item.input)))) return false;
  if (value.validatedArtifacts !== undefined
    && !(Array.isArray(value.validatedArtifacts)
      && value.validatedArtifacts.every(isContentArtifact))) return false;
  return true;
}
function isContentArtifact(value: Json): value is JsonRecord & QAContentArtifact {
  return record(value)
    && typeof value.artifactId === "string"
    && oneOf(value.kind, contentKinds)
    && typeof value.producerAgent === "string"
    && typeof value.workflowId === "string"
    && typeof value.correlationId === "string"
    && typeof value.status === "string"
    && record(value.payload)
    && (value.parentArtifact === undefined
      || (record(value.parentArtifact)
        && typeof value.parentArtifact.artifactId === "string"
        && typeof value.parentArtifact.kind === "string"));
}
/** Derive the QA domain: a populated content chain selects content QA. */
function qaModeOf(input: QAInput): QAMode {
  return input.validatedArtifacts !== undefined && input.validatedArtifacts.length > 0 ? "content" : "engineering";
}
function thisEvidence(value: JsonRecord): boolean { return typeof value.testName === "string" && oneOf(value.status, testStatuses) && typeof value.executed === "boolean" && oneOf(value.source, sources) && (value.evidence === undefined || typeof value.evidence === "string") && (value.durationMs === undefined || (typeof value.durationMs === "number" && Number.isFinite(value.durationMs) && value.durationMs >= 0)) && (value.failure === undefined || typeof value.failure === "string") && !(value.executed && (value.source !== "runtime" || typeof value.evidence !== "string" || value.evidence.trim() === "")); }

export const DEFAULT_QA_SYSTEM_PROMPT = `You are an evidence-aware QA analyst. Analyze only the supplied quality request and evidence. You have no test runner, shell, filesystem, or code tools. Never claim tests, commands, files, or code were executed unless an input evidence item has executed=true, source="runtime", and non-empty evidence. Preserve supplied results as supplied evidence, and mark unexecuted work as not_executed. Return valid JSON matching QAReport.`;

export class QAAgent extends BaseAgent {
  readonly id: AgentId = "qa";
  readonly name = "QA Agent";
  readonly version = "1.0.0";
  private readonly config: QAConfig;
  constructor(deps: QAAgentDependencies) { super(deps); this.config = deps.config; }

  async execute(input: AgentExecutionInput, signal: CancellationToken): Promise<AgentExecutionOutput> {
    signal.throwIfCancelled();
    if (!validInput(input.input)) throw new Error("Invalid QA input: expected a complete quality request");
    const capabilityRequests = input.input.capabilityRequests;
    const capabilityExecutions = capabilityRequests === undefined
      ? []
      : await this.runCapabilities(capabilityRequests);
    const prepared = this.prepareInput(input.input, capabilityExecutions);
    const response = await this.runExecution(input.context, this.buildExecutionRequest(this.buildPrompt(prepared, input.context)), signal);
    const parsed = this.parseResponse(response.output, prepared);
    const report = qaModeOf(input.input) === "content" ? this.applyContentQAGate(parsed, input.input) : this.normalizeClaims(parsed);
    const baseOutput = this.toJson(report);
    const output: Json = capabilityExecutions.length > 0 && record(baseOutput)
      ? { ...baseOutput, capabilityExecutions: JSON.parse(JSON.stringify(capabilityExecutions)) as Json[] }
      : baseOutput;
    const normalized: ExecutionResponse = { ...response, output, raw: JSON.stringify(report, null, 2) };
    return { output, response: normalized };
  }

  private prepareInput(input: QAInput, executions: readonly CapabilityResult[]): QAInput {
    if (executions.length === 0) return input;
    const derived: QAExecutionEvidence[] = [];
    for (const execution of executions) {
      if (execution.status !== "success" || execution.evidence === undefined) continue;
      const output = execution.output;
      const stdout = record(output) && typeof output.stdout === "string" ? output.stdout : "";
      const commandName = record(output) && typeof output.command === "string" ? output.command : execution.capabilityId;
      const args = record(output) && Array.isArray(output.args) ? output.args.filter((item): item is string => typeof item === "string") : [];
      const testName = [commandName, ...args].join(" ");
      derived.push({
        testName,
        status: "passed",
        executed: true,
        source: "runtime",
        evidence: stdout.trim().length > 0 ? stdout.trim() : `executed ${execution.capabilityId}`,
        durationMs: execution.evidence.durationMs,
      });
    }
    if (derived.length === 0) return input;
    const existing = input.request.suppliedEvidence ?? [];
    return { ...input, request: { ...input.request, suppliedEvidence: [...existing, ...derived] } };
  }

  private buildPrompt(input: QAInput, context: ExecutionContext): string { return `${this.config.systemPrompt}\n\nQA objective: ${input.objective}\nRequest:\n${JSON.stringify(input.request, null, 2)}\nExecution context:\n${JSON.stringify(context, null, 2)}\nProduce a QAReport that distinguishes runtime evidence, supplied results, and not-executed tests.`; }
  private buildExecutionRequest(prompt: string): ExecutionRequest { return { model: this.config.model, system: this.config.systemPrompt, messages: [{ role: "system", content: this.config.systemPrompt }, { role: "user", content: prompt }], temperature: this.config.temperature, maxOutputTokens: this.config.maxOutputTokens, responseSchema: this.getResponseSchema() }; }
  private getResponseSchema(): JsonSchema {
    const test = { type: "object", properties: { testName: { type: "string" }, status: { type: "string", enum: testStatuses }, executed: { type: "boolean" }, evidence: { type: "string" }, source: { type: "string", enum: sources }, durationMs: { type: "number", minimum: 0 }, failure: { type: "string" }, recommendation: { type: "string" } }, required: ["testName", "status", "executed", "source"] };
    const finding = { type: "object", properties: { id: { type: "string" }, severity: { type: "string", enum: severities }, category: { type: "string", enum: categories }, description: { type: "string" }, evidence: { type: "string" }, recommendation: { type: "string" } }, required: ["id", "severity", "category", "description"] };
    const risk = { type: "object", properties: { id: { type: "string" }, description: { type: "string" }, severity: { type: "string", enum: severities }, mitigation: { type: "string" } }, required: ["id", "description", "severity"] };
    const recommendation = { type: "object", properties: { priority: { type: "string", enum: priorities }, description: { type: "string" }, relatedFindingIds: { type: "array", items: { type: "string" } } }, required: ["priority", "description"] };
    return { type: "object", properties: { reportId: { type: "string", format: "uuid" }, requestId: { type: "string", format: "uuid" }, objective: { type: "string" }, status: { type: "string", enum: reportStatuses }, summary: { type: "string" }, testResults: { type: "array", items: test }, findings: { type: "array", items: finding }, risks: { type: "array", items: risk }, recommendations: { type: "array", items: recommendation }, metadata: { type: "object", properties: { createdAt: { type: "string" }, agentVersion: { type: "string" }, executionEvidencePresent: { type: "boolean" } }, required: ["createdAt", "agentVersion", "executionEvidencePresent"] } }, required: ["reportId", "requestId", "objective", "status", "summary", "testResults", "findings", "risks", "recommendations", "metadata"] };
  }

  private parseResponse(output: Json, input: QAInput): QAReport {
    if (!record(output)) throw new Error("Invalid QA response: missing required fields");
    if (typeof output.reportId !== "string" || typeof output.requestId !== "string" || output.requestId !== input.requestId || typeof output.objective !== "string" || output.objective !== input.objective || !oneOf(output.status, reportStatuses) || typeof output.summary !== "string" || !Array.isArray(output.testResults) || !Array.isArray(output.findings) || !Array.isArray(output.risks) || !Array.isArray(output.recommendations) || !record(output.metadata)) throw new Error("Invalid QA response: invalid report structure");
    const testResults = output.testResults.map((value) => this.parseTest(value, input));
    const findings = output.findings.map((value) => this.parseFinding(value));
    const risks = output.risks.map((value) => this.parseRisk(value));
    const recommendations = output.recommendations.map((value) => this.parseRecommendation(value));
    const metadata = output.metadata;
    if (typeof metadata.createdAt !== "string" || typeof metadata.agentVersion !== "string" || typeof metadata.executionEvidencePresent !== "boolean") throw new Error("Invalid QA response: malformed metadata");
    const actual = testResults.some((test) => test.executed);
    if (metadata.executionEvidencePresent !== actual) throw new Error("Invalid QA response: contradictory execution evidence");
    const report: QAReport = { reportId: output.reportId, requestId: output.requestId, objective: output.objective, status: output.status, summary: output.summary, testResults, findings, risks, recommendations, metadata: { createdAt: metadata.createdAt, agentVersion: metadata.agentVersion, executionEvidencePresent: actual } };
    return report;
  }
  private parseTest(value: Json, input: QAInput): QATestResult {
    if (!record(value) || typeof value.testName !== "string" || !oneOf(value.status, testStatuses) || typeof value.executed !== "boolean" || !oneOf(value.source, sources) || (value.evidence !== undefined && typeof value.evidence !== "string") || (value.durationMs !== undefined && (typeof value.durationMs !== "number" || !Number.isFinite(value.durationMs) || value.durationMs < 0)) || (value.failure !== undefined && typeof value.failure !== "string") || (value.recommendation !== undefined && typeof value.recommendation !== "string")) throw new Error("Invalid QA response: malformed test result");
    if (value.executed && (value.source !== "runtime" || typeof value.evidence !== "string" || value.evidence.trim() === "")) throw new Error("Invalid QA response: execution claim lacks evidence");
    if (!value.executed && value.source === "runtime") throw new Error("Invalid QA response: contradictory execution evidence");
    if (value.executed) {
      const supplied = input.request.suppliedEvidence?.find((evidence) => evidence.testName === value.testName && evidence.executed && evidence.source === "runtime" && typeof evidence.evidence === "string" && evidence.evidence.trim() !== "");
      if (!supplied) throw new Error("Invalid QA response: execution claim is not supported by supplied evidence");
    }
    const status = value.executed ? value.status : value.source === "provided-result" && (value.status === "passed" || value.status === "failed") ? value.status : "not_executed";
    return { testName: value.testName, status, executed: value.executed, source: value.source, ...(typeof value.evidence === "string" ? { evidence: value.evidence } : {}), ...(typeof value.durationMs === "number" ? { durationMs: value.durationMs } : {}), ...(typeof value.failure === "string" ? { failure: value.failure } : {}), ...(typeof value.recommendation === "string" ? { recommendation: value.recommendation } : {}) };
  }
  private parseFinding(value: Json): QAFinding { if (!record(value) || typeof value.id !== "string" || !oneOf(value.severity, severities) || !oneOf(value.category, categories) || typeof value.description !== "string" || (value.evidence !== undefined && typeof value.evidence !== "string") || (value.recommendation !== undefined && typeof value.recommendation !== "string")) throw new Error("Invalid QA response: malformed finding"); return { id: value.id, severity: value.severity, category: value.category, description: value.description, ...(typeof value.evidence === "string" ? { evidence: value.evidence } : {}), ...(typeof value.recommendation === "string" ? { recommendation: value.recommendation } : {}) }; }
  private parseRisk(value: Json): QARisk { if (!record(value) || typeof value.id !== "string" || typeof value.description !== "string" || !oneOf(value.severity, severities) || (value.mitigation !== undefined && typeof value.mitigation !== "string")) throw new Error("Invalid QA response: malformed risk"); return { id: value.id, description: value.description, severity: value.severity, ...(typeof value.mitigation === "string" ? { mitigation: value.mitigation } : {}) }; }
  private parseRecommendation(value: Json): QARecommendation { if (!record(value) || !oneOf(value.priority, priorities) || typeof value.description !== "string" || (value.relatedFindingIds !== undefined && (!Array.isArray(value.relatedFindingIds) || !value.relatedFindingIds.every((item) => typeof item === "string")))) throw new Error("Invalid QA response: malformed recommendation"); return { priority: value.priority, description: value.description, ...(Array.isArray(value.relatedFindingIds) ? { relatedFindingIds: value.relatedFindingIds.filter((item): item is string => typeof item === "string") } : {}) }; }
  private normalizeClaims(report: QAReport): QAReport {
    const unsupported = /\b(tests?\s+(?:were\s+)?(?:executed|run|passed|failed)|commands?\s+(?:were\s+)?executed|files?\s+(?:were\s+)?inspected|code\s+(?:was\s+)?modified)\b/i;
    const claimWithoutEvidence = report.status === "passed" || report.status === "failed" ? unsupported.test(report.summary) && !report.metadata.executionEvidencePresent : false;
    if (claimWithoutEvidence) return { ...report, status: "blocked", summary: `Blocked: no execution evidence supports this claim. ${report.summary}` };
    if (!report.metadata.executionEvidencePresent && (report.status === "passed" || report.status === "failed")) return { ...report, status: "reviewed" };
    return report;
  }

  /**
   * Content QA gate: deterministic structural validation of the upstream content
   * chain. Brand/reviewer/lineage predicates are authoritative and cannot be
   * overridden by the LLM, so an invalid chain can never be reported as passed.
   */
  private applyContentQAGate(report: QAReport, input: QAInput): QAReport {
    const artifacts = input.validatedArtifacts ?? [];
    const verdict = this.validateContentChain(artifacts);
    if (verdict.blocked) {
      return {
        ...report,
        status: "blocked",
        summary: `Blocked: the content chain failed QA validation. ${report.summary}`,
        findings: [...verdict.findings, ...report.findings],
        recommendations: [...verdict.recommendations, ...report.recommendations],
        validatedArtifacts: artifacts,
      };
    }
    return {
      ...report,
      status: "passed",
      summary: `Content chain validated: ${contentOrder.join(" → ")}. ${report.summary}`,
      findings: [...verdict.findings, ...report.findings],
      recommendations: [...verdict.recommendations, ...report.recommendations],
      validatedArtifacts: artifacts,
    };
  }

  private validateContentChain(artifacts: readonly QAContentArtifact[]): { blocked: boolean; findings: QAFinding[]; recommendations: QARecommendation[] } {
    const findings: QAFinding[] = [];
    const recommendations: QARecommendation[] = [];
    const block = (description: string, detail = ""): void => {
      findings.push({ id: `content-${findings.length + 1}`, severity: "critical", category: "correctness", description, evidence: detail, recommendation: "Resolve this before the content chain can pass QA." });
    };

    if (artifacts.length !== contentOrder.length) {
      block(`Content QA requires the upstream chain (${contentOrder.join(" → ")}) but received ${artifacts.length} artifact(s).`, `received kinds: ${artifacts.map((a) => a.kind).join(",")}`);
    }
    for (let i = 0; i < artifacts.length; i++) {
      if (artifacts[i].kind !== contentOrder[i]) {
        block(`Artifact at position ${i + 1} has kind "${artifacts[i].kind}" but expected "${contentOrder[i]}".`);
      }
    }
    for (let i = 1; i < artifacts.length; i++) {
      const parent = artifacts[i].parentArtifact;
      if (parent === undefined || parent.artifactId !== artifacts[i - 1].artifactId || parent.kind !== artifacts[i - 1].kind) {
        block(`Artifact lineage is broken at ${artifacts[i].kind}.`);
      }
    }
    if (artifacts.length > 0) {
      const workflowId = artifacts[0].workflowId;
      const correlationId = artifacts[0].correlationId;
      for (const artifact of artifacts) {
        if (artifact.workflowId !== workflowId) block("workflowId is inconsistent across the content chain.");
        if (artifact.correlationId !== correlationId) block("correlationId is inconsistent across the content chain.");
      }
    }
    for (const artifact of artifacts) {
      if (artifact.status === "blocked" || artifact.status === "failed") {
        block(`Upstream artifact ${artifact.kind} is ${artifact.status} and must not be treated as successful.`);
      }
      if (record(artifact.payload) && (!record(artifact.payload.metadata) || typeof artifact.payload.metadata.createdAt !== "string" || typeof artifact.payload.metadata.agentVersion !== "string")) {
        block(`Artifact ${artifact.kind} is missing required metadata.`);
      }
    }
    const writer = artifacts.find((a) => a.kind === "writer_report");
    if (writer !== undefined && record(writer.payload)) {
      if (typeof writer.payload.title !== "string" || writer.payload.title.trim() === "") block("Writer artifact is missing a title.");
      if (typeof writer.payload.content !== "string" || writer.payload.content.trim() === "") block("Writer artifact is missing required content.");
    }
    const seo = artifacts.find((a) => a.kind === "seo_report");
    if (seo !== undefined && record(seo.payload) && (typeof seo.payload.optimizedTitle !== "string" || seo.payload.optimizedTitle.trim() === "")) {
      block("SEO artifact is missing optimizedTitle.");
    }
    const brand = artifacts.find((a) => a.kind === "brand_report");
    if (brand !== undefined && record(brand.payload) && brand.payload.status !== "approved") {
      block(`Brand gate status is "${String(brand.payload.status)}"; QA cannot pass until the brand gate is approved.`);
    }
    const review = artifacts.find((a) => a.kind === "review_report");
    if (review !== undefined && record(review.payload) && review.payload.status !== "approved") {
      block(`Reviewer status is "${String(review.payload.status)}"; QA cannot pass until the reviewer approves the artifact.`);
    }

    const blocked = findings.length > 0;
    if (blocked) recommendations.push({ priority: "high", description: "Resolve all critical findings before the content chain can be approved.", relatedFindingIds: findings.map((f) => f.id) });
    return { blocked, findings, recommendations };
  }

  private toJson(report: QAReport): Json {
    const validatedArtifacts: Json[] | undefined = report.validatedArtifacts === undefined
      ? undefined
      : report.validatedArtifacts.map((artifact) => ({
          artifactId: artifact.artifactId,
          kind: artifact.kind,
          producerAgent: artifact.producerAgent,
          workflowId: artifact.workflowId,
          correlationId: artifact.correlationId,
          status: artifact.status,
          createdAt: artifact.createdAt,
          ...(artifact.parentArtifact === undefined ? {} : { parentArtifact: { artifactId: artifact.parentArtifact.artifactId, kind: artifact.parentArtifact.kind } }),
          payload: artifact.payload,
        }));
    const { validatedArtifacts: _validated, ...base } = report;
    return { ...base, testResults: report.testResults.map((test) => ({ ...test })), findings: report.findings.map((finding) => ({ ...finding })), risks: report.risks.map((risk) => ({ ...risk })), recommendations: report.recommendations.map((recommendation) => ({ ...recommendation })), metadata: { ...report.metadata }, ...(validatedArtifacts === undefined ? {} : { validatedArtifacts }) };
  }
}

export function createQAAgent(deps: QAAgentDependencies): QAAgent { const config: QAConfig = { ...deps.config, model: deps.config.model ?? "openrouter/auto", temperature: deps.config.temperature ?? 0.2, maxOutputTokens: deps.config.maxOutputTokens ?? 4096, systemPrompt: deps.config.systemPrompt ?? DEFAULT_QA_SYSTEM_PROMPT, includeReasoning: deps.config.includeReasoning ?? false }; return new QAAgent({ ...deps, config }); }
