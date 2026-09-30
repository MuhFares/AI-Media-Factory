import test from "node:test";
import assert from "node:assert/strict";
import { deriveCallTransportState, executeCapabilityWithTransportLifecycle } from "../dist/production-executor.js";
import { WebSearchCapabilityExecutor } from "@ai-media-factory/tool-framework";

const reservation = (id, key, status = "RESERVED") => ({ reservationId: id, idempotencyKey: key, status });
const event = (state, value, executionId = "shared-execution") => ({ executionId, state, metadata: value });

test("A: shared recovery execution attributes only Direction when only Direction starts", () => {
  const direction = reservation("res-direction", "wf:research:text:direction");
  const synthesis = reservation("res-synthesis", "wf:research:text:synthesis");
  const events = [event("PROVIDER_SUBMISSION_INTENT", { callLeg: "DIRECTION", reservationId: direction.reservationId }), event("FETCH_INVOCATION_STARTED", { callLeg: "DIRECTION", reservationId: direction.reservationId })];
  assert.equal(deriveCallTransportState(direction, events), "TRANSPORT_STARTED");
  assert.equal(deriveCallTransportState(synthesis, events), "RESERVED");
});

test("B: both calls are independently attributed under one execution", () => {
  const direction = reservation("res-direction", "direction-key");
  const synthesis = reservation("res-synthesis", "synthesis-key");
  const events = [
    event("FETCH_INVOCATION_STARTED", { callLeg: "DIRECTION", idempotencyKey: direction.idempotencyKey }),
    event("PROVIDER_RESPONSE_RECEIVED", { callLeg: "DIRECTION", idempotencyKey: direction.idempotencyKey }),
    event("FETCH_INVOCATION_STARTED", { callLeg: "FINAL_SYNTHESIS", idempotencyKey: synthesis.idempotencyKey }),
    event("PROVIDER_RESPONSE_RECEIVED", { callLeg: "FINAL_SYNTHESIS", idempotencyKey: synthesis.idempotencyKey }),
  ];
  assert.equal(deriveCallTransportState(direction, events), "TRANSPORT_COMPLETED");
  assert.equal(deriveCallTransportState(synthesis, events), "TRANSPORT_COMPLETED");
});

test("C: Direction failure after fetch counts Direction and leaves Synthesis untouched", () => {
  const direction = reservation("res-direction", "direction-key", "FAILED_AFTER_SUBMISSION");
  const synthesis = reservation("res-synthesis", "synthesis-key", "RELEASED_BEFORE_SUBMISSION");
  const events = [event("FETCH_INVOCATION_STARTED", { reservationId: direction.reservationId }), event("FAILED", { reservationId: direction.reservationId })];
  assert.equal(deriveCallTransportState(direction, events), "TRANSPORT_FAILED_AFTER_START");
  assert.equal(deriveCallTransportState(synthesis, events), "TRANSPORT_NOT_STARTED");
});

test("D: reservation plus submission intent without fetch is not transport-consumed", () => {
  const direction = reservation("res-direction", "direction-key", "RELEASED_BEFORE_SUBMISSION");
  const events = [event("PROVIDER_SUBMISSION_INTENT", { reservationId: direction.reservationId })];
  assert.equal(deriveCallTransportState(direction, events), "TRANSPORT_NOT_STARTED");
});

test("E: retry reservations do not collide with a prior recovery execution", () => {
  const prior = reservation("res-prior", "wf:research:text:recovery:one");
  const retry = reservation("res-retry", "wf:research:text:recovery:two");
  const events = [event("FETCH_INVOCATION_STARTED", { reservationId: prior.reservationId, idempotencyKey: prior.idempotencyKey }, "recovery-one")];
  assert.equal(deriveCallTransportState(prior, events), "TRANSPORT_STARTED");
  assert.equal(deriveCallTransportState(retry, events), "RESERVED");
});

