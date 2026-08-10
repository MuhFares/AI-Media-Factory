import type { AgentId, Json } from "@ai-media-factory/runtime";
import { BaseAgent, type AgentExecutionInput, type AgentExecutionOutput, type CancellationToken, type ExecutionContext, type ExecutionRequest, type ExecutionResponse, type JsonSchema } from "@ai-media-factory/runtime";
import type { DocumentationAgentDependencies, DocumentationArtifact, DocumentationConfig, DocumentationInput, DocumentationIssue, DocumentationRecommendation, DocumentationResult, DocumentationSection, DocumentationStatus, DocumentationType } from "./documentation-types.js";

type JsonRecord = { [key: string]: Json };
const types: DocumentationType[] = ["guide", "api", "tutorial", "reference", "readme", "design_doc", "report"];
const statuses: DocumentationStatus[] = ["generated", "blocked", "failed"];
const priorities: DocumentationIssue["severity"][] = ["high", "medium", "low"];

function record(value: Json): value is JsonRecord { return value !== null && typeof value === "object" && !Array.isArray(value); }
function validType(value: Json): value is DocumentationType { return typeof value === "string" && types.includes(value as DocumentationType); }
function validStatus(value: Json): value is DocumentationStatus { return typeof value === "string" && statuses.includes(value as DocumentationStatus); }
function validPriority(value: Json): value is DocumentationIssue["severity"] { return typeof value === "string" && priorities.includes(value as DocumentationIssue["severity"]); }
function validInput(value: Json): value is JsonRecord & DocumentationInput {
  if (!record(value) || typeof value.requestId !== "string" || typeof value.objective !== "string" || value.objective.trim() === "" || !record(value.request)) return false;
  const request = value.request;
  return validType(request.type) && typeof request.purpose === "string" && request.purpose.trim() !== "" && typeof request.audience === "string" && request.audience.trim() !== "" && Array.isArray(request.requiredSections) && request.requiredSections.length > 0 && request.requiredSections.every((item) => typeof item === "string" && item.trim() !== "");
}

export const DEFAULT_DOCUMENTATION_SYSTEM_PROMPT = `You are an expert documentation agent. Generate structured documentation from the supplied objective and request. You have no filesystem, publishing, or persistence tools: never claim a document was written, saved, published, committed, or created as a file. Return generated/proposed content only, with persistence set to "not_written". If required context is missing, return status "blocked".`;

export class DocumentationAgent extends BaseAgent {
  readonly id: AgentId = "documentation";
  readonly name = "Documentation Agent";
  readonly version = "1.0.0";
  private readonly config: DocumentationConfig;

  constructor(deps: DocumentationAgentDependencies) { super(deps); this.config = deps.config; }

  async execute(input: AgentExecutionInput, signal: CancellationToken): Promise<AgentExecutionOutput> {
    signal.throwIfCancelled();
    if (!validInput(input.input)) throw new Error("Invalid documentation input: expected a complete documentation request");
    const response = await this.runExecution(input.context, this.buildExecutionRequest(this.buildPrompt(input.input, input.context)), signal);
    const result = this.parseResponse(response.output, input.input);
    const output = this.toJson(result);
    const normalized: ExecutionResponse = { ...response, output, raw: JSON.stringify(result, null, 2) };
    return { output, response: normalized };
  }

  private buildPrompt(input: DocumentationInput, context: ExecutionContext): string {
    return `${this.config.systemPrompt}\n\nDocumentation objective: ${input.objective}\nRequest:\n${JSON.stringify(input.request, null, 2)}\nExecution context:\n${JSON.stringify(context, null, 2)}\nReturn a complete DocumentationResult JSON. Include every required section and clearly mark generated content as not written.`;
  }

  private buildExecutionRequest(prompt: string): ExecutionRequest {
    return { model: this.config.model, system: this.config.systemPrompt, messages: [{ role: "system", content: this.config.systemPrompt }, { role: "user", content: prompt }], temperature: this.config.temperature, maxOutputTokens: this.config.maxOutputTokens, responseSchema: this.getResponseSchema() };
  }

  private getResponseSchema(): JsonSchema {
    const section = { type: "object", properties: { title: { type: "string" }, content: { type: "string" }, order: { type: "integer", minimum: 0 } }, required: ["title", "content", "order"] };
    const issue = { type: "object", properties: { code: { type: "string" }, description: { type: "string" }, severity: { type: "string", enum: priorities }, recommendation: { type: "string" } }, required: ["code", "description", "severity"] };
    const recommendation = { type: "object", properties: { priority: { type: "string", enum: priorities }, description: { type: "string" }, relatedIssueCodes: { type: "array", items: { type: "string" } } }, required: ["priority", "description"] };
    return { type: "object", properties: { resultId: { type: "string", format: "uuid" }, requestId: { type: "string", format: "uuid" }, objective: { type: "string" }, documentationType: { type: "string", enum: types }, status: { type: "string", enum: statuses }, summary: { type: "string" }, artifact: { type: "object", properties: { title: { type: "string" }, documentationType: { type: "string", enum: types }, content: { type: "string" }, sections: { type: "array", items: section }, generatedOnly: { type: "boolean" } }, required: ["title", "documentationType", "content", "sections", "generatedOnly"] }, issues: { type: "array", items: issue }, recommendations: { type: "array", items: recommendation }, metadata: { type: "object", properties: { createdAt: { type: "string" }, agentVersion: { type: "string" }, persistence: { type: "string", enum: ["not_written", "blocked"] } }, required: ["createdAt", "agentVersion", "persistence"] } }, required: ["resultId", "requestId", "objective", "documentationType", "status", "summary", "artifact", "issues", "recommendations", "metadata"] };
  }

