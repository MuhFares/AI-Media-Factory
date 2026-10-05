/**
 * Research Agent types.
 */

import type { Uuid } from "@ai-media-factory/runtime";
import type { ExecutionContext, ExecutionResponse } from "@ai-media-factory/runtime";
import type { CapabilityRequest } from "@ai-media-factory/runtime";
import type { PlanTask } from "@ai-media-factory/planner-agent";
import type { VisualEvidence, VisualMode, ReferenceStrategy } from "@ai-media-factory/tool-framework";
import type { ContentIntelligenceResult, ResearchRequest } from "./content-intelligence.js";

/** Input to the research agent: a research task from the planner. */
export interface ResearchAgentInput {
  /** The task to research. */
  task: PlanTask;
  /**
   * Stable machine contract identity. When present, the report is validated
   * deterministically against taskId/stage exact equality, and taskDescription
   * is treated as descriptive prose (non-empty + relevant) rather than a
   * byte-for-byte echo. Absent = legacy path (exact description match).
   */
  contract?: {
    /** Stable contract identity; must equal the echoed report taskId exactly. */
    taskId: string;
    /** Contract stage; must equal the echoed report stage exactly. */
    stage: string;
  };
  /**
   * Synthesis contract marker. When set (production two-phase research), the
   * final report is validated against the post-retrieval synthesis contract
   * (candidateStories/evidenceRisks/status plus the base report fields).
   */
  synthesisContract?: string;
  /** Structured business/content objective used by Intelligence V2 direction. */
  researchObjective?: ResearchObjective;
  /** Canonical runtime capability inventory; desired capabilities never imply availability. */
  capabilityInventory?: CapabilitySupportEntry[];
  /**
   * Authorized retrieval call envelope for this execution.  V2 planning caps
   * total discovery + verification calls to this value.  When absent the agent
   * falls back to its architectural maximum (MAX_DISCOVERY_REQUESTS +
   * MAX_VERIFICATION_REQUESTS).  The caller computes:
   *
   *   effectiveEnvelope = min(architecturalMax, missionAuthorizedMax, remainingBudget)
   *
   * and passes the result here BEFORE the direction LLM runs.
   */
  maxRetrievalCallsAvailable?: number;
  /**
   * Durable execution scope for capability identities. The production worker
   * supplies the current recovery execution id; an ordinary first execution
   * may omit it and uses the stable `initial` scope.
   */
  recoveryScopeId?: string;
  /** Durable, owner-authorized direction reuse for an exact-workflow recovery. */
  reusedDirection?: {
    mission: ResearchMission;
    workflowId: string;
    correlationId: string;
    sourceExecutionId: string;
    providerRequestId: string;
    parsedPayloadFingerprint: string;
  };
  /**
   * Canonical project context supplied by the caller (brand/strategy facts with
   * provenance). The agent includes it in its prompt; it never improvises
   * brand strategy when this is absent (see PROJECT_CONTEXT_INCOMPLETE gate).
   */
  projectContext?: Record<string, unknown>;
  /** Optional authorized capability requests (e.g. web search) to execute through the runtime boundary. */
  capabilityRequests?: readonly CapabilityRequest[];
  /** Optional backward-compatible intelligence/source request. */
  researchRequest?: ResearchRequest;
}

/** A single source in the research report. */
export interface ResearchSource {
  /** Unique identifier for the source. */
  id: number;
  /** Title of the source. */
  title: string;
  /** URL of the source. */
  url: string;
  /** Brief snippet or summary of the source content. */
  snippet: string;
  /** Date accessed or published. */
  dateAccessed?: string;
}

/** A citation referencing a source. */
export interface ResearchCitation {
  /** ID of the source being cited. */
  sourceId: number;
  /** The text that is cited. */
  text: string;
  /** Optional start and end indices in the source text. */
  location?: { start: number; end: number };
}

