/**
 * Brand Gate Agent — a production quality gate.
 *
 * Consumes an SEO artifact through the normal collaboration handoff
 * (previousArtifact) and evaluates it against supplied brand configuration,
 * returning an approved / needs_revision / rejected BrandReviewReport. It never
 * invents brand facts: brand guidance must be supplied, and the verdict is
 * cross-checked so a successful report cannot claim failed checks passed (or
 * vice versa).
 *
 * Dependency boundary: BrandAgent → { runtime, planner-agent }. It depends only
 * on an LLM execution provider; it receives no CapabilityExecutionPort. There
 * are no filesystem, process, network, or provider imports.
 */

import type { AgentId, Json } from "@ai-media-factory/runtime";
import type { CancellationToken, ExecutionContext, ExecutionRequest, ExecutionResponse } from "@ai-media-factory/runtime";
import { BaseAgent, type AgentExecutionInput, type AgentExecutionOutput } from "@ai-media-factory/runtime";
import type {
  BrandAgentInput,
  BrandCheck,
  BrandConfig,
  BrandRecommendation,
  BrandReviewReport,
  BrandStatus,
  SEOArtifactHandoff,
} from "./types.js";

/** Default brand-gate system prompt. */
export const DEFAULT_BRAND_SYSTEM_PROMPT = `You are an expert brand-quality gate. Your job is to evaluate supplied content for brand consistency using ONLY the brand guidelines provided.

You must:
1. Apply only the supplied brand guidelines. Do not invent brand rules or facts.
2. Record explicit passedChecks and failedChecks with clear codes and messages.
3. Return status "approved" only when every check passes (zero failedChecks); otherwise "needs_revision" or "rejected".
4. Never claim a failing check passed, or a passing check failed.
5. If no brand guidelines were supplied, evaluate only for structural validity and return status "blocked" if you cannot decide.
6. Output a valid JSON BrandReviewReport. Do not include explanatory text outside the JSON.`;

type JsonRecord = { [key: string]: Json };

const STATUSES: readonly BrandStatus[] = ["approved", "needs_revision", "rejected"];
const PRIORITIES: readonly BrandRecommendation["priority"][] = ["high", "medium", "low"];

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSEOHandoff(value: unknown): value is SEOArtifactHandoff {
  return isRecord(value) && typeof value.artifactId === "string" && typeof value.kind === "string" && isRecord(value.payload);
}

function isBrandAgentInput(value: unknown): value is BrandAgentInput {
  return isRecord(value) && typeof value.objective === "string" && value.objective.trim() !== "" && (value.previousArtifact === undefined || isSEOHandoff(value.previousArtifact)) && (value.brandConfig === undefined || typeof value.brandConfig === "string");
}

/** Extract the required SEO report from a handoff, validating structure + writer lineage. */
function parseSEO(handoff: SEOArtifactHandoff): { artifactId: string; writerArtifactId: string } {
  if (handoff.kind !== "seo_report") {
    throw new Error("Brand gate requires a seo_report artifact, received: " + handoff.kind);
  }
  const payload = handoff.payload;
  if (!isRecord(payload) || typeof payload.reportId !== "string" || typeof payload.optimizedTitle !== "string" || typeof payload.optimizedDescription !== "string" || typeof payload.status !== "string" || !isRecord(payload.metadata) || typeof payload.metadata.writerArtifactId !== "string") {
    throw new Error("Brand gate received a malformed SEO artifact");
  }
  const writerArtifactId = payload.metadata.writerArtifactId;
  if (writerArtifactId.trim() === "") {
    throw new Error("Brand gate requires the SEO artifact to reference its writer lineage");
  }
  return { artifactId: handoff.artifactId, writerArtifactId };
}

/** Brand agent dependencies: LLM execution only, no capability port. */
export interface BrandAgentDependencies {
  execute(
    context: ExecutionContext,
    request: ExecutionRequest,
    signal: CancellationToken
  ): Promise<ExecutionResponse>;
  config: BrandConfig;
}

export class BrandAgent extends BaseAgent {
  readonly id: AgentId = "brand";
  readonly name = "Brand Gate Agent";
  readonly version = "1.0.0";

  private readonly brandConfig: BrandConfig;

  constructor(deps: BrandAgentDependencies) {
    super(deps);
    this.brandConfig = deps.config;
  }

  async execute(input: AgentExecutionInput, signal: CancellationToken): Promise<AgentExecutionOutput> {
    signal?.throwIfCancelled();
    if (!isBrandAgentInput(input.input)) {
      throw new Error("Invalid brand input: expected an objective and SEO artifact handoff");
    }

    const brandInput = input.input;
    if (brandInput.previousArtifact === undefined) {
      throw new Error("Brand gate requires an SEO artifact through the collaboration handoff");
    }
    const seo = parseSEO(brandInput.previousArtifact);
    const expectedTaskDescription = brandInput.task?.description ?? String((brandInput.previousArtifact.payload as JsonRecord).taskDescription ?? brandInput.objective);

    const { report, response: executionResponse } = await this.createReport(brandInput, seo, expectedTaskDescription, input.context, signal);
    const output = this.toJson(report);
    const response: ExecutionResponse = { ...executionResponse, output, raw: JSON.stringify(report, null, 2) };
    return { output, response };
  }

