/**
 * SEO Agent — the first SEO specialist.
 *
 * Consumes a writer artifact through the normal collaboration handoff
 * (previousArtifact) and produces a deterministic, source-linked SEO report
 * grounded in the supplied content. It NEVER fabricates research or source
 * claims: every source reference must trace to the writer artifact, and it
 * refuses to run without a valid writer report.
 *
 * Dependency boundary: SEOAgent → { runtime, planner-agent }. It depends only
 * on an LLM execution provider; it receives no CapabilityExecutionPort because
 * SEO optimization requires no external capability here. There are no
 * filesystem, process, web, HTTP, or provider imports.
 */

import type { AgentId, Json } from "@ai-media-factory/runtime";
import type { CancellationToken, ExecutionContext, ExecutionRequest, ExecutionResponse } from "@ai-media-factory/runtime";
import { BaseAgent, type AgentExecutionInput, type AgentExecutionOutput } from "@ai-media-factory/runtime";
import type {
  SEOAgentInput,
  SEOConfig,
  SEOContentStructureItem,
  SEOKeyword,
  SEOSearchIntent,
  SEOSourceReference,
  SEOReport,
  SEOStatus,
  SEOTopic,
  WriterArtifactHandoff,
} from "./types.js";

/** Default SEO system prompt. */
export const DEFAULT_SEO_SYSTEM_PROMPT = `You are an expert SEO specialist. Your job is to produce search-optimization recommendations grounded entirely in the supplied writer content.

You must:
1. Base every recommendation on the supplied writer content only.
2. Propose an optimized title and meta description consistent with the content.
3. Propose keywords and topics that are present in or directly supported by the content.
4. Declare a search intent based on the content's purpose.
5. Recommend a content structure consistent with the existing content.
6. Include source references that map only to source ids present in the writer artifact.
7. Do not claim that any external search, crawl, or ranking data was used.
8. If the supplied content is insufficient to optimize safely, return status "blocked" and do not fabricate recommendations.
9. Output a valid JSON SEOReport. Do not include explanatory text outside the JSON.`;

type JsonRecord = { [key: string]: Json };

const STATUSES: readonly SEOStatus[] = ["completed", "failed", "blocked"];
const INTENTS: readonly SEOSearchIntent[] = ["informational", "commercial", "transactional", "navigational"];

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isWriterHandoff(value: unknown): value is WriterArtifactHandoff {
  return isRecord(value) && typeof value.artifactId === "string" && typeof value.kind === "string" && isRecord(value.payload);
}

function isSEOAgentInput(value: unknown): value is SEOAgentInput {
  return isRecord(value) && typeof value.objective === "string" && value.objective.trim() !== "" && (value.previousArtifact === undefined || isWriterHandoff(value.previousArtifact));
}

/** Extract the required writer report from a handoff, validating structure. */
function parseWriter(handoff: WriterArtifactHandoff): { artifactId: string; sources: SEOSourceReference[] } {
  if (handoff.kind !== "writer_report") {
    throw new Error("SEO requires a writer_report artifact, received: " + handoff.kind);
  }
  const payload = handoff.payload;
  if (!isRecord(payload) || typeof payload.contentId !== "string" || typeof payload.title !== "string" || typeof payload.content !== "string" || !Array.isArray(payload.sourceReferences)) {
    throw new Error("SEO received a malformed writer artifact");
  }
  const sources: SEOSourceReference[] = [];
  const seen = new Set<number>();
  for (const item of payload.sourceReferences) {
    if (!isRecord(item) || typeof item.sourceId !== "number" || typeof item.title !== "string" || typeof item.url !== "string") {
      throw new Error("SEO received a malformed writer artifact source reference");
    }
    if (seen.has(item.sourceId)) continue;
    seen.add(item.sourceId);
    sources.push({ sourceId: item.sourceId, title: item.title, url: item.url });
  }
  return { artifactId: handoff.artifactId, sources };
}

/** SEO agent dependencies: LLM execution only, no capability port. */
export interface SEOAgentDependencies {
  execute(
    context: ExecutionContext,
    request: ExecutionRequest,
    signal: CancellationToken
  ): Promise<ExecutionResponse>;
  config: SEOConfig;
}

export class SEOAgent extends BaseAgent {
  readonly id: AgentId = "seo";
  readonly name = "SEO Agent";
  readonly version = "1.0.0";

  private readonly seoConfig: SEOConfig;

  constructor(deps: SEOAgentDependencies) {
    super(deps);
    this.seoConfig = deps.config;
  }