test("F: concurrent reservations preserve distinct canonical identities", () => {
  const first = reservation("res-a", "key-a");
  const second = reservation("res-b", "key-b");
  const events = [
    event("FETCH_INVOCATION_STARTED", { reservationId: first.reservationId, idempotencyKey: first.idempotencyKey }),
    event("PROVIDER_SUBMISSION_INTENT", { reservationId: second.reservationId, idempotencyKey: second.idempotencyKey }),
  ];
  assert.equal(deriveCallTransportState(first, events), "TRANSPORT_STARTED");
  assert.equal(deriveCallTransportState(second, events), "RESERVED");
});

test("retrieval A/B: Direction transport and reservation intent never consume retrieval", () => {
  const direction = reservation("text-direction", "text-direction-key", "FAILED_AFTER_SUBMISSION");
  const retrieval = reservation("research-1", "research-key-1", "RELEASED_BEFORE_SUBMISSION");
  const events = [
    event("FETCH_INVOCATION_STARTED", { reservationId: direction.reservationId, idempotencyKey: direction.idempotencyKey, callLeg: "DIRECTION" }),
    event("PROVIDER_SUBMISSION_INTENT", { reservationId: retrieval.reservationId, idempotencyKey: retrieval.idempotencyKey, callLeg: "RETRIEVAL" }),
  ];
  assert.equal(deriveCallTransportState(retrieval, events), "TRANSPORT_NOT_STARTED");
});

test("retrieval C: capability transport start then failure is consumed", () => {
  const retrieval = reservation("research-1", "research-key-1", "FAILED_AFTER_SUBMISSION");
  const events = [
    event("CAPABILITY_TRANSPORT_STARTED", { reservationId: retrieval.reservationId, idempotencyKey: retrieval.idempotencyKey }),
    event("CAPABILITY_TRANSPORT_FAILED", { reservationId: retrieval.reservationId, idempotencyKey: retrieval.idempotencyKey }),
  ];
  assert.equal(deriveCallTransportState(retrieval, events), "TRANSPORT_FAILED_AFTER_START");
});

test("retrieval D: completed web.search consumes exactly its reservation", () => {
  const retrieval = reservation("research-1", "research-key-1", "CONSUMED");
  const events = [
    event("CAPABILITY_TRANSPORT_STARTED", { reservationId: retrieval.reservationId }),
    event("CAPABILITY_RESULT_RECEIVED", { reservationId: retrieval.reservationId, resultStatus: "success" }),
  ];
  assert.equal(deriveCallTransportState(retrieval, events), "TRANSPORT_COMPLETED");
});

test("retrieval E: Direction and retrieval sharing an execution remain isolated", () => {
  const direction = reservation("text-direction", "text-direction-key");
  const retrieval = reservation("research-1", "research-key-1");
  const events = [event("FETCH_INVOCATION_STARTED", { reservationId: direction.reservationId })];
  assert.equal(deriveCallTransportState(direction, events), "TRANSPORT_STARTED");
  assert.equal(deriveCallTransportState(retrieval, events), "RESERVED");
});

test("retrieval F: concurrent capability reservations remain isolated", () => {
  const first = reservation("research-1", "research-key-1");
  const second = reservation("research-2", "research-key-2");
  const events = [event("CAPABILITY_TRANSPORT_STARTED", { reservationId: second.reservationId, idempotencyKey: second.idempotencyKey })];
  assert.equal(deriveCallTransportState(first, events), "RESERVED");
  assert.equal(deriveCallTransportState(second, events), "TRANSPORT_STARTED");
});

const descriptor = { capabilityId: "web.search", description: "Search", inputSchema: { type: "object" }, outputSchema: { type: "object" } };
const resolver = { resolve: (id) => id === "web.search" ? descriptor : null, isAuthorized: () => true };
const request = (id, input) => ({ requestId: id, capabilityId: "web.search", agentId: "research", workflowId: "wf", correlationId: "corr", input, requestedAt: "2026-09-26T00:00:00.000Z" });
const attribution = (id) => ({ reservationId: `reservation-${id}`, idempotencyKey: `key-${id}`, callLeg: "RETRIEVAL", capabilityRequestId: id, capabilityId: "web.search" });

