/**
 * @ai-media-factory/coding-agent – public contract surface.
 */

export type {
  CodingAgentInput,
  CodingAction,
  CodingActionType,
  CodingActionStatus,
  AffectedFile,
  TestRecommendation,
  CodingError,
  CodingResult,
  CodingAgentConfig,
  CodingConfig,
  CodingAgentDependencies,
} from "./coding-types.js";

export {
  CodingAgent,
  createCodingAgent,
  DEFAULT_CODING_SYSTEM_PROMPT,
} from "./coding-agent.js";
