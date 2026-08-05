/**
 * Cost + token tracking (reqs #18, #19).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Converts token usage to cost and tracks token counts. Output flows into the
 * event metadata the Finance Brain consumes and enforces the Margin gate.
 */

import type { ProviderId, ModelId } from "../core/common.js";
import type { Usage } from "../core/request.js";

/** Converts token usage to a USD cost using the model catalog pricing. */
export interface CostMeter {
  /** Cost for a given token usage on a given model. */
  cost(model: ModelId, inputTokens: number, outputTokens: number): number;
  /** Attribute recorded cost to a caller context (agent/brand/workflow). */
  attribute(context: { agent?: string; brand?: string; workflowId?: string }, usage: Usage): void;
}

/** Tracks input/output token counts per provider/model. */
export interface TokenMeter {
  record(provider: ProviderId, model: ModelId, inputTokens: number, outputTokens: number): void;
  total(model: ModelId): { inputTokens: number; outputTokens: number };
}
