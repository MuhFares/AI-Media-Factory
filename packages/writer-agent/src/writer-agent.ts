/**
 * Writer Agent — the first production specialist.
 *
 * Consumes a research report through the normal collaboration handoff
 * (previousArtifact) and produces a deterministic, source-linked content
 * artifact. It NEVER fabricates sources or evidence: every source reference in
 * the output must trace back to a source present in the supplied research
 * report, and it refuses to run without a valid research report.
 *
 * Dependency boundary: WriterAgent → { runtime, planner-agent }. It depends
 * only on an LLM execution provider; it receives no CapabilityExecutionPort
 * because content writing requires no external capability. There are no
 * filesystem, process, web, or provider imports here.
 */

import type { AgentId, Json } from "@ai-media-factory/runtime";
import type { CancellationToken, ExecutionContext, ExecutionRequest, ExecutionResponse } from "@ai-media-factory/runtime";
import { BaseAgent, type AgentExecutionInput, type AgentExecutionOutput } from "@ai-media-factory/runtime";
import type {
  ResearchArtifactHandoff,
  WriterAgentInput,
  WriterConfig,
  WriterReport,
  WriterSourceReference,
  WriterStatus,
} from "./types.js";

/** Default writer system prompt. */
export const DEFAULT_WRITER_SYSTEM_PROMPT = `You are an expert content writer. Your job is to produce precise, well-structured content grounded entirely in the supplied research report.

You must:
1. Use ONLY facts, claims, and sources present in the research report.
2. Produce a clear title, a concise summary, and structured content.
3. Include source references that map only to source ids present in the research report.
4. Do not invent facts, URLs, citations, or sources.
5. If the supplied research is insufficient to write the requested content, return status "blocked" and do not fabricate content.
6. Output a valid JSON WriterReport. Do not include explanatory text outside the JSON.`;

type JsonRecord = { [key: string]: Json };

const STATUSES: readonly WriterStatus[] = ["completed", "failed", "blocked"];

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isResearchHandoff(value: unknown): value is ResearchArtifactHandoff {
  return isRecord(value) && typeof value.artifactId === "string" && typeof value.kind === "string" && isRecord(value.payload);
}

function isWriterAgentInput(value: unknown): value is WriterAgentInput {
  return isRecord(value) && typeof value.objective === "string" && value.objective.trim() !== "" && (value.previousArtifact === undefined || isResearchHandoff(value.previousArtifact));
}

/** Extracted research findings used to ground the article (never fabricated). */
interface ResearchFindings {
  summary: string;
  evidence: readonly {
    sourceId: number;
    title: string;
    url: string;
    snippet?: string;
  }[];
  citations: readonly { sourceId: number; text: string }[];
}

/** Extract the required research report from a handoff, validating structure. */
function parseResearch(handoff: ResearchArtifactHandoff): { artifactId: string; sources: WriterSourceReference[]; findings: ResearchFindings } {
  if (handoff.kind !== "research_report") {
    throw new Error("Writer requires a research_report artifact, received: " + handoff.kind);
  }
  const payload = handoff.payload;
  if (!isRecord(payload) || typeof payload.reportId !== "string" || typeof payload.summary !== "string" || !Array.isArray(payload.sources)) {
    throw new Error("Writer received a malformed research artifact");
  }
  const sources: WriterSourceReference[] = [];
  const evidence: { sourceId: number; title: string; url: string; snippet?: string }[] = [];
  const seen = new Set<number>();
  for (const item of payload.sources) {
    if (!isRecord(item) || typeof item.id !== "number" || typeof item.title !== "string" || typeof item.url !== "string") {
      throw new Error("Writer received a malformed research artifact source");
    }
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    sources.push({ sourceId: item.id, title: item.title, url: item.url });
    evidence.push({ sourceId: item.id, title: item.title, url: item.url, snippet: typeof item.snippet === "string" ? item.snippet : undefined });
  }
  const citations: { sourceId: number; text: string }[] = [];
  if (Array.isArray(payload.citations)) {
    for (const c of payload.citations) {
      if (!isRecord(c) || typeof c.text !== "string" || typeof c.sourceId !== "number") continue;
      citations.push({ sourceId: c.sourceId, text: c.text });
    }
  }
  return {
    artifactId: handoff.artifactId,
    sources,
    findings: { summary: payload.summary, evidence, citations },
  };
}

