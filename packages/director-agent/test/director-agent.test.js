import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DirectorAgent } from "../dist/director-agent.js";

function agentWith(result) {
  return new DirectorAgent({
    execute: async () => { throw new Error("LLM not used"); },
    capabilityExecution: { executeCapability: async () => result },
    config: { model: "deterministic", systemPrompt: "test" },
  });
}
const success = {
  status: "success", resultId: "timeline-plan-result-timeline-plan-req1", capabilityId: "timeline.plan",
  output: { timelineId: "timeline-abc123", status: "completed", narrationDurationMs: 12640, plannedVisualDurationMs: 12640, coverageRatio: 1.0, sceneCount: 3, characters: [], scenes: [], warnings: [], generationSummary: { imageCount: 3, videoClipCount: 3, estimatedGeneratedVideoDurationMs: 15000 }, timingSource: "estimated_from_total_duration" },
  evidence: { evidenceId: "evidence-timeline-plan-result-timeline-plan-req1", capabilityId: "timeline.plan", agentId: "director", succeeded: true, providerId: "deterministic-v1", providerInvoked: true, workflowId: "wf1", correlationId: "corr1" },
};

describe("DirectorAgent", () => {
  it("succeeds with matching evidence", async () => {
    const a = agentWith(success);
    const out = await a.execute({ input: { requestId: "req1", objective: "plan", script: "مرحبا", narrationDurationMs: 3000, workflowId: "wf1", correlationId: "corr1" } }, { throwIfCancelled() {}, isCancelled: false });
    assert.equal(out.output.status, "completed");
    assert.equal(out.output.timelineId, "timeline-abc123");
    assert.equal(out.output.executionEvidencePresent, true);
  });
  it("blocks when capability blocked", async () => {
    const blocked = { status: "blocked", resultId: "r1", capabilityId: "timeline.plan", reason: "script must not be empty" };
    const a = agentWith(blocked);
    const out = await a.execute({ input: { requestId: "req1", objective: "plan", script: "مرحبا", narrationDurationMs: 3000, workflowId: "wf1", correlationId: "corr1" } }, { throwIfCancelled() {}, isCancelled: false });
    assert.equal(out.output.status, "blocked");
  });
  it("does not convert failure to success", async () => {
    const failed = { status: "failed", resultId: "r1", capabilityId: "timeline.plan", error: { code: "INVALID_PLAN", message: "coverage", retryable: false }, evidence: { evidenceId: "e1", capabilityId: "timeline.plan", agentId: "director", succeeded: false } };
    const a = agentWith(failed);
    const out = await a.execute({ input: { requestId: "req1", objective: "plan", script: "مرحبا", narrationDurationMs: 3000, workflowId: "wf1", correlationId: "corr1" } }, { throwIfCancelled() {}, isCancelled: false });
    assert.equal(out.output.status, "blocked");
  });
  it("throws on malformed input", async () => {
    const a = agentWith(success);
    await assert.rejects(() => a.execute({ input: { requestId: "req1", objective: "plan", script: "", narrationDurationMs: 0 } }, { throwIfCancelled() {}, isCancelled: false }), /Invalid director input/);
  });
  it("never invokes capability for malformed throw", async () => {
    let invoked = false;
    const cap = { execute: async () => { invoked = true; return success; }, executeCapability: async () => { invoked = true; return success; } };
    const a = new DirectorAgent({ execute: async () => { throw new Error("x"); }, capabilityExecution: { executeCapability: async () => { invoked = true; return success; } }, config: { model: "deterministic", systemPrompt: "test" } });
    try { await a.execute({ input: { video: "x" } }, { throwIfCancelled() {}, isCancelled: false }); } catch { /* expected */ }
    assert.equal(invoked, false);
  });
});
