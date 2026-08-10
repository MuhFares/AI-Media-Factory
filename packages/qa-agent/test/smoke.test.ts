import { strictEqual, ok } from "node:assert";
import { it } from "node:test";
import { createQAAgent } from "../dist/index.js";

it("executes through the injected runtime without fabricating test execution", async () => {
  const output = { reportId: "00000000-0000-4000-8000-000000000002", requestId: "00000000-0000-4000-8000-000000000001", objective: "Validate API", status: "reviewed", summary: "Supplied result reviewed", testResults: [{ testName: "API smoke", status: "passed", executed: false, source: "provided-result", evidence: "Requester supplied CI output" }], findings: [], risks: [], recommendations: [], metadata: { createdAt: "2026-08-10T00:00:00.000Z", agentVersion: "1.0.0", executionEvidencePresent: false } };
  let called = false;
  const agent = createQAAgent({ execute: async (_context, request) => { called = true; ok(request.responseSchema); return { output, raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }; }, config: {} });
  const result = await agent.execute({ context: {}, input: { requestId: output.requestId, objective: output.objective, request: { scope: "api", requirements: ["works"], expectedTests: ["API smoke"] } } }, { throwIfCancelled() {} });
  strictEqual(called, true);
  strictEqual(result.output.status, "reviewed");
  strictEqual(result.output.testResults[0].executed, false);
});
