import { strictEqual, rejects, ok } from "node:assert";
import { describe, it } from "node:test";
import { DefaultAgentRegistry } from "@ai-media-factory/agent-registry";
import { RegistryAgentResolver, RuntimeAgentExecutor } from "../dist/index.js";

const metadata = { id: "planner", name: "Planner", version: "1.0.0", description: "planner", capabilities: ["text-generation"], tags: [], createdAt: "2026-08-10T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z" };
const registration = { metadata, configSchema: { type: "object", properties: {} }, defaultConfig: {}, state: "REGISTERED", factory: async (config) => ({ id: "planner", metadata: config.metadata, config, async initialize() {}, async execute(input, context) { return { input, workflowId: context.workflowId }; }, async health() { return { healthy: true, lastCheck: "2026-08-10T00:00:00.000Z" }; }, async dispose() {} }) };
const context = { workflowId: "workflow-1", correlationId: "correlation-1", brandId: null, outputs: {}, data: {} };

describe("registry-backed agent resolution", () => {
  it("resolves an agent by id and reaches AgentExecutorPort", async () => {
    const registry = new DefaultAgentRegistry();
    await registry.register(registration);
    const executor = new RuntimeAgentExecutor(new RegistryAgentResolver(registry));
    const outcome = await executor.executeAgentStep({ id: "step-1", kind: "agent", agent: "planner", emits: "plan" }, context);
    strictEqual(outcome.status, "completed");
    strictEqual(outcome.output.workflowId, "workflow-1");
    await registry.disposeAll();
  });
  it("returns a controlled failure for an unknown agent", async () => {
    const executor = new RuntimeAgentExecutor(new RegistryAgentResolver(new DefaultAgentRegistry()));
    const outcome = await executor.executeAgentStep({ id: "step-1", kind: "agent", agent: "missing", emits: "run" }, context);
    strictEqual(outcome.status, "failed");
    ok(outcome.error.message.includes("Agent not found"));
  });
  it("accepts an injectable resolver boundary", async () => {
    let resolved = "";
    const resolver = { resolve: async (agentId) => { resolved = agentId; return { id: agentId, execute: async () => ({ ok: true }) }; } };
    const outcome = await new RuntimeAgentExecutor(resolver).executeAgentStep({ id: "step-1", kind: "agent", agent: "qa", emits: "qa" }, context);
    strictEqual(resolved, "qa");
    strictEqual(outcome.status, "completed");
  });
});
