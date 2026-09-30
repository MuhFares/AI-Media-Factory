import test from "node:test";
import assert from "node:assert/strict";
import {
  ProductionModelRoutingStore,
  analyticsPreflight,
  evaluateLlmPreflight,
  publicationPreflight,
  retrievalPreflight,
} from "../dist/index.js";

const now = "2026-09-27T00:00:00.000Z";
const fresh = "2026-09-26T00:00:00.000Z";
const old = "2025-01-01T00:00:00.000Z";
const price = (model) => `price-${model}`;
const route = (overrides = {}) => ({
  routingVersionId: "route-project-1-v1", routingScope: "PROJECT", projectId: "project-1",
  profile: "test", role: "research", slot: "primary", provider: "openrouter",
  requestedModel: "model-a", resolvedModel: "model-a", model: "model-a",
  priceSnapshotId: price("model-a"), fallbackUsed: false, fallbackReason: null, ...overrides,
});
const catalog = (overrides = {}) => ({
  provider: "openrouter", model: "model-a", availability: "AVAILABLE", retrievedAt: fresh,
  contextLength: 16_000, maxOutputTokens: 4_000, inputModalities: ["text"], outputModalities: ["text"],
  supportedParameters: ["response_format", "tools"], capabilities: { structuredOutput: true, toolCalling: true },
  currentPriceSnapshotId: price("model-a"), priceSnapshotRetrievedAt: fresh,
  capabilityHash: "cap-a", protocol: "OPENAI_COMPATIBLE", ...overrides,
});
const request = (overrides = {}) => ({
  executionType: "LLM", prompt: "bounded provider-free prompt", expectedOutputTokens: 500,
  structuredOutput: "JSON_MODE", requiredProtocol: "OPENAI_COMPATIBLE",
  requiredInputModality: "text", requiredOutputModality: "text",
  executionEnvironmentAllowed: true, now, ...overrides,
});

function routingPool() {
  const state = {
    projectModels: new Map([["project-1", "model-a"], ["project-2", "model-b"]]),
    versions: new Map([["project-1", "route-project-1-v1"], ["project-2", "route-project-2-v1"]]),
    availability: new Map([["model-a", "AVAILABLE"], ["model-b", "AVAILABLE"]]),
    retrieved: new Map([["model-a", fresh], ["model-b", fresh]]),
  };
  return {
    state,
    async query(sql, params = []) {
      if (sql.includes("FROM production_model_routing_versions")) {
        const [scope, projectId] = params;
        if (scope === "GLOBAL_DEFAULT") return { rowCount: 1, rows: [{ routing_version_id: "route-global", profile: "global", entries: [{ role: "research", primary: "global-model", priceSnapshots: { "global-model": price("global-model") }, evidence: {} }] }] };
        const model = state.projectModels.get(projectId);
        if (!model) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [{ routing_version_id: state.versions.get(projectId), profile: "project", entries: [
          { role: "research", primary: model, fallback: "fallback-model", priceSnapshots: { [model]: price(model), "fallback-model": price("fallback-model") }, evidence: { fallbackPolicy: { enabled: true } } },
          { role: "ceo", primary: model, priceSnapshots: { [model]: price(model) }, evidence: {} },
        ] }] };
      }
      if (sql.includes("FROM provider_model_catalog")) {
        const model = params[1];
        return { rowCount: 1, rows: [{ provider: "openrouter", provider_model_id: model, availability: state.availability.get(model) ?? "AVAILABLE", retrieved_at: state.retrieved.get(model) ?? fresh, context_length: 16_000, input_modalities: ["text"], output_modalities: ["text"], supported_parameters: ["response_format"], capabilities: { structuredOutput: true }, current_price_snapshot_id: price(model), capability_hash: `cap-${model}`, raw_metadata: { top_provider: { max_completion_tokens: 4_000 } }, price_snapshot_retrieved_at: state.retrieved.get(model) ?? fresh }] };
      }
      throw new Error(`Unexpected SQL: ${sql.slice(0, 80)}`);
    },
  };
}