/** The complete research report output by the research agent. */
export interface ResearchReport {
  /** Unique report identifier. */
  reportId: Uuid;
  /**
   * Stable contract identity echo. Required when the input carries a contract;
   * must equal the contract taskId byte-for-byte (deterministic, no fuzzy match).
   */
  taskId?: string;
  /**
   * Contract stage echo. Required when the input carries a contract; must equal
   * the contract stage byte-for-byte.
   */
  stage?: string;
  /** The original research task description. */
  taskDescription: string;
  /** Summary of the research findings. */
  summary: string;
  /** List of sources consulted. */
  sources: ResearchSource[];
  /** Confidence score in the research (0-1). */
  confidence: number;
  /** Citations referencing the sources. */
  citations: ResearchCitation[];
  /** Compact strategy findings required only for PRE_PUBLICATION_STRATEGY research. */
  strategyFindings?: {
    referencePatterns: StrategyFinding[];
    audienceOpportunities: StrategyFinding[];
    contentTerritories: StrategyFinding[];
    platformFindings: PlatformFinding[];
    differentiationOpportunities: StrategyFinding[];
    productionImplications: StrategyFinding[];
    risks: StrategyFinding[];
    assumptions: StrategyFinding[];
    unknowns: StrategyFinding[];
  };
  /** Optional normalized intelligence result; absent for legacy reports. */
  intelligence?: ContentIntelligenceResult;
  /** Optional provider-agnostic visual research, present when the topic needs imagery. */
  visual?: {
    topic: string;
    visualMode: VisualMode;
    referenceStrategy: ReferenceStrategy;
    imageRefs: VisualEvidence[];
    sourceRefs: VisualEvidence[];
    observations: string[];
    people?: { description: string; wardrobe?: string[] }[];
    environment?: string[];
    location?: string[];
    objects?: string[];
    styleCues?: string[];
    avoidCues?: string[];
    sceneRelevance?: string;
    provenance: "none" | "local" | "web" | "mixed";
  };
  /** Metadata about the report. */
  metadata: {
    /** When the report was created. */
    createdAt: string;
    /** Research agent version. */
    agentVersion: string;
  };
  /** A candidate factual story (post-retrieval synthesis only). */
  candidateStories?: ResearchCandidateStory[];
  /** Known evidence risks/limitations (post-retrieval synthesis only). */
  evidenceRisks?: string[];
  /** Synthesis status (post-retrieval synthesis only). */
  status?: string;
  /** The pre-retrieval planning report (preserved as execution evidence). */
  researchPlan?: ResearchPlan;
  /** Per-call LLM usage for budget attribution (planning call). */
  planningUsage?: ResearchCallUsage;
  /** Per-call LLM usage for budget attribution (post-retrieval synthesis call). */
  synthesisUsage?: ResearchCallUsage;
}

/** A pre-retrieval research plan (contract amf-research-plan-v1). */
export interface ResearchPlan {
  /** Stable contract identity echo. */
  taskId: string;
  /** Contract stage echo. */
  stage: string;
  /** Research objective. */
  objective: string;
  /** Planned search questions/queries. */
  searchQueries: string[];
  /** Research questions. */
  researchQuestions: string[];
  /** Plan status. */
  status: string;
  /** Plan summary. */
  summary: string;
}

/** A candidate factual story from post-retrieval synthesis. */
export interface ResearchCandidateStory {
  /** Stable candidate identity within this report (e.g. candidate-1). */
  candidateId: string;
  /** Candidate topic/title. */
  topic: string;
  /** Factual angle. */
  factualAngle?: string;
  /** Key factual claims requiring support. */
  keyClaims?: string[];
  /** Source ids supporting this candidate. */
  sourceIds?: number[];
  /** Stable persisted execution-evidence identities supporting this candidate. */
  supportingEvidenceIds?: string[];
  /** Per-candidate source-quality summary. */
  sourceQualitySummary?: string;
  /** Visual potential note. */
  visualPotential?: string;
  /** Short-form potential note. */
  shortFormPotential?: string;
  /** Why it fits / fit note. */
  fitNote?: string;
  /** Candidate-level evidence risks. */
  evidenceRisks?: string[];
  /** Verification status (e.g. verified, needs-verification, unverified). */
  verificationStatus?: string;
  /** Content-opportunity assessment, separate from factual verification. */
  contentOpportunityAssessment?: ContentOpportunityAssessment;
  /** Factual verification outcome, separate from opportunity. */
  factualVerification?: FactualVerification;
  /** Trend evidence with provenance (never invented). */
  trendEvidence?: { signal: string; observedAt: string | null; source: string }[];
  /** Evergreen evidence notes. */
  evergreenEvidence?: string[];
  /** Market relevance note. */
  marketRelevance?: string | null;
  /** Whether research recommends this candidate for production. */
  recommendedForProduction?: boolean;
}

