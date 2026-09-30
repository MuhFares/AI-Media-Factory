import { test } from "node:test";
import { deepStrictEqual, rejects, strictEqual } from "node:assert";
import { resolveRecoveryArtifacts, rewindWorkflow, workflow } from "@ai-media-factory/workflow-engine";

const definition = workflow().id("recovery-artifact-contract").version(1).trigger("manual", "test").entryStep("orchestrator")
  .addAgentStep({ id: "orchestrator", agent: "orchestrator", emits: "execution_plan", next: "research" })
  .addAgentStep({ id: "research", agent: "research", emits: "research_report" })
  .build();

function artifact(overrides = {}) {
  return {
    artifactId: "art-arbitrary-identity", kind: "execution_plan", producerAgent: "orchestrator",
    workflowId: "wf-contract", correlationId: "corr-contract", status: "completed", payload: {},
    contentType: "application/json", schemaVersion: "1", createdAt: "2026-09-26T00:00:00.000Z",
    ...overrides,
  };
}

function persistence(artifacts = [artifact()]) {
  const writes = { workflow: 0, checkpoint: 0 };
  const instance = {
    workflowId: "wf-contract", definitionId: definition.id, definitionVersion: definition.version, state: "FAILED",
    context: { workflowId: "wf-contract", correlationId: "corr-contract", brandId: null, outputs: {}, data: {} },
    steps: definition.steps.map((step) => ({ stepId: step.id, status: "completed", attempts: 1, startedAt: null, finishedAt: "2026-09-26T00:00:00.000Z" })),
    ready: [], lastCheckpointRef: null, createdAt: "2026-09-26T00:00:00.000Z", updatedAt: "2026-09-26T00:00:00.000Z",
  };
  return {
    writes,
    async listArtifacts(workflowId) { return artifacts.filter((item) => item.workflowId === workflowId); },
    async loadWorkflow(workflowId) { return workflowId === instance.workflowId ? instance : null; },
    async saveWorkflow() { writes.workflow += 1; },
    async saveCheckpoint() { writes.checkpoint += 1; },
  };
}

test("A/F: required kind resolves arbitrary artifact ID with matching workflow lineage", async () => {
  const store = persistence();
  const resolved = await resolveRecoveryArtifacts(store, definition, {
    workflowId: "wf-contract", targetStepId: "research",
    requiredArtifactsByStep: { orchestrator: { artifactKind: "execution_plan" } },
  });
  deepStrictEqual(resolved, [{ stepId: "orchestrator", artifactKind: "execution_plan", artifactId: "art-arbitrary-identity" }]);
  const rewound = await rewindWorkflow(store, definition, {
    workflowId: "wf-contract", targetStepId: "research", reason: "test",
    requiredArtifactsByStep: { orchestrator: { artifactKind: "execution_plan", artifactId: "art-arbitrary-identity" } },
  });
  strictEqual(rewound.ready[0], "research");
  strictEqual(store.writes.workflow, 1);
});

test("B: wrong artifact kind fails closed", async () => {
  await rejects(resolveRecoveryArtifacts(persistence([artifact({ kind: "research_report" })]), definition, {
    workflowId: "wf-contract", targetStepId: "research",
    requiredArtifactsByStep: { orchestrator: { artifactKind: "execution_plan" } },
  }), /RECOVERY_ARTIFACT_INVARIANT_FAILED:orchestrator:execution_plan/);
});

test("C: raw artifact ID string cannot be confused with an artifact kind", async () => {
  await rejects(resolveRecoveryArtifacts(persistence(), definition, {
    workflowId: "wf-contract", targetStepId: "research",
    requiredArtifactsByStep: { orchestrator: "art-wf-orchestrator-identity" },
  }), /RECOVERY_ARTIFACT_CONTRACT_INVALID:orchestrator/);
});

test("D: missing required artifact fails before rewind writes", async () => {
  const store = persistence([]);
  await rejects(rewindWorkflow(store, definition, {
    workflowId: "wf-contract", targetStepId: "research", reason: "test",
    requiredArtifactsByStep: { orchestrator: { artifactKind: "execution_plan" } },
  }), /RECOVERY_ARTIFACT_INVARIANT_FAILED/);
  deepStrictEqual(store.writes, { workflow: 0, checkpoint: 0 });
});

test("E: artifact from a different workflow fails lineage validation", async () => {
  await rejects(resolveRecoveryArtifacts(persistence([artifact({ workflowId: "wf-other" })]), definition, {
    workflowId: "wf-contract", targetStepId: "research",
    requiredArtifactsByStep: { orchestrator: { artifactKind: "execution_plan" } },
  }), /RECOVERY_ARTIFACT_INVARIANT_FAILED/);
});

test("explicit artifact ID mismatch fails closed even when kind matches", async () => {
  await rejects(resolveRecoveryArtifacts(persistence(), definition, {
    workflowId: "wf-contract", targetStepId: "research",
    requiredArtifactsByStep: { orchestrator: { artifactKind: "execution_plan", artifactId: "art-wrong" } },
  }), /RECOVERY_ARTIFACT_INVARIANT_FAILED/);
});
