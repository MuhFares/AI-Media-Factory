/**
 * Research Agent implementation.
 * Extends BaseAgent to produce structured research reports from research tasks.
 */

import type { AgentId, Json } from "@ai-media-factory/runtime";
import type { ExecutionContext, ExecutionResponse, CancellationToken } from "@ai-media-factory/runtime";
import { BaseAgent, type BaseAgentDependencies, type AgentExecutionInput, type AgentExecutionOutput } from "@ai-media-factory/runtime";
import type { ExecutionRequest } from "@ai-media-factory/runtime";
import { isVisualResearchResult } from "@ai-media-factory/tool-framework";
import type {
  ResearchAgentInput,
  ResearchCitation,
  ResearchConfig,
  ResearchReport,
  ResearchSource,
} from "./research-types.js";
import type { ContentIntelligenceResult, ResearchRequest, ResearchSourceRouter } from "./content-intelligence.js";

/** Research Agent dependencies. */
export interface ResearchAgentDependencies extends BaseAgentDependencies {
  config: ResearchConfig;
  sourceRouter?: ResearchSourceRouter;
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
  const validTask =
    typeof task.id === "string" &&
    typeof task.name === "string" &&
    typeof task.description === "string" &&
    typeof task.agent === "string" &&
    Array.isArray(task.dependencies) &&
    task.dependencies.every((dependency) => typeof dependency === "string");
  if (!validTask) return false;

  return value.capabilityRequests === undefined
    || (Array.isArray(value.capabilityRequests)
      && value.capabilityRequests.every((request) => isJsonRecord(request)
        && typeof request.requestId === "string"
        && typeof request.capabilityId === "string"
        && isJsonRecord(request.input)));
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

const STRATEGY_RESEARCH_SYSTEM_PROMPT = "Return only one compact JSON object matching the requested ResearchReport. Use supplied evidence; do not reveal reasoning or add prose outside JSON.";

const STRATEGY_FINDING_KEYS = [
  "referencePatterns", "audienceOpportunities", "contentTerritories", "differentiationOpportunities",
  "productionImplications", "risks", "assumptions", "unknowns",
] as const;

export type ResearchStructuralIssue = {
  readonly path: string;
  readonly code: "missing_required" | "wrong_type" | "too_small" | "too_large" | "invalid_enum" | "value_mismatch";
  readonly expected?: string | number;
  readonly actualType?: string;
  readonly actualCount?: number;
};

export type ResearchStructuralDiagnostics = {
  readonly validationKind: "STRUCTURAL";
  readonly issues: readonly ResearchStructuralIssue[];
  readonly shape: { readonly topLevelKeys: readonly string[]; readonly strategyFindingKeys: readonly string[]; readonly truncated: boolean };
  readonly diagnosticsTruncated: boolean;
};

/** Safe, allowlisted diagnostic carrier. It intentionally contains no model text. */
export class ResearchStructuralValidationError extends Error {
  constructor(readonly diagnostics: ResearchStructuralDiagnostics) {
    super("Invalid research response: invalid report structure");
  }
}

/** Stable contract identity for a research execution (deterministic exact validation). */
export interface ResearchContractIdentity {
  /** Stable machine identity; echoed byte-for-byte, never paraphrased. */
  readonly taskId: string;
  /** Contract stage; echoed byte-for-byte. */
  readonly stage: string;
}

/**
 * Deterministic lexical relevance for taskDescription under a contract.
 * Descriptive prose must be non-empty/bounded and share at least two
 * content tokens (length >= 4) with the requested description. This is exact
 * token-set intersection, not semantic similarity: no embeddings, no fuzzy
 * matching, no model judgment.
 */
export function isRelevantResearchDescription(requested: string, provided: unknown): boolean {
  if (typeof provided !== "string") return false;
  const trimmed = provided.trim();
  if (trimmed.length < 12 || trimmed.length > 2000) return false;
  const tokens = (value: string): Set<string> => new Set(
    value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4),
  );
  const want = tokens(requested);
  if (want.size === 0) return trimmed.length >= 12;
  let shared = 0;
  for (const token of tokens(trimmed)) if (want.has(token) && ++shared >= 2) return true;
  return false;
}

