/**
 * Section types and ordering enforcement.
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * The 11 sections in enforced assembly order. The compiler MUST assemble
 * sections in this exact order; the enum order IS the assembly order.
 */

import type { SectionType } from "./common";

export enum SectionType {
  System = 1,
  CompanyBrain = 2,
  AgentBrain = 3,
  WorkflowContext = 4,
  Memory = 5,
  Examples = 6,
  Task = 7,
  OutputSchema = 8,
  Safety = 9,
}

/** Section metadata for ordering and budgeting. */
export interface SectionMetadata {
  type: SectionType;
  name: string;
  required: boolean;
  priority: number;    // Higher = protected from budget trimming
  flexible: boolean;
}

/** Section order is the enum order. */
export const SECTION_ORDER: SectionType[] = [
  SectionType.System,
  SectionType.CompanyBrain,
  SectionType.AgentBrain,
  SectionType.WorkflowContext,
  SectionType.Memory,
  SectionType.Examples,
  SectionType.Task,
  SectionType.OutputSchema,
  SectionType.Safety,
];

/** Default per-section allocations (as % of maxPromptTokens). */
export const DEFAULT_ALLOCATIONS: Record<string, { maxPct: number; priority: number; flexible: boolean }> = {
  system:              { maxPct: 0.05,  priority: 90, flexible: false },
  company_brain:       { maxPct: 0.15,  priority: 80, flexible: true  },
  agent_brain:         { maxPct: 0.10,  priority: 80, flexible: true  },
  workflow_context:    { maxPct: 0.15,  priority: 70, flexible: true  },
  memory:              { maxPct: 0.25,  priority: 60, flexible: true  },
  examples:            { maxPct: 0.15,  priority: 30, flexible: true  },
  task:                { maxPct: 0.05,  priority: 90, flexible: false },
  output_schema:       { maxPct: 0.05,  priority: 80, flexible: false },
  safety:              { maxPct: 0.05,  priority: 100, flexible: false },
};

/** Returns section metadata by type. */
export function getSectionMetadata(type: SectionType): {
  required: boolean;
  priority: number;
  flexible: boolean;
  defaultMaxPct: number;
} {
  const req = [SectionType.System, SectionType.CompanyBrain, SectionType.AgentBrain,
               SectionType.WorkflowContext, SectionType.Memory, SectionType.Task,
               SectionType.OutputSchema, SectionType.Safety];
  const key = SectionType[type].toLowerCase();
  const alloc = DEFAULT_ALLOCATIONS[key] ?? { maxPct: 0.1, priority: 50, flexible: true };
  return {
    required: req.includes(type),
    priority: alloc.priority,
    flexible: alloc.flexible,
    defaultMaxPct: alloc.maxPct,
  };
}