/**
 * Concrete model router — cost/quality/speed-aware model selection over the
 * catalog `ModelRegistry`, with a fallback chain.
 *
 * This is the implementation-side selection helper used by the OpenRouter
 * transport. It does not replace the vendor-neutral `Router` contract in
 * `./routing/router`; it operates purely over concrete `ModelConfig` entries.
 */

import type { ModelConfig, ModelCapabilityFlags } from './config.js';
import { modelRegistry } from './models.js';

export type RoutingStrategy = 'cost' | 'speed' | 'quality' | 'balanced';

export interface RoutingOptions {
  complexity?: 'low' | 'medium' | 'high';
  requiredCapabilities?: Partial<ModelCapabilityFlags>;
  maxCostPer1kTokens?: number;
  preferFree?: boolean;
  preferredModel?: string;
  strategy?: RoutingStrategy;
}

export interface RoutingCandidate {
  model: ModelConfig;
  provider: 'openrouter';
}

export interface RoutingResult {
  primary: RoutingCandidate;
  fallbacks: RoutingCandidate[];
  reasoning: string;
}

interface ScoreOptions {
  strategy: RoutingStrategy;
}

export class ModelRouter {
  private readonly strategy: RoutingStrategy;

  constructor(strategy: RoutingStrategy = 'balanced') {
    this.strategy = strategy;
  }

  route(options: RoutingOptions = {}): RoutingResult {
    const {
      complexity = 'medium',
      requiredCapabilities,
      maxCostPer1kTokens,
      preferFree = false,
      preferredModel,
      strategy = this.strategy,
    } = options;

    // Explicit preferred model short-circuits routing.
    if (preferredModel) {
      const preferred = modelRegistry.get(preferredModel);
      if (preferred) {
        return {
          primary: { model: preferred, provider: 'openrouter' },
          fallbacks: [],
          reasoning: `Using preferred model: ${preferred.name}`,
        };
      }
    }

    let candidates: ModelConfig[] = modelRegistry.filter({
      capabilities: requiredCapabilities,
      maxCostPer1kTokens,
    });

    if (preferFree) {
      const freeModels = candidates.filter((m) => m.tier === 'free');
      if (freeModels.length > 0) {
        candidates = freeModels;
      }
    }

    if (complexity === 'high') {
      candidates = candidates.filter((m) => m.tier === 'standard' || m.tier === 'premium');
    } else if (complexity === 'low') {
      candidates = candidates.filter((m) => m.tier === 'free' || m.tier === 'cheap');
    }

    if (candidates.length === 0) {
      throw new Error('No suitable models found for the given routing criteria');
    }

    const scored = candidates
      .map((model: ModelConfig) => ({
        model,
        score: this.calculateScore(model, { strategy }),
      }))
      .sort((a, b) => b.score - a.score);

    const primary = scored[0]!;
    const fallbacks: RoutingCandidate[] = scored
      .slice(1, 3)
      .map((entry) => ({ model: entry.model, provider: 'openrouter' as const }));

    return {
      primary: { model: primary.model, provider: 'openrouter' },
      fallbacks,
      reasoning: `Selected ${primary.model.name} (${primary.model.tier}) using ${strategy} strategy`,
    };
  }

  private calculateScore(model: ModelConfig, options: ScoreOptions): number {
    const qualityScore =
      Math.min(model.contextLength / 200000, 1) * 0.4 +
      (model.capabilities.vision ? 0.15 : 0) +
      (model.capabilities.functionCalling ? 0.15 : 0) +
      (model.capabilities.structuredOutput ? 0.15 : 0) +
      (model.capabilities.streaming ? 0.1 : 0);

    const costScore =
      model.pricing.completion === 0 ? 1 : Math.max(0, 1 - model.pricing.completion / 20);

    const speedScore =
      model.tier === 'free' ? 0.9 : model.tier === 'cheap' ? 0.8 : model.tier === 'standard' ? 0.6 : 0.4;

    switch (options.strategy) {
      case 'cost':
        return costScore * 0.7 + qualityScore * 0.3;
      case 'speed':
        return speedScore * 0.7 + qualityScore * 0.3;
      case 'quality':
        return qualityScore * 0.8 + costScore * 0.2;
      case 'balanced':
      default:
        return qualityScore * 0.4 + costScore * 0.3 + speedScore * 0.3;
    }
  }

  getModelInfo(modelId: string): ModelConfig | null {
    return modelRegistry.get(modelId) ?? null;
  }

  getAvailableModels(): ModelConfig[] {
    return modelRegistry.getAll();
  }

  getFreeModels(): ModelConfig[] {
    return modelRegistry.getByTier('free');
  }

  getModelsByCapability(capability: keyof ModelCapabilityFlags): ModelConfig[] {
    return modelRegistry.getByCapability(capability, true);
  }
}

export const modelRouter = new ModelRouter();