/** Deterministic authority boundary for research synthesis (hard fail, never structural). Whole-word match only. */
const FORBIDDEN_RESEARCH_ACTION = /\b(?:grant|approve|authorize|execute|start)\s+(?:production|media|publication)\b|\bpublish\s+now\b|\bupload\s+(?:the\s+)?video\b|\bgenerate\s+(?:an?\s+)?(?:image|video|voice)\b/i;

/** Hard authority failure: the synthesis attempted or claimed a media/publication action. */
export class ResearchAuthorityViolationError extends Error {
  constructor(readonly hardFailReason: string, readonly issuePath: string) {
    super("Invalid research response: unauthorized media/publication action");
  }
}

/** Authority validation runs independently of prose quality and always hard-fails. */
export function assertResearchAuthorityBoundary(output: Json): void {
  if (!isJsonRecord(output)) return;
  for (const path of ["summary", "taskDescription"] as const) {
    const value = output[path];
    if (typeof value === "string" && FORBIDDEN_RESEARCH_ACTION.test(value.slice(0, 2000))) {
      throw new ResearchAuthorityViolationError("OWNER_AUTHORITY_BOUNDARY", `$.${path}`);
    }
  }
}

/**
 * Deterministic contract-identity validation.
 * New path (input carries a contract): taskId/stage echo byte-for-byte;
 * taskDescription is descriptive (non-empty + relevant), never exact-copied.
 * Legacy path (no contract): taskDescription must equal the requested
 * description exactly (preserved for backward compatibility).
 */
export function validateResearchContractIdentity(output: Json, input: ResearchAgentInput): void {
  const contract = (input as unknown as { contract?: unknown }).contract;
  if (!isJsonRecord((contract ?? null) as Json)) {
    if (typeof (output as JsonRecord).taskDescription === "string"
      && (output as JsonRecord).taskDescription !== input.task.description) {
      throw new ResearchStructuralValidationError(diagnoseResearchStructure(output, input));
    }
    return;
  }
  const expected = contract as unknown as { taskId?: unknown; stage?: unknown };
  const record = isJsonRecord(output) ? output : null;
  if (typeof record?.taskId !== "string" || record.taskId !== expected.taskId) {
    throw new ResearchStructuralValidationError(diagnoseResearchStructure(output, input));
  }
  if (typeof record?.stage !== "string" || record.stage !== expected.stage) {
    throw new ResearchStructuralValidationError(diagnoseResearchStructure(output, input));
  }
  if (!isRelevantResearchDescription(input.task.description, record?.taskDescription)) {
    throw new ResearchStructuralValidationError(diagnoseResearchStructure(output, input));
  }
}