  private async createReport(
    input: BrandAgentInput,
    seo: { artifactId: string; writerArtifactId: string },
    expectedTaskDescription: string,
    context: ExecutionContext,
    signal: CancellationToken
  ): Promise<{ report: BrandReviewReport; response: ExecutionResponse }> {
    signal?.throwIfCancelled();
    const prompt = this.buildPrompt(input, seo);
    const request = this.buildExecutionRequest(prompt);
    const response = await this.runExecution(context, request, signal);
    return { report: this.parseBrandResponse(response.output, seo.artifactId, expectedTaskDescription), response };
  }

  private buildPrompt(input: BrandAgentInput, seo: { artifactId: string; writerArtifactId: string }): string {
    const payload = input.previousArtifact !== undefined ? (input.previousArtifact.payload as JsonRecord) : {};
    const assignedTask = input.task ? `${input.task.name}: ${input.task.description}` : "(none supplied)";
    const expectedTaskDescription = input.task?.description ?? String(payload.taskDescription ?? input.objective);
    return `${this.brandConfig.systemPrompt}

Brand gate objective:
${input.objective}

Assigned task:
${assignedTask}

Supplied brand guidelines:
${input.brandConfig ?? "(none supplied — evaluate structural validity only)"}

SEO artifact (id ${seo.artifactId}, writer lineage ${seo.writerArtifactId}):
${JSON.stringify({ optimizedTitle: payload.optimizedTitle, optimizedDescription: payload.optimizedDescription, keywords: payload.keywords, topics: payload.topics, contentStructure: payload.contentStructure }, null, 2)}

Produce a valid BrandReviewReport JSON with reportId (UUID), taskDescription (must equal the assigned task description), objective, status, issues, passedChecks, failedChecks, recommendations, and metadata (createdAt, agentVersion, seoArtifactId).

BRAND REPORT FORMAT (structured-output contract - the JSON below MUST satisfy these exact shapes):

Set "taskDescription" EXACTLY to "${expectedTaskDescription}" (verbatim, no prefix, no suffix).
Set "status" to EXACTLY one of: "approved" | "needs_revision" | "rejected" (copy the exact lowercase token; do NOT use "blocked" or any other value).

Set "issues", "passedChecks", and "failedChecks" to arrays of OBJECTS, each with the exact shape {"code": "<string>", "message": "<string>"}. Use empty arrays when none apply.
Set "recommendations" to an array of OBJECTS, each with the exact shape {"priority": "high" | "medium" | "low", "description": "<string>"} — priority must be exactly "high", "medium", or "low".
Set "metadata" to an OBJECT with the exact shape {"createdAt": "<ISO string>", "agentVersion": "<string>", "seoArtifactId": "${seo.artifactId}"} — metadata.seoArtifactId must equal the SEO artifact id verbatim.

Gate invariants (must hold):
- If "status" is "approved": failedChecks MUST be empty and passedChecks MUST contain at least one check.
- If "status" is "needs_revision" or "rejected": failedChecks MUST contain at least one check.

Use ONLY the supplied brand guidelines; do not invent brand rules or facts. Output a single JSON object with ONLY the fields listed above (reportId, taskDescription, objective, status, issues, passedChecks, failedChecks, recommendations, metadata). No explanatory text outside the JSON.`;
  }

