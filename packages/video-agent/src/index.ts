/**
 * @ai-media-factory/video-agent — public contract surface.
 */

export type {
  VideoAgentDependencies,
  VideoAgentInput,
  VideoSourceArtifact,
  VideoReport,
  VideoReportStatus,
  VideoConfig,
  VideoExecutionInput,
  VideoExecutionOutput,
} from "./video-types.js";

export {
  VideoAgent,
  createVideoAgent,
  DEFAULT_VIDEO_SYSTEM_PROMPT,
} from "./video-agent.js";