/** Bounded per-call LLM usage for budget attribution. */
export interface ResearchCallUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface StrategyFinding {
  label: string;
  rationale: string;
  certainty: "KNOWN" | "OBSERVED" | "INFERRED" | "ASSUMED" | "UNKNOWN";
}

export interface PlatformFinding extends StrategyFinding {
  platform: "Instagram Reels" | "YouTube Shorts" | "TikTok";
}

/**
 * Canonical Research text-execution legs that may carry an independent model.
 * Reuses the call-leg vocabulary already canonical in budget authority.
 * RETRIEVAL is deliberately absent: retrieval planning is local and the
 * retrieval boundary carries no agent LLM call, so there is nothing to route.
 */
export type ResearchSynthesisLeg = "DIRECTION" | "FINAL_SYNTHESIS";

/** Research agent configuration. */
export interface ResearchConfig {
  /** Model to use for research. */
  model: string;
  /**
   * Optional per-leg model override. Only legs carrying a canonical
   * text-execution identity (DIRECTION planning, FINAL_SYNTHESIS) may be
   * overridden; retrieval has no agent LLM call. Absent legs resolve to
   * {@link ResearchConfig.model}. A leg listed here must also carry an
   * entry in the agent's per-leg execute map, enforced at construction.
   */
  modelForLeg?: Partial<Record<ResearchSynthesisLeg, string>>;
  /** Temperature for research output. */
  temperature: number;
  /** Maximum tokens for research output. */
  maxOutputTokens: number;
  /** System prompt for the research agent. */
  systemPrompt: string;
  /** Whether the model may include reasoning in its output. */
  includeReasoning?: boolean;
}

/** Research execution input (extends the base agent input). */
export interface ResearchExecutionInput {
  context: ExecutionContext;
  input: ResearchAgentInput;
}

/** Research execution output (extends the base agent output). */
export interface ResearchExecutionOutput {
  output: ResearchReport;
  response: ExecutionResponse;
}

/** A structured research objective (intelligence V2 entry point). */
export interface ResearchObjective {
  /** Owning project id. */
  projectId: string;
  /** Consumer brand. */
  brand: string;
  /** Content pillar (e.g. Historical POV, Original Fantasy). */
  contentPillar: string;
  /** Factual mode: historical claims need verification, fantasy does not. */
  factualMode: "HISTORICAL_POV" | "ORIGINAL_FANTASY";
  /** Target platforms. */
  platforms: string[];
  /** Market/geography (null = unspecified; never inferred). */
  market: string | null;
  /** Language. */
  language: string | null;
  /** Target audience. */
  audience: string | null;
  /** Content format. */
  format: string | null;
  /** Business objective in plain language. */
  businessObjective: string;
  /** Topic constraints. */
  topicConstraints: string[];
  /** Trend preference. */
  trendPreference: "TREND_LED" | "EVERGREEN" | "HYBRID";
  /** Desired content count. */
  desiredContentCount: number;
  /** Owner constraints. */
  ownerConstraints: string[];
}

/** One discovery lane in a research mission. */
export interface DiscoveryLane {
  /** Lane identity (canonical lane id or mission-scoped custom id). */
  laneId: string;
  /** What this lane investigates. */
  purpose: string;
  /** Query guidance for retrieval (never a hardcoded winner). */
  queryGuidance: string;
  /** Desired capability id. */
  desiredCapability: string;
  /** Actual capability id to invoke (may differ when degraded). */
  actualCapability: string;
  /** Max retrieval calls for this lane. */
  maxCalls: number;
  /** Expected output type. */
  expectedOutput: string;
  /**
   * Structured retrieval intent (optional; absent = broad discovery).
   * Compact entity terms emitted by Direction so candidate/topic
   * specificity survives query compilation and compaction. All
   * collections are honest-empty when the lane is exploratory.
   */
  /** Named entities / subject phrases for this lane. */
  subjectTerms?: string[];
  /** Site-level geographical specificity (beyond mission geography). */
  locationTerms?: string[];
  /** Dynasty / century / date range / historical period phrases. */
  periodTerms?: string[];
  /** What needs corroboration (claim-shaped phrases). */
  factTargets?: string[];
  /** Archive / museum / university / government / academic preferences. */
  sourcePreferences?: string[];
}