  private buildExecutionRequest(prompt: string): ExecutionRequest {
    return {
      model: this.brandConfig.model,
      system: this.brandConfig.systemPrompt,
      messages: [
        { role: "system", content: this.brandConfig.systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: this.brandConfig.temperature,
      maxOutputTokens: this.brandConfig.maxOutputTokens,
      responseSchema: this.getBrandResponseSchema(),
    };
  }

  private getBrandResponseSchema(): import("@ai-media-factory/runtime").JsonSchema {
    return {
      type: "object",
      properties: {
        reportId: { type: "string", format: "uuid" },
        taskDescription: { type: "string" },
        objective: { type: "string" },
        status: { type: "string", enum: ["approved", "needs_revision", "rejected"] },
        issues: { type: "array", items: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } }, required: ["code", "message"] } },
        passedChecks: { type: "array", items: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } }, required: ["code", "message"] } },
        failedChecks: { type: "array", items: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } }, required: ["code", "message"] } },
        recommendations: {
          type: "array",
          items: { type: "object", properties: { priority: { type: "string", enum: ["high", "medium", "low"] }, description: { type: "string" } }, required: ["priority", "description"] },
        },
        metadata: {
          type: "object",
          properties: { createdAt: { type: "string" }, agentVersion: { type: "string" }, seoArtifactId: { type: "string" } },
          required: ["createdAt", "agentVersion", "seoArtifactId"],
        },
      },
      required: ["reportId", "taskDescription", "objective", "status", "issues", "passedChecks", "failedChecks", "recommendations", "metadata"],
    };
  }

  private parseBrandResponse(output: Json, seoArtifactId: string, expectedTaskDescription: string): BrandReviewReport {
    if (!isRecord(output) || typeof output.reportId !== "string" || typeof output.taskDescription !== "string" || typeof output.objective !== "string" || typeof output.status !== "string" || !STATUSES.includes(output.status as BrandStatus) || !Array.isArray(output.issues) || !Array.isArray(output.passedChecks) || !Array.isArray(output.failedChecks) || !Array.isArray(output.recommendations) || !isRecord(output.metadata) || typeof output.metadata.createdAt !== "string" || typeof output.metadata.agentVersion !== "string" || typeof output.metadata.seoArtifactId !== "string") {
      throw new Error("Invalid brand response: invalid report structure");
    }
    if (output.taskDescription !== expectedTaskDescription) {
      throw new Error("Invalid brand response: task description does not match the assigned task");
    }
    if (String(output.metadata.seoArtifactId) !== seoArtifactId) {
      throw new Error("Invalid brand response: SEO artifact id does not match the handoff");
    }

    const issues = output.issues.map((item) => this.parseCheck(item, "issue"));
    const passedChecks = output.passedChecks.map((item) => this.parseCheck(item, "passed check"));
    const failedChecks = output.failedChecks.map((item) => this.parseCheck(item, "failed check"));
    const recommendations = output.recommendations.map((item) => this.parseRecommendation(item));

    const status = output.status as BrandStatus;
    if (status === "approved" && failedChecks.length > 0) {
      throw new Error("Invalid brand response: approved gate cannot contain failed checks");
    }
    if (status === "approved" && passedChecks.length === 0) {
      throw new Error("Invalid brand response: approved gate must record passed checks");
    }
    if (status !== "approved" && failedChecks.length === 0) {
      throw new Error("Invalid brand response: non-approved gate must record failed checks");
    }

    return {
      reportId: output.reportId,
      taskDescription: output.taskDescription,
      objective: output.objective,
      status,
      issues,
      passedChecks,
      failedChecks,
      recommendations,
      metadata: { createdAt: output.metadata.createdAt, agentVersion: output.metadata.agentVersion, seoArtifactId: output.metadata.seoArtifactId },
    };
  }

  private parseCheck(value: Json, label: string): BrandCheck {
    if (!isRecord(value) || typeof value.code !== "string" || value.code.trim() === "" || typeof value.message !== "string") {
      throw new Error(`Invalid brand response: invalid ${label}`);
    }
    return { code: value.code, message: value.message };
  }

  private parseRecommendation(value: Json): BrandRecommendation {
    if (!isRecord(value) || !PRIORITIES.includes(value.priority as BrandRecommendation["priority"]) || typeof value.description !== "string" || value.description.trim() === "") {
      throw new Error("Invalid brand response: invalid recommendation");
    }
    return { priority: value.priority as BrandRecommendation["priority"], description: value.description };
  }

  private toJson(report: BrandReviewReport): Json {
    return {
      reportId: report.reportId,
      taskDescription: report.taskDescription,
      objective: report.objective,
      status: report.status,
      issues: report.issues.map((check) => ({ code: check.code, message: check.message })),
      passedChecks: report.passedChecks.map((check) => ({ code: check.code, message: check.message })),
      failedChecks: report.failedChecks.map((check) => ({ code: check.code, message: check.message })),
      recommendations: report.recommendations.map((recommendation) => ({ priority: recommendation.priority, description: recommendation.description })),
      metadata: {
        createdAt: report.metadata.createdAt,
        agentVersion: report.metadata.agentVersion,
        seoArtifactId: report.metadata.seoArtifactId,
      },
    };
  }
}

/** Factory function to create a BrandAgent with defaults. */
export function createBrandAgent(deps: { config: BrandConfig; execute: (context: ExecutionContext, request: ExecutionRequest, signal: CancellationToken) => Promise<ExecutionResponse> }): BrandAgent {
  const config: BrandConfig = {
    ...deps.config,
    model: deps.config?.model ?? "openrouter/auto",
    temperature: deps.config?.temperature ?? 0.2,
    maxOutputTokens: deps.config?.maxOutputTokens ?? 4096,
    systemPrompt: deps.config?.systemPrompt ?? DEFAULT_BRAND_SYSTEM_PROMPT,
    includeReasoning: deps.config?.includeReasoning ?? false,
  };
  return new BrandAgent({ ...deps, config });
}