/**
 * @ai-media-factory/thumbnail-agent — public contract surface.
 */

export type {
  ThumbnailAgentDependencies,
  ThumbnailAgentInput,
  ThumbnailSourceArtifact,
  ThumbnailReport,
  ThumbnailReportStatus,
  ThumbnailConfig,
  ThumbnailExecutionInput,
  ThumbnailExecutionOutput,
} from "./thumbnail-types.js";

export {
  ThumbnailAgent,
  createThumbnailAgent,
  DEFAULT_THUMBNAIL_SYSTEM_PROMPT,
} from "./thumbnail-agent.js";