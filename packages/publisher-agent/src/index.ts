/**
 * @ai-media-factory/publisher-agent — public contract surface.
 */

export type {
  PublisherDependencies,
  PublisherInput,
  PublisherSourceArtifact,
  PublishedReport,
  PublishStatus,
  PublisherConfig,
  PublisherExecutionInput,
  PublisherExecutionOutput,
} from "./types.js";

export {
  PublisherAgent,
  createPublisherAgent,
  DEFAULT_PUBLISHER_SYSTEM_PROMPT,
} from "./publisher-agent.js";