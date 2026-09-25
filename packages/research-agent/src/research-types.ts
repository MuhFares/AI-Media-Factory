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
  /** Candidate topic/title. */
  topic: string;
  /** Factual angle. */
  factualAngle?: string;
  /** Source ids supporting this candidate. */
  sourceIds?: number[];
  /** Why it fits / visual/short-form potential notes. */
  fitNote?: string;
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

/** Research agent configuration. */
export interface ResearchConfig {
  /** Model to use for research. */
  model: string;
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
