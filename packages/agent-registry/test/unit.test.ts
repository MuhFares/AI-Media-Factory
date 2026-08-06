/**
 * Unit tests for Agent Registry.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strictEqual, ok, deepStrictEqual, rejects } from "node:assert";
import {
  DefaultAgentRegistry,
  getDefaultRegistry,
  setDefaultRegistry,
} from "@ai-media-factory/agent-registry";
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

// Test agent factory
function createTestAgentFactory(): AgentFactory {
  return async (config: Json) => {
    const cfg = config as Record<string, Json>;
    const instance: AgentInstance = {
      id: cfg.metadata?.id as string ?? "test-agent",
      metadata: cfg.metadata as AgentMetadata,
      config,
      async initialize() {},
      async execute(input: Json, context: ExecutionContext) {
        return { result: "ok", input, context };
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
    id: "test-agent",
    name: "Test Agent",
    version: "1.0.0",
    description: "A test agent",
    capabilities: ["text-generation", "web-search"],
    tags: ["test"],
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

describe("Agent Registry Unit Tests", () => {
  let registry: DefaultAgentRegistry;

  beforeEach(() => {
    registry = new DefaultAgentRegistry();
  });

  afterEach(async () => {
    await registry.disposeAll();
  });

  describe("register", () => {
    it("should register a new agent", async () => {
      const registration = createTestRegistration();
      await registry.register(registration);

      ok(registry.has("test-agent"));
      const metadata = await registry.getMetadata("test-agent");
      ok(metadata);
      strictEqual(metadata!.id, "test-agent");
      strictEqual(metadata!.name, "Test Agent");
    });

    it("should throw for duplicate registration", async () => {
      const registration = createTestRegistration();
      await registry.register(registration);

      await rejects(
        () => registry.register(registration),
        /Agent already registered/
      );
    });

    it("should validate required metadata fields", async () => {
      const registration = createTestRegistration({
        metadata: { ...createTestMetadata(), id: "" },
      });

      await rejects(
        () => registry.register(registration),
        /Agent ID is required/
      );
    });

    it("should set timestamps on registration", async () => {
      const registration = createTestRegistration({
        metadata: { ...createTestMetadata(), createdAt: undefined, updatedAt: undefined },
      });
      await registry.register(registration);

      const metadata = await registry.getMetadata("test-agent");
      ok(metadata!.createdAt);
      ok(metadata!.updatedAt);
    });
  });

  describe("unregister", () => {
    it("should unregister an existing agent", async () => {
      const registration = createTestRegistration();
      await registry.register(registration);

      await registry.unregister("test-agent");

      ok(!registry.has("test-agent"));
      strictEqual(await registry.getMetadata("test-agent"), null);
    });

    it("should throw for non-existent agent", async () => {
      await rejects(
        () => registry.unregister("non-existent"),
        /Agent not found/
      );
    });

    it("should dispose instance on unregister", async () => {
      const registration = createTestRegistration();
      await registry.register(registration);

      const instance = await registry.resolve("test-agent");
      ok(instance);

      await registry.unregister("test-agent");
      ok(true); // No error means dispose worked
    });
  });

  describe("resolve", () => {
    it("should create and return agent instance", async () => {
      const registration = createTestRegistration();
      await registry.register(registration);

      const instance = await registry.resolve("test-agent");

      ok(instance);
      strictEqual(instance.id, "test-agent");
      ok(typeof instance.execute === "function");
      ok(typeof instance.health === "function");
      ok(typeof instance.dispose === "function");
    });

    it("should throw for non-existent agent", async () => {
      await rejects(
        () => registry.resolve("non-existent"),
        /Agent not found/
      );
    });

    it("should reuse instance for same config", async () => {
      const registration = createTestRegistration();
      await registry.register(registration);

      const instance1 = await registry.resolve("test-agent");
      const instance2 = await registry.resolve("test-agent");

      strictEqual(instance1, instance2);
    });

    it("should create new instance for different config", async () => {
      const registration = createTestRegistration();
      await registry.register(registration);

      const instance1 = await registry.resolve("test-agent", { temperature: 0.5 });
      const instance2 = await registry.resolve("test-agent", { temperature: 0.9 });

      ok(instance1 !== instance2);
    });

    it("should handle concurrent resolve calls", async () => {
      const registration = createTestRegistration();
      await registry.register(registration);

      const [instance1, instance2] = await Promise.all([
        registry.resolve("test-agent"),
        registry.resolve("test-agent"),
      ]);

      strictEqual(instance1, instance2);
    });
  });

  describe("discover", () => {
    it("should find agents by capability", async () => {
      const reg1 = createTestRegistration({
        metadata: createTestMetadata({ id: "agent-1", capabilities: ["text-generation"] }),
      });
      const reg2 = createTestRegistration({
        metadata: createTestMetadata({ id: "agent-2", capabilities: ["image-generation"] }),
      });
      const reg3 = createTestRegistration({
        metadata: createTestMetadata({ id: "agent-3", capabilities: ["text-generation", "web-search"] }),
      });

      await registry.register(reg1);
      await registry.register(reg2);
      await registry.register(reg3);

      const textAgents = await registry.discover("text-generation");
      strictEqual(textAgents.length, 2);
      ok(textAgents.some((a) => a.id === "agent-1"));
      ok(textAgents.some((a) => a.id === "agent-3"));

      const imageAgents = await registry.discover("image-generation");
      strictEqual(imageAgents.length, 1);
      strictEqual(imageAgents[0].id, "agent-2");
    });

    it("should return empty array for unknown capability", async () => {
      const registration = createTestRegistration();
      await registry.register(registration);

      const results = await registry.discover("unknown-capability");
      deepStrictEqual(results, []);
    });
  });

  describe("list", () => {
    it("should list all registered agents", async () => {
      const reg1 = createTestRegistration({ metadata: createTestMetadata({ id: "agent-1" }) });
      const reg2 = createTestRegistration({ metadata: createTestMetadata({ id: "agent-2" }) });

      await registry.register(reg1);
      await registry.register(reg2);

      const list = await registry.list();
      strictEqual(list.length, 2);
      ok(list.some((a) => a.id === "agent-1"));
      ok(list.some((a) => a.id === "agent-2"));
    });

    it("should return empty array when no agents registered", async () => {
      const list = await registry.list();
      deepStrictEqual(list, []);
    });
  });

  describe("getMetadata", () => {
    it("should return metadata for registered agent", async () => {
      const registration = createTestRegistration();
      await registry.register(registration);

      const metadata = await registry.getMetadata("test-agent");
      ok(metadata);
      strictEqual(metadata.id, "test-agent");
    });

    it("should return null for non-existent agent", async () => {
      const metadata = await registry.getMetadata("non-existent");
      strictEqual(metadata, null);
    });
  });

  describe("getState", () => {
    it("should return state for registered agent", async () => {
      const registration = createTestRegistration();
      await registry.register(registration);

      const state = await registry.getState("test-agent");
      strictEqual(state, "REGISTERED");
    });

    it("should return null for non-existent agent", async () => {
      const state = await registry.getState("non-existent");
      strictEqual(state, null);
    });
  });

  describe("has", () => {
    it("should return true for registered agent", async () => {
      const registration = createTestRegistration();
      await registry.register(registration);

      ok(registry.has("test-agent"));
    });

    it("should return false for non-existent agent", () => {
      ok(!registry.has("non-existent"));
    });
  });

  describe("initialize", () => {
    it("should initialize agent and return instance", async () => {
      const registration = createTestRegistration();
      await registry.register(registration);

      const instance = await registry.initialize("test-agent");
      ok(instance);
      strictEqual(instance.id, "test-agent");
    });

    it("should update agent state to READY after initialization", async () => {
      const registration = createTestRegistration();
      await registry.register(registration);

      await registry.initialize("test-agent");
      const state = await registry.getState("test-agent");
      strictEqual(state, "READY");
    });

    it("should throw for non-existent agent", async () => {
      await rejects(
        () => registry.initialize("non-existent"),
        /Agent not found/
      );
    });
  });

  describe("dispose", () => {
    it("should dispose agent instance", async () => {
      const registration = createTestRegistration();
      await registry.register(registration);

      await registry.resolve("test-agent");
      await registry.dispose("test-agent");

      const state = await registry.getState("test-agent");
      strictEqual(state, "DISPOSED");
    });

    it("should throw for non-existent agent", async () => {
      await rejects(
        () => registry.dispose("non-existent"),
        /Agent not found/
      );
    });
  });

  describe("disposeAll", () => {
    it("should dispose all agents", async () => {
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

  describe("AgentLoader", () => {
    it("should load agents from registered loaders", async () => {
      const loader = {
        async load() {
          return [
            createTestRegistration({ metadata: createTestMetadata({ id: "loaded-1" }) }),
            createTestRegistration({ metadata: createTestMetadata({ id: "loaded-2" }) }),
          ];
        },
      };

      registry.registerLoader("test-loader", loader);
      await registry.loadAll();

      ok(registry.has("loaded-1"));
      ok(registry.has("loaded-2"));
    });

    it("should not overwrite existing agents", async () => {
      const existing = createTestRegistration({ metadata: createTestMetadata({ id: "existing" }) });
      await registry.register(existing);

      const loader = {
        async load() {
          return [createTestRegistration({ metadata: createTestMetadata({ id: "existing" }) })];
        },
      };

      registry.registerLoader("test-loader", loader);
      await registry.loadAll();

      // Should still have original
      const metadata = await registry.getMetadata("existing");
      strictEqual(metadata!.id, "existing");
    });
  });
});