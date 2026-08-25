export {
  TTSAgent,
  createTTSAgent,
  DEFAULT_TTS_SYSTEM_PROMPT,
} from "./tts-agent.js";
export {
  isTTSAgentInput,
  toCapabilityRequest,
} from "./tts-types.js";
export type {
  TTSReport,
  TTSReportStatus,
  TTSConfig,
  TTSAgentDependencies,
  TTSAgentInput,
  TTSExecutionInput,
  TTSExecutionOutput,
} from "./tts-types.js";
export { BENCHMARK_SCRIPTS } from "./scripts.js";
export type { BenchmarkScriptKey } from "./scripts.js";
