/**
 * Freshness Rules (Req #10).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

export interface FreshnessRules {
  maxAgeByType: Record<string, number>; // days
  decayFunction: "linear" | "exponential" | "step";
  halfLifeDays: number;
  neverExpire: string[];
}

export const DEFAULT_FRESHNESS_RULES: FreshnessRules = {
  maxAgeByType: {
    session: 30,
    company: null,
    agent: 90,
    analytics: 90,
    decision: null,
    workflow: 7,
    lessons: null,
    checkpoint: 30,
    knowledge: 365,
  },
  decayFunction: "exponential",
  halfLifeDays: 30,
  neverExpire: ["company", "decision", "lessons"],
}

export interface FreshnessEvaluator {
  isFresh(type: string, createdAt: string, asOf: string): boolean;
  freshnessScore(type: string, createdAt: string, asOf: string): number;
}