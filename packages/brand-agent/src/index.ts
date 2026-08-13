/**
 * @ai-media-factory/brand-agent — public contract surface.
 */

export type {
  BrandAgentDependencies,
} from "./brand-agent.js";

export type {
  SEOArtifactHandoff,
  BrandCheck,
  BrandAgentInput,
  BrandStatus,
  BrandRecommendation,
  BrandReviewReport,
  BrandConfig,
  BrandExecutionInput,
  BrandExecutionOutput,
} from "./types.js";

export {
  BrandAgent,
  createBrandAgent,
  DEFAULT_BRAND_SYSTEM_PROMPT,
} from "./brand-agent.js";