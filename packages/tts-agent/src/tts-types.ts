/**
 * TTS Agent types.
 */

import type { BaseAgentDependencies, ExecutionContext, ExecutionResponse, Json, Uuid } from "@ai-media-factory/runtime";
import type { CapabilityRequest, CapabilityResult } from "@ai-media-factory/runtime";

export type TTSReportStatus = "completed" | "blocked" | "failed";

export interface TTSAgentInput {
  requestId: Uuid;
  objective: string;
  /** Narration text to synthesize. Required, non-empty. */
  text: string;
  /** Optional language hint, e.g. "ar" | "en". */
  language?: string;
  /** Optional provider voice id. */
  voice?: string;
  /** Optional output format ("wav" | "mp3"). */
  format?: "wav" | "mp3";
  /** Optional task description carried into the report. */
  taskDescription?: string;
  /** Workflow id for capability evidence (wiring site responsibility). */
  workflowId?: string;
  /** Correlation id for capability evidence. */
  correlationId?: string;
}

export interface TTSReport {
  reportId: Uuid;
  taskDescription: string;
  objective: string;
  status: TTSReportStatus;
  summary: string;
  /** The narration text that was synthesized. */
  text: string;
  language: string;
  voice: string;
  audioId: string;
  /** data:audio/...;base64 reference to the provider-confirmed audio. */
  audioUrl: string;
  format: string;
  durationSeconds: number;
  providerId: string;
  executionEvidencePresent: boolean;
  metadata: {
    createdAt: string;
    agentVersion: string;
    providerId: string;
  };
}

export interface TTSConfig {
  /** Model, retained for interface parity; the TTS Agent is deterministic. */
  model: string;
  /** Maximum narration text length accepted by the agent. */
  maxTextLength: number;
  /** Default language when the input does not specify one. */
  defaultLanguage: string;
  systemPrompt: string;
}

export interface TTSAgentDependencies extends BaseAgentDependencies {
  config: TTSConfig;
}

export interface TTSExecutionInput {
  context: ExecutionContext;
  input: TTSAgentInput;
}

export interface TTSExecutionOutput {
  output: TTSReport & { capabilityExecutions?: readonly CapabilityResult[] };
  response: ExecutionResponse;
}

/** Narrow an arbitrary Json value into TTSAgentInput shape. */
export function isTTSAgentInput(value: Json): value is Json & TTSAgentInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.requestId === "string" &&
    typeof record.objective === "string" &&
    typeof record.text === "string"
  );
}

export function toCapabilityRequest(
  input: TTSAgentInput,
  agentId: string,
  workflowId: string,
  correlationId: string,
): CapabilityRequest {
  return {
    requestId: `tts-${input.requestId}`,
    capabilityId: "tts.generate",
    operation: "generate",
    agentId,
    workflowId: workflowId.length > 0 ? workflowId : `workflow-${input.requestId}`,
    correlationId: correlationId.length > 0 ? correlationId : `correlation-${input.requestId}`,
    input: {
      text: input.text,
      ...(input.language === undefined ? {} : { language: input.language }),
      ...(input.voice === undefined ? {} : { voice: input.voice }),
      ...(input.format === undefined ? {} : { format: input.format }),
    },
    requestedAt: new Date().toISOString(),
  };
}
