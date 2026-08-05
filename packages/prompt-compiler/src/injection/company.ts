/**
 * Company Brain Injection (Req #8).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Injects the Company Brain (Company Brain documents) into the prompt.
 * Reads from memory/company/ (README + key docs).
 */

import type { AgentId } from "../core/common";

export interface CompanyBrainInjector {
  /** Inject the Company Brain into the prompt. */
  inject(options?: CompanyInjectionOptions): Promise<string>;
}

export interface CompanyInjectionOptions {
  /** Which sections to include (default: all). */
  include?: Array<"vision" | "mission" | "values" | "goals" | "north_star" | "decision_framework" | "kpis" | "brand_guidelines">;
  /** Maximum tokens for this section. */
  maxTokens?: number;
  /** Format: "concise" (bullet points) | "full" (full text). */
  format?: "concise" | "full";
}

export interface CompanyBrainInjectionResult {
  content: string;
  sectionsIncluded: string[];
  tokens: number;
  truncated: boolean;
}