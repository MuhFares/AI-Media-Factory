/**
 * Structured operation outcomes for provider adapters.
 *
 * Every adapter reports the outcome of each provider operation (success or
 * classified failure) through an injectable sink. This is the observability
 * surface for provider health and retry behaviour.
 */

import type { ProviderFailureCategory } from "./errors.js";

export interface OperationOutcome {
  providerId: string;
  operation: string;
  outcome: "success" | "failure";
  latencyMs: number;
  retryCount: number;
  category?: ProviderFailureCategory;
  statusCode?: number;
  /** Correlator when the provider assigns one (job id, publication id, ...). */
  requestKey?: string;
}

export type OperationSink = (outcome: OperationOutcome) => void;

export const noopSink: OperationSink = () => {};

export function sinkOf(sink: OperationSink | undefined): OperationSink {
  return sink ?? noopSink;
}