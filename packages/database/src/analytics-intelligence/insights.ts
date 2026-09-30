/**
 * Program 4 — deterministic evidence-backed insight layer (no LLM).
 * Every insight carries evidence references, metric references, window,
 * and an evidence classification. Insights describe; they never prescribe
 * authority and never claim causality.
 */
export type InsightConfidence = "STRONG" | "MODERATE" | "WEAK" | "INFORMATIONAL";

export interface Insight {
  readonly text: string;
  readonly evidenceRefs: readonly string[];
  readonly metricRefs: readonly string[];
  readonly window: string | null;
  readonly confidence: InsightConfidence;
}

function insight(
  text: string, evidenceRefs: readonly string[], metricRefs: readonly string[],
  window: string | null, confidence: InsightConfidence,
): Insight {
  return { text, evidenceRefs, metricRefs, window, confidence };
}

/** Comparative insight from an already-computed comparison. */
export function comparisonInsight(input: {
  readonly labelA: string; readonly labelB: string; readonly metric: string;
  readonly leader: "A" | "B" | "TIE" | null; readonly quality: string;
  readonly window: string | null; readonly evidenceRefs: readonly string[];
}): Insight | null {
  if (input.quality !== "COMPARABLE" && input.quality !== "PARTIALLY_COMPARABLE") return null;
  if (input.leader === null || input.leader === "TIE") {
    return insight(
      `${input.labelA} and ${input.labelB} are tied on ${input.metric}.`,
      input.evidenceRefs, [input.metric], input.window, "MODERATE");
  }
  const winner = input.leader === "A" ? input.labelA : input.labelB;
  const qualifier = input.quality === "PARTIALLY_COMPARABLE" ? " (direction only; windows differ)" : "";
  return insight(
    `${winner} leads on ${input.metric}${qualifier}.`,
    input.evidenceRefs, [input.metric], input.window, "MODERATE");
}

/** Sparseness insight: honest about what cannot be said yet. */
export function sparsenessInsight(input: {
  readonly scope: string; readonly measured: number; readonly pending: number;
  readonly evidenceRefs: readonly string[];
}): Insight | null {
  if (input.measured > 0 && input.pending === 0) return null;
  return insight(
    `${input.scope}: ${input.measured} measured, ${input.pending} awaiting measurement; conclusions stay pending.`,
    input.evidenceRefs, [], null, "INFORMATIONAL");
}

/** Provider-evidence-gap insight: never ranks providers without data. */
export function providerGapInsight(input: {
  readonly providerA: string; readonly providerB: string;
  readonly comparableEvidence: boolean; readonly evidenceRefs: readonly string[];
}): Insight {
  return insight(
    input.comparableEvidence
      ? `${input.providerA} and ${input.providerB} have comparable published evidence; see comparisons.`
      : `Not enough published performance evidence to compare ${input.providerA} with ${input.providerB}.`,
    input.evidenceRefs, [], null, input.comparableEvidence ? "MODERATE" : "INFORMATIONAL");
}

/** Experiment-evaluability insight. */
export function experimentEvaluabilityInsight(input: {
  readonly experimentId: string; readonly evaluable: boolean;
  readonly reason: string; readonly evidenceRefs: readonly string[];
}): Insight {
  return insight(
    input.evaluable
      ? `Experiment ${input.experimentId} has evaluable evidence.`
      : `Experiment ${input.experimentId} cannot yet be evaluated: ${input.reason}`,
    input.evidenceRefs, [], null, input.evaluable ? "MODERATE" : "INFORMATIONAL");
}
