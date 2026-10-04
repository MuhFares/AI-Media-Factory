/**
 * Research Agent implementation.
 * Extends BaseAgent to produce structured research reports from research tasks.
 */

import type { AgentId, Json } from "@ai-media-factory/runtime";
import type { ExecutionContext, ExecutionResponse, CancellationToken } from "@ai-media-factory/runtime";
import { BaseAgent, type BaseAgentDependencies, type AgentExecutionInput, type AgentExecutionOutput } from "@ai-media-factory/runtime";
import type { ExecutionRequest } from "@ai-media-factory/runtime";
import type { CapabilityRequest } from "@ai-media-factory/tool-framework";
import { isVisualResearchResult, WEB_SEARCH_MAX_QUERY_LENGTH } from "@ai-media-factory/tool-framework";
import type {
  ResearchAgentInput,
  ResearchCallUsage,
  ResearchCitation,
  ResearchConfig,
  ResearchPlan,
  ResearchReport,
  ResearchSource,
  ResearchMission,
  CandidateOpportunity,
  CandidateVerificationPlan,
  ResearchCandidateStory,
} from "./research-types.js";
import type { ContentIntelligenceResult, ResearchRequest, ResearchSourceRouter } from "./content-intelligence.js";

/** Research Agent dependencies. */
export interface ResearchAgentDependencies extends BaseAgentDependencies {
  config: ResearchConfig;
  sourceRouter?: ResearchSourceRouter;
  /** Canonical runtime clock; injectable so date ownership is deterministic in tests. */
  now?: () => Date;
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

/** Deterministic reason codes for research capability lifecycle outcomes. Never silent. */
export type ResearchCapabilityReasonCode =
  | "CAPABILITY_COMPLETED"
  | "MISSING_PROVIDER_BOUNDARY"
  | "CAPABILITY_NOT_REGISTERED"
  | "CAPABILITY_NOT_AUTHORIZED"
  | "CAPABILITY_TRANSPORT_FAILED"
  | "CAPABILITY_EXECUTION_FAILED";

/** Lifecycle states for a requested research capability. */
export type ResearchCapabilityLifecycleState =
  | "REQUESTED"
  | "AUTHORIZED"
  | "EXECUTING"
  | "COMPLETED"
  | "BLOCKED"
  | "FAILED";

/** Map a thrown capability error to a deterministic, secret-free reason code. */
export function classifyResearchCapabilityError(error: unknown): ResearchCapabilityReasonCode {
  const message = error instanceof Error ? error.message : String(error);
  if (/NOT_REGISTERED|not registered|unknown capability|unsupported capability/i.test(message)) return "CAPABILITY_NOT_REGISTERED";
  if (/NOT_AUTHORIZED|not authorized|forbidden|grant/i.test(message)) return "CAPABILITY_NOT_AUTHORIZED";
  if (/timeout|network|transport|fetch|ECONN|ENOTFOUND|EACCES|503|502|500|429/i.test(message)) return "CAPABILITY_TRANSPORT_FAILED";
  return "CAPABILITY_EXECUTION_FAILED";
}

/** Capability result with an explicit lifecycle trail and reason code (no silent skips). */
export interface ResearchCapabilityOutcome {
  readonly result: Json;
  readonly lifecycle: readonly ResearchCapabilityLifecycleState[];
  readonly reasonCode: ResearchCapabilityReasonCode;
}

/**
 * Canonical bounded failure taxonomy for Research Final Synthesis. Pure
 * classifier over a thrown error's message plus its attached safe
 * diagnostics (never raw provider bodies): production, probes, and tests
 * share it so every synthesis failure carries the same durable family, code,
 * and bounded issue paths. Validation behavior is unchanged.
 */
export type SynthesisFailureFamily =
  | "PROVIDER_HTTP_ERROR"
  | "PROVIDER_RESPONSE_INCOMPLETE"
  | "OUTPUT_TOKEN_LIMIT_EXHAUSTION"
  | "JSON_PARSE_FAILURE"
  | "STRUCTURAL_SCHEMA_FAILURE"
  | "STATUS_CANDIDATE_COHERENCE_FAILURE"
  | "VISUAL_CONTRACT_FAILURE"
  | "SOURCE_LINKAGE_FAILURE"
  | "CITATION_LINKAGE_FAILURE"
  | "IDENTITY_FAILURE"
  | "CONFIDENCE_FAILURE"
  | "CANDIDATE_SEMANTIC_FAILURE"
  | "AUTHORITY_BOUNDARY_FAILURE"
  | "UNKNOWN_VALIDATION_FAILURE";

export interface SynthesisFailureClassification {
  readonly family: SynthesisFailureFamily;
  readonly code: string | null;
  readonly paths: readonly string[];
}

export function classifySynthesisFailure(error: unknown): SynthesisFailureClassification {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const diagnostics = isJsonRecord(((error as { diagnostics?: unknown } | null)?.diagnostics ?? null) as Json)
    ? ((error as { diagnostics?: unknown }).diagnostics as JsonRecord)
    : {};
  const rawIssues = Array.isArray(diagnostics.issues) ? diagnostics.issues : [];
  const paths = rawIssues
    .filter((issue): issue is JsonRecord => isJsonRecord(issue as Json) && typeof (issue as JsonRecord).path === "string")
    .map((issue) => String((issue as JsonRecord).path).slice(0, 160))
    .slice(0, 10);
  const issue = isJsonRecord(rawIssues[0] as Json) ? (rawIssues[0] as JsonRecord) : null;
  const issueCode = typeof issue?.code === "string" ? String(issue.code) : null;
  const termination = typeof diagnostics.terminationReason === "string" ? String(diagnostics.terminationReason) : null;
  if (diagnostics.incomplete === true) {
    return termination === "length"
      ? { family: "OUTPUT_TOKEN_LIMIT_EXHAUSTION", code: termination, paths }
      : { family: "PROVIDER_RESPONSE_INCOMPLETE", code: termination, paths };
  }
  if (typeof diagnostics.httpStatus === "number" && diagnostics.httpStatus !== 200) {
    return { family: "PROVIDER_HTTP_ERROR", code: `HTTP_${diagnostics.httpStatus}`, paths };
  }
  if (/unauthorized media\/publication action/.test(message)) {
    return { family: "AUTHORITY_BOUNDARY_FAILURE", code: "OWNER_AUTHORITY_BOUNDARY", paths };
  }
  if (/malformed visual research contract/.test(message)) {
    return { family: "VISUAL_CONTRACT_FAILURE", code: "value_mismatch", paths };
  }
  if (/citation references an unknown source/.test(message)) {
    return { family: "CITATION_LINKAGE_FAILURE", code: "value_mismatch", paths };
  }
  if (/non-JSON output/.test(message) || diagnostics.validationStage === "parse") {
    return { family: "JSON_PARSE_FAILURE", code: typeof diagnostics.validationCode === "string" ? String(diagnostics.validationCode) : "parse", paths };
  }
  if (/invalid report structure/.test(message)) {
    const head = paths[0] ?? "";
    if (head === "candidateStories" || head.startsWith("candidateStories[")) {
      const expected = typeof issue?.expected === "string" ? String(issue.expected) : "";
      if (/empty array for insufficient_evidence|at least one candidate for grounded/.test(expected)) {
        return { family: "STATUS_CANDIDATE_COHERENCE_FAILURE", code: issueCode, paths };
      }
      if (head.startsWith("candidateStories[")) {
        return { family: "CANDIDATE_SEMANTIC_FAILURE", code: issueCode, paths };
      }
      return { family: "STRUCTURAL_SCHEMA_FAILURE", code: issueCode, paths };
    }
    if (head.startsWith("sources")) return { family: "SOURCE_LINKAGE_FAILURE", code: issueCode, paths };
    if (head.startsWith("citations")) return { family: "CITATION_LINKAGE_FAILURE", code: issueCode, paths };
    if (head === "reportId" || head === "taskId" || head === "stage" || head === "taskDescription") {
      return { family: "IDENTITY_FAILURE", code: issueCode, paths };
    }
    if (head === "confidence") return { family: "CONFIDENCE_FAILURE", code: issueCode, paths };
    return { family: "STRUCTURAL_SCHEMA_FAILURE", code: issueCode, paths };
  }
  return { family: "UNKNOWN_VALIDATION_FAILURE", code: issueCode, paths };
}

/** Bounded per-call LLM usage for budget attribution (never negative/NaN). */
function toCallUsage(usage: unknown): ResearchCallUsage {
  const record = (usage ?? {}) as unknown as Record<string, unknown>;
  const integer = (value: unknown): number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const cost = typeof record.costUsd === "number" && Number.isFinite(record.costUsd) && record.costUsd >= 0 ? record.costUsd : 0;
  return { inputTokens: integer(record.inputTokens), outputTokens: integer(record.outputTokens), costUsd: cost };
}

/** Safe record coercion for deterministic evidence handling (never throws). */
function safeRecord(value: Json): JsonRecord {
  return isJsonRecord(value) ? value : {};
}

/** Recovery-attempt scope suffix for per-attempt capability identities. */
function recoveryScopeSuffix(input: ResearchAgentInput): string {
  const id = (input as unknown as { recoveryScopeId?: unknown }).recoveryScopeId;
  return typeof id === "string" && id.trim() !== "" ? `:recovery:${id.trim()}` : "";
}

export interface ResearchCapabilityInvocationIdentityInput {
  readonly workflowId: string;
  readonly executionScopeId?: string;
  readonly taskId: string;
  readonly capabilityId: string;
  readonly role: "DISCOVERY" | "VERIFICATION";
  readonly laneId: string;
  readonly queryOrdinal: number;
  readonly attemptOrdinal: number;
}

const identityPart = (value: string): string => encodeURIComponent(value.trim().toLowerCase());

/**
 * Deterministic durable identity for one logical Research capability call.
 * Replaying the same logical invocation produces the same id; changing its
 * workflow, execution, lane, query ordinal, attempt, role, or capability
 * produces a different id. Provider response content is deliberately absent.
 */
export function researchCapabilityInvocationIdentity(input: ResearchCapabilityInvocationIdentityInput): string {
  if (!input.workflowId.trim() || !input.taskId.trim() || !input.capabilityId.trim() || !input.laneId.trim()) {
    throw new Error("RESEARCH_CAPABILITY_IDENTITY_COMPONENT_REQUIRED");
  }
  if (!Number.isSafeInteger(input.queryOrdinal) || input.queryOrdinal < 1
    || !Number.isSafeInteger(input.attemptOrdinal) || input.attemptOrdinal < 1) {
    throw new Error("RESEARCH_CAPABILITY_IDENTITY_ORDINAL_INVALID");
  }
  const execution = input.executionScopeId?.trim() || "initial";
  return [
    "research-capability-v2",
    identityPart(input.workflowId),
    identityPart(execution),
    identityPart(input.taskId),
    identityPart(input.capabilityId),
    input.role.toLowerCase(),
    identityPart(input.laneId),
    `q${input.queryOrdinal}`,
    `a${input.attemptOrdinal}`,
  ].join(":");
}

/**
 * Deterministic lane-evidence zip: flatten successful retrieval results across
 * bounded discovery executions, preserving lane association. Empty/blocked/
 * failed executions contribute nothing (honest, never invented).
 */
function zipLaneEvidence(
  requests: readonly MissionCapabilityRequest[],
  executions: readonly unknown[],
): { result: Json; laneId: string }[] {
  const zipped: { result: Json; laneId: string }[] = [];
  const count = Math.min(requests.length, executions.length);
  for (let index = 0; index < count; index += 1) {
    const request = requests[index];
    const execution = executions[index];
    if (!isJsonRecord(execution as Json)) continue;
    const record = execution as unknown as JsonRecord;
    if (record.status !== "success") continue;
    const output = isJsonRecord((record.output ?? null) as Json) ? (record.output as JsonRecord) : null;
    const results = output !== null && Array.isArray(output.results) ? output.results : [];
    const laneRaw = (request.input as Record<string, unknown>).laneId;
    const laneId = typeof laneRaw === "string" && laneRaw.trim().length > 0 ? laneRaw : "unknown";
    for (const item of results.slice(0, 5)) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
      zipped.push({ result: item as Json, laneId });
      if (zipped.length >= MAX_CANDIDATES * 2) break;
    }
    if (zipped.length >= MAX_CANDIDATES * 2) break;
  }
  return zipped;
}

/** Successfully retrieved web results across capability executions (evidence for synthesis). */
function collectSuccessfulRetrievals(capabilityExecutions: readonly unknown[]): { providerId: string; results: { id?: unknown; title?: unknown; url?: unknown; snippet?: unknown; source?: unknown }[] }[] {
  const collected: { providerId: string; results: { id?: unknown; title?: unknown; url?: unknown; snippet?: unknown; source?: unknown }[] }[] = [];
  for (const item of capabilityExecutions) {
    if (!isJsonRecord(item as Json)) continue;
    const record = item as JsonRecord;
    if (record.status !== "success") continue;
    const output = record.output !== null && typeof record.output === "object" && !Array.isArray(record.output)
      ? record.output as JsonRecord
      : null;
    const results = output !== null && Array.isArray(output.results) ? output.results : [];
    if (results.length === 0) continue;
    collected.push({
      providerId: typeof output?.providerId === "string" ? output.providerId as string : "web.search",
      results: (results as unknown[]).filter((row): row is { id?: unknown; title?: unknown; url?: unknown; snippet?: unknown; source?: unknown } => row !== null && typeof row === "object"),
    });
  }
  return collected;
}

/** A discovery or verification retrieval request declared by the mission. */
export interface MissionCapabilityRequest extends CapabilityRequest<JsonRecord> {
  readonly requestId: string;
  readonly capabilityId: string;
  readonly input: JsonRecord;
}

/** Runtime-owned, executable retrieval plan entry materialized from a mission lane. */
export interface ExecutableRetrievalPlanEntry {
  readonly retrievalId: string;
  readonly laneId: string;
  readonly purpose: string;
  readonly capabilityId: "web.search";
  readonly rawQuery: string;
  readonly compiledQuery: string;
  readonly finalizedQuery: string;
  readonly semanticRequirements: readonly WebSearchSemanticRequirement[];
  readonly retainedOutsideProviderQuery: readonly RetainedQueryContext[];
  readonly packingTrace: WebSearchPackingTrace;
  readonly role: "DISCOVERY";
  readonly accountingOrdinal: number;
  readonly request: MissionCapabilityRequest;
}

