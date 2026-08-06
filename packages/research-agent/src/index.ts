/**
 * @ai-media-factory/research-agent — public contract surface.
 */

export type {
  ResearchAgentDependencies,
} from "./research-agent.js";

export type {
  ResearchAgentInput,
  ResearchSource,
  ResearchCitation,
  ResearchReport,
  ResearchConfig,
  ResearchExecutionInput,
  ResearchExecutionOutput,
} from "./research-types.js";

export {
  ResearchAgent,
  createResearchAgent,
  DEFAULT_RESEARCH_SYSTEM_PROMPT,
} from "./research-agent.js";