function structuralType(value: Json | undefined): string {
  if (value === undefined) return "missing";
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function boundedKeys(value: Json): { keys: string[]; truncated: boolean } {
  if (!isJsonRecord(value)) return { keys: [], truncated: false };
  const keys = Object.keys(value).sort();
  return { keys: keys.slice(0, 20), truncated: keys.length > 20 };
}

/** Validate only shape, type, cardinality and enum category; never retain values. */
export function diagnoseResearchStructure(output: Json, input: ResearchAgentInput): ResearchStructuralDiagnostics {
  const issues: ResearchStructuralIssue[] = [];
  const add = (issue: ResearchStructuralIssue) => { if (issues.length < 20) issues.push({ ...issue, path: issue.path.slice(0, 160) }); };
  const root = isJsonRecord(output) ? output : null;
  const top = boundedKeys(output);
  const strategyKeys = root === null ? { keys: [], truncated: false } : boundedKeys(root.strategyFindings as Json);
  if (root === null) add({ path: "$", code: "wrong_type", expected: "object", actualType: structuralType(output) });
  const required: Array<[string, string]> = [["reportId", "string"], ["taskDescription", "string"], ["summary", "string"], ["confidence", "number"], ["sources", "array"], ["citations", "array"], ["metadata", "object"]];
  for (const [key, expected] of required) {
    const value = root?.[key];
    if (value === undefined) add({ path: key, code: "missing_required", expected });
    else if (structuralType(value) !== expected) add({ path: key, code: "wrong_type", expected, actualType: structuralType(value) });
  }
  const contractRecord = isJsonRecord(((input as unknown as { contract?: unknown }).contract ?? null) as Json)
    ? ((input as unknown as { contract?: unknown }).contract as unknown as JsonRecord)
    : null;
  if (contractRecord !== null) {
    if (typeof root?.taskId !== "string" || root.taskId !== contractRecord.taskId) {
      add({ path: "taskId", code: root?.taskId === undefined ? "missing_required" : "value_mismatch", expected: "exact contracted taskId" });
    }
    if (typeof root?.stage !== "string" || root.stage !== contractRecord.stage) {
      add({ path: "stage", code: root?.stage === undefined ? "missing_required" : "value_mismatch", expected: "exact contracted stage" });
    }
  }
  const metadataRecord = root !== null && isJsonRecord((root.metadata ?? null) as Json) ? root.metadata as JsonRecord : null;
  if (metadataRecord !== null) for (const key of ["createdAt", "agentVersion"]) {
    if (typeof metadataRecord[key] !== "string") add({ path: `metadata.${key}`, code: metadataRecord[key] === undefined ? "missing_required" : "wrong_type", expected: "string", actualType: structuralType(metadataRecord[key]) });
  }
  if (typeof root?.taskDescription === "string") {
    const contract = (input as unknown as { contract?: unknown }).contract;
    if (isJsonRecord((contract ?? null) as Json)) {
      // Contract path: identity is carried by taskId/stage exact echo (checked
      // below); the description is descriptive prose, never a verbatim copy.
      if (!isRelevantResearchDescription(input.task.description, root.taskDescription)) {
        add({ path: "taskDescription", code: "value_mismatch", expected: "non-empty description relevant to the contracted task" });
      }
    } else if (root.taskDescription !== input.task.description) {
      add({ path: "taskDescription", code: "value_mismatch", expected: "exact requested task description" });
    }
  }
  if (typeof root?.confidence === "number" && (!Number.isFinite(root.confidence) || root.confidence < 0 || root.confidence > 1)) add({ path: "confidence", code: "invalid_enum", expected: "number 0..1", actualType: "number" });
  const validateSource = (value: Json, path: string) => {
    if (!isJsonRecord(value)) { add({ path, code: "wrong_type", expected: "object", actualType: structuralType(value) }); return; }
    for (const [key, expected] of [["id", "number"], ["title", "string"], ["url", "string"], ["snippet", "string"]] as const) {
      if (value[key] === undefined) add({ path: `${path}.${key}`, code: "missing_required", expected });
      else if (structuralType(value[key]) !== expected) add({ path: `${path}.${key}`, code: "wrong_type", expected, actualType: structuralType(value[key]) });
    }
  };
  const validateCitation = (value: Json, path: string) => {
    if (!isJsonRecord(value)) { add({ path, code: "wrong_type", expected: "object", actualType: structuralType(value) }); return; }
    for (const [key, expected] of [["sourceId", "number"], ["text", "string"]] as const) {
      if (value[key] === undefined) add({ path: `${path}.${key}`, code: "missing_required", expected });
      else if (structuralType(value[key]) !== expected) add({ path: `${path}.${key}`, code: "wrong_type", expected, actualType: structuralType(value[key]) });
    }
  };
  if (Array.isArray(root?.sources)) root.sources.slice(0, 5).forEach((value, index) => validateSource(value, `sources[${index}]`));
  if (Array.isArray(root?.citations)) root.citations.slice(0, 5).forEach((value, index) => validateCitation(value, `citations[${index}]`));
  const strategyMode = (input as unknown as { strategyMode?: unknown }).strategyMode === "PRE_PUBLICATION_STRATEGY";
  if (strategyMode) {
    const findings = root?.strategyFindings;
    if (!isJsonRecord((findings ?? null) as Json)) add({ path: "strategyFindings", code: findings === undefined ? "missing_required" : "wrong_type", expected: "object", actualType: structuralType((findings ?? null) as Json) });
    else {
      const findingsRecord = findings as JsonRecord;
      const allKeys = [...STRATEGY_FINDING_KEYS, "platformFindings"] as const;
      for (const key of allKeys) {
        const value = findingsRecord[key];
        const min = key === "platformFindings" ? 3 : 1, max = key === "platformFindings" ? 3 : 5;
        if (!Array.isArray(value)) { add({ path: `strategyFindings.${key}`, code: value === undefined ? "missing_required" : "wrong_type", expected: "array", actualType: structuralType(value as Json) }); continue; }
        if (value.length < min) add({ path: `strategyFindings.${key}`, code: "too_small", expected: min, actualCount: value.length });
        if (value.length > max) add({ path: `strategyFindings.${key}`, code: "too_large", expected: max, actualCount: value.length });
        value.slice(0, 5).forEach((item, index) => {
          if (!isJsonRecord(item)) { add({ path: `strategyFindings.${key}[${index}]`, code: "wrong_type", expected: "object", actualType: structuralType(item) }); return; }
          for (const field of ["label", "rationale", "certainty"] as const) if (typeof item[field] !== "string") add({ path: `strategyFindings.${key}[${index}].${field}`, code: item[field] === undefined ? "missing_required" : "wrong_type", expected: "string", actualType: structuralType(item[field]) });
          if (typeof item.certainty === "string" && !["KNOWN", "OBSERVED", "INFERRED", "ASSUMED", "UNKNOWN"].includes(item.certainty)) add({ path: `strategyFindings.${key}[${index}].certainty`, code: "invalid_enum", expected: "KNOWN|OBSERVED|INFERRED|ASSUMED|UNKNOWN", actualType: "string" });
          if (key === "platformFindings" && (!isJsonRecord(item) || !["Instagram Reels", "YouTube Shorts", "TikTok"].includes(String(item.platform)))) add({ path: `strategyFindings.platformFindings[${index}].platform`, code: "invalid_enum", expected: "Instagram Reels|YouTube Shorts|TikTok", actualType: structuralType(item.platform) });
        });
      }
    }
  }
  return { validationKind: "STRUCTURAL", issues, shape: { topLevelKeys: top.keys, strategyFindingKeys: strategyKeys.keys, truncated: top.truncated || strategyKeys.truncated }, diagnosticsTruncated: issues.length >= 20 };
}

function isStrategyFinding(value: Json): boolean {
  return isJsonRecord(value)
    && typeof value.label === "string" && value.label.trim().length > 0 && value.label.length <= 90
    && typeof value.rationale === "string" && value.rationale.trim().length >= 12 && value.rationale.length <= 220
    && ["KNOWN", "OBSERVED", "INFERRED", "ASSUMED", "UNKNOWN"].includes(String(value.certainty));
}

function hasBoundedStrategyFindings(value: Json): boolean {
  if (!isJsonRecord(value)) return false;
  if (!STRATEGY_FINDING_KEYS.every((key) => Array.isArray(value[key]) && value[key].length >= 1 && value[key].length <= 5 && value[key].every(isStrategyFinding))) return false;
  const platforms = value.platformFindings;
  return Array.isArray(platforms) && platforms.length === 3 && platforms.every((item) => isStrategyFinding(item)
    && isJsonRecord(item) && ["Instagram Reels", "YouTube Shorts", "TikTok"].includes(String(item.platform)));
}

export class ResearchAgent extends BaseAgent {
  readonly id: AgentId = "research";
  readonly name = "Research Agent";
  readonly version = "1.0.0";

  private readonly researchConfig: ResearchConfig;
  private readonly sourceRouter?: ResearchSourceRouter;

  constructor(deps: ResearchAgentDependencies) {
    super(deps);
    this.researchConfig = deps.config;
    this.sourceRouter = deps.sourceRouter;
  }

  /** Execute a normalized source research request without changing legacy task callers. */
  async executeSourceRequest(request: ResearchRequest): Promise<ContentIntelligenceResult> {
    if (this.sourceRouter === undefined) throw new Error("Research source router is not configured");
    return this.sourceRouter.execute(request);
  }

  async execute(input: AgentExecutionInput, signal: CancellationToken): Promise<AgentExecutionOutput> {
    signal?.throwIfCancelled();

    if (!isResearchAgentInput(input.input)) {
      throw new Error("Invalid research input: expected a research task");
    }

    const researchInput = input.input;
    const { report: baseReport, response: executionResponse } = await this.createReport(researchInput, input.context, signal);
    const intelligence = researchInput.researchRequest === undefined
      ? undefined
      : await this.executeSourceRequest(researchInput.researchRequest);
    const report = intelligence === undefined ? baseReport : { ...baseReport, intelligence };
    const capabilityExecutions = researchInput.capabilityRequests === undefined
      ? []
      : await this.runCapabilities(researchInput.capabilityRequests);
    const baseOutput = this.toJson(report);
    const output: Json = capabilityExecutions.length > 0 && isJsonRecord(baseOutput)
      ? { ...baseOutput, capabilityExecutions: JSON.parse(JSON.stringify(capabilityExecutions)) as Json[] }
      : baseOutput;

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

    const response = await this.runExecution(context, request, signal);
    return {
      report: this.parseResearchResponse(response.output, input),
      response,
    };
  }

  private buildResearchPrompt(input: ResearchAgentInput): string {
    const { task } = input;
    const strategyMode = (input as unknown as { strategyMode?: unknown }).strategyMode === "PRE_PUBLICATION_STRATEGY";
    if (strategyMode) {
      const evidence = isJsonRecord((input as unknown as JsonRecord).strategyEvidence)
        ? (input as unknown as JsonRecord).strategyEvidence
        : {};
      return `PRE_PUBLICATION_STRATEGY. Return only the required compact JSON object; no analysis before or after it. Do not expose chain-of-thought. Use only EVIDENCE and mark uncertainty rather than speculate.\n
Echo TASK_ID exactly into taskId (byte-for-byte, never paraphrased): ${JSON.stringify(task.id)}\n
Describe the requested task in your own words into taskDescription (do NOT copy verbatim; keep it clearly about the requested task): ${JSON.stringify(task.description)}\n
Required report fields: reportId (string UUID); taskId (string, exact TASK_ID echo); taskDescription (string); summary (string, max 900 chars); confidence (number 0..1); metadata {createdAt:string,agentVersion:string}.\n
sources must contain 2-5 objects, each {id:number,title:string,url:string,snippet:string}; each snippet max 240 chars. citations must contain 2-5 objects, each {sourceId:number,text:string}; every sourceId must equal a sources.id.\n
strategyFindings must contain arrays referencePatterns, audienceOpportunities, contentTerritories, differentiationOpportunities, productionImplications, risks, assumptions, unknowns (each 1-5 objects), plus platformFindings (exactly 3 objects). Every finding object is {label:string,rationale:string,certainty:"KNOWN"|"OBSERVED"|"INFERRED"|"ASSUMED"|"UNKNOWN"}; label max 90 chars; rationale 12-220 chars. Each platformFindings item additionally has platform exactly "Instagram Reels", "YouTube Shorts", or "TikTok". Keep conclusions concise.\n
EVIDENCE:\n${JSON.stringify(evidence)}`;
    }

    const contract = isJsonRecord((input as unknown as JsonRecord).contract)
      ? (input as unknown as JsonRecord).contract
      : null;
    const projectContext = isJsonRecord((input as unknown as JsonRecord).projectContext)
      ? (input as unknown as JsonRecord).projectContext
      : null;
    return `${this.researchConfig.systemPrompt}

Research task:
- Id: ${task.id}
- Name: ${task.name}
- Description: ${task.description}
- Assigned agent: ${task.agent}
- Dependencies: ${task.dependencies.join(", ") || "none"}
${contract !== null ? `- Contract taskId (echo EXACTLY into taskId, byte-for-byte, never paraphrased): ${JSON.stringify((contract as JsonRecord).taskId ?? task.id)}\n- Contract stage (echo EXACTLY into stage): ${JSON.stringify((contract as JsonRecord).stage ?? "research")}\n- Describe the task in your own words into taskDescription (do NOT copy the description verbatim; keep it clearly about the requested task).\n` : ``}
${projectContext !== null ? `PROJECT CONTEXT (canonical brand/strategy facts — use these, never improvise brand strategy):\n${JSON.stringify(projectContext).slice(0, 2000)}\n` : `PROJECT CONTEXT: none supplied. If brand strategy is required and missing, say so explicitly with low confidence; do not invent it.\n`}
Research intent: find candidate real-world factual stories (real historical events, unusual documented facts, discoveries, science, innovation, human stories) suitable for short-form visual storytelling. Seek claims supportable by reputable sources. This is a CAPABILITY PLAN if no retrieval has run yet: when you have no retrieved evidence, return empty sources with low confidence and a clear plan — governed web.search executes after your response and your result is evaluated against retrieved evidence.
Never claim media generation, publication, upload, or any production authority.

Expected task input schema:
${JSON.stringify(task.inputSchema, null, 2)}

Expected task output schema:
${JSON.stringify(task.outputSchema, null, 2)}

Produce a valid ResearchReport JSON with:
- reportId (UUID)
- taskId (string, exact contract taskId echo when a contract taskId is given above)
- stage (string, exact contract stage echo when given)
- taskDescription (string)
- summary (string)
- sources (array of identified sources)
- confidence (number from 0 to 1)
- citations (array that references source ids)
- metadata (createdAt and agentVersion)

When visual grounding is needed, also include optional visual data with topic, visualMode, referenceStrategy, imageRefs, sourceRefs, observations, people/wardrobe, environment/location, objects, style cues, avoid cues, scene relevance, and provenance. Keep web visual evidence distinct from web text evidence; do not invent image URLs.

Every citation sourceId must refer to an item in sources. Do not invent sources, URLs, or citations.`;
  }

  private buildExecutionRequest(prompt: string): ExecutionRequest {
    const strategyMode = prompt.startsWith("PRE_PUBLICATION_STRATEGY.");
    return {
      model: this.researchConfig.model,
      system: strategyMode ? STRATEGY_RESEARCH_SYSTEM_PROMPT : this.researchConfig.systemPrompt,
      messages: [
        { role: "system", content: strategyMode ? STRATEGY_RESEARCH_SYSTEM_PROMPT : this.researchConfig.systemPrompt },
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
        taskId: { type: "string" },
        stage: { type: "string" },
        taskDescription: { type: "string" },
        summary: { type: "string" },
        sources: {
          type: "array",
          minItems: 1,
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
        visual: {
          type: "object",
          description: "Optional provider-agnostic visual research contract; validate in the agent parser.",
        },
        metadata: {
          type: "object",
          properties: {
            createdAt: { type: "string" },
            agentVersion: { type: "string" },
          },
          required: ["createdAt", "agentVersion"],
        },
        strategyFindings: {
          type: "object",
          properties: {
            referencePatterns: { type: "array", minItems: 1, maxItems: 5, items: { type: "object" } },
            audienceOpportunities: { type: "array", minItems: 1, maxItems: 4, items: { type: "object" } },
            contentTerritories: { type: "array", minItems: 1, maxItems: 5, items: { type: "object" } },
            platformFindings: { type: "array", minItems: 3, maxItems: 3, items: { type: "object" } },
            differentiationOpportunities: { type: "array", minItems: 1, maxItems: 4, items: { type: "object" } },
            productionImplications: { type: "array", minItems: 1, maxItems: 4, items: { type: "object" } },
            risks: { type: "array", minItems: 1, maxItems: 5, items: { type: "object" } },
            assumptions: { type: "array", minItems: 1, maxItems: 5, items: { type: "object" } },
            unknowns: { type: "array", minItems: 1, maxItems: 5, items: { type: "object" } },
          },
        },
      },
      required: ["reportId", "taskDescription", "summary", "sources", "confidence", "citations", "metadata"],
    };
  }

  private parseResearchResponse(output: Json, input: ResearchAgentInput): ResearchReport {
    const structuralDiagnostics = diagnoseResearchStructure(output, input);
    if (structuralDiagnostics.issues.length > 0) throw new ResearchStructuralValidationError(structuralDiagnostics);
    if (!isJsonRecord(output)) throw new ResearchStructuralValidationError(structuralDiagnostics);

    const { reportId, taskDescription, summary, confidence, metadata } = output;
    if (typeof reportId !== "string" || typeof taskDescription !== "string" || typeof summary !== "string" || typeof confidence !== "number" || !isJsonRecord(metadata) || !Array.isArray(output.sources) || !Array.isArray(output.citations)) throw new ResearchStructuralValidationError(structuralDiagnostics);

    // Contract identity: stable taskId/stage exact echo under a contract;
    // legacy exact description match otherwise. Authority runs independently.
    validateResearchContractIdentity(output, input);
    assertResearchAuthorityBoundary(output);

    const sources = output.sources.map((source) => this.parseSource(source));
    const citations = output.citations.map((citation) => this.parseCitation(citation));
    if (output.visual !== undefined && !isVisualResearchResult(output.visual)) {
      throw new Error("Invalid research response: malformed visual research contract");
    }
    const sourceIds = new Set(sources.map((source) => source.id));
    if (citations.some((citation) => !sourceIds.has(citation.sourceId))) {
      throw new Error("Invalid research response: citation references an unknown source");
    }
    const strategyMode = (input as unknown as { strategyMode?: unknown }).strategyMode === "PRE_PUBLICATION_STRATEGY";
    if (strategyMode && (
      summary.length > 900 || sources.length < 2 || sources.length > 5 || citations.length < 2 || citations.length > 5
      || sources.some((source) => source.snippet.length > 240)
      || !hasBoundedStrategyFindings(output.strategyFindings ?? null)
    )) {
      throw new Error("Invalid research response: invalid bounded strategy findings");
    }

    return {
      reportId,
      ...(typeof output.taskId === "string" ? { taskId: output.taskId } : {}),
      ...(typeof output.stage === "string" ? { stage: output.stage } : {}),
      taskDescription,
      summary,
      sources,
      confidence,
      citations,
      ...(output.strategyFindings === undefined ? {} : { strategyFindings: output.strategyFindings as unknown as ResearchReport["strategyFindings"] }),
      ...(output.intelligence === undefined ? {} : { intelligence: output.intelligence as unknown as ResearchReport["intelligence"] }),
      ...(output.visual === undefined ? {} : { visual: output.visual }),
      metadata: {
        createdAt: metadata.createdAt as string,
        agentVersion: metadata.agentVersion as string,
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
      ...(report.taskId === undefined ? {} : { taskId: report.taskId }),
      ...(report.stage === undefined ? {} : { stage: report.stage }),
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
      ...(report.strategyFindings === undefined ? {} : { strategyFindings: report.strategyFindings as unknown as Json }),
      ...(report.intelligence === undefined ? {} : { intelligence: JSON.parse(JSON.stringify(report.intelligence)) as Json }),
      ...(report.visual === undefined ? {} : { visual: JSON.parse(JSON.stringify(report.visual)) as Json }),
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
