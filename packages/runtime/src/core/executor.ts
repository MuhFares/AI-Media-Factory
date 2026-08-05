import type { ExecutionContext } from "../interfaces/context.js";
import type { ExecutionRequest, ExecutionResponse } from "../interfaces/execution.js";
import type { CancellationToken } from "../interfaces/resilience.js";
import type { LlmExecutor, PromptAssembler } from "../interfaces/execution.js";
import type { PromptCompiler, PromptContext, FinalPrompt } from "../types/prompt-compiler.js";
import { DefaultRuntimeProviderBinding } from "../providers/binding.js";

export class DefaultLlmExecutor implements LlmExecutor {
  private readonly binding: DefaultRuntimeProviderBinding;
  private readonly promptCompiler: PromptCompiler;

  constructor(binding: DefaultRuntimeProviderBinding, promptCompiler: PromptCompiler) {
    this.binding = binding;
    this.promptCompiler = promptCompiler;
  }

  buildRequest(context: ExecutionContext): ExecutionRequest {
    const systemPrompt = context.prompts.system;
    const instructions = context.prompts.instructions;
    const examples = context.prompts.examples;

    const messages: ExecutionRequest["messages"] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `${instructions}\n\n${examples}\n\nInput: ${JSON.stringify(context.inputEvent)}` },
    ];

    return {
      model: context.config.model.primary,
      system: systemPrompt,
      messages,
      temperature: context.config.model.temperature,
      maxOutputTokens: context.config.model.max_output_tokens,
      responseSchema: context.schemas.output,
    };
  }

  async execute(request: ExecutionRequest, signal: CancellationToken): Promise<ExecutionResponse> {
    return this.binding.run(request, signal);
  }
}

export class DefaultPromptAssembler implements PromptAssembler {
  private readonly promptCompiler: PromptCompiler;

  constructor(promptCompiler: PromptCompiler) {
    this.promptCompiler = promptCompiler;
  }

  async assemblePrompt(context: ExecutionContext): Promise<FinalPrompt> {
    const promptContext: PromptContext = {
      agent: context.config.agent.id,
      config: context.config,
      prompts: context.prompts,
      memory: context.memory,
      workflow: { runId: context.turnId, stepId: context.turnId, variables: {} } as any,
      inputEvent: context.inputEvent,
      outputSchema: context.schemas.output,
      guardrails: {} as any,
      budget: {
        total: 128000,
        reservedForCompletion: context.config.model.max_output_tokens,
        maxPromptTokens: 128000 - context.config.model.max_output_tokens,
        allocations: [],
      },
    };

    return this.promptCompiler.assemble(promptContext);
  }
}