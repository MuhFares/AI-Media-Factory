/**
 * The router: automatic provider/model selection (req #5).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * The Router turns a GenerateRequest into a chosen (provider, model) plus an
 * ordered fallback chain, applying capability + health + rate-limit filters
 * then a selection strategy. The runtime never sees any of this.
 */

import type { GenerateRequest } from "../core/request.js";
import type { ModelDescriptor } from "../registry/model-registry.js";
import type { LlmProvider } from "../core/provider.js";
import type { SelectionStrategyId } from "./selection.js";

export interface RoutingRequest {
  request: GenerateRequest;
  /** Strategy to use for this route (from configs/models per agent/task). */
  strategy: SelectionStrategyId;
}

export interface RoutingDecision {
  /** The chosen provider + model to try first. */
  primary: { provider: LlmProvider; model: ModelDescriptor };
  /** Ordered fallback candidates (may span vendors). */
  fallbackChain: Array<{ provider: LlmProvider; model: ModelDescriptor }>;
  /** Why this primary was chosen (for audit logging). */
  rationale: string;
}

export interface Router {
  /** Produce a routing decision (capability → health → rate-limit → strategy). */
  route(input: RoutingRequest): Promise<RoutingDecision>;
}
