import { describe, it, beforeEach } from "node:test";
import { deepStrictEqual, strictEqual, ok } from "node:assert";
import { DefaultAgentRuntime } from "@ai-media-factory/runtime";
import type { AgentRuntime, RuntimeInput, RuntimeResult, TurnStatus } from "@ai-media-factory/runtime";
import type { ConfigLoader, PromptLoader, SchemaLoader, MemoryLoader } from "@ai-media-factory/runtime";
import type { AgentConfig, PromptSet, AgentSchemas } from "@ai-media-factory/runtime";
import type { LoadedMemory } from "@ai-media-factory/runtime";
import type { RuntimeEvent } from "@ai-media-factory/runtime";
import type { ExecutionRequest, CancellationToken } from "@ai-media-factory/runtime";
import type { MemoryEngine } from "../types/memory-engine.js";
import type { PromptCompiler } from "../types/prompt-compiler.js";
import type { Router } from "@ai-media-factory/providers";

class MockConfigLoader implements ConfigLoader {
  async load(agent: string): Promise<AgentConfig> {
    return {
      schema_version: "1.0",
      agent: { id: agent, name: "Test Agent", layer: "test", version: "1.0.0" },
      model: {
        primary: "openrouter/auto",
        fallback: "openrouter/auto",
        temperature: 0.7,
        max_output_tokens: 1000,
      },
      tools: { allow: [], deny: [] },
      budgets: { max_cost_usd: 1.0 },
      guardrails: {},
      escalation: { to: "human", triggers: ["error"], timeout_seconds: 60 },
      memory: { long_term_ref: "ltm", short_term_ref: "stm" },
      io: { input_schema: "input.json", output_schema: "output.json" },
    };
  }
}

class MockPromptLoader implements PromptLoader {
  async load(agent: string): Promise<PromptSet> {
    return {
      system: "You are a test agent.",
      instructions: "Process the input.",
      examples: "Example: input -> output",
    };
  }
}

class MockSchemaLoader implements SchemaLoader {
  async load(agent: string): Promise<AgentSchemas> {
    return {
      input: { type: "object", properties: {} },
      output: { type: "object", properties: { result: { type: "string" } } },
    };
  }
}

class MockMemoryLoader implements MemoryLoader {
  async loadForTurn(agent: string, query: any): Promise<LoadedMemory> {
    return {
      shortTerm: [],
      longTerm: [],
      company: [],
      workflow: [],
      lessons: [],
    };
  }
}

class MockMemoryEngine implements MemoryEngine {
  async save() { return { id: "mem-1", version: 1 }; }
  async retrieve() { return { records: [], totalConfidence: 0 }; }
  async search() { return { records: [], totalConfidence: 0 }; }
  async update() { return { id: "mem-1", version: 2 }; }
  async delete() {}
  async archive() { return { archived: 0, movedTo: "cold" }; }
  async compress() { return { inputRecords: 0, outputRecords: 0, ratio: 0 }; }
  async expire() { return { expired: 0, promoted: 0 }; }
}

class MockPromptCompiler implements PromptCompiler {
  async assemble(context: any) {
    return {
      sections: [],
      fullPrompt: "Test prompt",
      totalTokens: 100,
      budgetUsed: 100,
      budgetRemaining: 1000,
      trimmed: false,
      version: { major: 1, minor: 0, patch: 0, hash: "test" },
      cacheKey: { agent: "test", templateVersion: { major: 1, minor: 0, patch: 0, hash: "test" }, contextHash: "test", schemaHash: "test" },
      metadata: { agent: "test", templateVersion: { major: 1, minor: 0, patch: 0, hash: "test" }, compileDurationMs: 1, sectionsIncluded: [], sectionsTrimmed: [], cacheHit: false, timestamp: new Date().toISOString() },
    };
  }
  async assembleUncached(context: any) { return this.assemble(context); }
  async invalidateCache(agent: string) {}
}

class MockRouter implements Router {
  lastRequest: unknown;

  async route(input: any) {
    this.lastRequest = input.request;
    return {
      primary: {
        provider: {
          id: "openrouter",
          supports: () => true,
          describe: () => null,
          generate: async (req: any) => ({
            output: { result: "success" },
            text: "success",
            usage: { inputTokens: 10, outputTokens: 20, costUsd: 0.001 },
            provider: "openrouter",
            model: "openrouter/auto",
            latencyMs: 100,
            finishReason: "stop",
          }),
          stream: async function* () { yield { delta: "", done: true }; },
          embed: async () => ({ vectors: [], usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, provider: "", model: "" }),
          health: async () => ({ status: "healthy", circuitOpen: false, detail: null, observedAt: new Date().toISOString() }),
        },
        model: { id: "openrouter/auto", name: "auto", provider: "openrouter", tier: "free", pricing: { prompt: 0, completion: 0 }, contextLength: 4096, capabilities: {} },
      },
      fallbackChain: [],
      rationale: "test",
    };
  }
}

