/** Reviewer Agent implementation. */

import type { AgentId, Json } from "@ai-media-factory/runtime";
import type { CancellationToken, ExecutionContext, ExecutionRequest, ExecutionResponse } from "@ai-media-factory/runtime";
import { BaseAgent, type AgentExecutionInput, type AgentExecutionOutput } from "@ai-media-factory/runtime";
import type {
  ArtifactUnderReview,
  ReviewFinding,
  ReviewFindingCategory,
  ReviewFindingSeverity,
  ReviewMode,
  ReviewRecommendation,
  ReviewReport,
  ReviewerAgentDependencies,
  ReviewerConfig,
  ReviewerInput,
  ReviewArtifactKind,
} from "./review-types.js";

type JsonRecord = { [key: string]: Json };

/** Default reviewer system prompt. */
export const DEFAULT_REVIEWER_SYSTEM_PROMPT = `You are an expert software reviewer. Analyze only the supplied task, code, change, diff, and references.

Identify correctness issues, architectural violations, potential bugs, security concerns, and material risks. Do not claim to execute code, inspect files, modify files, or use tools. Every finding must include a severity, category, actionable description, and recommendation. If the supplied context is insufficient for a reliable review, return status "blocked" and explain what context is missing.

Your output must be valid JSON conforming to the ReviewReport schema. Do not include explanatory text outside the JSON.`;

const severities: ReviewFindingSeverity[] = ["critical", "high", "medium", "low", "info"];
const categories: ReviewFindingCategory[] = ["correctness", "architecture", "bug", "risk", "security", "maintainability"];

/** Derive the review domain from the artifact kind. */
function modeFromKind(kind: string): ReviewMode {
  switch (kind) {
    case "coding_report": return "coding";
    case "writer_report": return "writer";
    case "seo_report": return "seo";
    case "brand_report": return "brand";
    case "thumbnail_report": return "thumbnail";
    case "video_report": return "video";
    case "published_report": return "published";
    default: throw new Error(`Invalid review input: unsupported artifact kind "${String(kind)}"`);
  }
}

