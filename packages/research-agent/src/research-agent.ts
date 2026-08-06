/**
 * Research Agent implementation.
 * Extends BaseAgent to produce structured research reports from research tasks.
 */

import type { AgentId, Json } from "@ai-media-factory/runtime";
import type { ExecutionContext, ExecutionResponse, CancellationToken } from "@ai-media-factory/runtime";
import { BaseAgent, type BaseAgentDependencies, type AgentExecutionInput, type AgentExecutionOutput } from "@ai-media-factory/runtime";
import type { ExecutionRequest } from "@ai-media-factory/runtime";
import type {
  ResearchAgentInput,
  ResearchCitation,
  ResearchConfig,
  ResearchReport,
  ResearchSource,
} from "./research-types.js";

/** Research Agent dependencies. */
export interface ResearchAgentDependencies extends BaseAgentDependencies {
  config: ResearchConfig;
}

interface ResearchExecutionResult {
  report: ResearchReport;
  response: ExecutionResponse;
}

type JsonRecord = { [key: string]: Json };

function isJsonRecord(value: Json): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isResearchAgentInput(value: Json): value is JsonRecord & ResearchAgentInput {
  if (!isJsonRecord(value) || !isJsonRecord(value.task)) return false;

  const { task } = value;
  return (
    typeof task.id === "string" &&
    typeof task.name === "string" &&
    typeof task.description === "string" &&
    typeof task.agent === "string" &&
    Array.isArray(task.dependencies) &&
    task.dependencies.every((dependency) => typeof dependency === "string")
  );
}

/** Default research system prompt. */
export const DEFAULT_RESEARCH_SYSTEM_PROMPT = `You are an expert research agent. Your job is to investigate a planned research task and produce a precise, source-backed research report.

Given a task, you must:
1. Identify the facts and questions required to complete it
2. Produce a concise, evidence-based summary
3. Include only sources you can identify clearly
4. Link each citation to a source in the report
5. State confidence based on the quality and completeness of the evidence
6. Output a structured JSON research report

Your output must be valid JSON conforming to the ResearchReport schema.
Do not include explanatory text outside the JSON.`;

export class ResearchAgent extends BaseAgent {
  readonly id: AgentId = "research";
  readonly name = "Research Agent";
  readonly version = "1.0.0";

  private readonly researchConfig: ResearchConfig;

  constructor(deps: ResearchAgentDependencies) {
    super(deps);
    this.researchConfig = deps.config;
  }

  async execute(input: AgentExecutionInput, signal: CancellationToken): Promise<AgentExecutionOutput> {
    signal?.throwIfCancelled();

    if (!isResearchAgentInput(input.input)) {
      throw new Error("Invalid research input: expected a research task");
    }

    const researchInput = input.input;
    const { report, response: executionResponse } = await this.createReport(researchInput, input.context, signal);
    const output = this.toJson(report);

    // Preserve provider execution metadata while returning normalized output.
    const response: ExecutionResponse = {
      ...executionResponse,
      output,
      raw: JSON.stringify(report, null, 2),
    };

    return {
      output,
      response,
    };
  }

  private async createReport(
    input: ResearchAgentInput,
    context: ExecutionContext,
    signal: CancellationToken
  ): Promise<ResearchExecutionResult> {
    signal?.throwIfCancelled();

    const prompt = this.buildResearchPrompt(input);
    const request = this.buildExecutionRequest(prompt);
    void request;

    const response = await this.runExecution(context, signal);
    return {
      report: this.parseResearchResponse(response.output, input),
      response,
    };
  }

  private buildResearchPrompt(input: ResearchAgentInput): string {
    const { task } = input;

    return `${this.researchConfig.systemPrompt}

Research task:
- Id: ${task.id}
- Name: ${task.name}
- Description: ${task.description}
- Assigned agent: ${task.agent}
- Dependencies: ${task.dependencies.join(", ") || "none"}

Expected task input schema:
${JSON.stringify(task.inputSchema, null, 2)}

Expected task output schema:
${JSON.stringify(task.outputSchema, null, 2)}

Produce a valid ResearchReport JSON with:
- reportId (UUID)
- taskDescription (string)
- summary (string)
- sources (array of identified sources)
- confidence (number from 0 to 1)
- citations (array that references source ids)
- metadata (createdAt and agentVersion)

Every citation sourceId must refer to an item in sources. Do not invent sources, URLs, or citations.`;
  }

