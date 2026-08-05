/**
 * Runtime <-> provider-layer binding.
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * The canonical LLM provider abstraction lives in `@ai-media-factory/providers`.
 * The runtime does NOT redefine it (that duplication has been removed). This
 * module declares how the runtime's LlmExecutor binds to that canonical layer:
 * it maps the runtime's ExecutionRequest -> the provider layer's GenerateRequest,
 * calls generate()/stream(), and maps GenerateResponse -> ExecutionResponse.
 *
 * This is the single point where the two abstraction levels meet. Beyond this
 * binding the runtime pipeline stays both vendor-agnostic and unaware of the
 * provider layer's internals.
 */

import type { ExecutionRequest, ExecutionResponse } from "../interfaces/execution.js";
import type { CancellationToken } from "../interfaces/resilience.js";
import type {
  GenerateRequest,
  GenerateResponse,
} from "@ai-media-factory/providers";

/** Re-export the canonical provider contracts for the runtime's internal use. */
export type {
  LlmProvider,
  Router,
  GenerateRequest,
  GenerateResponse,
  ProviderId,
} from "@ai-media-factory/providers";

/**
 * Bridges the runtime executor to the canonical provider layer. The executor
 * holds a RuntimeProviderBinding and never talks to a vendor directly; the
 * binding delegates model selection + invocation to the provider layer's Router.
 */
export interface RuntimeProviderBinding {
  /** Map a runtime execution request to the provider layer's unified request. */
  toGenerateRequest(request: ExecutionRequest): GenerateRequest;
  /** Map the provider layer's unified response back to a runtime response. */
  fromGenerateResponse(response: GenerateResponse): ExecutionResponse;
  /** Run one execution end-to-end via the provider layer (routing + fallback). */
  run(request: ExecutionRequest, signal: CancellationToken): Promise<ExecutionResponse>;
}
