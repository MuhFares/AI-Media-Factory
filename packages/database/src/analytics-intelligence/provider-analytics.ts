/**
 * Program 4 — provider/model performance foundation.
 * Rolls up governed execution evidence (QA survival, failure rate, cost)
 * and refuses to rank providers without comparable published evidence.
 */
export interface ProviderEvidence {
  readonly runs: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly qaSurvived: number;
  readonly qaTotal: number;
  readonly knownCost: number | null;
  readonly publishedItems: number;
}

export interface ProviderRollup {
  readonly runs: number;
  readonly successRate: number | null;
  readonly failureRate: number | null;
  readonly qaSurvivalRate: number | null;
  readonly knownCost: number | null;
  readonly publishedItems: number;
  readonly sufficient: boolean;
  readonly reason: string;
}

/** Minimum 5 runs before any rate is quoted; otherwise INSUFFICIENT_DATA. */
export function rollupProvider(ev: ProviderEvidence): ProviderRollup {
  if (ev.runs < 5) {
    return {
      runs: ev.runs, successRate: null, failureRate: null, qaSurvivalRate: null,
      knownCost: ev.knownCost, publishedItems: ev.publishedItems,
      sufficient: false, reason: `only ${ev.runs} run(s); need 5 for quoted rates`,
    };
  }
  return {
    runs: ev.runs,
    successRate: ev.succeeded / ev.runs,
    failureRate: ev.failed / ev.runs,
    qaSurvivalRate: ev.qaTotal > 0 ? ev.qaSurvived / ev.qaTotal : null,
    knownCost: ev.knownCost,
    publishedItems: ev.publishedItems,
    sufficient: true,
    reason: "rates quoted from governed execution evidence",
  };
}

/** Provider comparison without invented rankings. */
export function compareProviders(
  aLabel: string, a: ProviderRollup, bLabel: string, b: ProviderRollup,
): { quality: "COMPARABLE" | "INSUFFICIENT_DATA"; reason: string } {
  if (!a.sufficient || !b.sufficient) {
    return {
      quality: "INSUFFICIENT_DATA",
      reason: `not enough governed evidence to compare ${aLabel} with ${bLabel}`,
    };
  }
  if (a.publishedItems === 0 || b.publishedItems === 0) {
    return {
      quality: "INSUFFICIENT_DATA",
      reason: "downstream engagement comparison needs published items on both sides",
    };
  }
  return { quality: "COMPARABLE", reason: "both providers have sufficient governed evidence" };
}