  async execute(input: AgentExecutionInput, signal: CancellationToken): Promise<AgentExecutionOutput> {
    signal?.throwIfCancelled();
    if (!isSEOAgentInput(input.input)) {
      throw new Error("Invalid SEO input: expected an objective and writer artifact handoff");
    }

    const seoInput = input.input;
    if (seoInput.previousArtifact === undefined) {
      throw new Error("SEO requires a writer artifact through the collaboration handoff");
    }
    const writer = parseWriter(seoInput.previousArtifact);
    const expectedTaskDescription = seoInput.task?.description ?? String((seoInput.previousArtifact.payload as JsonRecord).taskDescription ?? seoInput.objective);

    const { report, response: executionResponse } = await this.createReport(seoInput, writer.sources, expectedTaskDescription, input.context, signal);
    const output = this.toJson(report);
    const response: ExecutionResponse = { ...executionResponse, output, raw: JSON.stringify(report, null, 2) };
    return { output, response };
  }

  private async createReport(
    input: SEOAgentInput,
    allowedSources: readonly SEOSourceReference[],
    expectedTaskDescription: string,
    context: ExecutionContext,
    signal: CancellationToken
  ): Promise<{ report: SEOReport; response: ExecutionResponse }> {
    signal?.throwIfCancelled();
    const prompt = this.buildPrompt(input, allowedSources);
    const request = this.buildExecutionRequest(prompt);
    const response = await this.runExecution(context, request, signal);
    return { report: this.parseSEOResponse(response.output, allowedSources, expectedTaskDescription), response };
  }

  private buildPrompt(input: SEOAgentInput, allowedSources: readonly SEOSourceReference[]): string {
    const reviewableSources = allowedSources.map((source) => `${source.sourceId}: ${source.title} — ${source.url}`);
    return `${this.seoConfig.systemPrompt}

SEO objective:
${input.objective}

Assigned SEO task:
${input.task ? `${input.task.name}: ${input.task.description}` : "(none supplied)"}

Allowed source references (use ONLY these source ids):
${reviewableSources.join("\n") || "(none)"}

Produce a valid SEOReport JSON with reportId (UUID), taskDescription (must equal the assigned task description), objective, optimizedTitle, optimizedDescription, keywords, topics, searchIntent, contentStructure, sourceReferences (only ids above), status, and metadata (createdAt, agentVersion, writerArtifactId). Do not include a source id that is not listed above.`;
  }

