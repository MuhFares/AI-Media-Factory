import { strictEqual, ok } from "node:assert";
import { it } from "node:test";
import { createDocumentationAgent } from "../dist/index.js";

it("executes through the injected runtime and respects capability boundaries", async () => {
  const output = { resultId: "00000000-0000-4000-8000-000000000002", requestId: "00000000-0000-4000-8000-000000000001", objective: "Document API", documentationType: "api", status: "generated", summary: "Proposed documentation", artifact: { title: "API", documentationType: "api", content: "Content", sections: [{ title: "Overview", content: "Content", order: 0 }], generatedOnly: true }, issues: [], recommendations: [], metadata: { createdAt: "2026-08-10T00:00:00.000Z", agentVersion: "1.0.0", persistence: "not_written" } };
  let called = false;
  const agent = createDocumentationAgent({ execute: async (_context, request) => { called = true; ok(request.responseSchema); return { output, raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }; }, config: {} });
  const result = await agent.execute({ context: {}, input: { requestId: output.requestId, objective: output.objective, request: { type: "api", purpose: "Explain API", audience: "Developers", requiredSections: ["Overview"] } } }, { throwIfCancelled() {} });
  strictEqual(called, true);
  strictEqual(result.output.status, "generated");
  strictEqual(result.output.artifact.generatedOnly, true);
});
