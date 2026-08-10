/** Reviewer Agent implementation. */

import type { AgentId, Json } from "@ai-media-factory/runtime";
import type { CancellationToken, ExecutionContext, ExecutionRequest, ExecutionResponse } from "@ai-media-factory/runtime";
import { BaseAgent, type AgentExecutionInput, type AgentExecutionOutput } from "@ai-media-factory/runtime";
import type {
  ReviewFinding,
  ReviewFindingCategory,
  ReviewFindingSeverity,
  ReviewRecommendation,
  ReviewReport,
  ReviewerAgentDependencies,
  ReviewerConfig,
  ReviewerInput,
} from "./review-types.js";

type JsonRecord = { [key: string]: Json };

/** Default reviewer system prompt. */
export const DEFAULT_REVIEWER_SYSTEM_PROMPT = `You are an expert software reviewer. Analyze only the supplied task, code, change, diff, and references.

Identify correctness issues, architectural violations, potential bugs, security concerns, and material risks. Do not claim to execute code, inspect files, modify files, or use tools. Every finding must include a severity, category, actionable description, and recommendation. If the supplied context is insufficient for a reliable review, return status "blocked" and explain what context is missing.

Your output must be valid JSON conforming to the ReviewReport schema. Do not include explanatory text outside the JSON.`;

const severities: ReviewFindingSeverity[] = ["critical", "high", "medium", "low", "info"];
const categories: ReviewFindingCategory[] = ["correctness", "architecture", "bug", "risk", "security", "maintainability"];

function isRecord(value: Json): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSeverity(value: Json): value is ReviewFindingSeverity {
  return typeof value === "string" && severities.includes(value as ReviewFindingSeverity);
}

function isCategory(value: Json): value is ReviewFindingCategory {
  return typeof value === "string" && categories.includes(value as ReviewFindingCategory);
}

function isReviewerInput(value: Json): value is JsonRecord & ReviewerInput {
  if (!isRecord(value) || !isRecord(value.task)) return false;
  const task = value.task;
  return typeof value.requestId === "string" && typeof task.id === "string" && typeof task.name === "string" && typeof task.description === "string" && typeof task.agent === "string" && Array.isArray(task.dependencies) && task.dependencies.every((item) => typeof item === "string");
}

export class ReviewerAgent extends BaseAgent {
  readonly id: AgentId = "reviewer";
  readonly name = "Reviewer Agent";
  readonly version = "1.0.0";

  private readonly reviewerConfig: ReviewerConfig;

  constructor(deps: ReviewerAgentDependencies) {
    super(deps);
    this.reviewerConfig = deps.config;
  }

  async execute(input: AgentExecutionInput, signal: CancellationToken): Promise<AgentExecutionOutput> {
    signal.throwIfCancelled();
    if (!isReviewerInput(input.input)) throw new Error("Invalid reviewer input: expected a review request");

    const { report, response: executionResponse } = await this.createReport(input.input, input.context, signal);
    const output = this.toJson(report);
    const response: ExecutionResponse = { ...executionResponse, output, raw: JSON.stringify(report, null, 2) };
    return { output, response };
  }

  private async createReport(input: ReviewerInput, context: ExecutionContext, signal: CancellationToken): Promise<{ report: ReviewReport; response: ExecutionResponse }> {
    signal.throwIfCancelled();
    const request = this.buildExecutionRequest(this.buildReviewPrompt(input));
    const response = await this.runExecution(context, request, signal);
    return { report: this.parseReviewResponse(response.output, input), response };
  }

  private buildReviewPrompt(input: ReviewerInput): string {
    return `${this.reviewerConfig.systemPrompt}

Review request:
- Request ID: ${input.requestId}
- Task: ${input.task.description}
- Assigned agent: ${input.task.agent}

Supplied review context:
${JSON.stringify(input.context ?? {}, null, 2)}

Return a ReviewReport with summary, status, findings, recommendations, and metadata. Do not infer that any code was executed or changed.`;
  }

