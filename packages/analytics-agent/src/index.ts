/**
 * @ai-media-factory/analytics-agent — public contract surface.
 */

export type {
  AnalyticsDependencies,
  AnalyticsInput,
  AnalyticsSourceArtifact,
  PerformanceReport,
  AnalyticsStatus,
  AnalyticsConfig,
  AnalyticsExecutionInput,
  AnalyticsExecutionOutput,
} from "./types.js";

export {
  AnalyticsAgent,
  createAnalyticsAgent,
  DEFAULT_ANALYTICS_SYSTEM_PROMPT,
} from "./analytics-agent.js";