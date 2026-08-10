/**
 * Coding Agent implementation.
 * Extends BaseAgent to produce structured coding results from coding tasks.
 */

import type { AgentId, Json, Uuid } from "@ai-media-factory/runtime";
import type {
  CancellationToken,
  ExecutionContext,
  ExecutionRequest,
  ExecutionResponse,
} from "@ai-media-factory/runtime";
import {
  BaseAgent,
  type AgentExecutionInput,
  type AgentExecutionOutput,
} from "@ai-media-factory/runtime";
import type {
  AffectedFile,
  CodingAction,
  CodingActionStatus,
  CodingActionType,
  CodingAgentDependencies,
  CodingAgentInput,
  CodingConfig,
  CodingError,
  CodingResult,
  TestRecommendation,
} from "./coding-types.js";

type JsonRecord = { [key: string]: Json };

/** Default coding system prompt. */
export const DEFAULT_CODING_SYSTEM_PROMPT = `You are an expert software engineering agent. Your job is to analyze coding tasks and produce a structured coding result.

There are no filesystem, shell, or code-editing tools available in this execution. Do not claim that files were created, modified, deleted, read, or commands were run. If the task requires unavailable tools, return status "blocked" and describe the missing capability in errors.

Your output must be valid JSON conforming to the CodingResult schema. Do not include explanatory text outside the JSON.`;

const codingActionTypes: CodingActionType[] = [
  "create_file",
  "modify_file",
  "delete_file",
  "read_file",
  "run_command",
  "analyze",
];

const codingActionStatuses: CodingActionStatus[] = [
  "planned",
  "executing",
  "completed",
  "failed",
  "blocked",
];

function isJsonRecord(value: Json): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCodingActionType(value: Json): value is CodingActionType {
  return typeof value === "string" && codingActionTypes.includes(value as CodingActionType);
}

function isCodingActionStatus(value: Json): value is CodingActionStatus {
  return typeof value === "string" && codingActionStatuses.includes(value as CodingActionStatus);
}

function isCodingAgentInput(value: Json): value is JsonRecord & CodingAgentInput {
  if (!isJsonRecord(value) || !isJsonRecord(value.task)) return false;

  const { task } = value;
  return (
    typeof task.id === "string" &&
    typeof task.name === "string" &&
    typeof task.description === "string" &&
    typeof task.agent === "string" &&
    isJsonRecord(task.inputSchema) &&
    isJsonRecord(task.outputSchema) &&
    Array.isArray(task.dependencies) &&
    task.dependencies.every((dependency) => typeof dependency === "string")
  );
}

export class CodingAgent extends BaseAgent {
  readonly id: AgentId = "coding";
  readonly name = "Coding Agent";
  readonly version = "1.0.0";

  private readonly codingConfig: CodingConfig;

  constructor(deps: CodingAgentDependencies) {
    super(deps);
    this.codingConfig = deps.config;
  }

  async execute(input: AgentExecutionInput, signal: CancellationToken): Promise<AgentExecutionOutput> {
    signal.throwIfCancelled();

    if (!isCodingAgentInput(input.input)) {
      throw new Error("Invalid coding input: expected a coding task");
    }

    const startedAt = Date.now();
    const { result, response: executionResponse } = await this.createResult(input.input, input.context, signal);
    const resultWithDuration: CodingResult = {
      ...result,
      metadata: {
        ...result.metadata,
        durationMs: Date.now() - startedAt,
      },
    };
    const output = this.toJson(resultWithDuration);
    const response: ExecutionResponse = {
      ...executionResponse,
      output,
      raw: JSON.stringify(resultWithDuration, null, 2),
    };

    return { output, response };
  }

  private async createResult(
    input: CodingAgentInput,
    context: ExecutionContext,
    signal: CancellationToken,
  ): Promise<{ result: CodingResult; response: ExecutionResponse }> {
    signal.throwIfCancelled();
    const prompt = this.buildCodingPrompt(input, context);
    const request = this.buildExecutionRequest(prompt);
    const response = await this.runExecution(context, request, signal);

    return {
      result: this.parseCodingResponse(response.output, input),
      response,
    };
  }

  private buildCodingPrompt(input: CodingAgentInput, context: ExecutionContext): string {
    const { task } = input;

    return `${this.codingConfig.systemPrompt}

Coding task:
- Id: ${task.id}
- Name: ${task.name}
- Description: ${task.description}
- Assigned agent: ${task.agent}
- Dependencies: ${task.dependencies.join(", ") || "none"}

Expected task input schema:
${JSON.stringify(task.inputSchema, null, 2)}

Expected task output schema:
${JSON.stringify(task.outputSchema, null, 2)}

Execution context:
${JSON.stringify(context, null, 2)}

Produce a valid CodingResult JSON with resultId, taskDescription, status, summary, actions, affectedFiles, errors, recommendedTests, confidence, and metadata. Mark the result blocked when completing the task requires unavailable filesystem, shell, or code-editing tools.`;
  }