/** Writer agent dependencies: LLM execution only, no capability port. */
export interface WriterAgentDependencies {
  execute(
    context: ExecutionContext,
    request: ExecutionRequest,
    signal: CancellationToken
  ): Promise<ExecutionResponse>;
  config: WriterConfig;
}

export class WriterAgent extends BaseAgent {
  readonly id: AgentId = "writer";
  readonly name = "Writer Agent";
  readonly version = "1.0.0";

  private readonly writerConfig: WriterConfig;

  constructor(deps: WriterAgentDependencies) {
    super(deps);
    this.writerConfig = deps.config;
  }

  async execute(input: AgentExecutionInput, signal: CancellationToken): Promise<AgentExecutionOutput> {
    signal?.throwIfCancelled();
    if (!isWriterAgentInput(input.input)) {
      throw new Error("Invalid writer input: expected a writing objective and research handoff");
    }

    const writerInput = input.input;
    if (writerInput.previousArtifact === undefined) {
      throw new Error("Writer requires a research artifact through the collaboration handoff");
    }
    const research = parseResearch(writerInput.previousArtifact);
    const expectedTaskDescription = writerInput.task?.description ?? String((writerInput.previousArtifact.payload as JsonRecord).taskDescription ?? writerInput.objective);

    const { report, response: executionResponse } = await this.createReport(writerInput, research.sources, research.findings, research.artifactId, expectedTaskDescription, input.context, signal);
    const output = this.toJson(report);
    const response: ExecutionResponse = { ...executionResponse, output, raw: JSON.stringify(report, null, 2) };
    return { output, response };
  }

  private async createReport(
    input: WriterAgentInput,
    allowedSources: readonly WriterSourceReference[],
    findings: ResearchFindings,
    artifactId: string,
    expectedTaskDescription: string,
    context: ExecutionContext,
    signal: CancellationToken
  ): Promise<{ report: WriterReport; response: ExecutionResponse }> {
    signal?.throwIfCancelled();
    const prompt = this.buildPrompt(input, allowedSources, findings, artifactId);
    const request = this.buildExecutionRequest(prompt);
    const response = await this.runExecution(context, request, signal);
    return { report: this.parseWriterResponse(response.output, allowedSources, expectedTaskDescription), response };
  }

  private buildPrompt(input: WriterAgentInput, allowedSources: readonly WriterSourceReference[], findings: ResearchFindings, artifactId: string): string {
    const reviewableSources = allowedSources.map((source) => `${source.sourceId}: ${source.title} — ${source.url}`);
    return `${this.writerConfig.systemPrompt}

Writing objective:
${input.objective}

Assigned writing task:
${input.task ? `${input.task.name}: ${input.task.description}` : "(none supplied)"}

Allowed source references (use ONLY these source ids):
${reviewableSources.join("\n") || "(none)"}

Produce a valid WriterReport JSON with contentId (UUID), taskDescription (must equal the assigned task description), objective, title, content, summary, sourceReferences (only ids above), status, and metadata (createdAt, agentVersion, researchArtifactId). Do not include a source id that is not listed above.

RESEARCH FINDINGS (grounding evidence - write the article ONLY from these facts and claims; do not invent facts):
Research summary:
${findings.summary}

Source evidence:
${findings.evidence.map((s) => `- [source ${s.sourceId}] ${s.title} (${s.url})\n${s.snippet ? `  Evidence: ${s.snippet}` : ""}`).join("\n")}

Cited claims to use and attribute:
${findings.citations.map((c) => `- [source ${c.sourceId}] ${c.text}`).join("\n") || "(none)"}

Guidance: keep every claim attributable to one of the source ids above. In the WriterReport, set "sourceReferences" to an array of OBJECTS, one per source id you actually used, each with the exact shape {"sourceId": <number>, "title": "<exact title>", "url": "<exact url>"} copied from the source evidence above (do NOT output bare numbers or strings). Set "metadata.researchArtifactId" to "${artifactId}". If the findings are insufficient to write the article, return status "blocked" rather than fabricating content.`;
  }

