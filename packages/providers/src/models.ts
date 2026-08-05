/**
 * Concrete model catalog registry.
 *
 * Wraps the `MODEL_CATALOG` from `./config` and provides lookup, filtering, and
 * cost-aware selection over concrete `ModelConfig` entries. This is the
 * implementation-side registry the router consults; it is distinct from the
 * vendor-neutral `ModelRegistry` contract in `./registry/model-registry`.
 */

import { MODEL_CATALOG } from './config.js';
import type { ModelConfig, ModelCapabilityFlags, ModelTier } from './config.js';

export interface ModelFilter {
  tier?: ModelTier;
  capabilities?: Partial<ModelCapabilityFlags>;
  minContextLength?: number;
  maxCostPer1kTokens?: number;
  requiredCapabilities?: Array<keyof ModelCapabilityFlags>;
  excludeModels?: string[];
}

export type SelectionStrategy = 'cheapest' | 'fastest' | 'best-quality' | 'balanced';

export interface ModelSelectionOptions {
  filter?: ModelFilter;
  strategy?: SelectionStrategy;
  maxCostPer1kTokens?: number;
  preferFree?: boolean;
}

export class ModelRegistry {
  private readonly catalog: Map<string, ModelConfig> = new Map();

  constructor(models: Record<string, ModelConfig> = MODEL_CATALOG) {
    for (const config of Object.values(models)) {
      this.catalog.set(config.id, config);
    }
  }

  register(model: ModelConfig): void {
    this.catalog.set(model.id, model);
  }

  unregister(modelId: string): boolean {
    return this.catalog.delete(modelId);
  }

  get(modelId: string): ModelConfig | undefined {
    return this.catalog.get(modelId);
  }

  getAll(): ModelConfig[] {
    return Array.from(this.catalog.values());
  }

  getByTier(tier: ModelTier): ModelConfig[] {
    return this.getAll().filter((m) => m.tier === tier);
  }

  getByCapability(capability: keyof ModelCapabilityFlags, value = true): ModelConfig[] {
    return this.getAll().filter((m) => m.capabilities[capability] === value);
  }

  filter(filter: ModelFilter): ModelConfig[] {
    return this.getAll().filter((model) => {
      if (filter.tier && model.tier !== filter.tier) {
        return false;
      }
      if (filter.maxCostPer1kTokens !== undefined && model.pricing.completion > filter.maxCostPer1kTokens) {
        return false;
      }
      if (filter.minContextLength !== undefined && model.contextLength < filter.minContextLength) {
        return false;
      }
      if (filter.requiredCapabilities) {
        for (const cap of filter.requiredCapabilities) {
          if (!model.capabilities[cap]) {
            return false;
          }
        }
      }
      if (filter.excludeModels?.includes(model.id)) {
        return false;
      }
      if (filter.capabilities) {
        for (const [cap, value] of Object.entries(filter.capabilities)) {
          if (model.capabilities[cap as keyof ModelCapabilityFlags] !== value) {
            return false;
          }
        }
      }
      return true;
    });
  }

  selectBest(options: ModelSelectionOptions = {}): ModelConfig | null {
    const { filter = {}, strategy = 'balanced', maxCostPer1kTokens, preferFree = false } = options;

    let candidates = this.filter(filter);

    if (preferFree) {
      const freeModels = candidates.filter((m) => m.tier === 'free');
      if (freeModels.length > 0) {
        candidates = freeModels;
      }
    }

    if (maxCostPer1kTokens !== undefined) {
      candidates = candidates.filter((m) => m.pricing.completion <= maxCostPer1kTokens);
    }

    if (candidates.length === 0) {
      return null;
    }

    switch (strategy) {
      case 'cheapest':
        return candidates.reduce((best, current) =>
          current.pricing.completion < best.pricing.completion ? current : best,
        );
      case 'fastest':
        return candidates.reduce((best, current) =>
          current.capabilities.streaming && !best.capabilities.streaming ? current : best,
        );
      case 'best-quality':
        return candidates.reduce((best, current) =>
          current.contextLength > best.contextLength ? current : best,
        );
      case 'balanced':
      default:
        return candidates.reduce((best, current) =>
          this.calculateScore(current) > this.calculateScore(best) ? current : best,
        );
    }
  }

  private calculateScore(model: ModelConfig): number {
    const qualityScore =
      Math.min(model.contextLength / 200000, 1) * 0.4 +
      (model.capabilities.vision ? 0.2 : 0) +
      (model.capabilities.functionCalling ? 0.2 : 0) +
      (model.capabilities.structuredOutput ? 0.1 : 0) +
      (model.capabilities.streaming ? 0.1 : 0);

    const costScore =
      model.pricing.completion === 0 ? 1 : Math.max(0, 1 - model.pricing.completion / 10);

    return qualityScore * 0.7 + costScore * 0.3;
  }

  getModelPricing(modelId: string): { prompt: number; completion: number } | null {
    const model = this.get(modelId);
    return model ? model.pricing : null;
  }

  estimateCost(modelId: string, promptTokens: number, completionTokens: number): number {
    const pricing = this.getModelPricing(modelId);
    if (!pricing) {
      return 0;
    }
    return (promptTokens / 1_000_000) * pricing.prompt + (completionTokens / 1_000_000) * pricing.completion;
  }
}

export const modelRegistry = new ModelRegistry();
