/**
 * Agent Brain Injection (Req #9).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Injects the Agent's specific brain (identity, role, principles).
 * Reads from packages/agents/{agent}/brain.md or synthesizes from system+instructions.
 */

import type { AgentId } from "../core/common";

export interface AgentBrainInjector {
  /** Inject the agent's brain into the prompt. */
  inject(agent: AgentId, options?: AgentBrainInjectionOptions): Promise<string>;
}

export interface AgentBrainInjectionOptions {
  /** Maximum tokens for this section. */
  maxTokens?: number;
  /** Include agent's KPIs and responsibilities? */
  includeKPIs?: boolean;
  /** Include agent's decision authority? */
  includeAuthority?: boolean;
}

export interface AgentBrainInjectionResult {
  content: string;
  sectionsIncluded: string[];
  tokens: number;
  truncated: boolean;
}