  private buildExecutionRequest(prompt: string): ExecutionRequest {
    return {
      model: this.writerConfig.model,
      system: this.writerConfig.systemPrompt,
      messages: [
        { role: "system", content: this.writerConfig.systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: this.writerConfig.temperature,
      maxOutputTokens: this.writerConfig.maxOutputTokens,
      responseSchema: this.getWriterResponseSchema(),
    };
  }

  private getWriterResponseSchema(): import("@ai-media-factory/runtime").JsonSchema {
    return {
      type: "object",
      properties: {
        contentId: { type: "string", format: "uuid" },
        taskDescription: { type: "string" },
        objective: { type: "string" },
        title: { type: "string" },
        content: { type: "string" },
        summary: { type: "string" },
        sourceReferences: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sourceId: { type: "number" },
              title: { type: "string" },
              url: { type: "string" },
            },
            required: ["sourceId", "title", "url"],
          },
        },
        status: { type: "string", enum: ["completed", "failed", "blocked"] },
        metadata: {
          type: "object",
          properties: {
            createdAt: { type: "string" },
            agentVersion: { type: "string" },
            researchArtifactId: { type: "string" },
          },
          required: ["createdAt", "agentVersion", "researchArtifactId"],
        },
      },
      required: ["contentId", "taskDescription", "objective", "title", "content", "summary", "sourceReferences", "status", "metadata"],
    };
  }

  private parseWriterResponse(output: Json, allowedSources: readonly WriterSourceReference[], expectedTaskDescription: string): WriterReport {
    if (!isRecord(output) || typeof output.contentId !== "string" || typeof output.taskDescription !== "string" || typeof output.objective !== "string" || typeof output.title !== "string" || typeof output.content !== "string" || typeof output.summary !== "string" || typeof output.status !== "string" || !STATUSES.includes(output.status as WriterStatus) || !Array.isArray(output.sourceReferences) || !isRecord(output.metadata) || typeof output.metadata.createdAt !== "string" || typeof output.metadata.agentVersion !== "string" || typeof output.metadata.researchArtifactId !== "string") {
      throw new Error("Invalid writer response: invalid report structure");
    }
    if (output.taskDescription !== expectedTaskDescription) {
      throw new Error("Invalid writer response: task description does not match the assigned task");
    }

    const allowedById = new Map<number, WriterSourceReference>(allowedSources.map((source) => [source.sourceId, source]));
    const sourceReferences: WriterSourceReference[] = [];
    for (const item of output.sourceReferences) {
      if (!isRecord(item) || typeof item.sourceId !== "number" || typeof item.title !== "string" || typeof item.url !== "string") {
        throw new Error("Invalid writer response: invalid source reference");
      }
      const known = allowedById.get(item.sourceId);
      if (known === undefined) {
        throw new Error("Invalid writer response: source reference not present in the research report");
      }
      if (String(item.title) !== known.title || String(item.url) !== known.url) {
        throw new Error("Invalid writer response: source reference does not match the research report");
      }
      sourceReferences.push({ sourceId: known.sourceId, title: known.title, url: known.url });
    }

    const status = output.status as WriterStatus;
    if (status === "completed" && sourceReferences.length === 0 && allowedSources.length > 0) {
      throw new Error("Invalid writer response: completed content must reference research sources");
    }

    return {
      contentId: output.contentId,
      taskDescription: output.taskDescription,
      objective: output.objective,
      title: output.title,
      content: output.content,
      summary: output.summary,
      sourceReferences,
      status,
      metadata: {
        createdAt: output.metadata.createdAt,
        agentVersion: output.metadata.agentVersion,
        researchArtifactId: output.metadata.researchArtifactId,
      },
    };
  }

  private toJson(report: WriterReport): Json {
    return {
      contentId: report.contentId,
      taskDescription: report.taskDescription,
      objective: report.objective,
      title: report.title,
      content: report.content,
      summary: report.summary,
      sourceReferences: report.sourceReferences.map((source) => ({ sourceId: source.sourceId, title: source.title, url: source.url })),
      status: report.status,
      metadata: {
        createdAt: report.metadata.createdAt,
        agentVersion: report.metadata.agentVersion,
        researchArtifactId: report.metadata.researchArtifactId,
      },
    };
  }
}

/** Factory function to create a WriterAgent with defaults. */
export function createWriterAgent(deps: { config: WriterConfig; execute: (context: ExecutionContext, request: ExecutionRequest, signal: CancellationToken) => Promise<ExecutionResponse> }): WriterAgent {
  const config: WriterConfig = {
    ...deps.config,
    model: deps.config?.model ?? "openrouter/auto",
    temperature: deps.config?.temperature ?? 0.4,
    maxOutputTokens: deps.config?.maxOutputTokens ?? 4096,
    systemPrompt: deps.config?.systemPrompt ?? DEFAULT_WRITER_SYSTEM_PROMPT,
    includeReasoning: deps.config?.includeReasoning ?? false,
  };
  return new WriterAgent({ ...deps, config });
}