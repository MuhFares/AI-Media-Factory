/**
 * Coding Agent types.
 */

import type { BaseAgentDependencies } from "@ai-media-factory/runtime";
import type { Json, Uuid } from "@ai-media-factory/runtime";
import type { PlanTask } from "@ai-media-factory/planner-agent";

/** Input to the coding agent: a coding task from the planner. */
export interface CodingAgentInput {
  /** The task to implement. */
  task: PlanTask;
}

/** The type of coding action. */
export type CodingActionType =
  | "create_file"
  | "modify_file"
  | "delete_file"
  | "read_file"
  | "run_command"
  | "analyze";

/** Status of a coding action. */
export type CodingActionStatus =
  | "planned"
  | "executing"
  | "completed"
  | "failed"
  | "blocked";

/** A single coding action to be performed. */
export interface CodingAction {
  /** Unique identifier for the action. */
  id: string;
  /** Type of the action. */
  type: CodingActionType;
  /** Human-readable description of the action. */
  description: string;
  /** Target file path (for file operations). */
  filePath?: string;
  /** Content to write (for create/modify file). */
  content?: string;
  /** Command to execute (for run_command). */
  command?: string;
  /** Working directory for command. */
  workingDirectory?: string;
  /** Current status of the action. */
  status: CodingActionStatus;
  /** Error message if the action failed. */
  error?: string;
  /** Result output from the action. */
  output?: string;
}

/** A file affected by the coding task. */
export interface AffectedFile {
  /** File path relative to project root. */
  path: string;
  /** Type of change. */
  changeType: "created" | "modified" | "deleted" | "read";
  /** Brief description of the change. */
  description: string;
}

/** A test recommendation for the coding task. */
export interface TestRecommendation {
  /** Type of test. */
  type: "unit" | "integration" | "e2e" | "manual";
  /** Description of what to test. */
  description: string;
  /** Priority of the test. */
  priority: "high" | "medium" | "low";
  /** Suggested test file path. */
  suggestedPath?: string;
}

/** Error information for a coding task. */
export interface CodingError {
  /** Error code. */
  code: string;
  /** Human-readable error message. */
  message: string;
  /** Whether the error is recoverable. */
  recoverable: boolean;
  /** Related action ID if applicable. */
  actionId?: string;
  /** Additional details. */
  details?: Json;
}

/** The complete coding result output by the coding agent. */
export interface CodingResult {
  /** Unique result identifier. */
  resultId: Uuid;
  /** The original coding task description. */
  taskDescription: string;
  /** Overall status of the coding task. */
  status: "completed" | "partially_completed" | "failed" | "blocked";
  /** Summary of what was done. */
  summary: string;
  /** List of coding actions performed. */
  actions: CodingAction[];
  /** Files affected by the coding task. */
  affectedFiles: AffectedFile[];
  /** Errors encountered during execution. */
  errors: CodingError[];
  /** Recommended tests to run. */
  recommendedTests: TestRecommendation[];
  /** Confidence score in the result (0-1). */
  confidence: number;
  /** Metadata about the result. */
  metadata: {
    /** When the result was created. */
    createdAt: string;
    /** Coding agent version. */
    agentVersion: string;
    /** Total duration in milliseconds. */
    durationMs: number;
  };
}

/** Coding agent configuration. */
export interface CodingAgentConfig {
  /** Model to use for coding. */
  model: string;
  /** Temperature for coding output. */
  temperature: number;
  /** Maximum tokens for coding output. */
  maxOutputTokens: number;
  /** System prompt for the coding agent. */
  systemPrompt: string;
  /** Whether the model may include reasoning in its output. */
  includeReasoning?: boolean;
}

/** Backward-compatible alias for the coding agent configuration. */
export type CodingConfig = CodingAgentConfig;

/** Coding agent dependencies. */
export interface CodingAgentDependencies extends BaseAgentDependencies {
  config: CodingConfig;
}
