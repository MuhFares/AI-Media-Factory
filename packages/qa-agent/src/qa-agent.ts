import type { AgentId, Json } from "@ai-media-factory/runtime";
import { BaseAgent, type AgentExecutionInput, type AgentExecutionOutput, type CancellationToken, type ExecutionContext, type ExecutionRequest, type ExecutionResponse, type JsonSchema } from "@ai-media-factory/runtime";
import type { QAAgentDependencies, QAConfig, QAEvidenceSource, QAFinding, QAFindingCategory, QAFindingSeverity, QAInput, QAPriority, QAReport, QAReportStatus, QARisk, QATestResult, QATestStatus, QARecommendation } from "./qa-types.js";

type JsonRecord = { [key: string]: Json };
const testStatuses: QATestStatus[] = ["passed", "failed", "skipped", "not_executed"];
const reportStatuses: QAReportStatus[] = ["passed", "failed", "blocked", "not_executed", "reviewed"];
const severities: QAFindingSeverity[] = ["critical", "high", "medium", "low", "info"];
const categories: QAFindingCategory[] = ["correctness", "regression", "coverage", "reliability", "performance", "security", "process"];
const priorities: QAPriority[] = ["high", "medium", "low"];
const sources: QAEvidenceSource[] = ["runtime", "provided-result", "none"];

function record(value: Json): value is JsonRecord { return value !== null && typeof value === "object" && !Array.isArray(value); }
function oneOf<T extends string>(value: Json, values: T[]): value is T { return typeof value === "string" && values.includes(value as T); }
function validInput(value: Json): value is JsonRecord & QAInput {
  if (!record(value) || typeof value.requestId !== "string" || typeof value.objective !== "string" || value.objective.trim() === "" || !record(value.request)) return false;
  const request = value.request;
  return typeof request.scope === "string" && request.scope.trim() !== "" && Array.isArray(request.requirements) && request.requirements.length > 0 && request.requirements.every((item) => typeof item === "string" && item.trim() !== "") && Array.isArray(request.expectedTests) && request.expectedTests.length > 0 && request.expectedTests.every((item) => typeof item === "string" && item.trim() !== "") && (request.suppliedEvidence === undefined || (Array.isArray(request.suppliedEvidence) && request.suppliedEvidence.every((item) => record(item) && thisEvidence(item))));
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
    const response = await this.runExecution(input.context, this.buildExecutionRequest(this.buildPrompt(input.input, input.context)), signal);
    const report = this.parseResponse(response.output, input.input);
    const output = this.toJson(report);
    const normalized: ExecutionResponse = { ...response, output, raw: JSON.stringify(report, null, 2) };
    return { output, response: normalized };
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
    return this.normalizeClaims(report);
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
  private toJson(report: QAReport): Json { return { ...report, testResults: report.testResults.map((test) => ({ ...test })), findings: report.findings.map((finding) => ({ ...finding })), risks: report.risks.map((risk) => ({ ...risk })), recommendations: report.recommendations.map((recommendation) => ({ ...recommendation })), metadata: { ...report.metadata } }; }
}

export function createQAAgent(deps: QAAgentDependencies): QAAgent { const config: QAConfig = { ...deps.config, model: deps.config.model ?? "openrouter/auto", temperature: deps.config.temperature ?? 0.2, maxOutputTokens: deps.config.maxOutputTokens ?? 4096, systemPrompt: deps.config.systemPrompt ?? DEFAULT_QA_SYSTEM_PROMPT, includeReasoning: deps.config.includeReasoning ?? false }; return new QAAgent({ ...deps, config }); }