  private buildExecutionRequest(prompt: string): ExecutionRequest {
    return {
      model: this.seoConfig.model,
      system: this.seoConfig.systemPrompt,
      messages: [
        { role: "system", content: this.seoConfig.systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: this.seoConfig.temperature,
      maxOutputTokens: this.seoConfig.maxOutputTokens,
      responseSchema: this.getSEOResponseSchema(),
    };
  }

  private getSEOResponseSchema(): import("@ai-media-factory/runtime").JsonSchema {
    return {
      type: "object",
      properties: {
        reportId: { type: "string", format: "uuid" },
        taskDescription: { type: "string" },
        objective: { type: "string" },
        optimizedTitle: { type: "string" },
        optimizedDescription: { type: "string" },
        keywords: {
          type: "array",
          items: { type: "object", properties: { keyword: { type: "string" }, importance: { type: "string", enum: ["primary", "secondary"] } }, required: ["keyword", "importance"] },
        },
        topics: {
          type: "array",
          items: { type: "object", properties: { topic: { type: "string" }, presentInContent: { type: "boolean" } }, required: ["topic", "presentInContent"] },
        },
        searchIntent: { type: "string", enum: ["informational", "commercial", "transactional", "navigational"] },
        contentStructure: {
          type: "array",
          items: { type: "object", properties: { heading: { type: "string" }, purpose: { type: "string" } }, required: ["heading", "purpose"] },
        },
        sourceReferences: {
          type: "array",
          items: { type: "object", properties: { sourceId: { type: "number" }, title: { type: "string" }, url: { type: "string" } }, required: ["sourceId", "title", "url"] },
        },
        status: { type: "string", enum: ["completed", "failed", "blocked"] },
        metadata: {
          type: "object",
          properties: { createdAt: { type: "string" }, agentVersion: { type: "string" }, writerArtifactId: { type: "string" } },
          required: ["createdAt", "agentVersion", "writerArtifactId"],
        },
      },
      required: ["reportId", "taskDescription", "objective", "optimizedTitle", "optimizedDescription", "keywords", "topics", "searchIntent", "contentStructure", "sourceReferences", "status", "metadata"],
    };
  }

  private parseSEOResponse(output: Json, allowedSources: readonly SEOSourceReference[], expectedTaskDescription: string): SEOReport {
    if (!isRecord(output) || typeof output.reportId !== "string" || typeof output.taskDescription !== "string" || typeof output.objective !== "string" || typeof output.optimizedTitle !== "string" || typeof output.optimizedDescription !== "string" || typeof output.searchIntent !== "string" || !INTENTS.includes(output.searchIntent as SEOSearchIntent) || typeof output.status !== "string" || !STATUSES.includes(output.status as SEOStatus) || !Array.isArray(output.keywords) || !Array.isArray(output.topics) || !Array.isArray(output.contentStructure) || !Array.isArray(output.sourceReferences) || !isRecord(output.metadata) || typeof output.metadata.createdAt !== "string" || typeof output.metadata.agentVersion !== "string" || typeof output.metadata.writerArtifactId !== "string") {
      throw new Error("Invalid SEO response: invalid report structure");
    }
    if (output.taskDescription !== expectedTaskDescription) {
      throw new Error("Invalid SEO response: task description does not match the assigned task");
    }

    const allowedById = new Map<number, SEOSourceReference>(allowedSources.map((source) => [source.sourceId, source]));
    const sourceReferences: SEOSourceReference[] = [];
    for (const item of output.sourceReferences) {
      if (!isRecord(item) || typeof item.sourceId !== "number" || typeof item.title !== "string" || typeof item.url !== "string") {
        throw new Error("Invalid SEO response: invalid source reference");
      }
      const known = allowedById.get(item.sourceId);
      if (known === undefined) {
        throw new Error("Invalid SEO response: source reference not present in the writer artifact");
      }
      if (String(item.title) !== known.title || String(item.url) !== known.url) {
        throw new Error("Invalid SEO response: source reference does not match the writer artifact");
      }
      sourceReferences.push({ sourceId: known.sourceId, title: known.title, url: known.url });
    }

    const keywords: SEOKeyword[] = [];
    for (const item of output.keywords) {
      if (!isRecord(item) || typeof item.keyword !== "string" || item.keyword.trim() === "" || (item.importance !== "primary" && item.importance !== "secondary")) {
        throw new Error("Invalid SEO response: invalid keyword");
      }
      keywords.push({ keyword: item.keyword, importance: item.importance === "primary" ? "primary" : "secondary" });
    }

    const topics: SEOTopic[] = [];
    for (const item of output.topics) {
      if (!isRecord(item) || typeof item.topic !== "string" || item.topic.trim() === "" || typeof item.presentInContent !== "boolean") {
        throw new Error("Invalid SEO response: invalid topic");
      }
      topics.push({ topic: item.topic, presentInContent: item.presentInContent });
    }

    const contentStructure: SEOContentStructureItem[] = [];
    for (const item of output.contentStructure) {
      if (!isRecord(item) || typeof item.heading !== "string" || item.heading.trim() === "" || typeof item.purpose !== "string" || item.purpose.trim() === "") {
        throw new Error("Invalid SEO response: invalid content structure item");
      }
      contentStructure.push({ heading: item.heading, purpose: item.purpose });
    }

    const status = output.status as SEOStatus;
    if (status === "completed" && (keywords.length === 0 || topics.length === 0 || contentStructure.length === 0)) {
      throw new Error("Invalid SEO response: completed report must include keywords, topics, and content structure");
    }

    return {
      reportId: output.reportId,
      taskDescription: output.taskDescription,
      objective: output.objective,
      optimizedTitle: output.optimizedTitle,
      optimizedDescription: output.optimizedDescription,
      keywords,
      topics,
      searchIntent: output.searchIntent as SEOSearchIntent,
      contentStructure,
      sourceReferences,
      status,
      metadata: {
        createdAt: output.metadata.createdAt,
        agentVersion: output.metadata.agentVersion,
        writerArtifactId: output.metadata.writerArtifactId,
      },
    };
  }

  private toJson(report: SEOReport): Json {
    return {
      reportId: report.reportId,
      taskDescription: report.taskDescription,
      objective: report.objective,
      optimizedTitle: report.optimizedTitle,
      optimizedDescription: report.optimizedDescription,
      keywords: report.keywords.map((keyword) => ({ keyword: keyword.keyword, importance: keyword.importance })),
      topics: report.topics.map((topic) => ({ topic: topic.topic, presentInContent: topic.presentInContent })),
      searchIntent: report.searchIntent,
      contentStructure: report.contentStructure.map((item) => ({ heading: item.heading, purpose: item.purpose })),
      sourceReferences: report.sourceReferences.map((source) => ({ sourceId: source.sourceId, title: source.title, url: source.url })),
      status: report.status,
      metadata: {
        createdAt: report.metadata.createdAt,
        agentVersion: report.metadata.agentVersion,
        writerArtifactId: report.metadata.writerArtifactId,
      },
    };
  }
}

/** Factory function to create a SEOAgent with defaults. */
export function createSEOAgent(deps: { config: SEOConfig; execute: (context: ExecutionContext, request: ExecutionRequest, signal: CancellationToken) => Promise<ExecutionResponse> }): SEOAgent {
  const config: SEOConfig = {
    ...deps.config,
    model: deps.config?.model ?? "openrouter/auto",
    temperature: deps.config?.temperature ?? 0.3,
    maxOutputTokens: deps.config?.maxOutputTokens ?? 4096,
    systemPrompt: deps.config?.systemPrompt ?? DEFAULT_SEO_SYSTEM_PROMPT,
    includeReasoning: deps.config?.includeReasoning ?? false,
  };
  return new SEOAgent({ ...deps, config });
}