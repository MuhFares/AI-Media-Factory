/**
 * Unit tests for Memory Layer.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { strictEqual, ok, deepStrictEqual, rejects } from "node:assert";
import type {
  BaseMemory,
  ConversationMemory,
  SessionMemory,
  WorkspaceMemory,
  NamespaceConfig,
  MemoryFactory,
  MemoryRecord,
  MemoryQuery,
  WriteResult,
  MemoryPatch,
} from "@ai-media-factory/memory-engine";
import {
  InMemoryMemory,
  InMemoryConversationMemory,
  InMemorySessionMemory,
  InMemoryWorkspaceMemory,
} from "@ai-media-factory/memory-engine";
import { DefaultMemoryFactory } from "@ai-media-factory/memory-engine";

// Helper to create a test memory record
function createTestRecord(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    memory_id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    type: "session",
    agent: "test-agent",
    brand_id: "test-brand",
    body: { content: "test content" },
    confidence: 0.9,
    provenance: { sources: [{ type: "test", ref: "test" }], derived_by: "test-agent" },
    created_at: new Date().toISOString(),
    last_reinforced: null,
    supersedes: null,
    superseded_by: null,
    version: 1,
    ...overrides,
  };
}

// Helper to create a test query
function createTestQuery(overrides: Partial<MemoryQuery> = {}): MemoryQuery {
  return {
    agent: "test-agent",
    scope: ["session"],
    text: undefined,
    filter: {},
    mode: "hybrid",
    topK: 10,
    minConfidence: 0,
    ...overrides,
  };
}

describe("InMemoryMemory", () => {
  let memory: InMemoryMemory;
  const namespace = "test-namespace";
  const config: NamespaceConfig = { type: "session" };

  beforeEach(() => {
    memory = new InMemoryMemory(namespace, config);
  });

  it("should save and retrieve a record", async () => {
    const record = createTestRecord();
    const result = await memory.save(record);

    ok(result.memory_id);
    strictEqual(result.version, 1);
    strictEqual(result.supersededId, null);

    const retrieved = await memory.get(record.memory_id);
    ok(retrieved);
    strictEqual(retrieved!.memory_id, record.memory_id);
    strictEqual(retrieved!.body.content, "test content");
  });

  it("should update a record by superseding", async () => {
    const record = createTestRecord();
    await memory.save(record);

    const patch: MemoryPatch = {
      body: { content: "updated content" },
      confidenceDelta: 0.1,
      reinforce: true,
      reason: "test update",
    };

    const result = await memory.update(record.memory_id, patch);
    ok(result.memory_id);
    strictEqual(result.version, 2);
    strictEqual(result.supersededId, record.memory_id);

    const updated = await memory.get(result.memory_id);
    ok(updated);
    strictEqual(updated!.body.content, "updated content");
    strictEqual(updated!.confidence, 1.0); // capped at 1.0
  });

  it("should delete a record", async () => {
    const record = createTestRecord();
    await memory.save(record);

    await memory.delete(record.memory_id, "test deletion");

    const retrieved = await memory.get(record.memory_id);
    strictEqual(retrieved, null);
  });

  it("should reject delete on permanent types", async () => {
    const permanentMemory = new InMemoryMemory("permanent", { type: "company" });
    const record = createTestRecord({ type: "company" });
    await permanentMemory.save(record);

    await rejects(
      permanentMemory.delete(record.memory_id, "should fail"),
      /Cannot delete company records/
    );
  });

  it("should retrieve records matching query", async () => {
    const record1 = createTestRecord({ body: { content: "foo" }, agent: "agent-1" });
    const record2 = createTestRecord({ body: { content: "bar" }, agent: "agent-2" });
    await memory.save(record1);
    await memory.save(record2);

    const query = createTestQuery({ agent: "agent-1" });
    const result = await memory.retrieve(query);

    strictEqual(result.records.length, 1);
    strictEqual(result.records[0].record.body.content, "foo");
  });

  it("should search records", async () => {
    const record = createTestRecord({ body: { content: "searchable content" } });
    await memory.save(record);

    const query = createTestQuery({ text: "searchable" });
    const result = await memory.search(query);

    strictEqual(result.records.length, 1);
  });

  it("should clear all records", async () => {
    await memory.save(createTestRecord());
    await memory.save(createTestRecord());

    await memory.clear();

    const stats = await memory.stats();
    strictEqual(stats.recordCount, 0);
  });

  it("should check if record exists", async () => {
    const record = createTestRecord();
    await memory.save(record);

    ok(await memory.has(record.memory_id));
    ok(!(await memory.has("non-existent")));
  });

  it("should archive records", async () => {
    const record = createTestRecord({ created_at: "2020-01-01T00:00:00Z" });
    await memory.save(record);

    const result = await memory.archive("2023-01-01T00:00:00Z");
    ok(result.archived >= 0);
  });

  it("should expire records", async () => {
    const record = createTestRecord({ created_at: "2020-01-01T00:00:00Z" });
    await memory.save(record);

    const result = await memory.expire("2023-01-01T00:00:00Z");
    ok(result.expired >= 0);
  });

  it("should not expire permanent types", async () => {
    const permanentMemory = new InMemoryMemory("permanent", { type: "company" });
    const record = createTestRecord({ type: "company", created_at: "2020-01-01T00:00:00Z" });
    await permanentMemory.save(record);

    const result = await permanentMemory.expire("2023-01-01T00:00:00Z");
    strictEqual(result.expired, 0);
  });

  it("should return stats", async () => {
    await memory.save(createTestRecord());
    await memory.save(createTestRecord());

    const stats = await memory.stats();
    strictEqual(stats.namespace, namespace);
    strictEqual(stats.type, "session");
    strictEqual(stats.recordCount, 2);
    ok(stats.totalSizeBytes > 0);
  });

  it("should return health", async () => {
    const health = await memory.health();
    strictEqual(health.healthy, true);
    ok(health.lastCheck);
  });
});

describe("InMemoryConversationMemory", () => {
  let memory: InMemoryConversationMemory;
  const namespace = "test-conversation";

  beforeEach(() => {
    memory = new InMemoryConversationMemory(namespace, { type: "session" });
  });

  it("should add messages", async () => {
    await memory.addMessage("user", "Hello");
    await memory.addMessage("assistant", "Hi there!");

    const history = await memory.getHistory();
    strictEqual(history.length, 2);
    strictEqual(history[0].body.role, "user");
    strictEqual(history[0].body.content, "Hello");
    strictEqual(history[1].body.role, "assistant");
    strictEqual(history[1].body.content, "Hi there!");
  });

  it("should limit history", async () => {
    await memory.addMessage("user", "Message 1");
    await memory.addMessage("user", "Message 2");
    await memory.addMessage("user", "Message 3");

    const history = await memory.getHistory(2);
    strictEqual(history.length, 2);
    strictEqual(history[0].body.content, "Message 2");
    strictEqual(history[1].body.content, "Message 3");
  });

  it("should clear history", async () => {
    await memory.addMessage("user", "Hello");
    await memory.clearHistory();

    const history = await memory.getHistory();
    strictEqual(history.length, 0);
  });
});

describe("InMemorySessionMemory", () => {
  let memory: InMemorySessionMemory;
  const namespace = "test-session";

  beforeEach(() => {
    memory = new InMemorySessionMemory(namespace, { type: "workflow" });
  });

  it("should append to run", async () => {
    const record = createTestRecord();
    const result = await memory.appendToRun("workflow-1", record);

    ok(result.memory_id);
  });

  it("should get run records", async () => {
    await memory.appendToRun("workflow-1", createTestRecord({ body: { step: 1 } }));
    await memory.appendToRun("workflow-1", createTestRecord({ body: { step: 2 } }));
    await memory.appendToRun("workflow-2", createTestRecord({ body: { step: 1 } }));

    const run = await memory.getRun("workflow-1");
    strictEqual(run.length, 2);
    strictEqual(run[0].body.step, 1);
    strictEqual(run[1].body.step, 2);
  });

  it("should distill run", async () => {
    await memory.appendToRun("workflow-1", createTestRecord({ body: { step: 1 } }));
    const distilled = await memory.distill("workflow-1");
    strictEqual(distilled.length, 1);
  });
});

describe("InMemoryWorkspaceMemory", () => {
  let memory: InMemoryWorkspaceMemory;
  const namespace = "test-workspace";

  beforeEach(() => {
    memory = new InMemoryWorkspaceMemory(namespace, { type: "knowledge" });
  });

  it("should save and get document", async () => {
    await memory.saveDocument("key1", { value: "test" }, { agent: "test-agent" });

    const doc = await memory.getDocument("key1");
    ok(doc);
    strictEqual(doc!.body.content.value, "test");
  });

  it("should list documents", async () => {
    await memory.saveDocument("key1", { value: "test1" });
    await memory.saveDocument("key2", { value: "test2" });

    const docs = await memory.listDocuments();
    strictEqual(docs.length, 2);
    ok(docs.includes("key1"));
    ok(docs.includes("key2"));
  });

  it("should return null for missing document", async () => {
    const doc = await memory.getDocument("non-existent");
    strictEqual(doc, null);
  });
});

describe("DefaultMemoryFactory", () => {
  let factory: DefaultMemoryFactory;

  beforeEach(() => {
    factory = new DefaultMemoryFactory({ defaultTTLDays: 7, defaultMaxRecords: 100 });
  });

  afterEach(async () => {
    await factory.shutdown();
  });

  it("should create conversation memory", () => {
    const memory = factory.createConversation("conv-1");
    ok(memory);
    strictEqual(memory.getNamespace(), "conv-1");
    strictEqual(memory.getType(), "session");
  });

  it("should create session memory", () => {
    const memory = factory.createSession("sess-1");
    ok(memory);
    strictEqual(memory.getNamespace(), "sess-1");
    strictEqual(memory.getType(), "workflow");
  });

  it("should create workspace memory", () => {
    const memory = factory.createWorkspace("ws-1");
    ok(memory);
    strictEqual(memory.getNamespace(), "ws-1");
    strictEqual(memory.getType(), "knowledge");
  });

  it("should create generic memory", () => {
    const memory = factory.create("generic-1", { type: "analytics" });
    ok(memory);
    strictEqual(memory.getNamespace(), "generic-1");
    strictEqual(memory.getType(), "analytics");
  });

  it("should get existing memory", () => {
    factory.createConversation("conv-1");
    const memory = factory.get("conv-1");
    ok(memory);
    strictEqual(memory.getNamespace(), "conv-1");
  });

  it("should return undefined for non-existent memory", () => {
    const memory = factory.get("non-existent");
    strictEqual(memory, undefined);
  });

  it("should register custom factory", () => {
    factory.register("custom-type", () => new InMemoryMemory("custom", { type: "custom-type" }));
    ok(factory.listTypes().includes("custom-type"));
  });

  it("should list types", () => {
    const types = factory.listTypes();
    ok(types.includes("conversation"));
    ok(types.includes("session"));
    ok(types.includes("workspace"));
  });
});

describe("MemoryRecord and MemoryQuery types", () => {
  it("should create valid MemoryRecord", () => {
    const record = createTestRecord();
    strictEqual(record.type, "session");
    strictEqual(record.agent, "test-agent");
    strictEqual(record.confidence, 0.9);
    strictEqual(record.version, 1);
  });

  it("should create valid MemoryQuery", () => {
    const query = createTestQuery();
    strictEqual(query.agent, "test-agent");
    deepStrictEqual(query.scope, ["session"]);
    strictEqual(query.topK, 10);
  });
});