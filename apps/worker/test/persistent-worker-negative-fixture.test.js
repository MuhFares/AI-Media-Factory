/**
 * Already-queued engineering-sandbox negative fixture (DB-free, zero-network).
 *
 * Provider-free proves: when a media resume is already queued and the worker
 * process carries the explicit CODEX_SANDBOX_NETWORK_DISABLED restriction,
 * the canonical production executor stops BEFORE provider-budget consumption,
 * BEFORE provider invocation, and BEFORE artifact creation.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createProductionAgentExecutor } from "../dist/index.js";

function restrictedBoundary() {
  return {
    boundary: { execute: async () => { throw new Error("PROVIDER_MUST_NOT_BE_REACHED"); } },
    resolver: {},
    registeredCapabilityIds: ["tts.generate", "timeline.plan", "image.generate"],
    resolvedProviderIds: {},
    workerExecutionEnvironment: {
      status: "UNSUPPORTED",
      mediaLiveExecutionAllowed: false,
      reasonCode: "ENGINEERING_SANDBOX_NETWORK_DISABLED",
    },
  };
}

function mockBridge(calls) {
  const never = async (stage) => { calls.push(stage); throw new Error(`BRIDGE_MUST_NOT_RUN:${stage}`); };
  return {
    executeDirector: () => never("director"),
    executeTts: () => never("tts"),
    executeTimeline: () => never("timeline"),
    executeSceneImage: () => never("scene-image"),
    executeVisualSemanticReview: () => never("visual-semantic-review"),
    executeVisualTechnicalQa: () => never("visual-technical-qa"),
    executeWanAuthorization: () => never("wan-authorization"),
    executeVideo: () => never("video"),
    executeComposer: () => never("composer"),
  };
}

test("queued media execution in a restricted sandbox stops before budget, provider, and artifacts", async () => {
  const bridgeCalls = [];
  const budgetCalls = [];
  const persistence = { listArtifacts: async () => [] };
  const executor = createProductionAgentExecutor({
    persistence,
    providerBoundary: restrictedBoundary(),
    mediaChainBridge: mockBridge(bridgeCalls),
    mediaResumeBudget: {
      consumeProviderBudget: async (input) => { budgetCalls.push(input); },
    },
  });
  const context = {
    workflowId: "wf-op-negative-fixture",
    correlationId: "corr-op-negative-fixture",
    data: {
      mediaResumeExecution: {
        resumeId: "media-resume-fixture-r1",
        resumeAuthorization: "OWNER_APPROVED",
      },
    },
    outputs: {},
  };
  const outcome = await executor.executeAgentStep({ id: "tts", agent: "tts" }, context);
  assert.equal(outcome.status, "failed");
  assert.match(String(outcome.output?.error ?? outcome.error?.message ?? ""), /MEDIA_LIVE_EXECUTION_ENVIRONMENT_UNSUPPORTED:ENGINEERING_SANDBOX_NETWORK_DISABLED/);
  assert.equal(budgetCalls.length, 0, "no provider-budget consumption");
  assert.equal(bridgeCalls.length, 0, "no provider invocation and no artifact creation");
  assert.equal(outcome.artifact, undefined, "no artifact produced");
});
