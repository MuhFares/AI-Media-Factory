/**
 * Token Budget (Req #4) and Memory Priority (Req #5).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

export interface TokenBudget {
  total: number;                    // Model context window
  reservedForCompletion: number;    // Min tokens for completion
  maxPromptTokens: number;          // total - reservedForCompletion
  allocations: SectionAllocation[];
}

export interface SectionAllocation {
  section: string;
  maxTokens: number;
  priority: number;     // Higher = protected from trimming
  flexible: boolean;    // Can be trimmed
  minTokens: number;    // Minimum viable tokens
}

export interface TokenBudget {
  total: number;
  reservedForCompletion: number;
  maxPromptTokens: number;
  allocations: SectionAllocation[];
}

export interface SectionAllocation {
  section: string;
  maxTokens: number;
  priority: number;
  flexible: boolean;
  minTokens: number;
}

export interface MemoryPriority {
  typePriority: Record<string, number>;
  confidenceBoost: (confidence: number) => number;
  recencyBoost: (ageDays: number) => number;
  performanceBoost: (performanceScore: number) => number;
  conflictPenalty: (conflictSeverity: number) => number;
}

export interface BudgetAllocator {
  allocate(budget: TokenBudget): SectionAllocation[];
  trimToBudget(
    sections: Map<string, { content: string; tokens: number }>,
    allocations: SectionAllocation[],
    maxTokens: number
  ): { sections: Map<string, { content: string; tokens: number }>; trimmed: boolean };
  estimateTokens(text: string, model?: string): number;
}

export const DEFAULT_SECTION_ALLOCATIONS: Record<string, { maxPct: number; priority: number; flexible: boolean; minPct: number }> = {
  safety:           { maxPct: 0.05, priority: 100, flexible: false, minPct: 0.03 },
  system:           { maxPct: 0.05, priority: 90,  flexible: false, minPct: 0.03 },
  output_schema:    { maxPct: 0.05, priority: 80,  flexible: false, minPct: 0.03 },
  company_brain:    { maxPct: 0.15, priority: 80,  flexible: true,  minPct: 0.08 },
  agent_brain:      { maxPct: 0.10, priority: 80,  flexible: true,  minPct: 0.05 },
  workflow_context: { maxPct: 0.15, priority: 70,  flexible: true,  minPct: 0.08 },
  memory:           { maxPct: 0.25, priority: 60,  flexible: true,  minPct: 0.10 },
  examples:         { maxPct: 0.15, priority: 30,  flexible: true,  minPct: 0.05 },
};