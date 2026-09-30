/**
 * Provider failure-mode validation for the Research -> web.search -> Brave path.
 *
 * Verifies that NO provider failure ever becomes a successful research artifact.
 * Drives the exact production step (ProductionAgentExecutor.executeAgentStep for
 * the research agent) WITHOUT a database: every failure scenario must yield a
 * capability execution with status != "success" and a BLOCKED research artifact.
 *
 * Opt-in only. Run:
 *   RUN_REAL_PROVIDER_TESTS=true node e2e/provider-failures.mjs
 *
 * It is NOT part of `npm test` (lives outside test/ and self-guards). Only the
 * missing-key, network and invalid-key scenarios touch the real Brave endpoint
 * (network tolerance: even an offline environment still fails -> blocked).
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createProductionAgentExecutor } from "../dist/index.js";

const optIn = process.env.RUN_REAL_PROVIDER_TESTS === "true";
if (!optIn) {
  console.log("provider-failures: SKIPPED (set RUN_REAL_PROVIDER_TESTS=true to enable)");
  process.exit(0);
}

const results = [];
const defaults = Object.fromEntries(
  [
    "SEARCH_PROVIDER",
    "SEARCH_API", "SEARCH_API_TAVILY", "TAVILY_API_KEY",
    "SEARCH_API_SERPER", "SERPER_API_KEY",
    "SEARCH_API_EXA", "EXA_API_KEY",
    "SEARCH_API_BRAVE", "BRAVE_SEARCH_API_KEY", "BRAVE_API_KEY",
    "BRAVE_BASE_URL", "TAVILY_BASE_URL", "SERPER_BASE_URL", "EXA_BASE_URL",
    "WEB_SEARCH_TIMEOUT_MS", "WEB_SEARCH_MAX_RETRIES",
  ].map((k) => [k, process.env[k]]),
);

function withEnv(env) {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function runResearchStep(workflowSuffix) {
  const executor = createProductionAgentExecutor({});
  const step = { id: "research", kind: "agent", agent: "research", emits: "research" };
  const context = {
    workflowId: `wf-failure-${workflowSuffix}`,
    correlationId: `corr-failure-${workflowSuffix}`,
    brandId: null,
    outputs: {},
    data: {},
  };
  return executor.executeAgentStep(step, context);
}

async function startMock(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/res/v1/web/search` };
}

async function scenario(name, env, outcomeCheck) {
  withEnv(defaults), withEnv(env);
  try {
    const outcome = await runResearchStep(name.replace(/\W+/g, "-"));
    const artifact = outcome.artifact;
    const caps = Array.isArray(outcome.output?.capabilityExecutions) ? outcome.output.capabilityExecutions : [];
    const cap = caps[0];
    assert.equal(outcome.status, "completed", "step outcome envelope is 'completed'");
    assert.equal(artifact.status, "blocked", `${name}: research artifact MUST be blocked`);
    assert.equal(cap.capabilityId, "web.search", `${name}: capabilityId must be web.search`);
    assert.notEqual(cap.status, "success", `${name}: capability must not report success`);
    if (cap.evidence !== undefined) {
      assert.equal(cap.evidence.succeeded, false, `${name}: evidence must not be succeeded`);
    }
    outcomeCheck?.(cap, artifact, outcome);
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: String(error?.message ?? error) });
    console.error(`FAIL ${name}: ${error?.message ?? error}`);
  } finally {
    withEnv(defaults);
  }
}

// 1. Missing credential -> no search provider configured -> blocked.
await scenario("missing-key", {
  SEARCH_API: undefined, SEARCH_API_TAVILY: undefined, TAVILY_API_KEY: undefined,
  SEARCH_API_SERPER: undefined, SERPER_API_KEY: undefined,
  SEARCH_API_EXA: undefined, EXA_API_KEY: undefined,
  SEARCH_API_BRAVE: undefined, BRAVE_SEARCH_API_KEY: undefined, BRAVE_API_KEY: undefined,
  BRAVE_BASE_URL: undefined, TAVILY_BASE_URL: undefined, SERPER_BASE_URL: undefined, EXA_BASE_URL: undefined,
  SEARCH_PROVIDER: undefined,
});

// 2. Invalid API key -> real Brave rejects (401) -> failed -> blocked.
await scenario("invalid-key", {
  SEARCH_PROVIDER: "brave-search",
  SEARCH_API: undefined, SEARCH_API_TAVILY: undefined, TAVILY_API_KEY: undefined,
  SEARCH_API_SERPER: undefined, SERPER_API_KEY: undefined,
  SEARCH_API_EXA: undefined, EXA_API_KEY: undefined,
  SEARCH_API_BRAVE: "sk-invalid-e2e-key", BRAVE_SEARCH_API_KEY: "sk-invalid-e2e-key",
  BRAVE_BASE_URL: undefined,
});

// 3. Network-level failure (unreachable endpoint) -> failed -> blocked.
await scenario("network-error", {
  SEARCH_PROVIDER: "brave-search",
  SEARCH_API: undefined, SEARCH_API_TAVILY: undefined, TAVILY_API_KEY: undefined,
  SEARCH_API_SERPER: undefined, SERPER_API_KEY: undefined,
  SEARCH_API_EXA: undefined, EXA_API_KEY: undefined,
  SEARCH_API_BRAVE: "sk-e2e", BRAVE_SEARCH_API_KEY: "sk-e2e",
  BRAVE_BASE_URL: "http://127.0.0.1:9/res/v1/web/search", WEB_SEARCH_MAX_RETRIES: "0",
});

// 4. Provider 429 -> failed -> blocked.
{
  const mock = await startMock((req, res) => {
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "rate limited" }));
  });
  await scenario("provider-429", {
    SEARCH_PROVIDER: "brave-search",
    SEARCH_API: undefined, SEARCH_API_TAVILY: undefined, TAVILY_API_KEY: undefined,
    SEARCH_API_SERPER: undefined, SERPER_API_KEY: undefined,
    SEARCH_API_EXA: undefined, EXA_API_KEY: undefined,
    SEARCH_API_BRAVE: "sk-e2e", BRAVE_SEARCH_API_KEY: "sk-e2e",
    BRAVE_BASE_URL: mock.url,
    WEB_SEARCH_MAX_RETRIES: "0",
    WEB_SEARCH_TIMEOUT_MS: "2000",
  }, (cap) => {
    assert.match(cap.error?.message ?? "", /429|rate limited/i);
  });
  await new Promise((r) => mock.server.close(r));
}

// 5. Provider 5xx -> failed -> blocked.
{
  const mock = await startMock((req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "boom" } }));
  });
  await scenario("provider-500", {
    SEARCH_PROVIDER: "brave-search",
    SEARCH_API: undefined, SEARCH_API_TAVILY: undefined, TAVILY_API_KEY: undefined,
    SEARCH_API_SERPER: undefined, SERPER_API_KEY: undefined,
    SEARCH_API_EXA: undefined, EXA_API_KEY: undefined,
    SEARCH_API_BRAVE: "sk-e2e", BRAVE_SEARCH_API_KEY: "sk-e2e",
    BRAVE_BASE_URL: mock.url,
    WEB_SEARCH_MAX_RETRIES: "0",
    WEB_SEARCH_TIMEOUT_MS: "2000",
  }, (cap) => {
    assert.match(cap.error?.message ?? "", /500|transient|boom/i);
  });
  await new Promise((r) => mock.server.close(r));
}

// 6. Timeout -> failed -> blocked.
{
  const mock = await startMock(async (req, res) => {
    await new Promise((r) => setTimeout(r, 1500));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ web: { results: [] } }));
  });
  await scenario("timeout", {
    SEARCH_PROVIDER: "brave-search",
    SEARCH_API: undefined, SEARCH_API_TAVILY: undefined, TAVILY_API_KEY: undefined,
    SEARCH_API_SERPER: undefined, SERPER_API_KEY: undefined,
    SEARCH_API_EXA: undefined, EXA_API_KEY: undefined,
    SEARCH_API_BRAVE: "sk-e2e", BRAVE_SEARCH_API_KEY: "sk-e2e",
    BRAVE_BASE_URL: mock.url,
    WEB_SEARCH_MAX_RETRIES: "0",
    WEB_SEARCH_TIMEOUT_MS: "250",
  }, (cap) => {
    assert.match(cap.error?.message ?? "", /timed out|timeout/i);
  });
  await new Promise((r) => mock.server.close(r));
}

// 7. Malformed response (non-JSON body) -> failed -> blocked.
{
  const mock = await startMock((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("this is not json");
  });
  await scenario("malformed-json", {
    SEARCH_PROVIDER: "brave-search",
    SEARCH_API: undefined, SEARCH_API_TAVILY: undefined, TAVILY_API_KEY: undefined,
    SEARCH_API_SERPER: undefined, SERPER_API_KEY: undefined,
    SEARCH_API_EXA: undefined, EXA_API_KEY: undefined,
    SEARCH_API_BRAVE: "sk-e2e", BRAVE_SEARCH_API_KEY: "sk-e2e",
    BRAVE_BASE_URL: mock.url,
    WEB_SEARCH_MAX_RETRIES: "0",
    WEB_SEARCH_TIMEOUT_MS: "2000",
  });
  await new Promise((r) => mock.server.close(r));
}

// 8. Malformed response (wrong shape) -> failed -> blocked.
{
  const mock = await startMock((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ web: { results: "not-an-array" } }));
  });
  await scenario("malformed-shape", {
    SEARCH_PROVIDER: "brave-search",
    SEARCH_API: undefined, SEARCH_API_TAVILY: undefined, TAVILY_API_KEY: undefined,
    SEARCH_API_SERPER: undefined, SERPER_API_KEY: undefined,
    SEARCH_API_EXA: undefined, EXA_API_KEY: undefined,
    SEARCH_API_BRAVE: "sk-e2e", BRAVE_SEARCH_API_KEY: "sk-e2e",
    BRAVE_BASE_URL: mock.url,
    WEB_SEARCH_MAX_RETRIES: "0",
    WEB_SEARCH_TIMEOUT_MS: "2000",
  });
  await new Promise((r) => mock.server.close(r));
}

const failed = results.filter((r) => !r.ok);
console.log(`\nprovider-failures: ${results.length - failed.length}/${results.length} scenarios passed`);
if (failed.length > 0) {
  failed.forEach((r) => console.error(`  FAILED: ${r.name} -- ${r.error}`));
  process.exit(1);
}
console.log("provider-failures: OK — no provider failure becomes a successful artifact");