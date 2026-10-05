/**
 * Provider-free unit tests for Research synthesis leg routing helpers.
 * No DB, no network.
 */
import { describe, it } from "node:test";
import { strictEqual, ok, deepStrictEqual } from "node:assert";
import {
  RESEARCH_SYNTHESIS_ROUTE_ROLE,
  researchSynthesisRoute,
  researchLegDispatcher,
} from "../dist/production-executor.js";

const LEG_KEY = RESEARCH_SYNTHESIS_ROUTE_ROLE;

function overridesWith(model, extra = {}) {
  return {
    research: { provider: "openrouter", model: "openai/gpt-6-luna", canonicalRouting: { routingVersionId: "v1", priceSnapshotId: "ps-1" } },
    [LEG_KEY]: { provider: "openrouter", model, canonicalRouting: { routingVersionId: "v1", priceSnapshotId: "ps-9" }, ...extra },
  };
}

function taggedExecute(tag, calls) {
  return async (_ctx, request) => {
    calls.push(tag);
    return { output: {}, raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: tag, provider: "test", latencyMs: 1 };
  };
}

function requestFor(leg) {
  return { model: "m", messages: [], temperature: 0, maxOutputTokens: 1, callIdentity: leg === undefined ? undefined : { callLeg: leg } };
}

describe("research synthesis leg routing", () => {
  it("leg role key is the hyphenated research-synthesis role", () => {
    strictEqual(RESEARCH_SYNTHESIS_ROUTE_ROLE, "research-synthesis");
  });

  it("absent leg entry resolves null (legacy behavior)", () => {
    strictEqual(researchSynthesisRoute({}), null);
    strictEqual(researchSynthesisRoute({ research: { model: "m" } }), null);
    strictEqual(researchSynthesisRoute(null), null);
  });

  it("partial leg records fall back to legacy (no silent downgrade)", () => {
    strictEqual(researchSynthesisRoute({ [LEG_KEY]: {} }), null);
    strictEqual(researchSynthesisRoute({ [LEG_KEY]: { model: "  " } }), null);
    strictEqual(researchSynthesisRoute({ [LEG_KEY]: { model: "mistralai/mistral-nemo" } }), null);
    strictEqual(researchSynthesisRoute({ [LEG_KEY]: { model: "mistralai/mistral-nemo", canonicalRouting: {} } }), null);
  });

  it("complete leg record resolves model with routing identity", () => {
    const route = researchSynthesisRoute(overridesWith("mistralai/mistral-nemo"));
    ok(route !== null);
    strictEqual(route.model, "mistralai/mistral-nemo");
    strictEqual(route.routingVersionId, "v1");
    strictEqual(route.priceSnapshotId, "ps-9");
  });

  it("generic role-wide override alone never creates a leg route", () => {
    strictEqual(researchSynthesisRoute({ research: { model: "owner-model", canonicalRouting: { routingVersionId: "v", priceSnapshotId: "p" } } }), null);
  });

  it("dispatcher without a leg transport passes everything to default", async () => {
    const calls = [];
    const dispatched = researchLegDispatcher(taggedExecute("default", calls), null);
    await dispatched({}, requestFor("FINAL_SYNTHESIS"), {});
    await dispatched({}, requestFor("DIRECTION"), {});
    await dispatched({}, requestFor(undefined), {});
    deepStrictEqual(calls, ["default", "default", "default"]);
  });

  it("dispatcher routes only FINAL_SYNTHESIS to the leg transport", async () => {
    const calls = [];
    const dispatched = researchLegDispatcher(taggedExecute("default", calls), taggedExecute("synthesis", calls));
    await dispatched({}, requestFor("FINAL_SYNTHESIS"), {});
    await dispatched({}, requestFor("DIRECTION"), {});
    await dispatched({}, requestFor("RETRIEVAL"), {});
    await dispatched({}, requestFor(undefined), {});
    deepStrictEqual(calls, ["synthesis", "default", "default", "default"]);
  });
});