/** Domain-specific review guidance appended to the prompt. */
function domainInstructions(mode: ReviewMode): string {
  switch (mode) {
    case "writer":
      return "This is a CONTENT review. Assess factual grounding, citation consistency, completeness, clarity, and adherence to the stated objective. Do not review as code.";
    case "seo":
      return "This is an SEO review. Assess keyword coverage, search intent alignment, content structure, and optimization quality against the supplied objectives. Do not review as code.";
    case "brand":
      return "This is a BRAND compliance review. Verify the artifact aligns with brand constraints. If the upstream brand gate reports a non-approved status, the artifact must not be approved.";
    case "thumbnail":
      return "This is a THUMBNAIL review. Assess the thumbnail report's viability: it must report an image generated through the image.generate capability with matching runtime evidence, and include an image reference. An artifact that lacks runtime evidence of image generation must not be approved.";
    case "video":
      return "This is a VIDEO review. Assess the video report's viability: it must report a completed video generated through the video.generate capability with matching completion evidence, expected metadata, and a valid asset reference. An artifact that lacks confirmed completion evidence must not be approved.";
    case "published":
      return "This is a PUBLISH review. Assess the published report's viability: it must report confirmed publication through the publish.youtube capability with matching runtime evidence, a non-empty idempotency key, and a valid published URL/reference sourced from a completed video. An artifact that lacks confirmed publication evidence must not be approved.";
    case "coding":
    default:
      return "This is a CODE review. Analyze only the supplied task, code, change, diff, and references.";
  }
}

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
    const { mode, artifact } = this.resolveReviewContext(input);
    const request = this.buildExecutionRequest(this.buildReviewPrompt(input, mode, artifact));
    const response = await this.runExecution(context, request, signal);
    const parsed = this.parseReviewResponse(response.output, input);
    return { report: this.applyReviewGate(mode, artifact, parsed), response };
  }

  /** Determine the review domain from the artifact kind under review. */
  private resolveReviewContext(input: ReviewerInput): { mode: ReviewMode; artifact?: ArtifactUnderReview } {
    const artifact = input.context?.artifact;
    if (artifact === undefined) return { mode: "coding" };
    return { mode: modeFromKind(artifact.kind), artifact };
  }

  /** Structural validation of the artifact payload for its review domain. */
  private validateArtifact(mode: ReviewMode, artifact: ArtifactUnderReview | undefined): string[] {
    if (mode === "coding") return [];
    if (artifact === undefined) return ["Missing artifact payload: a content review requires the artifact under review."];
    if (!isRecord(artifact.payload)) return ["Artifact payload is not an object."];
    const p = artifact.payload;
    switch (mode) {
      case "writer":
        if (typeof p.title !== "string" || p.title.trim() === "") return ["writer_report payload lacks a title."];
        if (typeof p.content !== "string" || p.content.trim() === "") return ["writer_report payload lacks content."];
        return [];
      case "seo":
        if (typeof p.optimizedTitle !== "string" || p.optimizedTitle.trim() === "") return ["seo_report payload lacks optimizedTitle."];
        return [];
      case "brand":
        if (typeof p.status !== "string" || (p.status !== "approved" && p.status !== "needs_revision" && p.status !== "rejected")) return ["brand_report payload has an invalid status."];
        return [];
      case "thumbnail":
        if (typeof p.executionEvidencePresent !== "boolean" || p.executionEvidencePresent !== true) return ["thumbnail_report does not carry matching runtime evidence of image generation."];
        if (typeof p.status !== "string" || p.status !== "completed") return ["thumbnail_report is not completed."];
        if (typeof p.imageId !== "string" || p.imageId.trim() === "" || typeof p.imageUrl !== "string" || p.imageUrl.trim() === "") return ["thumbnail_report lacks a reference to the generated image."];
        return [];
      case "video":
        if (typeof p.executionEvidencePresent !== "boolean" || p.executionEvidencePresent !== true) return ["video_report does not carry matching runtime evidence of video generation."];
        if (typeof p.status !== "string" || p.status !== "completed") return ["video_report is not completed."];
        if (typeof p.videoId !== "string" || p.videoId.trim() === "" || typeof p.videoUrl !== "string" || p.videoUrl.trim() === "") return ["video_report lacks a reference to the generated video asset."];
        if (typeof p.jobId !== "string" || p.jobId.trim() === "") return ["video_report lacks a job identifier."];
        if (typeof p.durationSeconds !== "number" || !Number.isFinite(p.durationSeconds) || p.durationSeconds <= 0) return ["video_report has an invalid duration."];
        return [];
      case "published":
        if (typeof p.executionEvidencePresent !== "boolean" || p.executionEvidencePresent !== true) return ["published_report does not carry matching runtime evidence of publication."];
        if (typeof p.status !== "string" || p.status !== "completed") return ["published_report is not completed."];
        if (typeof p.publicationId !== "string" || p.publicationId.trim() === "" || typeof p.publishedUrl !== "string" || p.publishedUrl.trim() === "") return ["published_report lacks a reference to the confirmed publication."];
        if (typeof p.idempotencyKey !== "string" || p.idempotencyKey.trim() === "") return ["published_report lacks an idempotency key."];
        if (typeof p.sourceVideoId !== "string" || p.sourceVideoId.trim() === "") return ["published_report lacks a source video reference."];
        return [];
      default:
        return [`Unsupported review mode "${String(mode)}".`];
    }
  }

  /**
   * Enforce the review gate so an artifact that fails structural validation or
   * that an upstream brand gate rejected can never be approved.
   */
  private applyReviewGate(mode: ReviewMode, artifact: ArtifactUnderReview | undefined, report: ReviewReport): ReviewReport {
    const problems = this.validateArtifact(mode, artifact);
    const brandBlocked = mode === "brand" && artifact !== undefined && isRecord(artifact.payload) && artifact.payload.status !== "approved";
    if (problems.length === 0 && !brandBlocked) return report;

    const gateFindings: ReviewFinding[] = problems.map((problem, index) => ({
      id: `gate-${index + 1}`,
      severity: "critical",
      category: "correctness",
      title: "Artifact failed the review gate",
      description: problem,
      recommendation: "Resolve the structural issue before this artifact can be reviewed and approved.",
    }));
    if (brandBlocked) {
      gateFindings.push({
        id: `gate-${gateFindings.length + 1}`,
        severity: "critical",
        category: "risk",
        title: "Brand compliance gate rejected this artifact",
        description: 'The upstream brand gate returned a non-approved status, so this artifact must not be approved.',
        recommendation: "Resolve the brand compliance issues before resubmitting this artifact for review.",
      });
    }

    return {
      ...report,
      status: "blocked",
      findings: [...gateFindings, ...report.findings],
      recommendations: [
        { priority: "high", description: "Resolve all critical findings surfaced by the Review gate before approving.", relatedFindingIds: gateFindings.map((finding) => finding.id) },
        ...report.recommendations,
      ],
    };
  }

  private buildReviewPrompt(input: ReviewerInput, mode: ReviewMode, artifact: ArtifactUnderReview | undefined): string {
    const artifactBlock = artifact === undefined ? "" : `\n\nArtifact under review (kind: ${artifact.kind}, id: ${artifact.artifactId}):\n${JSON.stringify(artifact.payload, null, 2)}`;
    return `${this.reviewerConfig.systemPrompt}

Review domain: ${mode}
${domainInstructions(mode)}

Review request:
- Request ID: ${input.requestId}
- Task: ${input.task.description}
- Assigned agent: ${input.task.agent}

Supplied review context:
${JSON.stringify(input.context ?? {}, null, 2)}${artifactBlock}

Return a ReviewReport with summary, status, findings, recommendations, and metadata. Do not infer that any code was executed or changed. Refuse to approve an artifact that failed an upstream gate.

REVIEW REPORT FORMAT (structured-output contract - the JSON below MUST satisfy these exact shapes):

Set "reportId" to a UUID string. Set "taskDescription" EXACTLY to "${input.task.description}" (verbatim, no prefix, no suffix). Set "summary" to a concise string.
Set "status" to EXACTLY one of: "approved" | "changes_requested" | "blocked" (copy the exact lowercase token; do NOT use any other value).

Set "findings" to an array of OBJECTS, each with the exact shape {"id": "<string>", "severity": "critical" | "high" | "medium" | "low" | "info", "category": "correctness" | "architecture" | "bug" | "risk" | "security" | "maintainability", "title": "<string>", "description": "<string>", "recommendation": "<string>"}. "location" is optional (omit if not applicable).
Set "recommendations" to an array of OBJECTS, each with the exact shape {"priority": "high" | "medium" | "low", "description": "<string>"}. "relatedFindingIds" is an optional array of finding id strings referencing findings in the report.
Set "metadata" to an OBJECT with the exact shape {"createdAt": "<ISO string>", "agentVersion": "<string>"}.

Output a single JSON object with ONLY the fields listed above (reportId, taskDescription, summary, status, findings, recommendations, metadata). Do not include explanatory text outside the JSON. Do not omit any required field.`;
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
