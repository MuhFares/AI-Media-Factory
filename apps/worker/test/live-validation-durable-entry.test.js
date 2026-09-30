import { test } from "node:test";
import assert from "node:assert/strict";
import { bootstrapApprovedIdeaGate, approveBootstrappedIdeaGate, liveValidationDefinition } from "../dist/index.js";

const clone = (v) => JSON.parse(JSON.stringify(v));
class Store {
  workflows = new Map(); checkpoints = new Map(); artifacts = new Map(); decisions = new Map(); caps = new Map(); evidence = new Map();
  async saveWorkflow(v) { this.workflows.set(v.workflowId, clone(v)); }
  async loadWorkflow(id) { return clone(this.workflows.get(id) ?? null); }
  async saveCheckpoint(v) { this.checkpoints.set(v.workflowId, clone(v)); }
  async loadLatestCheckpoint(id) { return clone(this.checkpoints.get(id) ?? null); }
  async saveArtifact(v) { this.artifacts.set(v.artifactId, clone(v)); }
  async listArtifacts(id) { return [...this.artifacts.values()].filter((v) => v.workflowId === id).map(clone); }
  async saveCapabilityExecution(v) { this.caps.set(v.resultId, clone(v)); }
  async listCapabilityExecutions(id) { return [...this.caps.values()].filter((v) => v.workflowId === id).map(clone); }
  async saveExecutionEvidence(v) { this.evidence.set(v.evidenceId, clone(v)); }
  async listExecutionEvidence(id) { return [...this.evidence.values()].filter((v) => v.workflowId === id).map(clone); }
  async saveDecision(v) { this.decisions.set(v.decisionId, clone(v)); }
  async listDecisions(id) { return [...this.decisions.values()].filter((v) => v.workflowId === id).map(clone); }
  async close() {}
}

test("live validation bootstraps a durable approved idea gate exactly once", async () => {
  const store = new Store();
  const workflowId = "wf-live-idea-gate";
  const approval = { workflowId, stepId: "idea-human-gate", outcome: "approved", approver: "human_operator", note: "approved selected idea", decidedAt: new Date().toISOString() };
  const options = { persistence: store, workflowId, correlationId: "corr-live-idea", trigger: { directive: "produce", selectedIdea: "Why Does an Orange Float? The 20-Second Density Test" }, researchArtifactIds: ["research-live-001"], selectedIdeaArtifactId: "idea-live-001", approval };
  const first = await bootstrapApprovedIdeaGate(options);
  assert.equal(first.workflowId, workflowId);
  assert.equal(first.context.correlationId, "corr-live-idea");
  assert.equal(first.state, "AWAITING_APPROVAL");
  assert.equal(first.steps.find((s) => s.stepId === "idea-human-gate").status, "running");
  assert.deepEqual(first.context.data.importedResearchArtifactIds, ["research-live-001"]);
  assert.equal((await store.listArtifacts(workflowId)).length, 2);
  const second = await bootstrapApprovedIdeaGate(options);
  assert.deepEqual(second, first);
  assert.equal(store.workflows.size, 1);
  assert.equal(store.artifacts.size, 2);
  const newRuntime = await approveBootstrappedIdeaGate({ persistence: store, workflowId, approval, executor: { executeAgentStep: async () => ({ status: "completed", output: {} }) } });
  assert.equal(newRuntime.workflowId, workflowId);
  assert.equal(newRuntime.context.correlationId, "corr-live-idea");
  assert.equal(newRuntime.steps.find((s) => s.stepId === "idea-human-gate").status, "completed");
  assert.equal(newRuntime.ready.includes("planner-initial"), true);
  assert.equal(liveValidationDefinition().entryStep, "idea-human-gate");
});