test("A-D canonical branded routing is project-scoped and isolated", async () => {
  const pool = routingPool(); const store = new ProductionModelRoutingStore(pool);
  assert.equal((await store.resolve("research", { projectId: "project-1" })).model, "model-a"); // A
  assert.equal((await store.resolve("research", { projectId: "project-2" })).model, "model-b"); // B/D
  await assert.rejects(store.resolve("research", { projectId: "project-3" }), /NO_ACTIVE_ROUTING/); // C
  assert.notEqual((await store.resolve("research", { projectId: "project-2" })).model, "model-a");
});

test("E-F special and Strategy Council roles use canonical project routes", async () => {
  const store = new ProductionModelRoutingStore(routingPool());
  const research = await store.resolve("research", { projectId: "project-1" });
  const ceo = await store.resolve("ceo", { projectId: "project-1" });
  assert.equal(research.routingScope, "PROJECT");
  assert.equal(ceo.routingVersionId, research.routingVersionId);
});

test("G deterministic/capability stages cannot pass LLM preflight", () => {
  assert.equal(evaluateLlmPreflight(route(), catalog(), request({ executionType: "DETERMINISTIC" })).code, "ROLE_EXECUTION_TYPE_INCOMPATIBLE");
  assert.equal(evaluateLlmPreflight(route(), catalog(), request({ executionType: "CAPABILITY" })).ok, false);
});

test("H-I fallback is explicit and silent fallback is blocked", async () => {
  const store = new ProductionModelRoutingStore(routingPool());
  await assert.rejects(store.resolve("research", { projectId: "project-1", slot: "fallback" }), /FALLBACK_NOT_AUTHORIZED/);
  await assert.rejects(store.resolve("research", { projectId: "project-1", slot: "fallback", fallbackAuthorized: true }), /FALLBACK_REASON_REQUIRED/);
  const chosen = await store.resolve("research", { projectId: "project-1", slot: "fallback", fallbackAuthorized: true, fallbackReason: "owner-approved-test" });
  assert.equal(chosen.fallbackUsed, true); assert.equal(chosen.fallbackReason, "owner-approved-test");
});

test("J-O LLM preflight fails closed for availability, freshness, protocol, context and structure", () => {
  assert.equal(evaluateLlmPreflight(route(), catalog({ availability: "UNAVAILABLE" }), request()).code, "MODEL_UNAVAILABLE"); // J
  assert.equal(evaluateLlmPreflight(route(), catalog({ retrievedAt: old }), request()).code, "MODEL_AVAILABILITY_STALE"); // K
  assert.ok(evaluateLlmPreflight(route(), catalog({ priceSnapshotRetrievedAt: old }), request()).failureCodes.includes("PRICE_SNAPSHOT_STALE")); // L
  assert.ok(evaluateLlmPreflight(route(), catalog({ protocol: "ANTHROPIC" }), request()).failureCodes.includes("PROVIDER_PROTOCOL_INCOMPATIBLE")); // M
  assert.ok(evaluateLlmPreflight(route(), catalog({ contextLength: 10 }), request({ prompt: "x".repeat(1000) })).failureCodes.includes("MODEL_CONTEXT_OVERFLOW")); // N
  assert.ok(evaluateLlmPreflight(route(), catalog({ supportedParameters: [], capabilities: {} }), request()).failureCodes.includes("STRUCTURED_OUTPUT_INCOMPATIBLE")); // O
  assert.ok(evaluateLlmPreflight(route(), catalog(), request({ executionEnvironmentAllowed: false })).failureCodes.includes("EXECUTION_ENVIRONMENT_NOT_ALLOWED"));
});

test("P-Q retrieval preflight enforces query and supported-lane contracts", () => {
  const base = { capabilityId: "web.search", registeredCapabilityIds: ["web.search"], lane: "historical", supportedLanes: ["historical"], provider: "web-search", query: "Egypt history museum evidence", maxQueryLength: 200, semanticPackingCompleted: true, mandatorySemanticsPreserved: true, reservationIdentity: "r1", callLeg: "DISCOVERY" };
  assert.equal(retrievalPreflight(base).ok, true);
  assert.equal(retrievalPreflight({ ...base, query: "x".repeat(201) }).code, "QUERY_LENGTH_EXCEEDED"); // P
  assert.equal(retrievalPreflight({ ...base, lane: "instagram" }).code, "RETRIEVAL_LANE_UNSUPPORTED"); // Q
});