  private buildExecutionRequest(prompt: string): ExecutionRequest {
    return {
      model: this.reviewerConfig.model,
      system: this.reviewerConfig.systemPrompt,
      messages: [
        { role: "system", content: this.reviewerConfig.systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: this.reviewerConfig.temperature,
      maxOutputTokens: this.reviewerConfig.maxOutputTokens,
      responseSchema: this.getReviewResponseSchema(),
    };
  }

  private getReviewResponseSchema(): import("@ai-media-factory/runtime").JsonSchema {
    return {
      type: "object",
      properties: {
        reportId: { type: "string", format: "uuid" },
        taskDescription: { type: "string" },
        summary: { type: "string" },
        status: { type: "string", enum: ["approved", "changes_requested", "blocked"] },
        findings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              severity: { type: "string", enum: ["critical", "high", "medium", "low", "info"] },
              category: { type: "string", enum: ["correctness", "architecture", "bug", "risk", "security", "maintainability"] },
              title: { type: "string" },
              description: { type: "string" },
              location: { type: "string" },
              recommendation: { type: "string" },
            },
            required: ["id", "severity", "category", "title", "description", "recommendation"],
          },
        },
        recommendations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              priority: { type: "string", enum: ["high", "medium", "low"] },
              description: { type: "string" },
              relatedFindingIds: { type: "array", items: { type: "string" } },
            },
            required: ["priority", "description"],
          },
        },
        metadata: { type: "object", properties: { createdAt: { type: "string" }, agentVersion: { type: "string" } }, required: ["createdAt", "agentVersion"] },
      },
      required: ["reportId", "taskDescription", "summary", "status", "findings", "recommendations", "metadata"],
    };
  }

  private parseReviewResponse(output: Json, input: ReviewerInput): ReviewReport {
    if (!isRecord(output) || typeof output.reportId !== "string" || typeof output.taskDescription !== "string" || typeof output.summary !== "string" || typeof output.status !== "string" || !["approved", "changes_requested", "blocked"].includes(output.status) || !Array.isArray(output.findings) || !Array.isArray(output.recommendations) || !isRecord(output.metadata) || typeof output.metadata.createdAt !== "string" || typeof output.metadata.agentVersion !== "string") {
      throw new Error("Invalid review response: invalid report structure");
    }
    if (output.taskDescription !== input.task.description) throw new Error("Invalid review response: task description does not match the request");

    return {
      reportId: output.reportId,
      taskDescription: output.taskDescription,
      summary: output.summary,
      status: output.status as ReviewReport["status"],
      findings: output.findings.map((finding) => this.parseFinding(finding)),
      recommendations: output.recommendations.map((recommendation) => this.parseRecommendation(recommendation)),
      metadata: { createdAt: output.metadata.createdAt, agentVersion: output.metadata.agentVersion },
    };
  }

  private parseFinding(value: Json): ReviewFinding {
    if (!isRecord(value) || typeof value.id !== "string" || !isSeverity(value.severity) || !isCategory(value.category) || typeof value.title !== "string" || typeof value.description !== "string" || typeof value.recommendation !== "string" || (value.location !== undefined && typeof value.location !== "string")) throw new Error("Invalid review response: invalid finding");
    return { id: value.id, severity: value.severity, category: value.category, title: value.title, description: value.description, recommendation: value.recommendation, ...(typeof value.location === "string" ? { location: value.location } : {}) };
  }

  private parseRecommendation(value: Json): ReviewRecommendation {
    if (!isRecord(value) || typeof value.priority !== "string" || !["high", "medium", "low"].includes(value.priority) || typeof value.description !== "string" || (value.relatedFindingIds !== undefined && (!Array.isArray(value.relatedFindingIds) || !value.relatedFindingIds.every((item) => typeof item === "string")))) throw new Error("Invalid review response: invalid recommendation");
    return { priority: value.priority as ReviewRecommendation["priority"], description: value.description, ...(Array.isArray(value.relatedFindingIds) ? { relatedFindingIds: value.relatedFindingIds.filter((item): item is string => typeof item === "string") } : {}) };
  }

  private toJson(report: ReviewReport): Json {
    return { reportId: report.reportId, taskDescription: report.taskDescription, summary: report.summary, status: report.status, findings: report.findings.map((finding) => ({ ...finding })), recommendations: report.recommendations.map((recommendation) => ({ ...recommendation })), metadata: { ...report.metadata } };
  }
}

export function createReviewerAgent(deps: ReviewerAgentDependencies): ReviewerAgent {
  const config: ReviewerConfig = { ...deps.config, model: deps.config.model ?? "openrouter/auto", temperature: deps.config.temperature ?? 0.2, maxOutputTokens: deps.config.maxOutputTokens ?? 4096, systemPrompt: deps.config.systemPrompt ?? DEFAULT_REVIEWER_SYSTEM_PROMPT, includeReasoning: deps.config.includeReasoning ?? false };
  return new ReviewerAgent({ ...deps, config });
}
