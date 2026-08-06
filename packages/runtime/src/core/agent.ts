import type { AgentId, Json } from "../interfaces/common.js";
import type { ExecutionContext } from "../interfaces/context.js";
import type { ExecutionRequest, ExecutionResponse } from "../interfaces/execution.js";
import type { CancellationToken } from "../interfaces/resilience.js";

export interface Agent {
  readonly id: AgentId;
  readonly name: string;
  readonly version: string;
}

export interface AgentExecutionInput {
  context: ExecutionContext;
  input: Json;
}

export interface AgentExecutionOutput {
  output: Json;
  response: ExecutionResponse;
}

export interface BaseAgentDependencies {
  execute(
    context: ExecutionContext,
    request: ExecutionRequest,
    signal: CancellationToken
  ): Promise<ExecutionResponse>;
}

export abstract class BaseAgent implements Agent {
  abstract readonly id: AgentId;
  abstract readonly name: string;
  abstract readonly version: string;

  protected readonly deps: BaseAgentDependencies;

  constructor(deps: BaseAgentDependencies) {
    this.deps = deps;
  }

  abstract execute(input: AgentExecutionInput, signal: CancellationToken): Promise<AgentExecutionOutput>;

  protected async runExecution(
    context: ExecutionContext,
    request: ExecutionRequest,
    signal: CancellationToken
  ): Promise<ExecutionResponse> {
    return this.deps.execute(context, request, signal);
  }
}