/** Deterministic verification-query builder (mirrors the worker-side contract). */
export function buildVerificationQueryFor(candidateTopic: string, maxLength = WEB_SEARCH_MAX_QUERY_LENGTH): string {
  const topicWords = deduplicateQueryWords([candidateTopic]).split(/\s+/u).filter(Boolean);
  if (topicWords.length === 0) throw new Error("VERIFICATION_CANDIDATE_REQUIRED");
  const authority = ["museum", "archive", "university", "official", "sources", "evidence"];
  const minimum = deduplicateQueryWords([topicWords[0] ?? "", ...authority]);
  if (minimum.length > maxLength) throw new Error("LOCAL_QUERY_COMPILATION_FAILED:verification:MANDATORY_SEMANTICS_DO_NOT_FIT");
  const packed: string[] = [];
  for (const word of [...topicWords, ...authority]) {
    const candidate = deduplicateQueryWords([...packed, word]);
    if (candidate.length <= maxLength) packed.push(word);
  }
  return deduplicateQueryWords(packed);
}

/** Maximum discovery retrieval requests per V2 execution (bounded). */
export const MAX_DISCOVERY_REQUESTS = 3;
/** Maximum verification retrieval requests per V2 execution (bounded). */
export const MAX_VERIFICATION_REQUESTS = 3;
/** Maximum candidates formed per V2 execution (bounded). */
export const MAX_CANDIDATES = 6;
/**
 * Minimum output-token budget for the FINAL_SYNTHESIS leg. Proven by live
 * incident: a 4096-capped synthesis exhausted exactly 4096/4096 completion
 * tokens (2232 reasoning + visible JSON in flight) with finish_reason=length
 * while the same-model Direction leg completed at 2113. The floor never
 * lowers an explicitly larger configuration and changes no call counts.
 */
export const FINAL_SYNTHESIS_MIN_OUTPUT_TOKENS = 8192;

/** Canonical discovery lane ids (missions should prefer these; custom ids allowed with purpose). */
export const CANONICAL_DISCOVERY_LANES = [
  "TREND_SIGNAL",
  "SOCIAL_CONTENT_SIGNAL",
  "SEARCH_DEMAND",
  "COMPETITOR_PATTERN",
  "HISTORICAL_OPPORTUNITY",
  "CURRENT_EVENT_CONNECTION",
  "SEASONAL_CALENDAR",
  "EVERGREEN_CURIOSITY",
  "FACTUAL_ARCHIVE_DISCOVERY",
] as const;

export interface DiscoveryQueryQuality {
  hasGeographyContext: boolean;
  hasHistoricalIntent: boolean;
  hasConcreteCandidateIntent: boolean;
  hasEvidenceIntent: boolean;
  hasLaneIntent: boolean;
  hasMarketLanguageContext: boolean;
  providerSuitable: boolean;
  nonGeneric: boolean;
  passes: boolean;
}

export type QuerySemanticPriority = "TIER_1_REQUIRED" | "TIER_2_HIGH_VALUE" | "TIER_3_LINEAGE_ONLY";

export interface WebSearchSemanticRequirement {
  readonly dimension: string;
  readonly priority: QuerySemanticPriority;
  readonly compactTerms: readonly string[];
  readonly canonicalSource: string;
}

export interface RetainedQueryContext {
  readonly dimension: string;
  readonly value: string;
  readonly reason: string;
}

export interface WebSearchPackingTrace {
  readonly originalQuery: string;
  readonly providerQuery: string;
  readonly retainedDimensions: readonly string[];
  readonly retainedOutsideProviderQuery: readonly RetainedQueryContext[];
  readonly droppedInstructionalProse: boolean;
}

export interface PackedWebSearchQuery {
  readonly providerQuery: string;
  readonly semanticRequirements: readonly WebSearchSemanticRequirement[];
  readonly retainedOutsideProviderQuery: readonly RetainedQueryContext[];
  readonly trace: WebSearchPackingTrace;
}

const containsAny = (value: string, patterns: readonly RegExp[]): boolean => patterns.some((pattern) => pattern.test(value));

function normalizedSemanticWords(value: string): string[] {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}._-]+/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);
}

function containsSemanticPhrase(value: string, phrase: string): boolean {
  const haystack = new Set(normalizedSemanticWords(value));
  const required = normalizedSemanticWords(phrase);
  return required.length > 0 && required.every((word) => haystack.has(word));
}

/** Evaluate a discovery query against the structured mission and lane, not length alone. */
export function evaluateDiscoveryQueryQuality(query: string, mission: ResearchMission, lane: Pick<ResearchMission["discoveryLanes"][number], "laneId" | "purpose">): DiscoveryQueryQuality {
  const value = query.toLowerCase();
  const geography = mission.geography ?? mission.market;
  const historical = mission.factualMode === "HISTORICAL_POV";
  const geographyRequired = geography !== null && geography.trim() !== "";
  const marketLanguageRequired = [mission.market, mission.language].some((item) => item !== null && item.trim() !== "");
  // Query packing intentionally removes search-box punctuation. Compare the
  // normalized semantic words instead of requiring punctuation-identical text
  // (for example, `Cairo, Egypt` must match the packed `Cairo Egypt`).
  const hasGeographyContext = !geographyRequired || containsSemanticPhrase(query, geography!);
  const hasHistoricalIntent = !historical || containsAny(value, [/\bhistor(?:y|ic|ical)\b/, /\barchive\b/, /\bheritage\b/, /\banniversar(?:y|ies)\b/]);
  const hasConcreteCandidateIntent = historical
    ? containsAny(value, [/\bnamed\b/, /\bevents?\b/, /\bpeople\b/, /\bpersons?\b/, /\bobjects?\b/, /\bincidents?\b/, /\bfigures?\b/, /\bartifacts?\b/])
    : containsAny(value, [/\bconcepts?\b/, /\bcharacters?\b/, /\bsettings?\b/, /\bstories\b/, /\bvisuals?\b/, /\bideas?\b/]);
  const hasEvidenceIntent = historical
    ? containsAny(value, [/\bevidence\b/, /\bsources?\b/, /\bmuseums?\b/, /\barchives?\b/, /\buniversity\b/, /\binstitution(?:al|s)?\b/, /\breputable\b/, /\bdocumented\b/])
    : containsAny(value, [/\breferences?\b/, /\bvisual inspiration\b/, /\bsource material\b/]);
  const lanePatterns: Record<string, readonly RegExp[]> = {
    HISTORICAL_OPPORTUNITY: [/\bopportunit(?:y|ies)\b/, /\bdiscover(?:y|ies)?\b/, /\bnamed\b/],
    FACTUAL_ARCHIVE_DISCOVERY: [/\barchive\b/, /\binstitution(?:al|s)?\b/, /\bprimary sources?\b/, /\breputable sources?\b/],
    TREND_SIGNAL: [/\bcurrent\b/, /\bsearch signals?\b/, /\bcontent signals?\b/, /\btrend signals?\b/],
    SEASONAL_CALENDAR: [/\bdates?\b/, /\banniversar(?:y|ies)\b/, /\bcalendar\b/, /\bseasonal\b/],
  };
  const laneDescriptor = `${lane.laneId} ${lane.purpose}`.toLowerCase();
  const hasLaneIntent = lanePatterns[lane.laneId] !== undefined
    ? containsAny(value, lanePatterns[lane.laneId]!)
    : /current|relevance|signal|trend|season|calendar/u.test(laneDescriptor)
      ? containsAny(value, [/\bcurrent\b/, /\brelevance\b/, /\bsignals?\b/, /\bdates?\b/, /\bcalendar\b/])
      : /archive|source|evidence|verify|verification/u.test(laneDescriptor)
        ? hasEvidenceIntent
        : historical ? hasHistoricalIntent && hasConcreteCandidateIntent : hasConcreteCandidateIntent;
  const hasMarketLanguageContext = !marketLanguageRequired || [mission.market, mission.language]
    .filter((item): item is string => item !== null && item.trim() !== "")
    .every((item) => containsSemanticPhrase(query, item));
  const wordCount = value.split(/\s+/u).filter(Boolean).length;
  const providerSuitable = query.length <= WEB_SEARCH_MAX_QUERY_LENGTH && wordCount >= 4 && wordCount <= 30 && !/[\r\n]/u.test(query);
  const nonGeneric = historical
    ? hasGeographyContext && hasConcreteCandidateIntent && hasEvidenceIntent
    : hasConcreteCandidateIntent && hasEvidenceIntent;
  return {
    hasGeographyContext,
    hasHistoricalIntent,
    hasConcreteCandidateIntent,
    hasEvidenceIntent,
    hasLaneIntent,
    hasMarketLanguageContext,
    providerSuitable,
    nonGeneric,
    // Audience/platform/editorial context is mission lineage, not a literal
    // requirement for every provider search box query.
    passes: hasGeographyContext && hasHistoricalIntent && hasConcreteCandidateIntent && hasEvidenceIntent && hasLaneIntent && providerSuitable && nonGeneric,
  };
}

/** Compile missing mission dimensions into a bounded, deterministic discovery query. */
export function compileDiscoveryQuery(query: string, mission: ResearchMission, lane: Pick<ResearchMission["discoveryLanes"][number], "laneId" | "purpose">): string {
  const original = query.trim().replace(/\s+/g, " ");
  const quality = evaluateDiscoveryQueryQuality(original, mission, lane);
  if (quality.passes) return original;
  const parts = [original];
  const geography = mission.geography ?? mission.market;
  if (!quality.hasGeographyContext && geography) parts.push(geography);
  if (mission.factualMode === "HISTORICAL_POV") {
    if (!quality.hasHistoricalIntent) parts.push("historical discovery");
    if (!quality.hasConcreteCandidateIntent) parts.push("named events people objects incidents");
    if (!quality.hasEvidenceIntent) parts.push("museum archive reputable sources evidence");
  } else {
    if (!quality.hasConcreteCandidateIntent) parts.push("original fantasy concepts characters settings");
    if (!quality.hasEvidenceIntent) parts.push("creative references visual inspiration");
  }
  const laneIntent: Record<string, string> = {
    HISTORICAL_OPPORTUNITY: "historical opportunity discovery",
    FACTUAL_ARCHIVE_DISCOVERY: "institutional archive primary sources",
    TREND_SIGNAL: "current search content signals",
    SEASONAL_CALENDAR: "historical dates anniversaries calendar",
  };
  if (!quality.hasLaneIntent) parts.push(laneIntent[lane.laneId] ?? lane.purpose);
  if (!quality.hasMarketLanguageContext) {
    if (mission.market) parts.push(`${mission.market} market`);
    if (mission.language) parts.push(`${mission.language} language`);
  }
  return [...new Set(parts.filter(Boolean))].join(" ").replace(/\s+/g, " ").trim();
}

function deduplicateQueryWords(parts: readonly string[]): string {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const word of parts.join(" ").replace(/[^\p{L}\p{N}._-]+/gu, " ").split(/\s+/u).filter(Boolean)) {
    const key = word.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(word);
  }
  return words.join(" ");
}

function compactLaneIntent(lane: Pick<ResearchMission["discoveryLanes"][number], "laneId" | "purpose">): string {
  const descriptor = `${lane.laneId} ${lane.purpose}`.toLowerCase();
  if (/current|relevance|signal|trend|season|calendar/u.test(descriptor)) return "current relevance signals";
  if (/archive|source|evidence|verify|verification/u.test(descriptor)) return "archive evidence discovery";
  return "historical discovery opportunities";
}

function semanticRequirementsForWebSearch(
  mission: ResearchMission,
  lane: Pick<ResearchMission["discoveryLanes"][number], "laneId" | "purpose" | "subjectTerms" | "locationTerms" | "periodTerms" | "factTargets" | "sourcePreferences">,
): { requirements: WebSearchSemanticRequirement[]; outside: RetainedQueryContext[] } {
  const historical = mission.factualMode === "HISTORICAL_POV";
  const geography = mission.geography ?? mission.market;
  const descriptor = `${lane.laneId} ${lane.purpose}`.toLowerCase();
  const currentLane = /current|relevance|signal|trend|season|calendar/u.test(descriptor);
  // Structured retrieval intent (Direction-authored, never heuristically
  // extracted): compact entity terms travel as first-class dimensions so
  // query compaction cannot silently discard candidate specificity.
  const termWords = (value: readonly string[] | undefined): string[] =>
    Array.isArray(value) ? value.flatMap((term) => String(term).split(/\s+/u)).map((word) => word.trim()).filter(Boolean) : [];
  const subjectWords = termWords(lane.subjectTerms).concat(termWords(lane.locationTerms));
  const periodWords = termWords(lane.periodTerms);
  const factWords = termWords(lane.factTargets);
  const authorityWords = historical
    ? [...new Set(["museum", "archive", "university", ...termWords(lane.sourcePreferences)])]
    : [];
  const requirements: WebSearchSemanticRequirement[] = [
    ...(subjectWords.length > 0 ? [{ dimension: "subject_entity", priority: "TIER_1_REQUIRED" as const, compactTerms: subjectWords, canonicalSource: "lane.subjectTerms + lane.locationTerms" }] : []),
    ...(geography ? [{ dimension: "geography", priority: "TIER_1_REQUIRED" as const, compactTerms: deduplicateQueryWords([geography]).split(/\s+/u), canonicalSource: "mission.geography|mission.market" }] : []),
    { dimension: "subject_domain", priority: "TIER_1_REQUIRED", compactTerms: historical ? ["history"] : ["fantasy"], canonicalSource: "mission.factualMode" },
    { dimension: "concrete_discovery_class", priority: "TIER_1_REQUIRED", compactTerms: historical ? ["events", "people", "artifacts", "places"] : ["concepts", "characters", "settings"], canonicalSource: "lane purpose + factual mode" },
    { dimension: "evidence_orientation", priority: "TIER_1_REQUIRED", compactTerms: historical ? ["sources", "evidence"] : ["references", "inspiration"], canonicalSource: "mission.verificationRequirements" },
    ...(historical ? [{ dimension: "authority_preference", priority: "TIER_2_HIGH_VALUE" as const, compactTerms: authorityWords, canonicalSource: "mission.verificationRequirements + lane.queryGuidance + lane.sourcePreferences" }] : []),
    { dimension: "lane_purpose", priority: "TIER_2_HIGH_VALUE", compactTerms: compactLaneIntent(lane).split(/\s+/u), canonicalSource: "lane.laneId + lane.purpose" },
    ...(currentLane ? [{ dimension: "runtime_date", priority: "TIER_2_HIGH_VALUE" as const, compactTerms: [mission.currentDate], canonicalSource: "runtime currentDate" }] : []),
    ...(periodWords.length > 0 ? [{ dimension: "historical_period", priority: "TIER_2_HIGH_VALUE" as const, compactTerms: periodWords, canonicalSource: "lane.periodTerms" }] : []),
    ...(factWords.length > 0 ? [{ dimension: "fact_target", priority: "TIER_2_HIGH_VALUE" as const, compactTerms: factWords, canonicalSource: "lane.factTargets" }] : []),
  ];
  const outside: RetainedQueryContext[] = [
    ...(mission.language ? [{ dimension: "language", value: mission.language, reason: "Audience/language targeting remains in mission lineage; it is not essential lexical search-box semantics." }] : []),
    ...(mission.audience ? [{ dimension: "audience", value: mission.audience, reason: "Audience framing is used during opportunity assessment and synthesis, outside provider query text." }] : []),
    ...(mission.platforms.length > 0 ? [{ dimension: "platforms", value: mission.platforms.join(", "), reason: "Platform intent remains in mission lineage; unsupported social capabilities are not simulated through web.search terms." }] : []),
    { dimension: "content_pillar", value: mission.contentPillar, reason: "Editorial POV and short-form framing remain in mission and synthesis lineage." },
  ];
  return { requirements, outside };
}

