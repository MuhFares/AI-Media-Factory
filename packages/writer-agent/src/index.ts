/**
 * @ai-media-factory/writer-agent — public contract surface.
 */

export type {
  WriterAgentDependencies,
} from "./writer-agent.js";

export type {
  ResearchArtifactHandoff,
  WriterAgentInput,
  WriterSourceReference,
  WriterStatus,
  WriterReport,
  WriterConfig,
  WriterExecutionInput,
  WriterExecutionOutput,
} from "./types.js";

export {
  WriterAgent,
  createWriterAgent,
  DEFAULT_WRITER_SYSTEM_PROMPT,
} from "./writer-agent.js";