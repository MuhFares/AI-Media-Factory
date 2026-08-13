/**
 * @ai-media-factory/growth-agent — public contract surface.
 */

export type {
  GrowthDependencies,
  GrowthInput,
  GrowthSourceArtifact,
  GrowthReport,
  GrowthStatus,
  GrowthConfig,
  GrowthThresholds,
  WinningPattern,
  LosingPattern,
  GrowthRecommendationEntry,
  GrowthExperiment,
  GrowthPriority,
  RecommendationPriority,
  GrowthExecutionInput,
  GrowthExecutionOutput,
} from "./types.js";

export {
  GrowthAgent,
  createGrowthAgent,
  DEFAULT_GROWTH_SYSTEM_PROMPT,
} from "./growth-agent.js";