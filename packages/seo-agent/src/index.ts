/**
 * @ai-media-factory/seo-agent — public contract surface.
 */

export type {
  SEOAgentDependencies,
} from "./seo-agent.js";

export type {
  WriterArtifactHandoff,
  SEOSourceReference,
  SEOKeyword,
  SEOTopic,
  SEOSearchIntent,
  SEOContentStructureItem,
  SEOAgentInput,
  SEOStatus,
  SEOReport,
  SEOConfig,
  SEOExecutionInput,
  SEOExecutionOutput,
} from "./types.js";

export {
  SEOAgent,
  createSEOAgent,
  DEFAULT_SEO_SYSTEM_PROMPT,
} from "./seo-agent.js";