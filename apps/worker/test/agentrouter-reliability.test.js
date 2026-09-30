import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAgentRouterTimeoutMs } from "../dist/production-executor.js";

test("AgentRouter uses a bounded whole-response timeout suitable for observed glm-5.3 completions", () => {
  assert.equal(resolveAgentRouterTimeoutMs(undefined), 180_000);
  assert.equal(resolveAgentRouterTimeoutMs("240000"), 240_000);
  assert.equal(resolveAgentRouterTimeoutMs("999"), 180_000);
  assert.equal(resolveAgentRouterTimeoutMs("300001"), 180_000);
  assert.equal(resolveAgentRouterTimeoutMs("not-a-number"), 180_000);
});
