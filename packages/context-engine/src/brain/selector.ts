/**
 * Brain Selection (Req #6).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Decides which brains to include for a given agent/task.
 */

import type { AgentId, Json } from "./common";

export interface BrainSelector {
  /** Select which brains to include for this agent/task. */
  selectBrains(request: BrainSelectionRequest): Promise<BrainSelection>;
}

export interface BrainSelectionRequest {
  agent: AgentId;
  workflowId?: string;
  stepId?: string;
  trigger: string;
  taskType?: string;
}

export interface BrainSelection {
  /** Always included. */
  companyBrain: true;
  /** Always included. */
  agentBrain: true;
  /** Included if in workflow. */
  workflowContext: boolean;
  /** Included if agent has session. */
  sessionContext: boolean;
  /** Optional: only if relevant to task. */
  examples: boolean;
  /** Reasoning for the selection. */
  reasoning: string;
}

/** Selection rules by agent type. */
export const BRAIN_SELECTION_RULES: Record<string, Partial<BrainSelection>> = {
  ceo: {
    companyBrain: true,
    agentBrain: true,
    workflowContext: true,
    sessionContext: true,
    examples: false,
    reasoning: "CEO needs full context for strategic decisions",
  },
  orchestrator: {
    companyBrain: true,
    agentBrain: true,
    workflowContext: true,
    sessionContext: true,
    examples: false,
    reasoning: "Orchestrator manages workflow execution",
  },
  research: {
    companyBrain: true,
    agentBrain: true,
    workflowContext: true,
    sessionContext: true,
    examples: true,
    reasoning: "Research benefits from examples and workflow context",
  },
  writer: {
    companyBrain: true,
    agentBrain: true,
    workflowContext: true,
    sessionContext: true,
    examples: true,
    reasoning: "Writer needs examples for style consistency",
  },
  seo: {
    companyBrain: true,
    agentBrain: true,
    workflowContext: true,
    sessionContext: true,
    examples: true,
    reasoning: "SEO benefits from examples for optimization patterns",
  },
  thumbnail: {
    companyBrain: true,
    agentBrain: true,
    workflowContext: true,
    sessionContext: true,
    examples: true,
    reasoning: "Thumbnail benefits from visual examples",
  },
  video: {
    companyBrain: true,
    agentBrain: true,
    workflowContext: true,
    sessionContext: true,
    examples: true,
    reasoning: "Video benefits from examples for pacing/style",
  },
  publisher: {
    companyBrain: true,
    agentBrain: true,
    workflowContext: true,
    sessionContext: true,
    examples: false,
    reasoning: "Publisher follows defined publishing workflow",
  },
  analytics: {
    companyBrain: true,
    agentBrain: true,
    workflowContext: true,
    sessionContext: true,
    examples: false,
    reasoning: "Analytics processes structured data",
  },
  finance: {
    companyBrain: true,
    agentBrain: true,
    workflowContext: true,
    sessionContext: true,
    examples: false,
    reasoning: "Finance enforces budgets and margins",
  },
  growth: {
    companyBrain: true,
    agentBrain: true,
    workflowContext: true,
    sessionContext: true,
    examples: true,
    reasoning: "Growth runs experiments, benefits from examples",
  },
  qa: {
    companyBrain: true,
    agentBrain: true,
    workflowContext: true,
    sessionContext: true,
    examples: false,
    reasoning: "QA enforces quality gates",
  },
  brand: {
    companyBrain: true,
    agentBrain: true,
    workflowContext: true,
    sessionContext: true,
    examples: false,
    reasoning: "Brand enforces safety and voice guidelines",
  },
};

export const DEFAULT_BRAIN_SELECTION: BrainSelection = {
  companyBrain: true,
  agentBrain: true,
  workflowContext: true,
  sessionContext: true,
  examples: false,
  reasoning: "Default: full context for safety",
};