test("transport A/B: local query and schema preflight failures emit no transport start", async () => {
  let providerCalls = 0;
  const executor = new WebSearchCapabilityExecutor({ search: async () => { providerCalls += 1; return { providerId: "fixture", results: [] }; } }, resolver, { maxResults: 5, maxQueryLength: 200 });
  const capability = { executeCapability: (value) => executor.execute(value) };
  for (const [id, input] of [["too-long", { query: "x".repeat(201) }], ["bad-schema", { query: "valid", maxResults: 6 }]]) {
    const events = [];
    const result = await executeCapabilityWithTransportLifecycle(capability, request(id, input), attribution(id), async (state, metadata) => { events.push({ state, metadata }); });
    assert.equal(result.status, "blocked");
    assert.equal(events.some((item) => item.state === "CAPABILITY_TRANSPORT_STARTED"), false);
    assert.equal(deriveCallTransportState(reservation(`reservation-${id}`, `key-${id}`), events), "RESERVED");
  }
  assert.equal(providerCalls, 0);
});

test("transport C: provider failure after invocation emits transport start and consumes once", async () => {
  const executor = new WebSearchCapabilityExecutor({ search: async (providerRequest) => { await providerRequest.onExternalProviderInvocationStarted?.(); throw new Error("dns failure"); } }, resolver, { maxResults: 5, maxQueryLength: 200 });
  const events = [];
  const result = await executeCapabilityWithTransportLifecycle({ executeCapability: (value) => executor.execute(value) }, request("provider-failure", { query: "Egypt history evidence" }), attribution("provider-failure"), async (state, metadata) => { events.push({ state, metadata }); });
  assert.equal(result.status, "failed");
  assert.equal(events.filter((item) => item.state === "CAPABILITY_TRANSPORT_STARTED").length, 1);
  assert.equal(deriveCallTransportState(reservation("reservation-provider-failure", "key-provider-failure", "FAILED_AFTER_SUBMISSION"), events), "TRANSPORT_COMPLETED");
});

test("transport D: successful HTTP-equivalent provider call emits one start and one result", async () => {
  const executor = new WebSearchCapabilityExecutor({ search: async (providerRequest) => { await providerRequest.onExternalProviderInvocationStarted?.(); return { providerId: "fixture", results: [] }; } }, resolver, { maxResults: 5, maxQueryLength: 200 });
  const events = [];
  const result = await executeCapabilityWithTransportLifecycle({ executeCapability: (value) => executor.execute(value) }, request("success", { query: "Egypt history evidence" }), attribution("success"), async (state, metadata) => { events.push({ state, metadata }); });
  assert.equal(result.status, "success");
  assert.deepEqual(events.map((item) => item.state), ["CAPABILITY_TRANSPORT_STARTED", "CAPABILITY_RESULT_RECEIVED"]);
});

test("transport E/F: concurrent retrieval identities and Direction transport remain isolated", async () => {
  const executor = new WebSearchCapabilityExecutor({ search: async (providerRequest) => { await providerRequest.onExternalProviderInvocationStarted?.(); return { providerId: "fixture", results: [] }; } }, resolver, { maxResults: 5, maxQueryLength: 200 });
  const events = [event("FETCH_INVOCATION_STARTED", { reservationId: "direction", callLeg: "DIRECTION" })];
  await Promise.all(["one", "two"].map((id) => executeCapabilityWithTransportLifecycle(
    { executeCapability: (value) => executor.execute(value) }, request(id, { query: `Egypt history evidence ${id}` }), attribution(id),
    async (state, metadata) => { events.push({ state, metadata }); },
  )));
  assert.equal(deriveCallTransportState(reservation("reservation-one", "key-one"), events), "TRANSPORT_COMPLETED");
  assert.equal(deriveCallTransportState(reservation("reservation-two", "key-two"), events), "TRANSPORT_COMPLETED");
});
