/**
 * Smoke tests for Agent Registry.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strictEqual, ok } from "node:assert";
import { DefaultAgentRegistry } from "@ai-media-factory/agent-registry";
import type {
  AgentMetadata,
  AgentConfigSchema,
  AgentRegistration,
  AgentFactory,
  AgentInstance,
  ExecutionContext,
  Capability,
  Json,
} from "@ai-media-factory/agent-registry";

// Simple test agent factory
function createTestAgentFactory(): AgentFactory {
  return async (config: Json) => {
    const cfg = config as Record<string, Json>;
    const instance: AgentInstance = {
      id: cfg.metadata?.id as string ?? "test-agent",
      metadata: cfg.metadata as AgentMetadata,
      config,
      async initialize() {},
      async execute(input: Json, context: ExecutionContext) {
        return { result: "ok", processed: true };
      },
      async health() {
        return { healthy: true, lastCheck: new Date().toISOString() };
      },
      async dispose() {},
    };
    return instance;
  };
}

function createTestMetadata(overrides: Partial<AgentMetadata> = {}): AgentMetadata {
  return {
    id: "smoke-test-agent",
    name: "Smoke Test Agent",
    version: "1.0.0",
    description: "A smoke test agent",
    capabilities: ["text-generation", "web-search"],
    tags: ["smoke-test"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createTestRegistration(overrides: Partial<AgentRegistration> = {}): AgentRegistration {
  const metadata = createTestMetadata(overrides.metadata as any);
  return {
    metadata,
    configSchema: { type: "object", properties: {} },
    defaultConfig: { temperature: 0.7 },
    factory: createTestAgentFactory(),
    state: "REGISTERED",
    ...overrides,
  };
}

describe("Agent Registry Smoke Tests", () => {
  let registry: DefaultAgentRegistry;

  beforeEach(() => {
    registry = new DefaultAgentRegistry();
  });

  afterEach(async () => {
    await registry.disposeAll();
  });

  it("should register, resolve, and execute an agent end-to-end", async () => {
    // Register
    const registration = createTestRegistration();
    await registry.register(registration);

    // Resolve
    const instance = await registry.resolve("smoke-test-agent");
    ok(instance);
    strictEqual(instance.id, "smoke-test-agent");

    // Execute
    const result = await instance.execute({ prompt: "Hello" }, { workflowId: "wf-1" });
    ok(result);
    strictEqual(result.processed, true);

    // Health check
    const health = await instance.health();
    strictEqual(health.healthy, true);

    // Dispose
    await instance.dispose();
  });

  it("should discover agents by capability", async () => {
    const reg1 = createTestRegistration({
      metadata: createTestMetadata({ id: "writer", capabilities: ["text-generation"] }),
    });
    const reg2 = createTestRegistration({
      metadata: createTestMetadata({ id: "researcher", capabilities: ["web-search"] }),
    });
    const reg3 = createTestRegistration({
      metadata: createTestMetadata({ id: "analyst", capabilities: ["text-generation", "data-processing"] }),
    });

    await registry.register(reg1);
    await registry.register(reg2);
    await registry.register(reg3);

    const textAgents = await registry.discover("text-generation");
    strictEqual(textAgents.length, 2);
    ok(textAgents.some((a) => a.id === "writer"));
    ok(textAgents.some((a) => a.id === "analyst"));

    const webAgents = await registry.discover("web-search");
    strictEqual(webAgents.length, 1);
    strictEqual(webAgents[0].id, "researcher");
  });

  it("should list all agents", async () => {
    await registry.register(createTestRegistration({ metadata: createTestMetadata({ id: "agent-1" }) }));
    await registry.register(createTestRegistration({ metadata: createTestMetadata({ id: "agent-2" }) }));
    await registry.register(createTestRegistration({ metadata: createTestMetadata({ id: "agent-3" }) }));

    const list = await registry.list();
    strictEqual(list.length, 3);
  });

  it("should handle agent lifecycle: register -> initialize -> dispose", async () => {
    const registration = createTestRegistration();
    await registry.register(registration);

    // Initialize
    const instance = await registry.initialize("smoke-test-agent");
    ok(instance);
    strictEqual(await registry.getState("smoke-test-agent"), "READY");

    // Execute a few times
    await instance.execute({ test: 1 }, {});
    await instance.execute({ test: 2 }, {});

    // Dispose
    await registry.dispose("smoke-test-agent");
    strictEqual(await registry.getState("smoke-test-agent"), "DISPOSED");
  });

  it("should handle config merging", async () => {
    const registration = createTestRegistration({
      defaultConfig: { temperature: 0.5, maxTokens: 100 },
    });
    await registry.register(registration);

    const instance = await registry.resolve("smoke-test-agent", { temperature: 0.9 });
    ok(instance.config.temperature === 0.9);
    ok(instance.config.maxTokens === 100);
  });

  it("should handle concurrent operations", async () => {
    const registration = createTestRegistration();
    await registry.register(registration);

    // Multiple concurrent resolves
    const instances = await Promise.all([
      registry.resolve("smoke-test-agent"),
      registry.resolve("smoke-test-agent"),
      registry.resolve("smoke-test-agent"),
    ]);

    // Should all be the same instance
    strictEqual(instances[0], instances[1]);
    strictEqual(instances[1], instances[2]);
  });

  it("should handle unregister and re-register", async () => {
    const registration = createTestRegistration();
    await registry.register(registration);

    await registry.unregister("smoke-test-agent");
    ok(!registry.has("smoke-test-agent"));

    // Re-register
    const newRegistration = createTestRegistration({
      metadata: createTestMetadata({ version: "2.0.0" }),
    });
    await registry.register(newRegistration);

    const metadata = await registry.getMetadata("smoke-test-agent");
    strictEqual(metadata!.version, "2.0.0");
  });

  it("should return correct agent state transitions", async () => {
    const registration = createTestRegistration();
    await registry.register(registration);

    strictEqual(await registry.getState("smoke-test-agent"), "REGISTERED");

    await registry.initialize("smoke-test-agent");
    strictEqual(await registry.getState("smoke-test-agent"), "READY");

    await registry.dispose("smoke-test-agent");
    strictEqual(await registry.getState("smoke-test-agent"), "DISPOSED");
  });

  it("should support agent loader for plugin loading", async () => {
    const loader = {
      async load() {
        return [
          createTestRegistration({ metadata: createTestMetadata({ id: "plugin-1", capabilities: ["custom"] }) }),
          createTestRegistration({ metadata: createTestMetadata({ id: "plugin-2", capabilities: ["custom"] }) }),
        ];
      },
    };

    registry.registerLoader("test-plugins", loader);
    await registry.loadAll();

    ok(registry.has("plugin-1"));
    ok(registry.has("plugin-2"));

    const customAgents = await registry.discover("custom");
    strictEqual(customAgents.length, 2);
  });

  it("should handle disposeAll correctly", async () => {
    const reg1 = createTestRegistration({ metadata: createTestMetadata({ id: "agent-1" }) });
    const reg2 = createTestRegistration({ metadata: createTestMetadata({ id: "agent-2" }) });

    await registry.register(reg1);
    await registry.register(reg2);
    await registry.resolve("agent-1");
    await registry.resolve("agent-2");

    await registry.disposeAll();

    strictEqual(await registry.getState("agent-1"), "DISPOSED");
    strictEqual(await registry.getState("agent-2"), "DISPOSED");
  });
});