/** Deterministically pack rich intent into a search-engine-native provider query. */
export function packWebSearchQuery(
  compiledQuery: string,
  mission: ResearchMission,
  lane: Pick<ResearchMission["discoveryLanes"][number], "laneId" | "purpose" | "subjectTerms" | "locationTerms" | "periodTerms" | "factTargets" | "sourcePreferences">,
  maxLength = WEB_SEARCH_MAX_QUERY_LENGTH,
): PackedWebSearchQuery {
  const normalized = compiledQuery.trim().replace(/\s+/gu, " ");
  const { requirements, outside } = semanticRequirementsForWebSearch(mission, lane);
  if (normalized.length <= maxLength && evaluateDiscoveryQueryQuality(normalized, mission, lane).passes) {
    return {
      providerQuery: normalized,
      semanticRequirements: requirements,
      retainedOutsideProviderQuery: outside,
      trace: { originalQuery: normalized, providerQuery: normalized, retainedDimensions: requirements.map((item) => item.dimension), retainedOutsideProviderQuery: outside, droppedInstructionalProse: false },
    };
  }
  const required = requirements.filter((item) => item.priority === "TIER_1_REQUIRED");
  const highValue = requirements.filter((item) => item.priority === "TIER_2_HIGH_VALUE");
  const requiredQuery = deduplicateQueryWords(required.flatMap((item) => item.compactTerms));
  if (requiredQuery.length === 0 || requiredQuery.length > maxLength) {
    let packed = "";
    let blockingDimension = required[0]?.dimension ?? "unknown";
    for (const requirement of required) {
      const candidate = deduplicateQueryWords([packed, ...requirement.compactTerms]);
      if (candidate.length > maxLength) {
        blockingDimension = requirement.dimension;
        break;
      }
      packed = candidate;
    }
    throw new Error(`LOCAL_QUERY_COMPILATION_FAILED:${lane.laneId}:MANDATORY_SEMANTICS_DO_NOT_FIT:${blockingDimension}`);
  }
  let providerQuery = requiredQuery;
  const retained = required.map((item) => item.dimension);
  for (const requirement of highValue) {
    // Empty term sets contribute nothing and are not recorded, so legacy
    // missions without structured intent keep byte-identical traces.
    if (requirement.compactTerms.length === 0) continue;
    const candidate = deduplicateQueryWords([providerQuery, ...requirement.compactTerms]);
    if (candidate.length <= maxLength) {
      providerQuery = candidate;
      retained.push(requirement.dimension);
    }
  }
  if (!evaluateDiscoveryQueryQuality(providerQuery, mission, lane).passes) {
    const missing = requirements.find((requirement) => !requirement.compactTerms.some((term) => containsSemanticPhrase(providerQuery, term)));
    throw new Error(`LOCAL_QUERY_COMPILATION_FAILED:${lane.laneId}:MANDATORY_SEMANTICS_DO_NOT_FIT:${missing?.dimension ?? "quality_contract"}`);
  }
  return {
    providerQuery,
    semanticRequirements: requirements,
    retainedOutsideProviderQuery: outside,
    trace: { originalQuery: normalized, providerQuery, retainedDimensions: retained, retainedOutsideProviderQuery: outside, droppedInstructionalProse: normalized !== providerQuery },
  };
}

/**
 * Capability-aware finalization for web.search. Long model prose is replaced
 * with a deterministic search-engine query assembled from mandatory mission
 * dimensions in priority order. Nothing is character-sliced: either the full
 * mandatory contract fits, or planning fails locally before capability I/O.
 */
export function finalizeWebSearchQuery(
  compiledQuery: string,
  mission: ResearchMission,
  lane: Pick<ResearchMission["discoveryLanes"][number], "laneId" | "purpose" | "subjectTerms" | "locationTerms" | "periodTerms" | "factTargets" | "sourcePreferences">,
  maxLength = WEB_SEARCH_MAX_QUERY_LENGTH,
): string {
  return packWebSearchQuery(compiledQuery, mission, lane, maxLength).providerQuery;
}

/**
 * Convert descriptive Direction lanes into runtime-complete governed calls.
 * Capability selection is owned by the supplied canonical inventory, never by
 * a model-authored spelling of `actualCapability`. One discovery call is
 * materialized per supported lane so unused envelope remains available for
 * candidate-specific verification.
 */
export function materializeDiscoveryRetrievalPlan(
  mission: ResearchMission,
  scope: { workflowId: string; correlationId: string; taskId: string; recoverySuffix?: string; executionScopeId?: string },
  maxTotal: number,
): ExecutableRetrievalPlanEntry[] {
  const cap = Math.max(0, Math.min(maxTotal, MAX_DISCOVERY_REQUESTS));
  if (cap === 0) return [];
  const supportedWebTypes = new Set(
    mission.availableCapabilities
      .filter((entry) => entry.status === "SUPPORTED" && entry.via.includes("web.search"))
      .map((entry) => entry.sourceType.trim().toUpperCase()),
  );
  const supportedLanes = mission.discoveryLanes.filter((lane) => supportedWebTypes.has(lane.desiredCapability.trim().toUpperCase()));
  const plan: ExecutableRetrievalPlanEntry[] = [];
  for (const lane of supportedLanes) {
    if (plan.length >= cap) break;
    const rawQuery = lane.queryGuidance.trim().replace(/\s+/g, " ");
    if (rawQuery.length === 0 || lane.purpose.trim().length === 0 || lane.laneId.trim().length === 0) {
      throw new Error(`RETRIEVAL_PLAN_MATERIALIZATION_FAILED:${lane.laneId || "unknown"}:REQUIRED_RUNTIME_FIELD_MISSING`);
    }
    const compiledQuery = compileDiscoveryQuery(rawQuery, mission, lane);
    if (compiledQuery.length === 0) {
      throw new Error(`RETRIEVAL_PLAN_MATERIALIZATION_FAILED:${lane.laneId}:QUERY_COMPILATION_FAILED`);
    }
    const packed = packWebSearchQuery(compiledQuery, mission, lane);
    const finalizedQuery = packed.providerQuery;
    const accountingOrdinal = plan.length + 1;
    const retrievalId = `discovery-${lane.laneId}-${accountingOrdinal}`;
    const executionScopeId = scope.executionScopeId
      ?? scope.recoverySuffix?.replace(/^:recovery:/u, "")
      ?? "initial";
    const requestId = researchCapabilityInvocationIdentity({
      workflowId: scope.workflowId,
      executionScopeId,
      taskId: scope.taskId,
      capabilityId: "web.search",
      role: "DISCOVERY",
      laneId: lane.laneId,
      queryOrdinal: accountingOrdinal,
      attemptOrdinal: 1,
    });
    const request: MissionCapabilityRequest = {
      requestId,
      capabilityId: "web.search",
      agentId: "research",
      workflowId: scope.workflowId,
      correlationId: scope.correlationId,
      requestedAt: new Date().toISOString(),
      input: { query: finalizedQuery, maxResults: 5, laneId: lane.laneId, retrievalId, role: "DISCOVERY", accountingOrdinal },
    };
    plan.push({
      retrievalId, laneId: lane.laneId, purpose: lane.purpose, capabilityId: "web.search",
      rawQuery, compiledQuery, finalizedQuery,
      semanticRequirements: packed.semanticRequirements,
      retainedOutsideProviderQuery: packed.retainedOutsideProviderQuery,
      packingTrace: packed.trace,
      role: "DISCOVERY", accountingOrdinal, request,
    });
  }
  if (supportedLanes.length > 0 && plan.length === 0) throw new Error("RETRIEVAL_PLAN_MATERIALIZATION_FAILED:SUPPORTED_CAPABILITY_WITHOUT_EXECUTABLE_CALL");
  return plan;
}
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

export interface RuntimeIdentityEcho {
  readonly field: string;
  readonly canonicalValue: unknown;
  readonly expected: string;
}

export const RESEARCH_DIRECTION_REQUIRED_FIELDS = [
  "taskId", "stage", "missionId", "objective", "market", "geography", "language",
  "platforms", "contentPillar", "factualMode", "audience", "trendMode", "timeHorizon",
  "currentDate", "discoveryLanes", "desiredSourceTypes", "availableCapabilities",
  "unavailableDesiredCapabilities", "searchPriorities", "verificationRequirements",
  "stopConditions", "riskNotes",
] as const;

/** Provider-facing schema for amf-research-mission-v1. Direction is not a ResearchReport. */
export function researchDirectionResponseSchema(): import("@ai-media-factory/runtime").JsonSchema {
  const nullableString: Json = { type: ["string", "null"] };
  const stringArray: Json = { type: "array", items: { type: "string" } };
  const capability: Json = {
    type: "object", additionalProperties: false,
    properties: {
      sourceType: { type: "string" },
      status: { type: "string", enum: ["SUPPORTED", "PARTIALLY_SUPPORTED", "UNSUPPORTED"] },
      via: stringArray,
      limitations: stringArray,
    },
    required: ["sourceType", "status", "via", "limitations"],
  };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      taskId: { type: "string" },
      stage: { type: "string", enum: ["research"] },
      missionId: { type: "string" },
      objective: { type: "string" },
      market: nullableString,
      geography: nullableString,
      language: nullableString,
      platforms: stringArray,
      contentPillar: { type: "string" },
      factualMode: { type: "string", enum: ["HISTORICAL_POV", "ORIGINAL_FANTASY"] },
      audience: nullableString,
      trendMode: { type: "string", enum: ["TREND_LED", "EVERGREEN", "HYBRID"] },
      timeHorizon: {
        type: "object", additionalProperties: false,
        properties: { from: nullableString, to: nullableString },
        required: ["from", "to"],
      },
      currentDate: { type: "string" },
      discoveryLanes: {
        type: "array", minItems: 1, maxItems: 5,
        items: {
          type: "object", additionalProperties: false,
          properties: {
            laneId: { type: "string" }, purpose: { type: "string" }, queryGuidance: { type: "string" },
            desiredCapability: { type: "string" }, actualCapability: { type: "string" },
            maxCalls: { type: "number", minimum: 1, maximum: 3 }, expectedOutput: { type: "string" },
            subjectTerms: { type: "array", description: "Compact named entities / subject phrases for retrieval specificity; [] when exploratory.", items: { type: "string" } },
            locationTerms: { type: "array", description: "Site-level geographical specificity beyond mission geography; [] when none.", items: { type: "string" } },
            periodTerms: { type: "array", description: "Dynasty / century / date range / historical period phrases; [] when none.", items: { type: "string" } },
            factTargets: { type: "array", description: "Claim-shaped phrases stating what needs corroboration; [] when none.", items: { type: "string" } },
            sourcePreferences: { type: "array", description: "Archive / museum / university / government / academic preferences; [] defaults to canonical authority intent.", items: { type: "string" } },
          },
          required: ["laneId", "purpose", "queryGuidance", "desiredCapability", "actualCapability", "maxCalls", "expectedOutput", "subjectTerms", "locationTerms", "periodTerms", "factTargets", "sourcePreferences"],
        },
      },
      desiredSourceTypes: stringArray,
      availableCapabilities: { type: "array", items: capability },
      unavailableDesiredCapabilities: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          properties: { sourceType: { type: "string" }, reason: { type: "string" } },
          required: ["sourceType", "reason"],
        },
      },
      searchPriorities: stringArray,
      verificationRequirements: stringArray,
      stopConditions: stringArray,
      riskNotes: stringArray,
    },
    required: [...RESEARCH_DIRECTION_REQUIRED_FIELDS],
  };
}

/**
 * Narrow provider-free repair primitive. It can only correct the known
 * orchestration label when every mission field is already present at the
 * canonical top level. The caller retains and fingerprints the raw response.
 */
export function normalizeResearchDirectionStageForRecovery(value: Json): JsonRecord {
  if (!isJsonRecord(value)) throw new Error("RESEARCH_DIRECTION_RECOVERY_OBJECT_REQUIRED");
  const missing = RESEARCH_DIRECTION_REQUIRED_FIELDS
    .filter((field) => field !== "stage" && value[field] === undefined);
  if (missing.length > 0) throw new Error(`RESEARCH_DIRECTION_RECOVERY_FIELDS_MISSING:${missing.join(",")}`);
  if (value.stage !== "mission" && value.stage !== "research") {
    throw new Error("RESEARCH_DIRECTION_RECOVERY_STAGE_NOT_NORMALIZABLE");
  }
  return { ...value, stage: "research" };
}

