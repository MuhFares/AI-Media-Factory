import test from "node:test";
import assert from "node:assert/strict";
import { GovernedAgentRuntime } from "../dist/governed-agent-runtime.js";
import { executeGovernedVisibleJson } from "../dist/production-executor.js";

const config = { provider: "agentrouter", model: "gpt-5.6-sol", source: "AGENT" };
const research = () => ({ concept: "A real historical turning point", historicalAngle: "Documented context", evidenceConsiderations: ["Primary source"], sourceability: "High", risks: ["Avoid overclaiming"], recommendation: "Test it" });
const planner = () => ({ hook: "A decisive moment", shortFormStructure: ["Hook", "Context", "Payoff"], audienceAppeal: "Immediate stakes", pilotFit: "Strong", risks: ["Keep it concise"], recommendation: "Test it" });
const synthesis = () => ({ agreements: ["Test it"], disagreements: [], evidence: ["Validated research"], recommendation: "Run a pilot", confidence: 0.7, missingEvidence: ["Retention"], nextAction: "Produce one short" });
function persistence() { const artifacts = []; const provenance = []; return { artifacts, provenance, saveArtifact: async (artifact) => artifacts.push(artifact), listArtifacts: async (workflowId) => artifacts.filter((artifact) => artifact.workflowId === workflowId), saveExecutionProvenance: async (record) => provenance.push(record) }; }
function response(output, request) { return { output, raw: JSON.stringify(output), provider: "agentrouter-openai", model: request.model, usage: { inputTokens: 1, outputTokens: 2, costUsd: 0 }, latencyMs: 1 }; }

test("governed runtime independently persists strictly validated selected agents and synthesis", async () => {
  const store = persistence(); let calls = 0;
  const runtime = new GovernedAgentRuntime(store, async (request) => { calls++; return response(request.agentId === "research" ? research() : request.agentId === "planner" ? planner() : synthesis(), request); });
  const group = await runtime.executeGovernedAgentGroup(["research", "planner"].map((agentId) => ({ workflowId: "wf-command", projectId: "Morroway", agentId, prompt: "one idea", config })));
  assert.ok(group.results.every((item) => item.status === "COMPLETED"));
  const ceo = await runtime.synthesizeAgentOutputs({ workflowId: "wf-command", projectId: "Morroway", prompt: "one idea", results: group.results, config });
  assert.equal(ceo.status, "COMPLETED"); assert.equal(store.artifacts.length, 3); assert.equal(store.provenance.length, 3); assert.equal(calls, 3);
});

test("strict Research types reject object substitution and persist no canonical artifact", async () => {
  const store = persistence(); const runtime = new GovernedAgentRuntime(store, async (request) => response({ ...research(), concept: { title: "not a string" } }, request));
  const result = await runtime.executeGovernedAgent({ workflowId: "wf-invalid-research", projectId: "Morroway", agentId: "research", prompt: "one idea", config });
  assert.equal(result.status, "FAILED"); assert.match(result.error, /COMMAND_ROLE_CONTRACT_TYPE_INVALID:research/); assert.equal(store.artifacts.length, 0); assert.equal(result.output, null);
});

test("strict Research arrays reject non-string values and cannot feed synthesis", async () => {
  const store = persistence(); const runtime = new GovernedAgentRuntime(store, async (request) => response({ ...research(), sourceability: { rating: "high" }, evidenceConsiderations: ["source", 4], risks: ["risk", {}] }, request));
  const invalid = await runtime.executeGovernedAgent({ workflowId: "wf-invalid-arrays", projectId: "Morroway", agentId: "research", prompt: "one idea", config });
  assert.equal(invalid.status, "FAILED"); assert.equal(store.artifacts.length, 0);
  const ceo = await runtime.synthesizeAgentOutputs({ workflowId: "wf-invalid-arrays", projectId: "Morroway", prompt: "one idea", results: [invalid], config });
  assert.equal(ceo.status, "BLOCKED"); assert.equal(ceo.error, "NO_VALIDATED_AGENT_OUTPUTS");
});

test("strict Planner and synthesis types reject object and scalar substitutions", async () => {
  const store = persistence(); const runtime = new GovernedAgentRuntime(store, async (request) => response(request.agentId === "planner" ? { ...planner(), hook: { text: "not string" }, shortFormStructure: "not array" } : { ...synthesis(), confidence: "high" }, request));
  const badPlanner = await runtime.executeGovernedAgent({ workflowId: "wf-invalid-planner", projectId: "Morroway", agentId: "planner", prompt: "one idea", config });
  assert.equal(badPlanner.status, "FAILED"); assert.equal(store.artifacts.length, 0);
  const badCeo = await runtime.executeGovernedAgent({ workflowId: "wf-invalid-ceo", projectId: "Morroway", agentId: "ceo", prompt: "one idea", config });
  assert.equal(badCeo.status, "FAILED"); assert.equal(store.artifacts.length, 0);
});

