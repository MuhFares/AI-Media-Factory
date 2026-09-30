import test from "node:test";
import assert from "node:assert/strict";
import { DefaultAgentRegistry, setDefaultRegistry } from "@ai-media-factory/agent-registry";
import { bootstrapCanonicalAgentRegistry } from "../dist/agent-bootstrap.js";
import { createProductionAgentExecutor } from "../dist/production-executor.js";

const REQUIRED = ["ceo", "research", "growth", "finance", "brand", "seo", "planner", "writer"];
const PRODUCTION = [...REQUIRED, "review", "thumbnail", "video", "qa", "publisher", "analytics"];

test("canonical bootstrap registers required real implementations and resolves them", async () => {
  setDefaultRegistry(new DefaultAgentRegistry());
  const registry = await bootstrapCanonicalAgentRegistry({ executor: createProductionAgentExecutor() });
  const ids = (await registry.list()).map((a) => a.id);
  for (const id of [...PRODUCTION, "director", "tts", "timeline", "scene-image", "visual-semantic-review", "visual-technical-qa", "wan-authorization", "composer"]) assert.ok(ids.includes(id));
  for (const id of PRODUCTION) {
    const instance = await registry.resolve(id);
    assert.equal(instance.id, id);
    assert.equal((await instance.health()).healthy, true);
  }
});
test("bootstrap is idempotent and registry remains fail-closed", async () => {
  setDefaultRegistry(new DefaultAgentRegistry());
  const registry = await bootstrapCanonicalAgentRegistry({ executor: createProductionAgentExecutor() });
  await bootstrapCanonicalAgentRegistry({ executor: createProductionAgentExecutor() });
  assert.ok((await registry.list()).length >= PRODUCTION.length);
  await assert.rejects(() => registry.resolve("does-not-exist"), /Agent not found/);
});

test("fresh-process reconstruction produces the same registry", async () => {
  setDefaultRegistry(new DefaultAgentRegistry());
  const first = await bootstrapCanonicalAgentRegistry({ executor: createProductionAgentExecutor() });
  const firstIds = (await first.list()).map((a) => a.id).sort();
  setDefaultRegistry(new DefaultAgentRegistry());
  const second = await bootstrapCanonicalAgentRegistry({ executor: createProductionAgentExecutor() });
  assert.deepEqual((await second.list()).map((a) => a.id).sort(), firstIds);
});

test("stage-only registrations expose their contracts and reject arbitrary direct payloads", async () => {  setDefaultRegistry(new DefaultAgentRegistry());
  const registry = await bootstrapCanonicalAgentRegistry({ executor: createProductionAgentExecutor() });
  const research = await registry.resolve("research");
  assert.equal(research.metadata.execution.mode, "workflow-stage");
  assert.deepEqual(research.metadata.execution.requiredArtifactKinds, ["execution_plan"]);
  await assert.rejects(
    () => research.execute({ objective: "arbitrary input" }, { workflowId: "wf", correlationId: "corr" }),
    (error) => error?.code === "AGENT_INVOCATION_CONTRACT_VIOLATION" && error?.agentId === "research",
  );
  const ceo = await registry.resolve("ceo");
  // CEO synthesis is a governed workflow stage. The human owner remains the
  // decision authority, so registry resolution must not expose a direct
  // decision-mode execution escape hatch.
  assert.equal(ceo.metadata.execution.mode, "workflow-stage");
  assert.deepEqual(ceo.metadata.execution.requiredArtifactKinds, ["research_report"]);
  assert.equal(ceo.metadata.execution.outputArtifactKind, "ceo_recommendation");
});

test("visual-director is registered as a governed creative role without an execution escape hatch", async () => {
  setDefaultRegistry(new DefaultAgentRegistry());
  const registry = await bootstrapCanonicalAgentRegistry({ executor: createProductionAgentExecutor() });
  assert.ok((await registry.list()).some((a) => a.id === "visual-director"));
  const director = await registry.resolve("visual-director");
  assert.equal(director.metadata.execution.mode, "workflow-stage");
  assert.equal(director.metadata.execution.outputArtifactKind, "visual_direction_contract");
  assert.deepEqual(director.metadata.execution.requiredArtifactKinds, ["scene_plan"]);
  await assert.rejects(
    () => director.execute({ objective: "arbitrary input" }, { workflowId: "wf", correlationId: "corr" }),
    (error) => error?.code === "AGENT_INVOCATION_CONTRACT_VIOLATION" && error?.agentId === "visual-director",
  );
});