  private parseResponse(output: Json, input: DocumentationInput): DocumentationResult {
    if (!record(output)) throw new Error("Invalid documentation response: missing required fields");
    if (typeof output.resultId !== "string" || typeof output.requestId !== "string" || output.requestId !== input.requestId || typeof output.objective !== "string" || output.objective !== input.objective || !validType(output.documentationType) || !validStatus(output.status) || typeof output.summary !== "string" || !record(output.artifact) || !Array.isArray(output.issues) || !Array.isArray(output.recommendations) || !record(output.metadata)) throw new Error("Invalid documentation response: invalid result structure");
    const artifact = this.parseArtifact(output.artifact);
    const issues = output.issues.map((value) => this.parseIssue(value));
    const recommendations = output.recommendations.map((value) => this.parseRecommendation(value));
    const metadata = output.metadata;
    if (typeof metadata.createdAt !== "string" || typeof metadata.agentVersion !== "string" || (metadata.persistence !== "not_written" && metadata.persistence !== "blocked")) throw new Error("Invalid documentation response: malformed metadata");
    const result: DocumentationResult = { resultId: output.resultId, requestId: output.requestId, objective: output.objective, documentationType: output.documentationType, status: output.status, summary: output.summary, artifact, issues, recommendations, metadata: { createdAt: metadata.createdAt, agentVersion: metadata.agentVersion, persistence: metadata.persistence } };
    return this.normalizeClaims(result);
  }

  private parseArtifact(value: Json): DocumentationArtifact {
    if (!record(value) || typeof value.title !== "string" || !validType(value.documentationType) || typeof value.content !== "string" || typeof value.generatedOnly !== "boolean" || !Array.isArray(value.sections)) throw new Error("Invalid documentation response: malformed artifact");
    const sections = value.sections.map((section) => this.parseSection(section));
    return { title: value.title, documentationType: value.documentationType, content: value.content, sections, generatedOnly: value.generatedOnly };
  }
  private parseSection(value: Json): DocumentationSection {
    if (!record(value) || typeof value.title !== "string" || value.title.trim() === "" || typeof value.content !== "string" || typeof value.order !== "number" || !Number.isInteger(value.order) || value.order < 0) throw new Error("Invalid documentation response: malformed section");
    return { title: value.title, content: value.content, order: value.order };
  }
  private parseIssue(value: Json): DocumentationIssue {
    if (!record(value) || typeof value.code !== "string" || typeof value.description !== "string" || !validPriority(value.severity) || (value.recommendation !== undefined && typeof value.recommendation !== "string")) throw new Error("Invalid documentation response: malformed issue");
    return { code: value.code, description: value.description, severity: value.severity, ...(typeof value.recommendation === "string" ? { recommendation: value.recommendation } : {}) };
  }
  private parseRecommendation(value: Json): DocumentationRecommendation {
    if (!record(value) || !validPriority(value.priority) || typeof value.description !== "string" || (value.relatedIssueCodes !== undefined && (!Array.isArray(value.relatedIssueCodes) || !value.relatedIssueCodes.every((item) => typeof item === "string")))) throw new Error("Invalid documentation response: malformed recommendation");
    return { priority: value.priority, description: value.description, ...(Array.isArray(value.relatedIssueCodes) ? { relatedIssueCodes: value.relatedIssueCodes.filter((item): item is string => typeof item === "string") } : {}) };
  }
  private normalizeClaims(result: DocumentationResult): DocumentationResult {
    const claim = /\b(written|saved|published|committed|commit\s+created|created\s+file|modified\s+file|file\s+(?:was\s+)?(?:created|modified))\b/i;
    const sectionClaims = result.artifact.sections.some((section) => claim.test(`${section.title} ${section.content}`));
    if ((result.status === "generated" && (claim.test(result.summary) || claim.test(result.artifact.content) || sectionClaims || result.artifact.generatedOnly === false)) || result.metadata.persistence !== "not_written") return { ...result, status: "blocked", metadata: { ...result.metadata, persistence: "blocked" }, artifact: { ...result.artifact, generatedOnly: true }, summary: `Blocked: no documentation writing or publishing tools are available. ${result.summary}` };
    return result;
  }
  private toJson(result: DocumentationResult): Json { return { ...result, artifact: { ...result.artifact, sections: result.artifact.sections.map((section) => ({ ...section })) }, issues: result.issues.map((issue) => ({ ...issue })), recommendations: result.recommendations.map((recommendation) => ({ ...recommendation })), metadata: { ...result.metadata } }; }
}

export function createDocumentationAgent(deps: DocumentationAgentDependencies): DocumentationAgent {
  const config: DocumentationConfig = { ...deps.config, model: deps.config.model ?? "openrouter/auto", temperature: deps.config.temperature ?? 0.2, maxOutputTokens: deps.config.maxOutputTokens ?? 4096, systemPrompt: deps.config.systemPrompt ?? DEFAULT_DOCUMENTATION_SYSTEM_PROMPT, includeReasoning: deps.config.includeReasoning ?? false };
  return new DocumentationAgent({ ...deps, config });
}