/** Capability support assessment for one desired source type. */
export interface CapabilitySupportEntry {
  /** Desired source type (e.g. INSTAGRAM_DISCOVERY, WEB_SEARCH). */
  sourceType: string;
  /** Support level. */
  status: "SUPPORTED" | "PARTIALLY_SUPPORTED" | "UNSUPPORTED";
  /** How it is actually served. */
  via: string[];
  /** Explicit limitations. */
  limitations: string[];
}

/** A structured research mission (contract amf-research-mission-v1). */
export interface ResearchMission {
  /** Stable contract identity echo. */
  taskId: string;
  /** Contract stage echo. */
  stage: string;
  /** Mission identity. */
  missionId: string;
  /** Objective text. */
  objective: string;
  /** Market (null = global/unspecified). */
  market: string | null;
  /** Geography (null = unspecified, never inferred). */
  geography: string | null;
  /** Language. */
  language: string | null;
  /** Platforms. */
  platforms: string[];
  /** Content pillar. */
  contentPillar: string;
  /** Factual mode. */
  factualMode: "HISTORICAL_POV" | "ORIGINAL_FANTASY";
  /** Audience. */
  audience: string | null;
  /** Trend mode. */
  trendMode: "TREND_LED" | "EVERGREEN" | "HYBRID";
  /** Time horizon (ISO date bounds or null). */
  timeHorizon: { from: string | null; to: string | null };
  /** Execution date (ISO) for anniversary/seasonal reasoning. */
  currentDate: string;
  /** Discovery lanes (1..5). */
  discoveryLanes: DiscoveryLane[];
  /** Desired source types. */
  desiredSourceTypes: string[];
  /** Capability support actually available. */
  availableCapabilities: CapabilitySupportEntry[];
  /** Desired-but-unavailable capabilities with reasons. */
  unavailableDesiredCapabilities: { sourceType: string; reason: string }[];
  /** Search priorities. */
  searchPriorities: string[];
  /** Verification requirements. */
  verificationRequirements: string[];
  /** Stop conditions. */
  stopConditions: string[];
  /** Risk notes. */
  riskNotes: string[];
}

/** A candidate opportunity from discovery evidence (pre-verification). */
export interface CandidateOpportunity {
  /** Stable candidate identity within this report. */
  candidateId: string;
  /** Candidate topic (arose from evidence, never hardcoded). */
  topic: string;
  /** Candidate type. */
  candidateType: string;
  /** Content pillar. */
  contentPillar: string;
  /** Market relevance note. */
  marketRelevance: string | null;
  /** Trend signals (only provider-returned evidence, never invented). */
  trendSignals: { signal: string; provenance: string; observedAt: string | null }[];
  /** Evergreen signals. */
  evergreenSignals: string[];
  /** Factual angle. */
  factualAngle: string;
  /** Why interesting. */
  whyInteresting: string;
  /** Visual potential. */
  visualPotential: string;
  /** Short-form potential. */
  shortFormPotential: string;
  /** Discovery evidence ids backing this candidate. */
  discoveryEvidenceIds: (string | number)[];
  /** Risks. */
  risks: string[];
  /** Verification questions for the verification planner. */
  verificationQuestions: string[];
  /** Whether verification is required (factual mode). */
  verificationRequired: boolean;
}

/** Verification plan for one candidate (deterministic compiler output). */
export interface CandidateVerificationPlan {
  /** Candidate identity. */
  candidateId: string;
  /** Claims requiring verification. */
  claimsToVerify: string[];
  /** Targeted verification queries. */
  verificationQueries: string[];
  /** Preferred authority classes. */
  preferredAuthorityClasses: string[];
  /** Minimum evidence rule description. */
  minimumEvidenceRule: string;
  /** Risks. */
  risks: string[];
}

/** Content-opportunity assessment, separate from factual verification. */
export interface ContentOpportunityAssessment {
  /** Opportunity level. */
  level: "HIGH" | "MEDIUM" | "LOW";
  /** Basis (which signals, with provenance). */
  basis: string;
}

/** Factual verification status, separate from opportunity. */
export interface FactualVerification {
  /** Verification status. */
  status: "STRONG" | "PARTIAL" | "INCOMPLETE";
  /** Basis. */
  basis: string;
}