test("incomplete and Morroway-grounding failures remain non-canonical", async () => {
  const incompleteStore = persistence(); const incomplete = new GovernedAgentRuntime(incompleteStore, async () => { throw new Error("OpenRouter model incomplete response (length)"); });
  const incompleteResult = await incomplete.executeGovernedAgent({ workflowId: "wf-incomplete", projectId: "Morroway", agentId: "research", prompt: "one idea", config });
  assert.equal(incompleteResult.status, "FAILED"); assert.equal(incompleteStore.artifacts.length, 0);
  const groundingStore = persistence(); const grounding = new GovernedAgentRuntime(groundingStore, async (request) => response({ ...research(), concept: "A Dwemer gameplay story" }, request));
  const groundingResult = await grounding.executeGovernedAgent({ workflowId: "wf-grounding", projectId: "Morroway", agentId: "research", prompt: "Give a historical POV idea", context: { projectId: "morroway", brand: "Morroway", contentPillars: ["real-world historical", "fantasy"], prohibitions: ["Morrowind", "Elder Scrolls", "game"] }, config });
  assert.equal(groundingResult.status, "FAILED"); assert.equal(groundingStore.artifacts.length, 0);
});

test("valid strict Research output preserves ASK-style single-agent completion", async () => {
  const store = persistence(); const runtime = new GovernedAgentRuntime(store, async (request) => response(research(), request));
  const result = await runtime.executeGovernedAgent({ workflowId: "wf-ask", projectId: "Morroway", agentId: "research", prompt: "one idea", config });
  assert.equal(result.status, "COMPLETED"); assert.equal(store.artifacts.length, 1); assert.equal(store.provenance.length, 1);
});

test("multi-agent execution is serial, forwards reasoning to every role, and records it", async () => {
  const store = persistence(); const seen = [];
  const runtime = new GovernedAgentRuntime(store, async (request) => {
    seen.push(request);
    return response(request.agentId === "research" ? research() : request.agentId === "planner" ? planner() : synthesis(), request);
  });
  const group = await runtime.executeGovernedAgentGroup(["research", "planner"].map((agentId) => ({ workflowId: "wf-reasoning", projectId: "Morroway", agentId, prompt: "one idea", config, outputBudget: 1000, reasoning: { effort: "none" } })));
  const ceo = await runtime.synthesizeAgentOutputs({ workflowId: "wf-reasoning", projectId: "Morroway", prompt: "one idea", results: group.results, config, reasoning: { effort: "none" } });
  assert.equal(ceo.status, "COMPLETED");
  assert.deepEqual(seen.map((request) => request.agentId), ["research", "planner", "ceo"]);
  assert.ok(seen.every((request) => request.reasoning?.effort === "none"));
  assert.ok(seen.filter((request) => request.agentId !== "ceo").every((request) => request.maxOutputTokens === 1000));
  const { ceoSynthesisBudget } = await import("../dist/research-contracts.js");
  assert.equal(seen.find((request) => request.agentId === "ceo").maxOutputTokens, ceoSynthesisBudget(), "synthesis budget is ceiling-derived, not flat");
  assert.ok(store.provenance.every((record) => record.configuration.reasoningEffort === "none"));
});

test("provider failure diagnostics survive incomplete-response rejection", async () => {
  const store = persistence();
  const runtime = new GovernedAgentRuntime(store, async () => {
    const error = new Error("OpenRouter incomplete response (length)");
    error.diagnostics = { finishReason: "length", reasoningEffort: "none", maxTokens: 1000, responseFormat: "json_object", visibleContentBytes: 847 };
    throw error;
  });
  const result = await runtime.executeGovernedAgent({ workflowId: "wf-diagnostics", projectId: "Morroway", agentId: "planner", prompt: "one idea", config, outputBudget: 1000, reasoning: { effort: "none" } });
  assert.equal(result.status, "FAILED"); assert.equal(store.artifacts.length, 0);
  assert.equal(store.provenance[0].configuration.providerDiagnostics.finishReason, "length");
  assert.equal(store.provenance[0].configuration.providerDiagnostics.reasoningEffort, "none");
  assert.equal(store.provenance[0].configuration.providerDiagnostics.maxTokens, 1000);
  assert.equal(store.provenance[0].configuration.providerDiagnostics.responseFormat, "json_object");
});

test("OpenRouter governed request visibly carries the fixed model, JSON mode, 1000 tokens, and reasoning none", async () => {
  const originalFetch = global.fetch; const originalKey = process.env.OPENROUTER_API_KEY; const originalBase = process.env.OPENROUTER_BASE_URL;
  let body;
  process.env.OPENROUTER_API_KEY = "test-key"; process.env.OPENROUTER_BASE_URL = "https://mock.invalid/v1";
  global.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    const event = `data: ${JSON.stringify({ id: "gen-test", model: "nex-agi/nex-n2.5-pro:free", choices: [{ delta: { content: JSON.stringify(research()) }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 2, cost: 0 } })}\n\ndata: [DONE]\n\n`;
    return new Response(event, { status: 200 });
  };
  try {
    const result = await executeGovernedVisibleJson({ agentId: "research", workflowId: "wf-provider-visible", provider: "openrouter", model: "nex-agi/nex-n2.5-pro:free", system: "contract", prompt: "prompt", maxOutputTokens: 1000, reasoning: { effort: "none" } });
    assert.deepEqual(result.output, research());
    assert.equal(body.model, "nex-agi/nex-n2.5-pro:free"); assert.equal(body.max_tokens, 1000);
    assert.deepEqual(body.reasoning, { effort: "none" }); assert.deepEqual(body.response_format, { type: "json_object" });
    assert.equal(result.providerResponseDiagnostics.reasoningEffort, "none");
  } finally { global.fetch = originalFetch; process.env.OPENROUTER_API_KEY = originalKey; process.env.OPENROUTER_BASE_URL = originalBase; }
});
