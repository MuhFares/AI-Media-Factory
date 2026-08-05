/**
 * Safety Layer (Req #13).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * The Safety Layer enforces guardrails from agent config + brand guidelines.
 * It can block, warn, or rewrite the prompt.
 */

import type { Json } from "../core/common";

export interface Guardrail {
  id: string;
  type: "hard" | "soft";
  rule: string;                    // Human-readable rule description
  check: (prompt: string) => boolean;
  violationAction: "block" | "warn" | "rewrite";
}

export interface GuardrailSet {
  /** Hard guardrails (block if violated). */
  hard: Guardrail[];
  /** Soft guardrails (warn or rewrite). */
  soft: Guardrail[];
  /** Brand-specific rules. */
  brand: BrandGuardrails;
}

export interface BrandGuardrails {
  voice: VoiceRules;
  forbiddenTerms: string[];
  requiredCitations: boolean;
  maxHypeLevel: number;
}

export interface VoiceRules {
  confident: boolean;
  clear: boolean;
  grounded: boolean;
  expertApproachable: boolean;
  showDontTell: boolean;
}

export interface GuardrailViolation {
  guardrailId: string;
  severity: "hard" | "soft";
  message: string;
  location?: { start: number; end: number };
}

export interface SafetyLayer {
  /** Check a prompt against all guardrails. */
  check(prompt: string): Promise<SafetyResult>;

  /** Prepend safety preamble to final prompt (always included). */
  injectSafetyPreamble(prompt: string): string;

  /** Apply rewrite transformations for soft violations. */
  rewrite(prompt: string, violations: GuardrailViolation[]): Promise<string>;
}

export interface SafetyResult {
  passed: boolean;
  violations: GuardrailViolation[];
  rewrittenPrompt?: string;   // if soft violations were auto-rewritten
}

export interface GuardrailViolation {
  guardrailId: string;
  severity: "hard" | "soft";
  message: string;
  location?: { start: number; end: number };
  suggestedRewrite?: string;
}