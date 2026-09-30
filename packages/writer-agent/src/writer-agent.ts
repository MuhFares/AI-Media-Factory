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
import { BaseAgent, BoundedStructuralValidationError, boundedStructuralDiagnostics, type AgentExecutionInput, type AgentExecutionOutput } from "@ai-media-factory/runtime";
import type {
  ResearchArtifactHandoff,
  EvidenceBackedBriefHandoff,
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
  if (handoff.kind === "evidence_backed_content_brief") {
    const payload = handoff.payload;
    if (!isRecord(payload) || payload.stage !== "POST_RESEARCH_SYNTHESIS" || payload.status !== "completed" || !Array.isArray(payload.claims)) {
      throw new Error("Writer received a blocked or malformed evidence-backed content brief");
    }
    const evidence: { sourceId: number; title: string; url: string; snippet?: string }[] = [];
    const sources: Json[] = Array.isArray((payload as JsonRecord).researchSources) ? ((payload as JsonRecord).researchSources as Json[]) : [];
    for (const item of sources) {
      if (!isRecord(item) || typeof item.sourceId !== "number" || typeof item.title !== "string" || typeof item.url !== "string") continue;
      evidence.push({ sourceId: item.sourceId, title: item.title, url: item.url, snippet: typeof item.snippet === "string" ? item.snippet : undefined });
    }
    const claims = payload.claims.filter((claim): claim is JsonRecord => isRecord(claim) && claim.status === "SUPPORTED" && typeof claim.text === "string");
    const allowed = claims.map((claim) => (Array.isArray(claim.sourceIds) ? claim.sourceIds : [])).flat().filter((id): id is number => typeof id === "number");
    const allowedIds = new Set(allowed);
    const filtered = evidence.filter((source) => allowedIds.has(source.sourceId));
    return {
      artifactId: handoff.artifactId,
      sources: filtered.map((source) => ({ sourceId: source.sourceId, title: source.title, url: source.url })),
      findings: { summary: claims.map((claim) => String(claim.text)).join(" ") || "No supported claims were supplied.", evidence: filtered, citations: [] },
    };
  }
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
    if (writerInput.requireSynthesis === true && writerInput.previousArtifact.kind !== "evidence_backed_content_brief") {
      throw new Error("Writer production handoff requires evidence_backed_content_brief");
    }
    const research = parseResearch(writerInput.previousArtifact);
    const briefPayload = writerInput.previousArtifact.payload as JsonRecord;
    const expectedTaskDescription = writerInput.task?.description ?? String(briefPayload.taskDescription ?? writerInput.objective);

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
    const prompt = this.buildPrompt(input, allowedSources, findings, artifactId, expectedTaskDescription);
    const request = this.buildExecutionRequest(prompt);
    const response = await this.runExecution(context, request, signal);
    return { report: this.parseWriterResponse(response.output, allowedSources, expectedTaskDescription), response };
  }

  private buildPrompt(input: WriterAgentInput, allowedSources: readonly WriterSourceReference[], findings: ResearchFindings, artifactId: string, expectedTaskDescription: string): string {
    const reviewableSources = allowedSources.map((source) => `${source.sourceId}: ${source.title} �?" ${source.url}`);
    const revisionDirective = input.revision === undefined ? "" : `

REVISION DIRECTIVE (authoritative — you are REVISING the prior content, not writing from scratch):
Revision task: ${input.revision.revisionTaskId} (version ${input.revision.revisionVersion})
Source Review artifact: ${input.revision.reviewArtifactId}
The prior content was reviewed and changes were requested.
Review summary:
${input.revision.summary}

Review findings (address every finding):
${JSON.stringify(input.revision.findings, null, 2)}

Review recommendations (apply every recommendation):
${JSON.stringify(input.revision.recommendations, null, 2)}

Prior content to revise:
Title: ${input.revision.priorTitle}
Content: ${input.revision.priorContent}

Revise the prior content to address every finding and recommendation while remaining grounded in the allowed sources. Preserve valid, unaffected content; do not discard it unnecessarily; do not write unrelated content. Keep the same output contract.`;
    return `${this.writerConfig.systemPrompt}

Writing objective:
${input.objective}
${revisionDirective}

Assigned writing task:
${input.task ? `${input.task.name}: ${input.task.description}` : "(none supplied)"}

Allowed source references (use ONLY these source ids):
${reviewableSources.join("\n") || "(none)"}

Produce a valid WriterReport JSON with contentId (UUID), taskDescription, objective, title, content, summary, sourceReferences (only ids above), status, and metadata (createdAt, agentVersion, researchArtifactId). Set taskDescription to EXACTLY this string, character-for-character, with no paraphrase: "${expectedTaskDescription}". Write the content and title in natural Egyptian Arabic (عامية مصرية), suitable for a general Arabic-speaking social audience. Keep the narrated content concise enough for approximately 15–25 seconds, with one clear hook and one coherent message; do not write an English article or a long essay. Use only facts, proper nouns, places, dates, and specific details explicitly present in the supplied source evidence; if a detail is not explicitly supported, describe it generally or omit it. Do not include a source id that is not listed above.

RESEARCH FINDINGS (grounding evidence - write the article ONLY from these facts and claims; do not invent facts):
Research summary:
${findings.summary}

Source evidence:
${findings.evidence.map((s) => `- [source ${s.sourceId}] ${s.title} (${s.url})\n${s.snippet ? `  Evidence: ${s.snippet}` : ""}`).join("\n")}

Cited claims to use and attribute:
${findings.citations.map((c) => `- [source ${c.sourceId}] ${c.text}`).join("\n") || "(none)"}

Guidance: keep every claim attributable to one of the source ids above. In the WriterReport, set "sourceReferences" to an array of OBJECTS, one per source id you actually used, each with the exact shape {"sourceId": <number>, "title": "<exact title>", "url": "<exact url>"} copied from the source evidence above (do NOT output bare numbers or strings). Set "metadata.researchArtifactId" to "${artifactId}". Every required scalar field in the WriterReport MUST be a JSON string, including "status". Set "status" to the literal JSON string "completed" when producing content; only use the literal JSON string "blocked" if the evidence is insufficient. Do not output objects, null, booleans, or arrays in place of scalar fields. If the findings are insufficient to write the article, return status "blocked" rather than fabricating content.`;
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
    const structuralErrors: string[] = [];
    if (!isRecord(output)) structuralErrors.push("report must be an object");
    else {
      if (typeof output.contentId !== "string") structuralErrors.push("contentId");
      if (typeof output.taskDescription !== "string") structuralErrors.push("taskDescription");
      if (typeof output.objective !== "string") structuralErrors.push("objective");
      if (typeof output.title !== "string") structuralErrors.push("title");
      if (typeof output.content !== "string") structuralErrors.push("content");
      if (typeof output.summary !== "string") structuralErrors.push("summary");
      if (typeof output.status !== "string" || !STATUSES.includes(output.status as WriterStatus)) structuralErrors.push("status");
      if (!Array.isArray(output.sourceReferences)) structuralErrors.push("sourceReferences");
      if (!isRecord(output.metadata)) structuralErrors.push("metadata");
      else {
        if (typeof output.metadata.createdAt !== "string") structuralErrors.push("metadata.createdAt");
        if (typeof output.metadata.agentVersion !== "string") structuralErrors.push("metadata.agentVersion");
        if (typeof output.metadata.researchArtifactId !== "string") structuralErrors.push("metadata.researchArtifactId");
      }
    }
    if (structuralErrors.length > 0) throw new BoundedStructuralValidationError(`Invalid writer response: invalid report structure (${structuralErrors.join(", ")})`, boundedStructuralDiagnostics("writer", "WriterReport", output, structuralErrors.map((path) => ({ path, code: path === "report must be an object" ? "wrong_type" : "missing_or_wrong_type" })), ["metadata"]));
    if (!isRecord(output)) throw new Error("Invalid writer response: invalid report structure (report must be an object)");
    const metadata = isRecord(output.metadata) ? output.metadata : {};
    const sourceReferenceItems = Array.isArray(output.sourceReferences) ? output.sourceReferences : [];
    if (output.taskDescription !== expectedTaskDescription) {
      throw new Error("Invalid writer response: task description does not match the assigned task");
    }

    const allowedById = new Map<number, WriterSourceReference>(allowedSources.map((source) => [source.sourceId, source]));
    const sourceReferences: WriterSourceReference[] = [];
    for (const item of sourceReferenceItems) {
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
      contentId: String(output.contentId),
      taskDescription: String(output.taskDescription),
      objective: String(output.objective),
      title: String(output.title),
      content: String(output.content),
      summary: String(output.summary),
      sourceReferences,
      status,
      metadata: {
        createdAt: String(metadata.createdAt),
        agentVersion: String(metadata.agentVersion),
        researchArtifactId: String(metadata.researchArtifactId),
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
    maxOutputTokens: deps.config?.maxOutputTokens ?? 16384,
    systemPrompt: deps.config?.systemPrompt ?? DEFAULT_WRITER_SYSTEM_PROMPT,
    includeReasoning: deps.config?.includeReasoning ?? false,
  };
  return new WriterAgent({ ...deps, config });
}