  private buildExecutionRequest(prompt: string): ExecutionRequest {
    return {
      model: this.researchConfig.model,
      system: this.researchConfig.systemPrompt,
      messages: [
        { role: "system", content: this.researchConfig.systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: this.researchConfig.temperature,
      maxOutputTokens: this.researchConfig.maxOutputTokens,
      responseSchema: this.getResearchResponseSchema(),
    };
  }

  private getResearchResponseSchema(): import("@ai-media-factory/runtime").JsonSchema {
    return {
      type: "object",
      properties: {
        reportId: { type: "string", format: "uuid" },
        taskDescription: { type: "string" },
        summary: { type: "string" },
        sources: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "number" },
              title: { type: "string" },
              url: { type: "string", format: "uri" },
              snippet: { type: "string" },
              dateAccessed: { type: "string" },
            },
            required: ["id", "title", "url", "snippet"],
          },
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        citations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sourceId: { type: "number" },
              text: { type: "string" },
              location: {
                type: "object",
                properties: {
                  start: { type: "number" },
                  end: { type: "number" },
                },
                required: ["start", "end"],
              },
            },
            required: ["sourceId", "text"],
          },
        },
        metadata: {
          type: "object",
          properties: {
            createdAt: { type: "string" },
            agentVersion: { type: "string" },
          },
          required: ["createdAt", "agentVersion"],
        },
      },
      required: ["reportId", "taskDescription", "summary", "sources", "confidence", "citations", "metadata"],
    };
  }

  private parseResearchResponse(output: Json, input: ResearchAgentInput): ResearchReport {
    if (!isJsonRecord(output)) {
      throw new Error("Invalid research response: missing required fields");
    }

    const { reportId, taskDescription, summary, confidence, metadata } = output;
    if (
      typeof reportId !== "string" ||
      typeof taskDescription !== "string" ||
      typeof summary !== "string" ||
      typeof confidence !== "number" ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 1 ||
      !isJsonRecord(metadata) ||
      typeof metadata.createdAt !== "string" ||
      typeof metadata.agentVersion !== "string" ||
      !Array.isArray(output.sources) ||
      !Array.isArray(output.citations)
    ) {
      throw new Error("Invalid research response: invalid report structure");
    }

    if (taskDescription !== input.task.description) {
      throw new Error("Invalid research response: task description does not match the requested task");
    }

    const sources = output.sources.map((source) => this.parseSource(source));
    const citations = output.citations.map((citation) => this.parseCitation(citation));
    const sourceIds = new Set(sources.map((source) => source.id));
    if (citations.some((citation) => !sourceIds.has(citation.sourceId))) {
      throw new Error("Invalid research response: citation references an unknown source");
    }

    return {
      reportId,
      taskDescription,
      summary,
      sources,
      confidence,
      citations,
      metadata: {
        createdAt: metadata.createdAt,
        agentVersion: metadata.agentVersion,
      },
    };
  }

  private parseSource(value: Json): ResearchSource {
    if (!isJsonRecord(value) || typeof value.id !== "number" || !Number.isFinite(value.id) || typeof value.title !== "string" || typeof value.url !== "string" || typeof value.snippet !== "string") {
      throw new Error("Invalid research response: invalid source");
    }

    if (value.dateAccessed !== undefined && typeof value.dateAccessed !== "string") {
      throw new Error("Invalid research response: invalid source access date");
    }

    return {
      id: value.id,
      title: value.title,
      url: value.url,
      snippet: value.snippet,
      ...(value.dateAccessed === undefined ? {} : { dateAccessed: value.dateAccessed }),
    };
  }

  private parseCitation(value: Json): ResearchCitation {
    if (!isJsonRecord(value) || typeof value.sourceId !== "number" || !Number.isFinite(value.sourceId) || typeof value.text !== "string") {
      throw new Error("Invalid research response: invalid citation");
    }

    if (value.location === undefined) {
      return { sourceId: value.sourceId, text: value.text };
    }

    if (!isJsonRecord(value.location) || typeof value.location.start !== "number" || typeof value.location.end !== "number") {
      throw new Error("Invalid research response: invalid citation location");
    }

    return {
      sourceId: value.sourceId,
      text: value.text,
      location: { start: value.location.start, end: value.location.end },
    };
  }

  private toJson(report: ResearchReport): Json {
    return {
      reportId: report.reportId,
      taskDescription: report.taskDescription,
      summary: report.summary,
      sources: report.sources.map((source) => ({
        id: source.id,
        title: source.title,
        url: source.url,
        snippet: source.snippet,
        ...(source.dateAccessed === undefined ? {} : { dateAccessed: source.dateAccessed }),
      })),
      confidence: report.confidence,
      citations: report.citations.map((citation) => ({
        sourceId: citation.sourceId,
        text: citation.text,
        ...(citation.location === undefined ? {} : { location: { start: citation.location.start, end: citation.location.end } }),
      })),
      metadata: {
        createdAt: report.metadata.createdAt,
        agentVersion: report.metadata.agentVersion,
      },
    };
  }
}

/** Factory function to create a ResearchAgent. */
export function createResearchAgent(deps: ResearchAgentDependencies): ResearchAgent {
  const defaultConfig: ResearchConfig = {
    ...deps.config,
    model: deps.config?.model ?? "openrouter/auto",
    temperature: deps.config?.temperature ?? 0.2,
    maxOutputTokens: deps.config?.maxOutputTokens ?? 4096,
    systemPrompt: deps.config?.systemPrompt ?? DEFAULT_RESEARCH_SYSTEM_PROMPT,
    includeReasoning: deps.config?.includeReasoning ?? false,
  };

  return new ResearchAgent({ ...deps, config: defaultConfig });
}
