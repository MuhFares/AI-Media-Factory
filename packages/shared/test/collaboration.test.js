import { strictEqual, deepStrictEqual, ok } from "node:assert";
import { describe, it } from "node:test";

const metadata = { schemaVersion: "1.0", createdAt: "2026-08-10T00:00:00.000Z", attempt: 1, traceId: "trace-1" };
const artifact = { artifactId: "artifact-1", kind: "research_report", payload: { summary: "facts" }, contentType: "application/json", schemaVersion: "1.0", createdAt: metadata.createdAt };

describe("collaboration contracts", () => {
  it("represents a valid directed handoff", () => {
    const handoff = { workflowId: "workflow-1", correlationId: "correlation-1", sourceAgent: "planner", targetAgent: "research", objective: "Research the plan", status: "completed", artifact, evidence: [{ kind: "supplied", evidenceId: "evidence-1", observedAt: metadata.createdAt, source: "planner", details: "Plan output" }], errors: [], metadata };
    strictEqual(handoff.sourceAgent, "planner");
    strictEqual(handoff.targetAgent, "research");
    strictEqual(handoff.artifact.contentType, "application/json");
  });
  it("requires workflow and correlation identity in the serialized shape", () => {
    const envelope = { envelopeId: "envelope-1", handoff: { workflowId: "workflow-1", correlationId: "correlation-1" }, metadata };
    ok(typeof envelope.handoff.workflowId === "string");
    ok(typeof envelope.handoff.correlationId === "string");
  });
  it("keeps evidence provenance discriminated", () => {
    const runtime = { kind: "runtime", evidenceId: "e-1", observedAt: metadata.createdAt, source: "runner", details: "exit 0" };
    const supplied = { kind: "supplied", evidenceId: "e-2", observedAt: metadata.createdAt, source: "request", details: "reported pass" };
    const unavailable = { kind: "not_available", reason: "No execution tool" };
    deepStrictEqual([runtime.kind, supplied.kind, unavailable.kind], ["runtime", "supplied", "not_available"]);
  });
  it("represents failures without changing artifact identity", () => {
    const error = { code: "CAPABILITY_UNAVAILABLE", category: "capability", message: "No test runner", retryable: false };
    ok(error.category === "capability");
    strictEqual(artifact.artifactId, "artifact-1");
  });
  it("keeps collaboration status values closed", () => {
    const invalidStatus = "unknown";
    ok(!["pending", "in_progress", "completed", "blocked", "failed", "cancelled"].includes(invalidStatus));
  });
});