/**
 * Restore exact execution identities that are owned by runtime input rather
 * than model reasoning. Missing identities are injected only from a known,
 * non-empty canonical string; exact echoes are preserved; conflicts and
 * absent canonical sources fail through the ordinary structural validator.
 */
export function normalizeRuntimeIdentityEchoes(record: JsonRecord, identities: readonly RuntimeIdentityEcho[]): JsonRecord {
  const normalized = { ...record };
  const fail = (field: string, code: ResearchStructuralIssue["code"], expected: string): never => {
    throw new ResearchStructuralValidationError({
      validationKind: "STRUCTURAL",
      issues: [{ path: field, code, expected }],
      shape: { topLevelKeys: [], strategyFindingKeys: [], truncated: false },
      diagnosticsTruncated: false,
    });
  };
  for (const identity of identities) {
    const canonicalValue = identity.canonicalValue;
    if (typeof canonicalValue !== "string" || canonicalValue.trim().length === 0) {
      fail(identity.field, "missing_required", `canonical runtime source for ${identity.field}`);
    }
    const canonicalString = canonicalValue as string;
    const supplied = normalized[identity.field];
    if (supplied === undefined) {
      normalized[identity.field] = canonicalString;
      continue;
    }
    if (supplied !== canonicalString) fail(identity.field, "value_mismatch", identity.expected);
  }
  return normalized;
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

/**
 * Canonical model-facing semantic clauses for Final Synthesis. Each clause
 * restates one invariant the runtime validator already enforces; the prompt
 * builder interpolates them verbatim so prompt, validator, and regression
 * tests share a single definition (drift in any one place is caught by the
 * prompt-contract regression suite). Prompt guidance only: validation,
 * schema, thresholds, and budgets are unchanged by these sentences.
 */
export const RESEARCH_SYNTHESIS_SEMANTIC_CLAUSES = [
  'Status/candidate coherence is mandatory: when status is "insufficient_evidence", candidateStories MUST be [].',
  'When status is "grounded", candidateStories MUST contain at least one valid evidence-linked candidate.',
  'Never return candidate stories with "insufficient_evidence".',
  "Every candidate needs a non-empty candidateId and topic; every candidate sourceIds entry and every citation sourceId MUST equal a sources[].id from the retrieved evidence.",
  "Every source needs an http(s) URL; reportId MUST be a UUID; confidence MUST be a number from 0 to 1; taskDescription MUST describe the requested task in relevant terms; metadata MUST carry createdAt and agentVersion strings.",
  "Visual rule: if usable visual research is unavailable, omit visual or set it to null. Never return visual as an empty object {}. If visual is present as an object, it MUST satisfy the complete visual contract (topic, visualMode, referenceStrategy, imageRefs, sourceRefs, observations, provenance).",
  "Recommendation rule: mark recommendedForProduction true only for STRONG-verified, evidence-linked candidates.",
  "Authority rule: never claim or request production, media, publication, upload, or generation actions in any field.",
] as const;

export class ResearchAgent extends BaseAgent {
  readonly id: AgentId = "research";
  readonly name = "Research Agent";
  readonly version = "1.0.0";

  private readonly researchConfig: ResearchConfig;
  private readonly sourceRouter?: ResearchSourceRouter;
  private readonly now: () => Date;

  constructor(deps: ResearchAgentDependencies) {
    super(deps);
    this.researchConfig = deps.config;
    this.sourceRouter = deps.sourceRouter;
    this.now = deps.now ?? (() => new Date());
  }

  /** Execute a normalized source research request without changing legacy task callers. */
  async executeSourceRequest(request: ResearchRequest): Promise<ContentIntelligenceResult> {
    if (this.sourceRouter === undefined) throw new Error("Research source router is not configured");
    return this.sourceRouter.execute(request);
  }

  /**
   * Governed capability execution: every DECLARED request yields exactly one
   * result carrying an explicit lifecycle trail and reason code. Declared
   * capabilities can never silently disappear: a missing boundary produces a
   * BLOCKED/MISSING_PROVIDER_BOUNDARY result, and a throwing transport
   * produces a FAILED result with a classified secret-free reason code.
   */
  private async runGovernedCapabilities(requests: readonly CapabilityRequest[]): Promise<ResearchCapabilityOutcome[]> {
    const outcomes: ResearchCapabilityOutcome[] = [];
    for (const request of requests) {
      const lifecycle: ResearchCapabilityLifecycleState[] = ["REQUESTED", "AUTHORIZED"];
      if (this.deps.capabilityExecution === undefined) {
        lifecycle.push("BLOCKED");
        outcomes.push({
          result: {
            status: "blocked",
            resultId: `agent-capability-result-${request.requestId}`,
            capabilityId: request.capabilityId,
            reason: "Capability execution is not configured",
            reasonCode: "MISSING_PROVIDER_BOUNDARY",
            lifecycle: [...lifecycle],
          } as unknown as Json,
          lifecycle: [...lifecycle],
          reasonCode: "MISSING_PROVIDER_BOUNDARY",
        });
        continue;
      }
      lifecycle.push("EXECUTING");
      try {
        const raw = await this.deps.capabilityExecution.executeCapability(request);
        const record = (raw ?? {}) as unknown as Record<string, unknown>;
        const status = record.status === "success" ? "COMPLETED" : record.status === "blocked" ? "BLOCKED" : "FAILED";
        const reasonCode: ResearchCapabilityReasonCode = status === "COMPLETED"
          ? "CAPABILITY_COMPLETED"
          : this.classifyBlockedResult(record);
        lifecycle.push(status);
        outcomes.push({
          result: { ...(record as unknown as JsonRecord), lifecycle: [...lifecycle], reasonCode } as unknown as Json,
          lifecycle: [...lifecycle],
          reasonCode,
        });
      } catch (error) {
        const reasonCode = classifyResearchCapabilityError(error);
        lifecycle.push("FAILED");
        outcomes.push({
          result: {
            status: "failed",
            resultId: `agent-capability-result-${request.requestId}`,
            capabilityId: request.capabilityId,
            error: { code: reasonCode, message: (error instanceof Error ? error.message : String(error)).slice(0, 300), retryable: false },
            reasonCode,
            lifecycle: [...lifecycle],
          } as unknown as Json,
          lifecycle: [...lifecycle],
          reasonCode,
        });
      }
    }
    return outcomes;
  }

  private classifyBlockedResult(record: Record<string, unknown>): ResearchCapabilityReasonCode {
    const message = typeof record.reason === "string" ? record.reason : typeof record.error === "string" ? record.error : JSON.stringify(record.error ?? "").slice(0, 200);
    if (/NOT_REGISTERED|not registered|unknown capability|unsupported capability/i.test(message)) return "CAPABILITY_NOT_REGISTERED";
    return "CAPABILITY_NOT_AUTHORIZED";
  }

  async execute(input: AgentExecutionInput, signal: CancellationToken): Promise<AgentExecutionOutput> {
    signal?.throwIfCancelled();

    if (!isResearchAgentInput(input.input)) {
      throw new Error("Invalid research input: expected a research task");
    }

    const researchInput = input.input;
    const strategyMode = (researchInput as unknown as { strategyMode?: unknown }).strategyMode === "PRE_PUBLICATION_STRATEGY";
    const synthesisContract = (researchInput as unknown as { synthesisContract?: unknown }).synthesisContract;
    if (strategyMode || synthesisContract !== "amf-research-intelligence-v2") {
      return this.executeLegacy(researchInput, input.context, signal);
    }
    return this.executeIntelligenceV2(researchInput, input.context, signal);
  }

  /**
   * Legacy single-report path (strategy council + pre-contract callers).
   * Preserved byte-for-byte in behavior for existing consumers.
   */
  private async executeLegacy(researchInput: ResearchAgentInput, context: ExecutionContext, signal: CancellationToken): Promise<AgentExecutionOutput> {
    const { report: planReport, response: planResponse } = await this.createReport(researchInput, context, signal);
    const planUsage = toCallUsage(planResponse.usage);
    const intelligence = researchInput.researchRequest === undefined
      ? undefined
      : await this.executeSourceRequest(researchInput.researchRequest);
    const withIntelligence = intelligence === undefined ? planReport : { ...planReport, intelligence };
    const governed = researchInput.capabilityRequests === undefined
      ? null
      : await this.runGovernedCapabilities(researchInput.capabilityRequests);
    const capabilityExecutions = governed === null ? [] : governed.map((outcome) => outcome.result);
    const synthesisInputs = collectSuccessfulRetrievals(capabilityExecutions);
    const wantsSynthesis = typeof researchInput.synthesisContract === "string"
      && (researchInput as unknown as { strategyMode?: unknown }).strategyMode !== "PRE_PUBLICATION_STRATEGY"
      && synthesisInputs.length > 0;
    let report: ResearchReport = withIntelligence;
    let synthesisUsage: ResearchCallUsage | null = null;
    let executionResponse: ExecutionResponse = planResponse;
    if (wantsSynthesis) {
      const synthesis = await this.createSynthesisReport(researchInput, withIntelligence, synthesisInputs, context, signal);
      synthesisUsage = toCallUsage(synthesis.response.usage);
      report = synthesis.report;
      executionResponse = synthesis.response;
    }
    const baseOutput = this.toJson(report);
    const output: Json = capabilityExecutions.length > 0 && isJsonRecord(baseOutput)
      ? {
        ...baseOutput,
        capabilityExecutions: JSON.parse(JSON.stringify(capabilityExecutions)) as Json[],
        planningUsage: { ...planUsage },
        ...(synthesisUsage === null ? {} : { synthesisUsage: { ...synthesisUsage } }),
        researchPlan: { ...this.toJsonPlan(planReport) },
      }
      : baseOutput;

    // Preserve provider execution metadata while returning normalized output.
    const response: ExecutionResponse = {
      ...executionResponse,
      usage: {
        inputTokens: planResponse.usage.inputTokens + (synthesisUsage?.inputTokens ?? 0),
        outputTokens: planResponse.usage.outputTokens + (synthesisUsage?.outputTokens ?? 0),
        costUsd: planResponse.usage.costUsd + (synthesisUsage?.costUsd ?? 0),
      },
      output,
      raw: JSON.stringify(report, null, 2),
    };

    return {
      output,
      response,
    };
  }

  private async createSynthesisReport(
    input: ResearchAgentInput,
    plan: ResearchReport,
    retrievals: { providerId: string; results: { id?: unknown; title?: unknown; url?: unknown; snippet?: unknown; source?: unknown }[] }[],
    context: ExecutionContext,
    signal: CancellationToken,
  ): Promise<ResearchExecutionResult> {
    signal?.throwIfCancelled();
    const response = await this.runExecution(context, this.buildExecutionRequest(this.buildSynthesisPrompt(input, plan, retrievals), "FINAL_SYNTHESIS"), signal);
    return { report: this.parseSynthesisResponse(response.output, input), response };
  }

  /**
   * Intelligence V2 lifecycle (modes of the same Research agent, no new
   * canonical agent): direction LLM → mission → discovery execution →
   * candidate formation → verification planning → verification execution →
   * final synthesis LLM → gate-ready output. Every phase is bounded; every
   * external call flows through governed boundaries with diagnostics.
   */
  private async executeIntelligenceV2(researchInput: ResearchAgentInput, context: ExecutionContext, signal: CancellationToken): Promise<AgentExecutionOutput> {
    // Compute the effective retrieval envelope BEFORE direction planning.
    // When maxRetrievalCallsAvailable is supplied (production path), it is the
    // binding cap.  When absent (test/legacy path), fall back to architectural
    // maximum (MAX_DISCOVERY_REQUESTS + MAX_VERIFICATION_REQUESTS).
    const architecturalMax = MAX_DISCOVERY_REQUESTS + MAX_VERIFICATION_REQUESTS;
    const effectiveEnvelope = typeof researchInput.maxRetrievalCallsAvailable === "number"
      && Number.isSafeInteger(researchInput.maxRetrievalCallsAvailable)
      && researchInput.maxRetrievalCallsAvailable >= 0
      ? Math.min(researchInput.maxRetrievalCallsAvailable, architecturalMax)
      : architecturalMax;
    // PHASE 0 — direction LLM produces the validated research mission.
    const reuse = researchInput.reusedDirection;
    const productionContext = context as unknown as { workflowId?: string; correlationId?: string };
    const runtimeWorkflowId = String(productionContext.workflowId ?? context.inputEvent?.workflow_id ?? `wf-${researchInput.task.id}`);
    const runtimeCorrelationId = String(productionContext.correlationId ?? context.inputEvent?.correlation_id ?? context.inputEvent?.event_id ?? researchInput.task.id);
    if (reuse !== undefined && (reuse.workflowId !== runtimeWorkflowId || reuse.correlationId !== runtimeCorrelationId
      || !reuse.sourceExecutionId.trim() || !reuse.providerRequestId.trim() || !/^[0-9a-f]{64}$/u.test(reuse.parsedPayloadFingerprint))) {
      throw new Error("RESEARCH_DIRECTION_REUSE_LINEAGE_INVALID");
    }
    const direction = reuse === undefined
      ? await this.createDirectionReport(researchInput, context, signal)
      : {
          mission: this.parseDirectionResponse(reuse.mission as unknown as Json, researchInput, reuse.mission.currentDate),
          response: {
            output: reuse.mission as unknown as Json,
            raw: JSON.stringify(reuse.mission),
            usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
            model: "reused-direction",
            provider: "durable-recovery",
            latencyMs: 0,
          },
        };
    const planningUsage = toCallUsage(direction.response.usage);
    const scope = {
      workflowId: runtimeWorkflowId,
      correlationId: runtimeCorrelationId,
      taskId: researchInput.task.id,
      recoverySuffix: recoveryScopeSuffix(researchInput),
      executionScopeId: researchInput.recoveryScopeId?.trim() || "initial",
    };
    // PHASE 1 — discovery execution across mission lanes (bounded to envelope).
    const discoveryBudget = Math.min(MAX_DISCOVERY_REQUESTS, effectiveEnvelope);
    const discoveryPlan = materializeDiscoveryRetrievalPlan(direction.mission, scope, discoveryBudget);
    const discoveryRequests = discoveryPlan.map((entry) => entry.request);
    // Pre-validate: if the mission demands more than the envelope allows,
    // adapt by capping rather than allowing a downstream hard-cap failure.
    const plannedDiscovery = discoveryRequests.length;
    const remainingForVerification = Math.max(0, effectiveEnvelope - plannedDiscovery);
    const discoveryGoverned = await this.runGovernedCapabilities(discoveryRequests);
    const discoveryExecutions = discoveryGoverned.map((outcome) => outcome.result);
    const social = await this.runSocialDiscovery(researchInput, direction.mission);
    // PHASE 2 — candidate formation (deterministic) from discovery evidence.
    const webEvidence = zipLaneEvidence(discoveryRequests, discoveryExecutions);
    const opportunities = this.formCandidateOpportunities(direction.mission, webEvidence, social.evidence);
    // PHASE 3 — verification planning (deterministic) + execution.
    // Verification budget = envelope minus actual discovery calls consumed.
    const verificationBudget = Math.min(MAX_VERIFICATION_REQUESTS, remainingForVerification);
    const verificationPlans = this.planCandidateVerification(direction.mission, opportunities, webEvidence);
    const verificationRequests = this.verificationRequestsFor(verificationPlans, scope, verificationBudget);
    const verificationGoverned = verificationRequests.length === 0
      ? []
      : await this.runGovernedCapabilities(verificationRequests);
    const verificationExecutions = verificationGoverned.map((outcome) => outcome.result);
    // PHASE 4 — final synthesis LLM consumes mission + all evidence.
    const synthesis = await this.createFinalSynthesisReport(
      researchInput, direction.mission, opportunities, verificationPlans,
      discoveryExecutions, social.evidence, verificationExecutions, context, signal,
    );
    const synthesisUsage = toCallUsage(synthesis.response.usage);
    const report = synthesis.report;
    const baseOutput = this.toJson(report);
    const capabilityExecutions = [...discoveryExecutions, ...verificationExecutions];
    const output: Json = {
      ...safeRecord(baseOutput),
      capabilityExecutions: JSON.parse(JSON.stringify(capabilityExecutions)) as Json[],
      socialDiscovery: JSON.parse(JSON.stringify(social.outcomes.map((outcome) => outcome.result))) as Json[],
      planningUsage: { ...planningUsage },
      synthesisUsage: { ...synthesisUsage },
      researchPlan: JSON.parse(JSON.stringify(direction.mission)) as Json,
      retrievalPlan: JSON.parse(JSON.stringify(discoveryPlan.map(({ request: _request, ...entry }) => entry))) as Json[],
      retrievalPlanning: {
        status: discoveryPlan.length > 0 ? "MATERIALIZED" : "NO_SUPPORTED_CAPABILITY",
        maxRetrievalCallsAvailable: effectiveEnvelope,
        discoveryCallsMaterialized: discoveryPlan.length,
        unusedAfterDiscovery: remainingForVerification,
      },
    };
    const combined: ExecutionResponse = {
      ...synthesis.response,
      usage: {
        inputTokens: planningUsage.inputTokens + synthesisUsage.inputTokens,
        outputTokens: planningUsage.outputTokens + synthesisUsage.outputTokens,
        costUsd: planningUsage.costUsd + synthesisUsage.costUsd,
      },
      output,
      raw: JSON.stringify(report, null, 2),
    };
    return { output, response: combined };
  }

  /**
   * PHASE 0 — direction LLM: produces the validated research mission from
   * objective + canonical context + capability inventory. No retrieval runs
   * before this completes.
   */
  private async createDirectionReport(
    input: ResearchAgentInput,
    context: ExecutionContext,
    signal: CancellationToken,
  ): Promise<{ mission: ResearchMission; response: ExecutionResponse }> {
    signal?.throwIfCancelled();
    const canonicalCurrentDate = this.now().toISOString().slice(0, 10);
    const prompt = this.buildDirectionPrompt(input, canonicalCurrentDate);
    const request = this.buildExecutionRequest(prompt, "DIRECTION", "DIRECTION");
    const response = await this.runExecution(context, request, signal);
    return { mission: this.parseDirectionResponse(response.output, input, canonicalCurrentDate), response };
  }

  /**
   * Deterministic mission validation (contract amf-research-mission-v1).
   * Identity echoes byte-for-byte; content fields are structural, never
   * semantically judged. Throws ResearchStructuralValidationError on defect.
   */
  private parseDirectionResponse(output: Json, input: ResearchAgentInput, canonicalCurrentDate: string): ResearchMission {
    const fail = (path: string, code: ResearchStructuralIssue["code"], expected?: string | number): never => {
      throw new ResearchStructuralValidationError({
        validationKind: "STRUCTURAL",
        issues: [{ path, code, ...(expected === undefined ? {} : { expected }) }],
        shape: { topLevelKeys: [], strategyFindingKeys: [], truncated: false },
        diagnosticsTruncated: false,
      });
    };
    if (!isJsonRecord(output)) fail("$", "wrong_type", "object");
    const taskId = (input.task as unknown as { id?: unknown }).id;
    const contractStage = (input as unknown as { contract?: unknown }).contract;
    const expectedStage = isJsonRecord((contractStage ?? null) as Json) && typeof (contractStage as JsonRecord).stage === "string"
      ? String((contractStage as JsonRecord).stage)
      : undefined;
    const record = normalizeRuntimeIdentityEchoes(output as JsonRecord, [
      { field: "taskId", canonicalValue: taskId, expected: "exact task identity echo" },
      { field: "stage", canonicalValue: expectedStage, expected: "exact stage identity echo" },
    ]);
    const strings = (value: unknown, path: string, allowEmpty: boolean): string | null => {
      if (value === null || value === undefined) return null;
      if (typeof value !== "string") fail(path, "wrong_type", "string");
      if (!allowEmpty && (value as string).trim().length === 0) fail(path, "missing_required", "non-empty string");
      return value as string;
    };
    const requireString = (path: string): string => {
      const value = record[path];
      if (typeof value !== "string" || value.trim().length === 0) fail(path, value === undefined ? "missing_required" : "value_mismatch", "non-empty string");
      return value as string;
    };
    const missionId = requireString("missionId");
    const objective = requireString("objective");
    const contentPillar = requireString("contentPillar");
    const factualMode = record.factualMode;
    if (factualMode !== "HISTORICAL_POV" && factualMode !== "ORIGINAL_FANTASY") fail("factualMode", "invalid_enum", "HISTORICAL_POV|ORIGINAL_FANTASY");
    const trendMode = record.trendMode;
    if (trendMode !== "TREND_LED" && trendMode !== "EVERGREEN" && trendMode !== "HYBRID") fail("trendMode", "invalid_enum", "TREND_LED|EVERGREEN|HYBRID");
    if (!Array.isArray(record.discoveryLanes) || record.discoveryLanes.length < 1 || record.discoveryLanes.length > 5) {
      fail("discoveryLanes", !Array.isArray(record.discoveryLanes) ? "wrong_type" : "too_small", "array of 1..5 lanes");
    }
    for (const [index, lane] of (record.discoveryLanes as unknown[]).entries()) {
      if (lane === null || typeof lane !== "object" || Array.isArray(lane)) fail(`discoveryLanes[${index}]`, "wrong_type", "object");
      const entry = lane as Record<string, unknown>;
      for (const field of ["laneId", "purpose", "queryGuidance", "desiredCapability", "expectedOutput"] as const) {
        if (typeof entry[field] !== "string" || (entry[field] as string).trim().length === 0) fail(`discoveryLanes[${index}].${field}`, "missing_required", "non-empty string");
      }
      if (!Number.isSafeInteger(entry.maxCalls) || (entry.maxCalls as number) < 1 || (entry.maxCalls as number) > 3) {
        fail(`discoveryLanes[${index}].maxCalls`, "invalid_enum", "integer 1..3");
      }
      // Structured retrieval intent is optional per lane (absent = broad
      // discovery) but must be string arrays when present. Terms are carried
      // verbatim — never expanded, never filtered here.
      for (const field of ["subjectTerms", "locationTerms", "periodTerms", "factTargets", "sourcePreferences"] as const) {
        const terms = (entry as Record<string, unknown>)[field];
        if (terms !== undefined && (!Array.isArray(terms) || terms.some((term) => typeof term !== "string"))) {
          fail(`discoveryLanes[${index}].${field}`, "wrong_type", "array of strings");
        }
      }
    }
    const asStringArray = (value: unknown, path: string): string[] => {
      if (!Array.isArray(value)) fail(path, "wrong_type", "array");
      for (const item of value as unknown[]) if (typeof item !== "string") fail(path, "wrong_type", "array of strings");
      return value as string[];
    };
    const strOrNull = (value: unknown, path: string): string | null => {
      if (value === null || value === undefined) return null;
      return strings(value, path, true);
    };
    const suppliedInventory = Array.isArray((input as unknown as JsonRecord).capabilityInventory)
      ? ((input as unknown as JsonRecord).capabilityInventory as Json[])
        .filter((entry): entry is JsonRecord => isJsonRecord(entry))
        .filter((entry) => typeof entry.sourceType === "string" && ["SUPPORTED", "PARTIALLY_SUPPORTED", "UNSUPPORTED"].includes(String(entry.status)))
        .map((entry) => ({
          sourceType: String(entry.sourceType),
          status: String(entry.status) as "SUPPORTED" | "PARTIALLY_SUPPORTED" | "UNSUPPORTED",
          via: Array.isArray(entry.via) ? entry.via.filter((item): item is string => typeof item === "string") : [],
          limitations: Array.isArray(entry.limitations) ? entry.limitations.filter((item): item is string => typeof item === "string") : [],
        }))
      : [];
    const desiredSourceTypes = asStringArray(record.desiredSourceTypes, "desiredSourceTypes");
    const unavailableDesiredCapabilities = desiredSourceTypes
      .filter((sourceType) => !suppliedInventory.some((entry) => entry.sourceType === sourceType && entry.status === "SUPPORTED"))
      .map((sourceType) => ({ sourceType, reason: suppliedInventory.find((entry) => entry.sourceType === sourceType)?.limitations.join("; ") || "No supported governed capability in the supplied inventory" }));
    return {
      taskId: record.taskId as string,
      stage: typeof record.stage === "string" ? record.stage as string : "",
      missionId,
      objective,
      market: strOrNull(record.market, "market"),
      geography: strOrNull(record.geography, "geography"),
      language: strOrNull(record.language, "language"),
      platforms: asStringArray(record.platforms, "platforms"),
      contentPillar,
      factualMode: factualMode as "HISTORICAL_POV" | "ORIGINAL_FANTASY",
      audience: strOrNull(record.audience, "audience"),
      trendMode: trendMode as "TREND_LED" | "EVERGREEN" | "HYBRID",
      timeHorizon: (() => {
        const horizon = record.timeHorizon;
        if (horizon === null || horizon === undefined) return { from: null, to: null };
        if (!isJsonRecord(horizon as Json)) fail("timeHorizon", "wrong_type", "object");
        const window = horizon as unknown as Record<string, unknown>;
        return { from: strOrNull(window.from, "timeHorizon.from"), to: strOrNull(window.to, "timeHorizon.to") };
      })(),
      currentDate: canonicalCurrentDate,
      discoveryLanes: (record.discoveryLanes as unknown[]).map((lane) => {
        const entry = lane as Record<string, unknown>;
        const termList = (field: string): string[] => {
          const value = entry[field];
          if (value === undefined) return [];
          return (value as unknown[]).filter((term): term is string => typeof term === "string" && term.trim().length > 0);
        };
        return {
          laneId: String(entry.laneId), purpose: String(entry.purpose), queryGuidance: String(entry.queryGuidance),
          desiredCapability: String(entry.desiredCapability), actualCapability: typeof entry.actualCapability === "string" ? entry.actualCapability as string : String(entry.desiredCapability),
          maxCalls: Number(entry.maxCalls), expectedOutput: String(entry.expectedOutput),
          subjectTerms: termList("subjectTerms"), locationTerms: termList("locationTerms"),
          periodTerms: termList("periodTerms"), factTargets: termList("factTargets"),
          sourcePreferences: termList("sourcePreferences"),
        };
      }),
      desiredSourceTypes,
      availableCapabilities: suppliedInventory,
      unavailableDesiredCapabilities,
      searchPriorities: asStringArray(record.searchPriorities, "searchPriorities"),
      verificationRequirements: asStringArray(record.verificationRequirements, "verificationRequirements"),
      stopConditions: asStringArray(record.stopConditions, "stopConditions"),
      riskNotes: asStringArray(record.riskNotes, "riskNotes"),
    };
  }

  /**
   * Research Direction prompt: the model reasons about WHERE/WHY/HOW to
   * investigate from the objective, canonical context and the real capability
   * inventory — before any retrieval runs. It must state desired-vs-available
   * capabilities honestly and never claim unsupported analysis.
   */
  private buildDirectionPrompt(input: ResearchAgentInput, canonicalCurrentDate: string): string {
    const { task } = input;
    const record = input as unknown as JsonRecord;
    const objective = isJsonRecord(record.researchObjective) ? record.researchObjective : {};
    const projectContext = isJsonRecord(record.projectContext) ? record.projectContext : null;
    const inventory = Array.isArray(record.capabilityInventory) ? record.capabilityInventory : [];
    return `${this.researchConfig.systemPrompt}

Research Direction (contract amf-research-mission-v1) for research task ${task.id}.
Echo TASK_ID exactly into taskId (byte-for-byte, never paraphrased): ${JSON.stringify(task.id)}
Echo STAGE exactly into the top-level stage field (byte-for-byte): "research"
The top-level stage is orchestration identity, not the research mission label. Mission content belongs in the top-level mission fields listed below. Do not use "mission" as the stage and do not wrap the mission under metadata.mission.
Describe the requested objective in your own words into objective (do NOT copy verbatim; keep it clearly about the requested task): ${JSON.stringify(task.description)}
RESEARCH OBJECTIVE (structured; market/geography null means unspecified — choose explicitly with rationale, never infer permanence):
${JSON.stringify(objective).slice(0, 2000)}
PROJECT CONTEXT (canonical brand/strategy facts — use these, never improvise brand strategy):
${projectContext !== null ? JSON.stringify(projectContext).slice(0, 2000) : "none supplied; say so explicitly rather than inventing strategy"}
CAPABILITY INVENTORY (actual current capabilities — desired sources WITHOUT a SUPPORTED entry must be recorded under unavailableDesiredCapabilities with reasons; never claim INSTAGRAM_ANALYZED, viral, trending or popular without governed capability evidence):
${JSON.stringify(inventory).slice(0, 2000)}
CANONICAL CURRENT DATE (runtime-owned; use this value for recency, seasonal and verification reasoning): ${JSON.stringify(canonicalCurrentDate)}
  Return one JSON mission with: missionId (string); objective (string); market (string|null); geography (string|null — null unless the objective specifies one); language (string|null); platforms (string[]); contentPillar (string); factualMode ("HISTORICAL_POV"|"ORIGINAL_FANTASY" — ORIGINAL_FANTASY only for explicitly fictional storytelling; fictional inspiration must never be framed as factual history); audience (string|null); trendMode ("TREND_LED"|"EVERGREEN"|"HYBRID" — TREND_LED only with a plan for temporal evidence); timeHorizon {from:string|null,to:string|null}; currentDate (string YYYY-MM-DD, use execution context date); discoveryLanes (1..5 entries {laneId, purpose, queryGuidance, desiredCapability, actualCapability, maxCalls 1..3, expectedOutput, subjectTerms, locationTerms, periodTerms, factTargets, sourcePreferences} — choose only relevant lanes); desiredSourceTypes (string[]); availableCapabilities (array echoing usable inventory entries); unavailableDesiredCapabilities (array {sourceType, reason}); searchPriorities (string[]); verificationRequirements (string[] — HISTORICAL_POV requires museum/archive/university/reputable-reference corroboration); stopConditions (string[]); riskNotes (string[]).
  For each discovery lane also emit compact structured retrieval intent: subjectTerms (named entities / subject phrases for this lane, e.g. a monument or person name), locationTerms (site-level geography beyond mission geography), periodTerms (dynasty / century / date range), factTargets (short phrases stating what needs corroboration), sourcePreferences (archive / museum / university / government / academic preferences where the lane requests them). Use [] for any collection with nothing specific — never invent entities, never pad with generic words, never restate exclusions as terms.
Never claim media generation, publication, upload, or any production authority. Do not include explanatory text outside the JSON.`;
  }

  /**
   * Deterministic discovery request construction from a validated mission.
   * Bounded (MAX_DISCOVERY_REQUESTS); request ids embed lane scope plus the
   * recovery attempt identity for per-attempt evidence separation.
   */
  /**
   * Deterministic verification request construction from verification plans.
   * Bounded (MAX_VERIFICATION_REQUESTS); per-candidate association travels in
   * the requestId so evidence never mixes across candidates accidentally.
   */
  private verificationRequestsFor(plans: CandidateVerificationPlan[], scope: { workflowId: string; correlationId: string; taskId: string; recoverySuffix?: string; executionScopeId?: string }, maxTotal?: number): MissionCapabilityRequest[] {
    const cap = typeof maxTotal === "number" ? Math.min(maxTotal, MAX_VERIFICATION_REQUESTS) : MAX_VERIFICATION_REQUESTS;
    if (cap <= 0) return [];
    const requests: MissionCapabilityRequest[] = [];
    for (const plan of plans) {
      for (const [queryIndex, query] of plan.verificationQueries.entries()) {
        if (requests.length >= cap) break;
        requests.push({
          requestId: researchCapabilityInvocationIdentity({
            workflowId: scope.workflowId,
            executionScopeId: scope.executionScopeId ?? scope.recoverySuffix?.replace(/^:recovery:/u, "") ?? "initial",
            taskId: scope.taskId,
            capabilityId: "web.search",
            role: "VERIFICATION",
            laneId: `verification-${plan.candidateId}`,
            queryOrdinal: queryIndex + 1,
            attemptOrdinal: 1,
          }),
          capabilityId: "web.search",
          agentId: "research",
          workflowId: scope.workflowId,
          correlationId: scope.correlationId,
          requestedAt: new Date().toISOString(),
          input: { query: buildVerificationQueryFor(String(query)), maxResults: 5, laneId: "verification", candidateId: plan.candidateId },
        });
      }
      if (requests.length >= cap) break;
    }
    return requests;
  }

  /**
   * Deterministic candidate formation from discovery evidence (no model call).
   * Each retrieved result becomes a candidate opportunity stub grounded in
   * that result; trend signals attach ONLY from provider-returned social
   * evidence with matching vocabulary (never invented). Bounded.
   */
  private formCandidateOpportunities(
    mission: ResearchMission,
    webEvidence: { result: Json; laneId: string }[],
    socialEvidence: { platform: string; title?: string; caption?: string; canonicalUrl?: string; engagement?: Record<string, number>; retrievedAt: string; limitations: string[] }[],
  ): CandidateOpportunity[] {
    const candidates: CandidateOpportunity[] = [];
    const tokenize = (value: string): Set<string> => new Set(
      value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4),
    );
    let index = 0;
    for (const item of webEvidence) {
      if (candidates.length >= MAX_CANDIDATES) break;
      const record = safeRecord(item.result);
      const title = typeof record.title === "string" ? record.title.slice(0, 200) : "";
      const snippet = typeof record.snippet === "string" ? record.snippet.slice(0, 500) : "";
      if (title.trim().length === 0) continue;
      index += 1;
      const topicTokens = tokenize(`${title} ${snippet}`);
      const trendSignals: CandidateOpportunity["trendSignals"] = [];
      for (const social of socialEvidence) {
        const socialTokens = tokenize(`${social.title ?? ""} ${social.caption ?? ""}`);
        let shared = 0;
        for (const token of topicTokens) if (socialTokens.has(token) && ++shared >= 2) break;
        if (shared >= 2) {
          trendSignals.push({
            signal: `social-mention:${social.platform}`,
            provenance: social.canonicalUrl ?? social.platform,
            observedAt: social.retrievedAt,
          });
        }
        if (trendSignals.length >= 3) break;
      }
      candidates.push({
        candidateId: `candidate-${index}`,
        topic: title,
        candidateType: item.laneId,
        contentPillar: mission.contentPillar,
        marketRelevance: mission.market,
        trendSignals,
        evergreenSignals: [],
        factualAngle: snippet.slice(0, 300),
        whyInteresting: snippet.slice(0, 300),
        visualPotential: "",
        shortFormPotential: "",
        discoveryEvidenceIds: typeof record.id === "number" || typeof record.id === "string" ? [record.id as string | number] : [],
        risks: [],
        verificationQuestions: [
          `Corroborate "${title.slice(0, 80)}" with an institutional source (museum, archive, university).`,
          `Verify the central factual claim of "${title.slice(0, 80)}" against a primary or reputable secondary reference.`,
        ],
        verificationRequired: mission.factualMode === "HISTORICAL_POV",
      });
    }
    return candidates;
  }

  /**
   * Deterministic verification planning (no model call): candidates that
   * lack corroboration (fewer than 2 distinct-domain discovery evidence
   * items) get targeted verification queries via buildVerificationQuery.
   */
  private planCandidateVerification(
    mission: ResearchMission,
    candidates: CandidateOpportunity[],
    webEvidence: { result: Json; laneId: string }[],
  ): CandidateVerificationPlan[] {
    if (mission.factualMode !== "HISTORICAL_POV") return [];
    const plans: CandidateVerificationPlan[] = [];
    for (const candidate of candidates) {
      if (plans.length >= MAX_CANDIDATES) break;
      if (candidate.verificationRequired === false) continue;
      const domains = new Set<string>();
      for (const id of candidate.discoveryEvidenceIds) {
        const found = webEvidence.find((item) => {
          const record = safeRecord(item.result);
          return record.id === id;
        });
        const url = found !== undefined ? String(safeRecord(found.result).url ?? "") : "";
        try {
          const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
          if (host.includes(".")) domains.add(host);
        } catch { /* unparseable URL contributes no domain */ }
      }
      if (domains.size >= 2) continue;
      plans.push({
        candidateId: candidate.candidateId,
        claimsToVerify: [candidate.topic, candidate.factualAngle].filter((claim) => claim.trim().length > 0),
        verificationQueries: [buildVerificationQueryFor(candidate.topic)],
        preferredAuthorityClasses: ["PRIMARY_OR_INSTITUTIONAL", "REPUTABLE_SECONDARY"],
        minimumEvidenceRule: "at least 2 independent (distinct-domain) sources with at least 1 above community/compilation tier",
        risks: [],
      });
    }
    return plans;
  }

  /**
   * Bounded social discovery through the injected source router. Social
   * evidence is content-intelligence only (platform/source/query/time/
   * provider-returned metadata); reach, virality, trend rank, view velocity
   * and demographics are NEVER fabricated — only copied when the provider
   * returned them. Failures degrade to recorded limitations, never silent.
   */
  private async runSocialDiscovery(
    input: ResearchAgentInput,
    mission: ResearchMission,
  ): Promise<{ outcomes: ResearchCapabilityOutcome[]; evidence: { platform: string; title?: string; caption?: string; canonicalUrl?: string; engagement?: Record<string, number>; retrievedAt: string; limitations: string[] }[] }> {
    const outcomes: ResearchCapabilityOutcome[] = [];
    const evidence: { platform: string; title?: string; caption?: string; canonicalUrl?: string; engagement?: Record<string, number>; retrievedAt: string; limitations: string[] }[] = [];
    const wantsSocial = mission.discoveryLanes.some((lane) => /social/i.test(lane.desiredCapability) || /social/i.test(lane.laneId));
    if (!wantsSocial) return { outcomes, evidence };
    const socialSupported = mission.availableCapabilities.some((entry) => entry.status === "SUPPORTED" && /INSTAGRAM|SOCIAL|TIKTOK/i.test(entry.sourceType));
    if (!socialSupported) {
      const lifecycle: ResearchCapabilityLifecycleState[] = ["REQUESTED", "BLOCKED"];
      outcomes.push({
        result: { status: "blocked", resultId: "social-discovery-unsupported", capabilityId: "social.discovery", reason: "Desired social discovery is not available in the canonical capability inventory", reasonCode: "CAPABILITY_NOT_REGISTERED", lifecycle: [...lifecycle] } as unknown as Json,
        lifecycle: [...lifecycle], reasonCode: "CAPABILITY_NOT_REGISTERED",
      });
      return { outcomes, evidence };
    }
    if (this.sourceRouter === undefined) {
      const lifecycle: ResearchCapabilityLifecycleState[] = ["REQUESTED", "AUTHORIZED", "BLOCKED"];
      outcomes.push({
        result: {
          status: "blocked", resultId: "social-discovery-unconfigured", capabilityId: "social.discovery",
          reason: "No social source router is configured", reasonCode: "MISSING_PROVIDER_BOUNDARY", lifecycle: [...lifecycle],
        } as unknown as Json,
        lifecycle: [...lifecycle],
        reasonCode: "MISSING_PROVIDER_BOUNDARY",
      });
      return { outcomes, evidence };
    }
    const platforms = (mission.platforms ?? []).map((platform) => platform.toUpperCase());
    const platform = platforms.includes("INSTAGRAM") ? "INSTAGRAM" : platforms.includes("TIKTOK") ? "TIKTOK" : "INSTAGRAM";
    const lifecycle: ResearchCapabilityLifecycleState[] = ["REQUESTED", "AUTHORIZED", "EXECUTING"];
    try {
      const response = await this.sourceRouter.execute({
        mode: "CONTENT_DISCOVERY",
        topic: mission.objective.slice(0, 200),
        platforms: [platform as "INSTAGRAM" | "TIKTOK"],
      });
      lifecycle.push("COMPLETED");
      const limitations = [...(response.limitations ?? []), "Social evidence is content-intelligence only, not factual verification."];
      for (const item of (response.sources ?? []).slice(0, 3)) {
        const source = item as unknown as Record<string, unknown>;
        const entry: { platform: string; title?: string; caption?: string; canonicalUrl?: string; engagement?: Record<string, number>; retrievedAt: string; limitations: string[] } = {
          platform,
          retrievedAt: typeof source.retrievedAt === "string" ? source.retrievedAt as string : new Date().toISOString(),
          limitations,
        };
        if (typeof source.title === "string") entry.title = (source.title as string).slice(0, 200);
        if (typeof source.text === "string") entry.caption = (source.text as string).slice(0, 500);
        if (typeof source.canonicalUrl === "string") entry.canonicalUrl = (source.canonicalUrl as string).slice(0, 500);
        if (source.engagement !== null && typeof source.engagement === "object" && !Array.isArray(source.engagement)) {
          const engagement: Record<string, number> = {};
          for (const [key, value] of Object.entries(source.engagement as Record<string, unknown>)) {
            if (typeof value === "number" && Number.isFinite(value)) engagement[key.slice(0, 40)] = value;
          }
          if (Object.keys(engagement).length > 0) entry.engagement = engagement;
        }
        evidence.push(entry);
      }
      outcomes.push({
        result: {
          status: "success",
          resultId: `social-discovery-${platform.toLowerCase()}-${mission.missionId}`,
          capabilityId: "social.discovery",
          output: { platform, resultCount: evidence.length },
          evidence: { providerId: "social-router", evidenceId: `ev-social-${platform.toLowerCase()}-${mission.missionId}`, succeeded: evidence.length > 0, executedAt: new Date().toISOString() },
          reasonCode: "CAPABILITY_COMPLETED",
          lifecycle: [...lifecycle],
        } as unknown as Json,
        lifecycle: [...lifecycle],
        reasonCode: "CAPABILITY_COMPLETED",
      });
    } catch (error) {
      lifecycle.push("FAILED");
      const reasonCode = classifyResearchCapabilityError(error);
      outcomes.push({
        result: {
          status: "failed", resultId: "social-discovery-failed", capabilityId: "social.discovery",
          error: { code: reasonCode, message: (error instanceof Error ? error.message : String(error)).slice(0, 300), retryable: false },
          reasonCode, lifecycle: [...lifecycle],
        } as unknown as Json,
        lifecycle: [...lifecycle],
        reasonCode,
      });
    }
    return { outcomes, evidence };
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

  private buildExecutionRequest(
    prompt: string,
    callLeg: "DIRECTION" | "FINAL_SYNTHESIS" = "DIRECTION",
    responseContract: "REPORT" | "DIRECTION" = "REPORT",
  ): ExecutionRequest {
    const strategyMode = prompt.startsWith("PRE_PUBLICATION_STRATEGY.");
    // Final synthesis carries the full evidence payload plus a reasoning-heavy
    // model leg: reasoning tokens consume the same output budget as visible
    // JSON. A live synthesis exhausted exactly 4096/4096 tokens with
    // finish_reason=length while 8KB of valid partial JSON was still in
    // flight, so the synthesis leg carries a floor the planning leg does not
    // need. The floor never lowers an explicitly larger configuration.
    const maxOutputTokens = callLeg === "FINAL_SYNTHESIS"
      ? Math.max(this.researchConfig.maxOutputTokens, FINAL_SYNTHESIS_MIN_OUTPUT_TOKENS)
      : this.researchConfig.maxOutputTokens;
    return {
      model: this.researchConfig.model,
      system: strategyMode ? STRATEGY_RESEARCH_SYSTEM_PROMPT : this.researchConfig.systemPrompt,
      messages: [
        { role: "system", content: strategyMode ? STRATEGY_RESEARCH_SYSTEM_PROMPT : this.researchConfig.systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: this.researchConfig.temperature,
      maxOutputTokens,
      responseSchema: responseContract === "DIRECTION"
        ? researchDirectionResponseSchema()
        : this.getResearchResponseSchema(callLeg === "FINAL_SYNTHESIS"),
      callIdentity: { callLeg },
    };
  }

  private getResearchResponseSchema(synthesis = false): import("@ai-media-factory/runtime").JsonSchema {
    // Strict provider-facing shape (synthesis-400 remediation). The provider
    // envelope is always sent with strict semantics (see the successful
    // Direction contract), so the synthesis schema mirrors that profile:
    // explicit objects with additionalProperties:false, enum instead of
    // const/oneOf, no format annotations (UUID/URI syntax is enforced by the
    // runtime synthesis validator instead). Status coupling that oneOf used
    // to express (empty candidates iff insufficient_evidence) is enforced
    // by parseSynthesisResponse, which remains the fail-closed authority and
    // is intentionally untouched by provider-schema simplification.
    const candidateItem = {
      type: "object",
      additionalProperties: false,
      properties: {
        candidateId: { type: "string" },
        topic: { type: "string" },
        factualAngle: { type: "string" },
        keyClaims: { type: "array", items: { type: "string" } },
        sourceIds: { type: "array", items: { type: "number" } },
        supportingEvidenceIds: { type: "array", items: { type: "string" } },
        sourceQualitySummary: { type: "string" },
        visualPotential: { type: "string" },
        shortFormPotential: { type: "string" },
        fitNote: { type: "string" },
        evidenceRisks: { type: "array", items: { type: "string" } },
        verificationStatus: { type: "string" },
        contentOpportunityAssessment: {
          type: "object",
          additionalProperties: false,
          properties: {
            level: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
            basis: { type: "string" },
          },
          required: ["level", "basis"],
        },
        factualVerification: {
          type: "object",
          additionalProperties: false,
          properties: {
            status: { type: "string", enum: ["STRONG", "PARTIAL", "INCOMPLETE"] },
            basis: { type: "string" },
          },
          required: ["status", "basis"],
        },
        trendEvidence: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              signal: { type: "string" },
              observedAt: { type: ["string", "null"] },
              source: { type: "string" },
            },
            required: ["signal", "source"],
          },
        },
        evergreenEvidence: { type: "array", items: { type: "string" } },
        marketRelevance: { type: ["string", "null"] },
        recommendedForProduction: { type: "boolean" },
      },
      required: ["candidateId", "topic"],
    };
    const visualContract = {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        topic: { type: "string" },
        visualMode: { type: "string" },
        referenceStrategy: { type: "string" },
        imageRefs: { type: "array", items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, kind: { type: "string" }, uri: { type: "string" }, sourceUrl: { type: ["string", "null"] }, provenance: { type: "string" }, sha256: { type: ["string", "null"] }, observations: { type: "array", items: { type: "string" } }, relevance: { type: "string" } } } },
        sourceRefs: { type: "array", items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, kind: { type: "string" }, uri: { type: "string" }, sourceUrl: { type: ["string", "null"] }, provenance: { type: "string" }, sha256: { type: ["string", "null"] }, observations: { type: "array", items: { type: "string" } }, relevance: { type: "string" } } } },
        observations: { type: "array", items: { type: "string" } },
        provenance: { type: "string", enum: ["none", "local", "web", "mixed"] },
      },
      required: ["topic", "visualMode", "referenceStrategy", "imageRefs", "sourceRefs", "observations", "provenance"],
    };
    return {
      type: "object",
      additionalProperties: false,
      properties: {
        reportId: { type: "string" },
        taskId: { type: "string" },
        stage: { type: "string" },
        taskDescription: { type: "string" },
        summary: { type: "string" },
        sources: {
          type: "array",
          ...(synthesis ? {} : { minItems: 1 }),
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "number" },
              title: { type: "string" },
              url: { type: "string" },
              snippet: { type: "string" },
              dateAccessed: { type: ["string", "null"] },
            },
            required: ["id", "title", "url", "snippet"],
          },
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        citations: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              sourceId: { type: "number" },
              text: { type: "string" },
              location: {
                type: ["object", "null"],
                additionalProperties: false,
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
        visual: visualContract,
        candidateStories: { type: "array", items: candidateItem },
        evidenceRisks: { type: "array", items: { type: "string" } },
        status: { type: "string", enum: ["grounded", "insufficient_evidence"] },
        metadata: {
          type: "object",
          additionalProperties: false,
          properties: {
            createdAt: { type: "string" },
            agentVersion: { type: "string" },
          },
          required: ["createdAt", "agentVersion"],
        },
        strategyFindings: {
          type: "object",
          additionalProperties: false,
          properties: {
            referencePatterns: { type: "array", minItems: 1, maxItems: 5, items: { type: "object", additionalProperties: false } },
            audienceOpportunities: { type: "array", minItems: 1, maxItems: 4, items: { type: "object", additionalProperties: false } },
            contentTerritories: { type: "array", minItems: 1, maxItems: 5, items: { type: "object", additionalProperties: false } },
            platformFindings: { type: "array", minItems: 3, maxItems: 3, items: { type: "object", additionalProperties: false } },
            differentiationOpportunities: { type: "array", minItems: 1, maxItems: 4, items: { type: "object", additionalProperties: false } },
            productionImplications: { type: "array", minItems: 1, maxItems: 4, items: { type: "object", additionalProperties: false } },
            risks: { type: "array", minItems: 1, maxItems: 5, items: { type: "object", additionalProperties: false } },
            assumptions: { type: "array", minItems: 1, maxItems: 5, items: { type: "object", additionalProperties: false } },
            unknowns: { type: "array", minItems: 1, maxItems: 5, items: { type: "object", additionalProperties: false } },
          },
        },
      },
      required: synthesis
        ? ["reportId", "taskDescription", "summary", "sources", "confidence", "citations", "candidateStories", "evidenceRisks", "status", "metadata"]
        : ["reportId", "taskDescription", "summary", "sources", "confidence", "citations", "metadata"],
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
    // Canonical neutral visual for a negative outcome is absent or null. An
    // empty-object placeholder is rejected for every outcome: it is neither a
    // complete visual contract nor a legitimate neutral form.
    if (output.visual !== undefined && output.visual !== null && !isVisualResearchResult(output.visual)) {
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
      ...(output.visual === undefined || output.visual === null
        ? {}
        : { visual: output.visual as unknown as ResearchReport["visual"] }),
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

    if (value.dateAccessed !== undefined && value.dateAccessed !== null && typeof value.dateAccessed !== "string") {
      throw new Error("Invalid research response: invalid source access date");
    }

    return {
      id: value.id,
      title: value.title,
      url: value.url,
      snippet: value.snippet,
      ...(value.dateAccessed === undefined || value.dateAccessed === null ? {} : { dateAccessed: value.dateAccessed }),
    };
  }

  private parseCitation(value: Json): ResearchCitation {
    if (!isJsonRecord(value) || typeof value.sourceId !== "number" || !Number.isFinite(value.sourceId) || typeof value.text !== "string") {
      throw new Error("Invalid research response: invalid citation");
    }

    if (value.location === undefined || value.location === null) {
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

  private toJsonPlan(report: ResearchReport): ResearchPlan {
    const record = report as unknown as Record<string, unknown>;
    return {
      taskId: report.taskId ?? "",
      stage: report.stage ?? "",
      objective: report.taskDescription,
      searchQueries: Array.isArray(record.searchQueries)
        ? record.searchQueries.filter((query): query is string => typeof query === "string")
        : [],
      researchQuestions: [],
      status: "planned",
      summary: report.summary,
    };
  }

  /**
   * Post-retrieval synthesis prompt (contract amf-research-synthesis-v1).
   * The model receives ONLY bounded retrieved evidence plus the plan and
   * canonical project context. It must ground every candidate and citation in
   * the supplied evidence: inventing source metadata or substituting internal
   * knowledge is a contract violation.
   */
  /**
   * PHASE 4 — final synthesis LLM: consumes mission + discovery evidence +
   * candidate opportunities + verification evidence. Candidates arise from
   * evidence; an empty list is honest, never structural failure.
   */
  private async createFinalSynthesisReport(
    input: ResearchAgentInput,
    mission: ResearchMission,
    opportunities: CandidateOpportunity[],
    verificationPlans: CandidateVerificationPlan[],
    discoveryExecutions: readonly unknown[],
    socialEvidence: { platform: string; title?: string; caption?: string; canonicalUrl?: string; engagement?: Record<string, number>; retrievedAt: string; limitations: string[] }[],
    verificationExecutions: readonly unknown[],
    context: ExecutionContext,
    signal: CancellationToken,
  ): Promise<ResearchExecutionResult> {
    signal?.throwIfCancelled();
    const prompt = this.buildFinalSynthesisPrompt(input, mission, opportunities, verificationPlans, discoveryExecutions, socialEvidence, verificationExecutions);
    const request = this.buildExecutionRequest(prompt, "FINAL_SYNTHESIS");
    const response = await this.runExecution(context, request, signal);
    return {
      report: this.parseSynthesisResponse(response.output, input),
      response,
    };
  }

  private buildFinalSynthesisPrompt(
    input: ResearchAgentInput,
    mission: ResearchMission,
    opportunities: CandidateOpportunity[],
    verificationPlans: CandidateVerificationPlan[],
    discoveryExecutions: readonly unknown[],
    socialEvidence: { platform: string; title?: string; caption?: string; canonicalUrl?: string; engagement?: Record<string, number>; retrievedAt: string; limitations: string[] }[],
    verificationExecutions: readonly unknown[],
  ): string {
    const { task } = input;
    const record = input as unknown as JsonRecord;
    const contract = isJsonRecord(record.contract) ? record.contract : null;
    const projectContext = isJsonRecord(record.projectContext) ? record.projectContext : null;
    const successfulDiscovery = discoveryExecutions
      .map((item) => safeRecord(item as Json))
      .filter((execution) => execution.status === "success")
      .map((execution) => safeRecord(execution.output));
    return `${this.researchConfig.systemPrompt}

Final research synthesis (contract amf-research-synthesis-v1) for research task ${task.id}.
Echo TASK_ID exactly into taskId (byte-for-byte, never paraphrased): ${JSON.stringify(task.id)}
Echo STAGE exactly into stage: ${JSON.stringify(typeof contract?.stage === "string" ? contract.stage : "research")}
Describe the requested task in your own words into taskDescription (do NOT copy verbatim; keep it clearly about the requested task): ${JSON.stringify(task.description)}
RESEARCH MISSION (authoritative plan — candidates must arise from its evidence):
${JSON.stringify(mission).slice(0, 3000)}
${projectContext !== null ? `PROJECT CONTEXT (canonical brand/strategy facts):\n${JSON.stringify(projectContext).slice(0, 2000)}\n` : ``}
DISCOVERY EVIDENCE (web retrieval; the ONLY web sources you may cite):
${JSON.stringify(successfulDiscovery).slice(0, 4000)}
SOCIAL/CONTENT-INTELLIGENCE EVIDENCE (opportunity signals only — NEVER factual proof; never claim trending/reach/virality beyond what is shown here):
${JSON.stringify(socialEvidence).slice(0, 2000)}
CANDIDATE OPPORTUNITIES (from discovery evidence):
${JSON.stringify(opportunities).slice(0, 3000)}
VERIFICATION PLANS:
${JSON.stringify(verificationPlans).slice(0, 2000)}
VERIFICATION EVIDENCE (per-candidate corroboration results):
${JSON.stringify(verificationExecutions.map((item) => safeRecord(item as Json))).slice(0, 4000)}
Return one JSON ResearchReport with: reportId (UUID); taskId (exact echo); stage (exact echo); taskDescription; summary; candidateStories (array, possibly empty when evidence is insufficient — an empty list is honest, never a failure — each entry {candidateId:string, topic:string, factualAngle:string, keyClaims:string[], sourceIds:number[], supportingEvidenceIds:string[] (stable evidence IDs copied exactly from the supplied retrieval evidence; never source IDs or capability-result IDs), sourceQualitySummary:string, visualPotential:string, shortFormPotential:string, trendEvidence:[{signal:string, observedAt:string|null, source:string}] (ONLY from social evidence above, with provenance; omit when none), evergreenEvidence:string[], marketRelevance:string|null, evidenceRisks:string[], verificationStatus:string, contentOpportunityAssessment:{level:"HIGH"|"MEDIUM"|"LOW", basis:string} (opportunity is SEPARATE from factual verification), factualVerification:{status:"STRONG"|"PARTIAL"|"INCOMPLETE", basis:string}, recommendedForProduction:boolean}); sources (array of {id:number,title:string,url:string,snippet:string} built ONLY from DISCOVERY/VERIFICATION evidence above); confidence (number 0..1 reflecting evidence quality, never inflated by retrieval count alone); citations (array of {sourceId:number,text:string} — every sourceId must equal a sources.id); evidenceRisks (array of strings); status (string: "grounded" when candidates are supported, "insufficient_evidence" otherwise); metadata {createdAt:string,agentVersion:string}.
Never claim media generation, publication, upload, or any production authority. Never invent source metadata. Do not include explanatory text outside the JSON.`;
  }

  /** Backward-compatible V1 post-retrieval synthesis prompt. */
  private buildSynthesisPrompt(
    input: ResearchAgentInput,
    plan: ResearchReport,
    retrievals: { providerId: string; results: { id?: unknown; title?: unknown; url?: unknown; snippet?: unknown; source?: unknown }[] }[],
  ): string {
    const contract = input.contract;
    const projectContext = isJsonRecord((input.projectContext ?? null) as Json) ? input.projectContext : null;
    const evidence = retrievals.map((retrieval, retrievalIndex) => ({
      retrievalId: retrievalIndex + 1,
      providerId: retrieval.providerId,
      results: retrieval.results.slice(0, 5).map((result, resultIndex) => ({
        id: resultIndex + 1,
        title: String(result.title ?? "").slice(0, 240),
        url: String(result.url ?? "").slice(0, 500),
        snippet: String(result.snippet ?? "").slice(0, 500),
        source: String(result.source ?? "").slice(0, 120),
      })),
    }));
    return `${this.researchConfig.systemPrompt}

Post-retrieval synthesis (contract amf-research-synthesis-v1) for research task ${input.task.id}.
Echo TASK_ID exactly into taskId: ${JSON.stringify(contract?.taskId ?? input.task.id)}
Echo STAGE exactly into stage: ${JSON.stringify(contract?.stage ?? "research")}
Planning summary: ${JSON.stringify(plan.summary).slice(0, 900)}
${projectContext === null ? "" : `PROJECT CONTEXT:\n${JSON.stringify(projectContext).slice(0, 2000)}\n`}
RETRIEVED EVIDENCE (the only sources you may cite):
${JSON.stringify(evidence).slice(0, 6000)}
Return one valid ResearchReport JSON with candidateStories, sources, citations, evidenceRisks, status, and metadata. An empty candidateStories list is valid when evidence is insufficient. Never invent source metadata or authority.
${RESEARCH_SYNTHESIS_SEMANTIC_CLAUSES.join(" ")}`;
  }

  /**
   * Post-retrieval synthesis validation (contract amf-research-synthesis-v1):
   * base report rules plus synthesis extras. Runs only when the caller set an
   * explicit synthesisContract; legacy/strategy inputs keep prior behavior.
   */
  private parseSynthesisResponse(output: Json, input: ResearchAgentInput): ResearchReport {
    const report = this.parseResearchResponse(output, input);
    const record = isJsonRecord(output) ? output : null;
    if (record === null) throw new ResearchStructuralValidationError(diagnoseResearchStructure(output, input));
    if (!Array.isArray(record.candidateStories)) {
      throw new ResearchStructuralValidationError({
        validationKind: "STRUCTURAL",
        issues: [{ path: "candidateStories", code: "missing_required", expected: "array" }],
        shape: { topLevelKeys: [], strategyFindingKeys: [], truncated: false },
        diagnosticsTruncated: false,
      });
    }
    if (record.status === "insufficient_evidence" && record.candidateStories.length !== 0) {
      throw new ResearchStructuralValidationError({
        validationKind: "STRUCTURAL",
        issues: [{ path: "candidateStories", code: "value_mismatch", expected: "empty array for insufficient_evidence" }],
        shape: { topLevelKeys: Object.keys(record), strategyFindingKeys: [], truncated: false },
        diagnosticsTruncated: false,
      });
    }
    if (record.status === "grounded" && record.candidateStories.length === 0) {
      throw new ResearchStructuralValidationError({
        validationKind: "STRUCTURAL",
        issues: [{ path: "candidateStories", code: "value_mismatch", expected: "at least one candidate for grounded" }],
        shape: { topLevelKeys: Object.keys(record), strategyFindingKeys: [], truncated: false },
        diagnosticsTruncated: false,
      });
    }
    for (const [index, item] of (record.candidateStories as unknown[]).entries()) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        throw new ResearchStructuralValidationError({
          validationKind: "STRUCTURAL",
          issues: [{ path: `candidateStories[${index}]`, code: "wrong_type", expected: "object", actualType: Array.isArray(item) ? "array" : typeof item }],
          shape: { topLevelKeys: [], strategyFindingKeys: [], truncated: false },
          diagnosticsTruncated: false,
        });
      }
      const candidate = item as Record<string, unknown>;
      // An empty candidate list is an honest insufficient-evidence result, not
      // a structural failure; non-empty entries need identity + topic.
      if (typeof candidate.candidateId !== "string" || candidate.candidateId.trim().length === 0) {
        throw new ResearchStructuralValidationError({
          validationKind: "STRUCTURAL",
          issues: [{ path: `candidateStories[${index}].candidateId`, code: "missing_required", expected: "string" }],
          shape: { topLevelKeys: [], strategyFindingKeys: [], truncated: false },
          diagnosticsTruncated: false,
        });
      }
      if (typeof candidate.topic !== "string" || candidate.topic.trim().length === 0) {
        throw new ResearchStructuralValidationError({
          validationKind: "STRUCTURAL",
          issues: [{ path: `candidateStories[${index}].topic`, code: "missing_required", expected: "string" }],
          shape: { topLevelKeys: [], strategyFindingKeys: [], truncated: false },
          diagnosticsTruncated: false,
        });
      }
      const candidateSourceIds = Array.isArray(candidate.sourceIds) ? candidate.sourceIds : [];
      const knownSourceIds = new Set(report.sources.map((source) => source.id));
      if (candidateSourceIds.some((id) => typeof id !== "number" || !knownSourceIds.has(id))) {
        throw new ResearchStructuralValidationError({
          validationKind: "STRUCTURAL",
          issues: [{ path: `candidateStories[${index}].sourceIds`, code: "value_mismatch", expected: "ids from sources" }],
          shape: { topLevelKeys: [], strategyFindingKeys: [], truncated: false }, diagnosticsTruncated: false,
        });
      }
    }
    if (!Array.isArray(record.evidenceRisks) || !record.evidenceRisks.every((risk): risk is string => typeof risk === "string")) {
      throw new ResearchStructuralValidationError({
        validationKind: "STRUCTURAL",
        issues: [{ path: "evidenceRisks", code: "wrong_type", expected: "array of strings", actualType: Array.isArray(record.evidenceRisks) ? "array" : typeof record.evidenceRisks }],
        shape: { topLevelKeys: [], strategyFindingKeys: [], truncated: false },
        diagnosticsTruncated: false,
      });
    }
    if (record.status !== "grounded" && record.status !== "insufficient_evidence") {
      throw new ResearchStructuralValidationError({
        validationKind: "STRUCTURAL",
        issues: [{ path: "status", code: "invalid_enum", expected: "grounded|insufficient_evidence" }],
        shape: { topLevelKeys: [], strategyFindingKeys: [], truncated: false },
        diagnosticsTruncated: false,
      });
    }
    // Synthesis-only semantic-syntax checks (provider `format` was removed
    // from the wire schema, so the runtime carries UUID/URI enforcement).
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(report.reportId))) {
      throw new ResearchStructuralValidationError({
        validationKind: "STRUCTURAL",
        issues: [{ path: "reportId", code: "value_mismatch", expected: "UUID string" }],
        shape: { topLevelKeys: [], strategyFindingKeys: [], truncated: false },
        diagnosticsTruncated: false,
      });
    }
    for (const [index, source] of report.sources.entries()) {
      let protocol = "";
      try { protocol = new URL(source.url).protocol; } catch { protocol = ""; }
      if (protocol !== "http:" && protocol !== "https:") {
        throw new ResearchStructuralValidationError({
          validationKind: "STRUCTURAL",
          issues: [{ path: `sources[${index}].url`, code: "value_mismatch", expected: "http(s) URL" }],
          shape: { topLevelKeys: [], strategyFindingKeys: [], truncated: false },
          diagnosticsTruncated: false,
        });
      }
    }
    if (record.status === "grounded") {
      // A production candidate must carry evidence-linked sources: unknown
      // ids already fail above, and an empty link set carries no evidence.
      const linkedSourceIds = new Set(report.sources.map((source) => source.id));
      for (const [index, item] of (record.candidateStories as unknown[]).entries()) {
        const candidate = item as Record<string, unknown>;
        const linked = Array.isArray(candidate.sourceIds) ? candidate.sourceIds.filter((id): id is number => typeof id === "number" && linkedSourceIds.has(id)) : [];
        if (linked.length === 0) {
          throw new ResearchStructuralValidationError({
            validationKind: "STRUCTURAL",
            issues: [{ path: `candidateStories[${index}].sourceIds`, code: "value_mismatch", expected: "evidence-linked sourceIds for grounded" }],
            shape: { topLevelKeys: [], strategyFindingKeys: [], truncated: false },
            diagnosticsTruncated: false,
          });
        }
      }
      // Grounding answers whether the candidate is sufficiently supported by
      // evidence; visual direction is constructed downstream (Visual Direction
      // builds from the scene plan, never from research.visual). An explicit
      // null visual is therefore the same canonical neutral as an absent key
      // and is normalized away by parseResearchResponse above.
    }
    return {
      ...report,
      candidateStories: (record.candidateStories as unknown[]).map((item) => {
        const candidate = item as Record<string, unknown>;
        const strings = (value: unknown): string[] | undefined => Array.isArray(value)
          ? value.filter((entry): entry is string => typeof entry === "string")
          : undefined;
        const opportunity = isJsonRecord((candidate.contentOpportunityAssessment ?? null) as Json)
          && ["HIGH", "MEDIUM", "LOW"].includes(String((candidate.contentOpportunityAssessment as JsonRecord).level))
          && typeof (candidate.contentOpportunityAssessment as JsonRecord).basis === "string"
          ? candidate.contentOpportunityAssessment as unknown as ResearchCandidateStory["contentOpportunityAssessment"] : undefined;
        const factual = isJsonRecord((candidate.factualVerification ?? null) as Json)
          && ["STRONG", "PARTIAL", "INCOMPLETE"].includes(String((candidate.factualVerification as JsonRecord).status))
          && typeof (candidate.factualVerification as JsonRecord).basis === "string"
          ? candidate.factualVerification as unknown as ResearchCandidateStory["factualVerification"] : undefined;
        const historical = input.researchObjective?.factualMode === "HISTORICAL_POV";
        const carriesEligibilityContract = input.researchObjective !== undefined
          || Object.prototype.hasOwnProperty.call(candidate, "recommendedForProduction")
          || factual !== undefined || opportunity !== undefined;
        const recommended = candidate.recommendedForProduction === true && (!historical || factual?.status === "STRONG");
        return {
          candidateId: String(candidate.candidateId),
          topic: String(candidate.topic),
          ...(typeof candidate.factualAngle === "string" ? { factualAngle: candidate.factualAngle } : {}),
          ...(strings(candidate.keyClaims) === undefined ? {} : { keyClaims: strings(candidate.keyClaims) }),
          ...(Array.isArray(candidate.sourceIds) ? { sourceIds: candidate.sourceIds.filter((id): id is number => typeof id === "number") } : {}),
          ...(Array.isArray(candidate.supportingEvidenceIds) ? { supportingEvidenceIds: candidate.supportingEvidenceIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0) } : {}),
          ...(typeof candidate.sourceQualitySummary === "string" ? { sourceQualitySummary: candidate.sourceQualitySummary } : {}),
          ...(typeof candidate.visualPotential === "string" ? { visualPotential: candidate.visualPotential } : {}),
          ...(typeof candidate.shortFormPotential === "string" ? { shortFormPotential: candidate.shortFormPotential } : {}),
          ...(typeof candidate.fitNote === "string" ? { fitNote: candidate.fitNote } : {}),
          ...(Array.isArray(candidate.evidenceRisks) ? { evidenceRisks: candidate.evidenceRisks.filter((risk): risk is string => typeof risk === "string") } : {}),
          ...(typeof candidate.verificationStatus === "string" ? { verificationStatus: candidate.verificationStatus } : {}),
          ...(opportunity === undefined ? {} : { contentOpportunityAssessment: opportunity }),
          ...(factual === undefined ? {} : { factualVerification: factual }),
          ...(Array.isArray(candidate.trendEvidence) ? { trendEvidence: candidate.trendEvidence as ResearchCandidateStory["trendEvidence"] } : {}),
          ...(strings(candidate.evergreenEvidence) === undefined ? {} : { evergreenEvidence: strings(candidate.evergreenEvidence) }),
          ...(typeof candidate.marketRelevance === "string" || candidate.marketRelevance === null ? { marketRelevance: candidate.marketRelevance as string | null } : {}),
          ...(carriesEligibilityContract ? { recommendedForProduction: recommended } : {}),
        };
      }),
      evidenceRisks: (record.evidenceRisks as unknown[]).filter((risk): risk is string => typeof risk === "string"),
      status: String(record.status),
    };
  }

  private toJson(report: ResearchReport): Json {
    return {
      reportId: report.reportId,
      ...(report.taskId === undefined ? {} : { taskId: report.taskId }),
      ...(report.stage === undefined ? {} : { stage: report.stage }),
      taskDescription: report.taskDescription,
      summary: report.summary,
      ...(report.candidateStories === undefined ? {} : { candidateStories: JSON.parse(JSON.stringify(report.candidateStories)) as Json }),
      ...(report.evidenceRisks === undefined ? {} : { evidenceRisks: [...report.evidenceRisks] }),
      ...(report.status === undefined ? {} : { status: report.status }),
      ...(report.planningUsage === undefined ? {} : { planningUsage: { ...report.planningUsage } }),
      ...(report.synthesisUsage === undefined ? {} : { synthesisUsage: { ...report.synthesisUsage } }),
      ...(report.researchPlan === undefined ? {} : { researchPlan: JSON.parse(JSON.stringify(report.researchPlan)) as Json }),
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
