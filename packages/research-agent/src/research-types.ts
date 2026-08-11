/**
 * Research Agent types.
 */

import type { Uuid } from "@ai-media-factory/runtime";
import type { ExecutionContext, ExecutionResponse } from "@ai-media-factory/runtime";
import type { CapabilityRequest } from "@ai-media-factory/runtime";
import type { PlanTask } from "@ai-media-factory/planner-agent";

/** Input to the research agent: a research task from the planner. */
export interface ResearchAgentInput {
  /** The task to research. */
  task: PlanTask;
  /** Optional authorized capability requests (e.g. web search) to execute through the runtime boundary. */
  capabilityRequests?: readonly CapabilityRequest[];
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
  /** Metadata about the report. */
  metadata: {
    /** When the report was created. */
    createdAt: string;
    /** Research agent version. */
    agentVersion: string;
  };
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
