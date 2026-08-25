/**
 * TTS Agent implementation.
 * Deterministic agent: validates the narration input and requests the
 * `tts.generate` capability through the injected capability execution
 * boundary. It does not call a provider directly, never sees credentials,
 * and never claims audio without matching runtime evidence.
 */

import type { AgentId, Json } from "@ai-media-factory/runtime";
import type { CancellationToken, CapabilityResult, ExecutionResponse } from "@ai-media-factory/runtime";
import { BaseAgent, type AgentExecutionInput, type AgentExecutionOutput } from "@ai-media-factory/runtime";
import { TTS_GENERATION_CAPABILITY_ID } from "@ai-media-factory/tool-framework";
import type {
  TTSConfig,
  TTSReport,
  TTSReportStatus,
  TTSAgentDependencies,
  TTSAgentInput,
} from "./tts-types.js";
import { isTTSAgentInput, toCapabilityRequest } from "./tts-types.js";

const DEFAULT_TTS_SYSTEM_PROMPT = `You are a narration audio agent. Validate the narration request and request the tts.generate capability through the runtime boundary. Never claim audio was generated unless a matching runtime evidence item confirms success.`;
export { DEFAULT_TTS_SYSTEM_PROMPT };

type JsonRecord = { [key: string]: Json };

function isRecord(value: Json): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export class TTSAgent extends BaseAgent {
  readonly id: AgentId = "tts";
  readonly name = "TTS Agent";
  readonly version = "1.0.0";

  private readonly ttsConfig: TTSConfig;

  constructor(deps: TTSAgentDependencies) {
    super(deps);
    this.ttsConfig = deps.config;
  }

  async execute(input: AgentExecutionInput, signal: CancellationToken): Promise<AgentExecutionOutput> {
    signal.throwIfCancelled();
    if (!isTTSAgentInput(input.input)) {
      throw new Error("Invalid TTS input: expected narration text (requestId, objective, text)");
    }
    const text = input.input.text.trim();
    if (text.length === 0) {
      return this.blockedOutput(input.input, "Blocked: narration text must not be empty.");
    }
    if (text.length > this.ttsConfig.maxTextLength) {
      return this.blockedOutput(input.input, `Blocked: narration text exceeds ${this.ttsConfig.maxTextLength} characters.`);
    }

    const request = toCapabilityRequest(
      input.input,
      this.id,
      typeof input.input.workflowId === "string" ? input.input.workflowId : `workflow-${input.input.requestId}`,
      typeof input.input.correlationId === "string" ? input.input.correlationId : "",
    );
    const executions = await this.runCapabilities([request]);
    const execution = executions[0];
    return this.buildOutput(input.input, execution);
  }

  /** Deterministically produce the tts_report from the capability execution. */
  private buildOutput(
    input: TTSAgentInput & { taskDescription?: string },
    execution: CapabilityResult | undefined,
  ): { output: Json; response: ExecutionResponse } {
    const taskDescription = input.taskDescription ?? "Synthesize narration audio for the provided text";
    const language = typeof input.language === "string" ? input.language : this.ttsConfig.defaultLanguage;
    const voice = typeof input.voice === "string" ? input.voice : "";

    const executionRecord: JsonRecord | undefined =
      execution === undefined ? undefined : (JSON.parse(JSON.stringify(execution)) as JsonRecord);
    if (executionRecord === undefined || executionRecord.status !== "success") {
      const report = this.report(input, taskDescription, language, voice, "blocked", this.failureReason(executionRecord), {
        audioId: "",
        audioUrl: "",
        format: "",
        providerId: "",
        durationSeconds: 0,
      });
      return this.wrap(report, executionRecord);
    }

    const evidence = isRecord(executionRecord.evidence) ? executionRecord.evidence : {};
    const output = isRecord(executionRecord.output) ? executionRecord.output : {};
    const isGrantedCompletion =
      evidence.capabilityId === TTS_GENERATION_CAPABILITY_ID &&
      evidence.agentId === this.id &&
      evidence.succeeded === true;

    const audioId = typeof output.audioId === "string" ? output.audioId : "";
    const audioUrl = typeof output.url === "string" ? output.url : "";
    const format = typeof output.format === "string" ? output.format : "wav";
    const providerId = typeof output.providerId === "string" ? output.providerId : "";
    const durationSeconds = typeof output.durationSeconds === "number" && Number.isFinite(output.durationSeconds)
      ? output.durationSeconds
      : 0;

    if (!isGrantedCompletion || audioId === "" || audioUrl === "") {
      const report = this.report(input, taskDescription, language, voice, "blocked",
        "Blocked: the tts.generate execution did not return matching completion evidence.",
        { audioId: "", audioUrl: "", format, providerId, durationSeconds });
      return this.wrap(report, executionRecord);
    }

    const report = this.report(input, taskDescription, language, voice, "completed",
      "Narration audio generated through the tts.generate capability with matching completion evidence.",
      { audioId, audioUrl, format, providerId, durationSeconds });
    return this.wrap(report, executionRecord);
  }

  private report(
    input: TTSAgentInput,
    taskDescription: string,
    language: string,
    voice: string,
    status: TTSReportStatus,
    summary: string,
    fields: { audioId: string; audioUrl: string; format: string; providerId: string; durationSeconds: number },
  ): TTSReport {
    return {
      reportId: input.requestId,
      taskDescription,
      objective: input.objective,
      status,
      summary,
      text: input.text,
      language,
      voice,
      audioId: fields.audioId,
      audioUrl: fields.audioUrl,
      format: fields.format,
      durationSeconds: fields.durationSeconds,
      providerId: fields.providerId,
      executionEvidencePresent: status === "completed",
      metadata: {
        createdAt: new Date().toISOString(),
        agentVersion: this.version,
        providerId: fields.providerId,
      },
    };
  }

  private failureReason(execution: JsonRecord | undefined): string {
    if (execution === undefined) return "tts.generate was not executed or capability execution is not configured.";
    if (execution.status === "blocked") {
      return `tts.generate was blocked: ${typeof execution.reason === "string" ? execution.reason : "unknown"}`;
    }
    if (execution.status === "failed") {
      const error = isRecord(execution.error) ? execution.error : {};
      return `tts.generate failed: ${typeof error.message === "string" ? error.message : "unknown"}`;
    }
    return "tts.generate did not succeed.";
  }

  private blockedOutput(input: TTSAgentInput, summary: string): AgentExecutionOutput {
    const language = typeof input.language === "string" ? input.language : this.ttsConfig.defaultLanguage;
    const voice = typeof input.voice === "string" ? input.voice : "";
    const report = this.report(input, input.taskDescription ?? "Synthesize narration audio for the provided text",
      language, voice, "blocked", summary, { audioId: "", audioUrl: "", format: "", providerId: "", durationSeconds: 0 });
    return {
      output: this.toJson(report),
      response: {
        output: this.toJson(report),
        raw: JSON.stringify(report, null, 2),
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        model: this.ttsConfig.model,
        provider: "tts-deterministic",
        latencyMs: 0,
      },
    };
  }

  private wrap(report: TTSReport, execution: JsonRecord | undefined): { output: Json; response: ExecutionResponse } {
    const base = this.toJson(report) as unknown as JsonRecord;
    const withExecutions: Json = execution !== undefined
      ? { ...base, capabilityExecutions: [execution] as unknown as Json }
      : (base as unknown as Json);
    return {
      output: withExecutions,
      response: {
        output: withExecutions,
        raw: JSON.stringify(report, null, 2),
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        model: this.ttsConfig.model,
        provider: "tts-deterministic",
        latencyMs: 0,
      },
    };
  }

  private toJson(report: TTSReport): Json {
    return {
      reportId: report.reportId,
      taskDescription: report.taskDescription,
      objective: report.objective,
      status: report.status,
      summary: report.summary,
      text: report.text,
      language: report.language,
      voice: report.voice,
      audioId: report.audioId,
      audioUrl: report.audioUrl,
      format: report.format,
      durationSeconds: report.durationSeconds,
      providerId: report.providerId,
      executionEvidencePresent: report.executionEvidencePresent,
      metadata: { ...report.metadata },
    };
  }
}

/** Factory function to create a TTSAgent. */
export function createTTSAgent(deps: TTSAgentDependencies): TTSAgent {
  const config: TTSConfig = {
    ...deps.config,
    model: deps.config?.model ?? "deterministic",
    maxTextLength: deps.config?.maxTextLength ?? 2000,
    defaultLanguage: deps.config?.defaultLanguage ?? "ar",
    systemPrompt: deps.config?.systemPrompt ?? DEFAULT_TTS_SYSTEM_PROMPT,
  };
  return new TTSAgent({ ...deps, config });
}