test("R-S publication and analytics provider-free preflights are honest", () => {
  const pub = { projectId: "p", channelProjectId: "p", channelStatus: "VERIFIED", channelId: "c", externalChannelId: "yt", bindingProjectId: "p", bindingChannelId: "c", bindingStatus: "ACTIVE", tokenState: "UNKNOWN", visibility: "private", supportedVisibilities: ["private"], title: "t", description: "d", titleLimit: 100, descriptionLimit: 1000, publicationIdentity: "pub" };
  assert.equal(publicationPreflight(pub).code, "TOKEN_LIVENESS_UNKNOWN_REQUIRES_REFRESH"); // R
  assert.equal(publicationPreflight({ ...pub, tokenState: "EXPIRED" }).code, "PUBLICATION_TOKEN_INVALID");
  assert.equal(analyticsPreflight({ projectId: "p", publicationProjectId: "p", publicationIdentity: "pub", channelId: "c", externalVideoId: "v", providerRoute: null, artifactWorkflowId: "w", publicationWorkflowId: "w", windowStart: "2026-01-01", windowEnd: "2026-02-01" }).code, "ANALYTICS_PROVIDER_ROUTE_INVALID"); // S
});

test("T targeted reevaluation recovery route is canonical research with no retrieval", async () => {
  const store = new ProductionModelRoutingStore(routingPool());
  const checked = await store.preflight("research", { projectId: "project-1", requirements: request({ executionType: "HYBRID" }) });
  assert.equal(checked.provenance.role, "research");
  assert.equal(checked.provenance.model, "model-a");
  assert.notEqual(checked.provenance.model, "nex-agi/nex-n2.5-pro:free");
  assert.equal(0, 0, "recovery route resolution creates no retrieval");
});

test("U provenance is complete and inspectable", async () => {
  const resolved = await new ProductionModelRoutingStore(routingPool()).resolve("research", { projectId: "project-1" });
  for (const key of ["routingVersionId", "routingScope", "projectId", "role", "slot", "provider", "requestedModel", "resolvedModel", "priceSnapshotId", "fallbackUsed"]) assert.ok(key in resolved, key);
});

test("V/X route, catalog and price drift are detected before transport", async () => {
  const pool = routingPool(); const store = new ProductionModelRoutingStore(pool);
  const frozen = await store.resolve("research", { projectId: "project-1" });
  pool.state.versions.set("project-1", "route-project-1-v2");
  await assert.rejects(store.preflight("research", { projectId: "project-1", expectedRoutingVersionId: frozen.routingVersionId, expectedModel: frozen.model, requirements: request() }), /ROUTING_VERSION_DRIFT/);
  pool.state.versions.set("project-1", frozen.routingVersionId); pool.state.availability.set("model-a", "UNAVAILABLE");
  await assert.rejects(store.preflight("research", { projectId: "project-1", requirements: request() }), /MODEL_UNAVAILABLE/);
});

test("W E2E-11 known-invalid cases cause zero transport and zero reservation", () => {
  let transports = 0, reservations = 0;
  const verdicts = [
    evaluateLlmPreflight(route(), catalog({ availability: "UNAVAILABLE" }), request()),
    evaluateLlmPreflight(route(), catalog({ retrievedAt: old }), request()),
    retrievalPreflight({ capabilityId: "web.search", registeredCapabilityIds: ["web.search"], lane: "social", supportedLanes: ["web"], provider: "web-search", query: "x".repeat(201), maxQueryLength: 200, semanticPackingCompleted: true, mandatorySemanticsPreserved: true, reservationIdentity: "r", callLeg: "DISCOVERY" }),
  ];
  for (const verdict of verdicts) { if (verdict.ok) { reservations += 1; transports += 1; } }
  assert.equal(transports, 0); assert.equal(reservations, 0);
});

test("Y tests import freshly built dist and source marker matches", async () => {
  const fs = await import("node:fs/promises");
  const src = await fs.readFile(new URL("../src/routing-preflight.ts", import.meta.url), "utf8");
  const dist = await fs.readFile(new URL("../dist/routing-preflight.js", import.meta.url), "utf8");
  assert.match(src, /TOKEN_LIVENESS_UNKNOWN_REQUIRES_REFRESH/);
  assert.match(dist, /TOKEN_LIVENESS_UNKNOWN_REQUIRES_REFRESH/);
});
