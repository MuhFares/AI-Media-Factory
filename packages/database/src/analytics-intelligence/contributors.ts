/**
 * Program 4 — contributor analysis foundation (association only).
 * Answers "what varied alongside performance" without ever claiming
 * causation. Vocabulary is fixed: OBSERVED_ASSOCIATION,
 * POSSIBLE_CONTRIBUTOR, INSUFFICIENT_EVIDENCE, NOT_EVALUABLE.
 */
export type ContributorVerdict =
  | "OBSERVED_ASSOCIATION"
  | "POSSIBLE_CONTRIBUTOR"
  | "INSUFFICIENT_EVIDENCE"
  | "NOT_EVALUABLE";

export interface ContributorInput {
  readonly dimension: string;
  readonly valuesDiffer: boolean | null;
  readonly outcomeDiffers: boolean | null;
  readonly evidenceRefs: readonly string[];
}

export interface ContributorResult {
  readonly dimension: string;
  readonly verdict: ContributorVerdict;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
}

/** A dimension that did not vary cannot explain a difference. */
export function analyzeContributor(input: ContributorInput): ContributorResult {
  if (input.valuesDiffer === null || input.outcomeDiffers === null) {
    return {
      dimension: input.dimension, verdict: "INSUFFICIENT_EVIDENCE",
      reason: `${input.dimension}: missing dimension or outcome evidence`,
      evidenceRefs: input.evidenceRefs,
    };
  }
  if (!input.valuesDiffer && !input.outcomeDiffers) {
    return {
      dimension: input.dimension, verdict: "NOT_EVALUABLE",
      reason: `${input.dimension}: neither dimension nor outcome varied`,
      evidenceRefs: input.evidenceRefs,
    };
  }
  if (!input.valuesDiffer) {
    return {
      dimension: input.dimension, verdict: "NOT_EVALUABLE",
      reason: `${input.dimension}: constant across compared items, cannot explain the difference`,
      evidenceRefs: input.evidenceRefs,
    };
  }
  if (!input.outcomeDiffers) {
    return {
      dimension: input.dimension, verdict: "OBSERVED_ASSOCIATION",
      reason: `${input.dimension}: varied while outcome held steady (associated, not causal)`,
      evidenceRefs: input.evidenceRefs,
    };
  }
  return {
    dimension: input.dimension, verdict: "POSSIBLE_CONTRIBUTOR",
    reason: `${input.dimension}: co-varied with the outcome (association only, never causation)`,
    evidenceRefs: input.evidenceRefs,
  };
}