  private buildExecutionRequest(prompt: string): ExecutionRequest {
    return {
      model: this.codingConfig.model,
      system: this.codingConfig.systemPrompt,
      messages: [
        { role: "system", content: this.codingConfig.systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: this.codingConfig.temperature,
      maxOutputTokens: this.codingConfig.maxOutputTokens,
      responseSchema: this.getCodingResponseSchema(),
    };
  }

  private getCodingResponseSchema(): import("@ai-media-factory/runtime").JsonSchema {
    return {
      type: "object",
      properties: {
        resultId: { type: "string", format: "uuid" },
        taskDescription: { type: "string" },
        status: { type: "string", enum: ["completed", "partially_completed", "failed", "blocked"] },
        summary: { type: "string" },
        actions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              type: { type: "string", enum: ["create_file", "modify_file", "delete_file", "read_file", "run_command", "analyze"] },
              description: { type: "string" },
              filePath: { type: "string" },
              content: { type: "string" },
              command: { type: "string" },
              workingDirectory: { type: "string" },
              status: { type: "string", enum: ["planned", "executing", "completed", "failed", "blocked"] },
              error: { type: "string" },
              output: { type: "string" },
            },
            required: ["id", "type", "description", "status"],
          },
        },
        affectedFiles: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              changeType: { type: "string", enum: ["created", "modified", "deleted", "read"] },
              description: { type: "string" },
            },
            required: ["path", "changeType", "description"],
          },
        },
        errors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              recoverable: { type: "boolean" },
              actionId: { type: "string" },
              details: { type: "object" },
            },
            required: ["code", "message", "recoverable"],
          },
        },
        recommendedTests: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["unit", "integration", "e2e", "manual"] },
              description: { type: "string" },
              priority: { type: "string", enum: ["high", "medium", "low"] },
              suggestedPath: { type: "string" },
            },
            required: ["type", "description", "priority"],
          },
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        metadata: {
          type: "object",
          properties: {
            createdAt: { type: "string" },
            agentVersion: { type: "string" },
            durationMs: { type: "number" },
          },
          required: ["createdAt", "agentVersion"],
        },
      },
      required: ["resultId", "taskDescription", "status", "summary", "actions", "affectedFiles", "errors", "recommendedTests", "confidence", "metadata"],
    };
  }

  private parseCodingResponse(output: Json, input: CodingAgentInput): CodingResult {
    if (!isJsonRecord(output)) {
      throw new Error("Invalid coding response: missing required fields");
    }

    const resultId = output.resultId;
    const taskDescription = output.taskDescription;
    const status = output.status;
    const summary = output.summary;
    const confidence = output.confidence;
    const metadata = output.metadata;

    if (
      typeof resultId !== "string" ||
      typeof taskDescription !== "string" ||
      typeof status !== "string" ||
      !["completed", "partially_completed", "failed", "blocked"].includes(status) ||
      typeof summary !== "string" ||
      typeof confidence !== "number" ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 1 ||
      !isJsonRecord(metadata) ||
      typeof metadata.createdAt !== "string" ||
      typeof metadata.agentVersion !== "string" ||
      !Array.isArray(output.actions) ||
      !Array.isArray(output.affectedFiles) ||
      !Array.isArray(output.errors) ||
      !Array.isArray(output.recommendedTests)
    ) {
      throw new Error("Invalid coding response: invalid result structure");
    }

    if (taskDescription !== input.task.description) {
      throw new Error("Invalid coding response: task description does not match the requested task");
    }

    const durationMs = metadata.durationMs === undefined
      ? 0
      : typeof metadata.durationMs === "number" && Number.isFinite(metadata.durationMs)
        ? metadata.durationMs
        : -1;
    if (durationMs < 0) {
      throw new Error("Invalid coding response: invalid duration metadata");
    }

    const result: CodingResult = {
      resultId: resultId as Uuid,
      taskDescription,
      status: status as CodingResult["status"],
      summary,
      actions: output.actions.map((action) => this.parseAction(action)),
      affectedFiles: output.affectedFiles.map((file) => this.parseAffectedFile(file)),
      errors: output.errors.map((error) => this.parseCodingError(error)),
      recommendedTests: output.recommendedTests.map((test) => this.parseTestRecommendation(test)),
      confidence,
      metadata: {
        createdAt: metadata.createdAt,
        agentVersion: metadata.agentVersion,
        durationMs,
      },
    };

    return this.normalizeCapabilityClaims(result);
  }

  private normalizeCapabilityClaims(result: CodingResult): CodingResult {
    if (result.status === "blocked") return result;

    const executionClaim = /\b(implemented|created|modified|deleted|executed|ran|applied|completed|passed tests|tested)\b/i;
    const claimsExecution = result.status === "completed" || result.status === "partially_completed";
    const claimsToolWork = result.actions.some((action) => action.type !== "analyze" && action.status !== "planned") || result.affectedFiles.length > 0 || executionClaim.test(result.summary) || result.actions.some((action) => executionClaim.test(`${action.description} ${action.output ?? ""}`));

    if (!claimsExecution || !claimsToolWork) return result;

    return {
      ...result,
      status: "blocked",
      summary: `Blocked: no filesystem, code-editing, or execution tools are available. ${result.summary}`,
      actions: result.actions.map((action) => action.status === "completed" || action.status === "executing" ? { ...action, status: "blocked", error: "No concrete coding tool execution evidence is available." } : action),
      errors: [
        ...result.errors,
        { code: "TOOLS_UNAVAILABLE", message: "Coding actions were reported without concrete tool execution evidence.", recoverable: true },
      ],
    };
  }

  private parseAction(value: Json): CodingAction {
    if (!isJsonRecord(value) || typeof value.id !== "string" || !isCodingActionType(value.type) || typeof value.description !== "string" || !isCodingActionStatus(value.status)) {
      throw new Error("Invalid coding response: invalid action structure");
    }

    return {
      id: value.id,
      type: value.type,
      description: value.description,
      ...(typeof value.filePath === "string" ? { filePath: value.filePath } : {}),
      ...(typeof value.content === "string" ? { content: value.content } : {}),
      ...(typeof value.command === "string" ? { command: value.command } : {}),
      ...(typeof value.workingDirectory === "string" ? { workingDirectory: value.workingDirectory } : {}),
      status: value.status,
      ...(typeof value.error === "string" ? { error: value.error } : {}),
      ...(typeof value.output === "string" ? { output: value.output } : {}),
    };
  }

  private parseAffectedFile(value: Json): AffectedFile {
    if (!isJsonRecord(value) || typeof value.path !== "string" || typeof value.changeType !== "string" || !["created", "modified", "deleted", "read"].includes(value.changeType) || typeof value.description !== "string") {
      throw new Error("Invalid coding response: invalid affected file structure");
    }
    return {
      path: value.path,
      changeType: value.changeType as AffectedFile["changeType"],
      description: value.description,
    };
  }

  private parseCodingError(value: Json): CodingError {
    if (!isJsonRecord(value) || typeof value.code !== "string" || typeof value.message !== "string" || typeof value.recoverable !== "boolean") {
      throw new Error("Invalid coding response: invalid error structure");
    }
    return {
      code: value.code,
      message: value.message,
      recoverable: value.recoverable,
      ...(typeof value.actionId === "string" ? { actionId: value.actionId } : {}),
      ...(value.details === undefined ? {} : { details: value.details }),
    };
  }

  private parseTestRecommendation(value: Json): TestRecommendation {
    if (!isJsonRecord(value) || typeof value.type !== "string" || !["unit", "integration", "e2e", "manual"].includes(value.type) || typeof value.description !== "string" || typeof value.priority !== "string" || !["high", "medium", "low"].includes(value.priority)) {
      throw new Error("Invalid coding response: invalid test recommendation structure");
    }
    return {
      type: value.type as TestRecommendation["type"],
      description: value.description,
      priority: value.priority as TestRecommendation["priority"],
      ...(typeof value.suggestedPath === "string" ? { suggestedPath: value.suggestedPath } : {}),
    };
  }

  private toJson(result: CodingResult): Json {
    return {
      resultId: result.resultId,
      taskDescription: result.taskDescription,
      status: result.status,
      summary: result.summary,
      actions: result.actions.map((action) => ({ ...action })),
      affectedFiles: result.affectedFiles.map((file) => ({ ...file })),
      errors: result.errors.map((error) => ({ ...error })),
      recommendedTests: result.recommendedTests.map((test) => ({ ...test })),
      confidence: result.confidence,
      metadata: { ...result.metadata },
    };
  }
}

/** Factory function to create a CodingAgent. */
export function createCodingAgent(deps: CodingAgentDependencies): CodingAgent {
  const defaultConfig: CodingConfig = {
    ...deps.config,
    model: deps.config.model ?? "openrouter/auto",
    temperature: deps.config.temperature ?? 0.2,
    maxOutputTokens: deps.config.maxOutputTokens ?? 4096,
    systemPrompt: deps.config.systemPrompt ?? DEFAULT_CODING_SYSTEM_PROMPT,
    includeReasoning: deps.config.includeReasoning ?? false,
  };

  return new CodingAgent({ ...deps, config: defaultConfig });
}