function createTestEvent(): RuntimeEvent {
  return {
    schema_version: "1.0.0",
    event_id: "evt-1",
    workflow_id: "wf-1",
    correlation_id: null,
    brand_id: null,
    asset_id: null,
    timestamp: new Date().toISOString(),
    type: "TestEvent",
    source_agent: "test",
    target_agent: "test-agent",
    payload: { input: "test" },
    metadata: {},
  };
}

describe("AgentRuntime smoke tests", () => {
  let runtime: AgentRuntime;
  let defaultRuntime: DefaultAgentRuntime;
  let router: MockRouter;

  beforeEach(() => {
    router = new MockRouter();
    defaultRuntime = new DefaultAgentRuntime({
      configLoader: new MockConfigLoader(),
      promptLoader: new MockPromptLoader(),
      schemaLoader: new MockSchemaLoader(),
      memoryLoader: new MockMemoryLoader(),
      memoryEngine: new MockMemoryEngine(),
      promptCompiler: new MockPromptCompiler(),
      router,
    });
    runtime = defaultRuntime;
  });

  it("should run an agent turn successfully", async () => {
    const input: RuntimeInput = {
      agent: "test-agent",
      event: createTestEvent(),
    };

    const result: RuntimeResult = await runtime.run(input);

    strictEqual(result.status, "COMPLETED");
    ok(result.turnId);
    ok(result.durationMs >= 0);
    ok(result.costUsd >= 0);
  });

  it("should return a valid turnId", async () => {
    const input: RuntimeInput = {
      agent: "test-agent",
      event: createTestEvent(),
    };

    const result = await runtime.run(input);

    ok(typeof result.turnId === "string");
    ok(result.turnId.length > 0);
  });

  it("should include cost in result", async () => {
    const input: RuntimeInput = {
      agent: "test-agent",
      event: createTestEvent(),
    };

    const result = await runtime.run(input);

    ok(typeof result.costUsd === "number");
    ok(result.costUsd >= 0);
  });

  it("should include duration in result", async () => {
    const input: RuntimeInput = {
      agent: "test-agent",
      event: createTestEvent(),
    };

    const result = await runtime.run(input);

    ok(typeof result.durationMs === "number");
    ok(result.durationMs >= 0);
  });

  it("should handle different agents", async () => {
    const agents = ["agent-a", "agent-b", "agent-c"];

    for (const agent of agents) {
      const input: RuntimeInput = {
        agent,
        event: createTestEvent(),
      };

      const result = await runtime.run(input);
      strictEqual(result.status, "COMPLETED");
    }
  });

  it("should execute an agent-provided execution request", async () => {
    const request: ExecutionRequest = {
      model: "agent-selected-model",
      system: "Agent system prompt",
      messages: [
        { role: "system", content: "Agent system prompt" },
        { role: "user", content: "Agent request content" },
      ],
      temperature: 0.1,
      maxOutputTokens: 42,
      responseSchema: { type: "object" },
    };
    const signal: CancellationToken = {
      isCancelled: false,
      onCancelled() {},
      throwIfCancelled() {},
    };

    await defaultRuntime.execute({} as ExecutionContext, request, signal);

    const forwardedRequest = router.lastRequest as {
      model: string;
      messages: Array<{ role: string; content: Array<{ kind: string; text: string }> }>;
      temperature: number;
      maxOutputTokens: number;
      responseFormat: unknown;
    };
    strictEqual(forwardedRequest.model, request.model);
    strictEqual(forwardedRequest.temperature, request.temperature);
    strictEqual(forwardedRequest.maxOutputTokens, request.maxOutputTokens);
    deepStrictEqual(forwardedRequest.messages, [
      { role: "system", content: [{ kind: "text", text: "Agent system prompt" }] },
      { role: "user", content: [{ kind: "text", text: "Agent request content" }] },
    ]);
    deepStrictEqual(forwardedRequest.responseFormat, { kind: "json_schema", schema: request.responseSchema });
  });
});
