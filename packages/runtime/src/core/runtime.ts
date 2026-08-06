import type { AgentRuntime, RuntimeInput, RuntimeResult, TurnStatus } from "../interfaces/runtime.js";
import type { AgentId, Uuid } from "../interfaces/common.js";
import type { ExecutionContext } from "../interfaces/context.js";
import type { RuntimeEvent } from "../interfaces/events.js";
import type { RuntimeError } from "../interfaces/errors.js";
import type { ContextBuilder } from "../interfaces/context.js";
import type { ConfigLoader, PromptLoader, SchemaLoader, MemoryLoader } from "../interfaces/loaders.js";
import type { MemoryEngine } from "../types/memory-engine.js";
import type { PromptCompiler } from "../types/prompt-compiler.js";
import type { Router } from "@ai-media-factory/providers";
import type { ExecutionRequest, ExecutionResponse, LlmExecutor, PromptAssembler } from "../interfaces/execution.js";
import type { CancellationToken } from "../interfaces/resilience.js";
import { DefaultRuntimeProviderBinding } from "../providers/binding.js";
import { DefaultLlmExecutor, DefaultPromptAssembler } from "./executor.js";
import { v4 as uuidv4 } from "uuid";

interface AgentRuntimeDependencies {
  configLoader: ConfigLoader;
  promptLoader: PromptLoader;
  schemaLoader: SchemaLoader;
  memoryLoader: MemoryLoader;
  memoryEngine: MemoryEngine;
  promptCompiler: PromptCompiler;
  router: Router;
}

export class DefaultAgentRuntime implements AgentRuntime {
  private readonly deps: AgentRuntimeDependencies;
  private readonly llmExecutor: LlmExecutor;
  private readonly promptAssembler: PromptAssembler;
  private readonly contextBuilder: ContextBuilder;

  constructor(deps: AgentRuntimeDependencies) {
    this.deps = deps;

    const binding = new DefaultRuntimeProviderBinding(deps.router);
    this.llmExecutor = new DefaultLlmExecutor(binding, deps.promptCompiler);
    this.promptAssembler = new DefaultPromptAssembler(deps.promptCompiler);

    this.contextBuilder = {
      build: async (input) => {
        const memory = await deps.memoryLoader.loadForTurn(input.config.agent.id, input.inputEvent.payload);
        return {
          turnId: uuidv4(),
          config: input.config,
          prompts: input.prompts,
          schemas: input.schemas,
          memory,
          inputEvent: input.inputEvent,
          budgetCeilingUsd: Number(input.config.budgets.max_cost_usd ?? 1.0),
          deadline: new Date(Date.now() + (input.config.escalation.timeout_seconds ?? 60) * 1000),
        } as ExecutionContext;
      },
    };
  }

  async execute(
    _context: ExecutionContext,
    request: ExecutionRequest,
    signal: CancellationToken
  ): Promise<ExecutionResponse> {
    return this.llmExecutor.execute(request, signal);
  }

  async run(input: RuntimeInput): Promise<RuntimeResult> {
    const turnId = uuidv4();
    const startTime = Date.now();

    try {
      const config = await this.deps.configLoader.load(input.agent);
      const prompts = await this.deps.promptLoader.load(input.agent);
      const schemas = await this.deps.schemaLoader.load(input.agent);

      const context = await this.contextBuilder.build({
        config,
        prompts,
        schemas,
        memory: {} as any,
        inputEvent: input.event,
      });

      const request = this.llmExecutor.buildRequest(context);
      const response = await this.execute(context, request, { cancelled: false } as any);

      const durationMs = Date.now() - startTime;

      return {
        turnId,
        status: "COMPLETED" as TurnStatus,
        emitted: input.event,
        costUsd: response.usage.costUsd,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const runtimeError: RuntimeError = {
        kind: "ProviderError",
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
        deadLetter: false,
        stage: "EXECUTING",
      };

      return {
        turnId,
        status: "FAILED" as TurnStatus,
        error: runtimeError,
        costUsd: 0,
        durationMs,
      };
    }
  }
}
