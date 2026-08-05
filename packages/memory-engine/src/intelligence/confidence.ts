/**
 * Confidence scoring (req #13).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * 0..1, driven by evidence strength, corroboration, recency decay, and outcome
 * validation. Gates whether a memory is acted on autonomously vs "verify first".
 */

import type { MemoryRecord } from "../core/record.js";

export interface ConfidenceInputs {
  evidenceCount: number;
  corroborations: number;
  ageDays: number;
  /** Did this memory predict outcomes correctly when previously applied? */
  outcomeValidations: number;
  outcomeFailures: number;
}

export interface ConfidenceScorer {
  /** Compute a confidence score for a record given its evidence signals. */
  score(record: MemoryRecord, inputs: ConfidenceInputs): number;
  /** Reinforce (raise) or decay confidence as evidence/age changes. */
  reinforce(current: number, positive: boolean): number;
}
