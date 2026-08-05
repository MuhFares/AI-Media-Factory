/**
 * Provider registry (req #2).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { LlmProvider } from "../core/provider.js";
import type { ProviderId, ModelId } from "../core/common.js";

/** Registers provider adapters and resolves them by id or by model. */
export interface ProviderRegistry {
  register(provider: LlmProvider): void;
  get(id: ProviderId): LlmProvider | null;
  /** All registered providers that serve the given model. */
  forModel(model: ModelId): LlmProvider[];
  all(): LlmProvider[];
}
