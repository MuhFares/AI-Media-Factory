/**
 * Context Package — the output of the Context Engine.
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * This is the complete context package sent to the Prompt Compiler.
 * It contains all 9 sections in the canonical order.
 */

import type { AgentId, Json, Timestamp, Uuid, MemoryType, SectionType } from "./common";

export interface ContextPackage {
  /** Unique ID for this context package. */
  packageId: string;
  /** The agent this package is for. */
  agent: AgentId;
  /** Timestamp when package was created. */
  createdAt: Timestamp;
  
  /** Company Brain section (always included). */
  companyBrain: CompanyBrainSection;
  /** Agent Brain section (always included). */
  agentBrain: AgentBrainSection;
  /** Workflow context (if in workflow). */
  workflowContext?: WorkflowContextSection;
  /** Session context (always included). */
  sessionContext: SessionContextSection;
  /** Relevant memory (RAG results). */
  memory: MemorySection;
  /** Agent brain section. */
  agentBrain: AgentBrainSection;
  /** Workflow context (if applicable). */
  workflowContext?: WorkflowContextSection;
  /** Few-shot examples. */
  examples?: ExamplesSection;
  /** Current task/input. */
  task: TaskSection;
  /** Output schema. */
  outputSchema: SchemaSection;
  /** Safety/guardrails. */
  safety: SafetySection;
  
  /** Total tokens in this package. */
  totalTokens: number;
  /** Token budget used. */
  budgetUsed: number;
  /** Whether any section was compressed. */
  compressed: boolean;
  /** Cache info. */
  cacheInfo: CacheInfo;
}

export interface CacheInfo {
  hit: boolean;
  cacheKey: CacheKey;
  ageMs: number;
}

export interface CacheKey {
  agent: string;
  workflowId: string | null;
  stepId: string | null;
  trigger: string;
  contextHash: string;
  budgetHash: string;
}

export interface CompanyBrainSection {
  vision: string;
  mission: string;
  values: string[];
  northStar: string;
  decisionFramework: string;
  kpis: string;
  brandGuidelines: string;
  tokens: number;
}

export interface AgentBrainSection {
  agent: string;
  role: string;
  responsibilities: string[];
  kpis: string[];
  authority: DecisionAuthority;
  escalationRules: string;
  tokens: number;
}

export interface DecisionAuthority {
  canDecide: string[];
  mustEscalate: string[];
  budgetAuthorityUsd: number;
}

export interface WorkflowContextSection {
  workflowId: string;
  correlationId: string | null;
  brandId: string | null;
  currentStep: string;
  relevantOutputs: Record<string, any>;
  data: Record<string, any>;
  tokens: number;
}

export interface SessionContextSection {
  turnId: string;
  workflowId: string | null;
  agent: string;
  scratch: any;
  recentEvents: EventSummary[];
  tokens: number;
}

export interface EventSummary {
  eventId: string;
  type: string;
  stepId: string | null;
  timestamp: string;
  outcome: "success" | "failure" | "partial";
}

export interface MemorySection {
  records: MemoryRecord[];
  totalAvailable: number;
  retrieved: number;
  tokens: number;
  query: string;
  retrievalRules: RetrievalRulesSummary;
}

export interface RetrievalRulesSummary {
  maxPerType: Record<string, number>;
  minRelevance: number;
  minConfidence: number;
  recencyBoost: boolean;
  diversityFactor: number;
}

export interface ExamplesSection {
  examples: Example[];
  tokens: number;
}

export interface Example {
  input: string;
  output: string;
  description?: string;
}

export interface TaskSection {
  eventType: string;
  payload: any;
  tokens: number;
}

export interface SchemaSection {
  schema: any; // JSON Schema
  example?: any;
  tokens: number;
}

export interface SafetySection {
  preamble: string;
  guardrails: GuardrailSummary[];
  tokens: number;
}

export interface GuardrailSummary {
  id: string;
  type: "hard" | "soft";
  rule: string;
}