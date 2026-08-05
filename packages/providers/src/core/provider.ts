/**
 * The unified provider interface (req #1).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Every vendor adapter implements this. The runtime calls generate() (or
 * stream()/embed()) without knowing which vendor answers.
 */

import type { ProviderId, ModelId } from "./common.js";
import type {
  GenerateRequest,
  GenerateResponse,
  StreamChunk,
  EmbeddingRequest,
  EmbeddingResponse,
} from "./request.js";
import type { ModelCapabilities } from "./capabilities.js";
import type { HealthState } from "../observability/health.js";

/** The one contract every provider adapter implements. */
export interface LlmProvider {
  readonly id: ProviderId;

  /** Does this provider serve the given model id? */
  supports(model: ModelId): boolean;

  /** Declared capabilities/cost/latency for a model this provider serves. */
  describe(model: ModelId): ModelCapabilities | null;

  /** Single-shot completion (req #1). Credentials come from the environment. */
  generate(request: GenerateRequest, signal: AbortSignal): Promise<GenerateResponse>;

  /** Token streaming (req #11). */
  stream(request: GenerateRequest, signal: AbortSignal): AsyncIterable<StreamChunk>;

  /** Embeddings (req #15). */
  embed(request: EmbeddingRequest, signal: AbortSignal): Promise<EmbeddingResponse>;

  /** Health probe used by monitoring and failover (req #16). */
  health(): Promise<HealthState>;
}
