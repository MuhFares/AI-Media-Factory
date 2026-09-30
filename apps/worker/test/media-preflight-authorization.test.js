/**
 * Media preflight authorization hardening regressions (DB-free, zero-network).
 *
 * Reproduces the exact R6 defect: timeline.plan registered but the production
 * caller "timeline" lacked a grant, so the old registration-only preflight
 * passed while the live execution later blocked with
 * "Capability is not authorized for this agent".
 *
 * Proves:
 *  1. old grant shape (director-only) => preflight FAIL TIMELINE_CALLER_NOT_AUTHORIZED
 *  2. repaired grant (timeline authorized) => PASS
 *  3. unrelated capability remains unauthorized (no privilege creep)
 *  4. no wildcard grant introduced (research cannot call tts/image/timeline)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createProviderCapabilityBoundary, DEFAULT_PROVIDER_GRANTS } from "@ai-media-factory/provider-adapters";
import { mediaCapabilityPreflight } from "../../../packages/database/dist/index.js";
import { createCapabilityRegistry } from "../../../packages/tool-framework/dist/index.js";
import { PROVIDER_CAPABILITIES } from "../../../packages/provider-adapters/dist/wiring/registry.js";

// Minimal adapters that don't touch env or network — just enough to build a boundary.
function stubAdapters(overrides = {}) {
  const stub = { generate: async () => { throw new Error("must not be called"); }, search: async () => { throw new Error("must not be called"); } };
  return {
    webSearch: stub,
    imageGeneration: { ...stub, providerId: "stub-image" },
    videoGeneration: stub,
    publishing: stub,
    analytics: stub,
    ttsGeneration: { ...stub, providerId: "stub-tts", generate: async () => ({ providerId: "stub-tts", audioId: "a", url: "data:audio/wav;base64,AAA", format: "wav" }) },
    ...overrides,
  };
}

function boundaryWithGrants(grants) {
  // Build a real registry so isAuthorized reflects exact grants.
  const resolver = createCapabilityRegistry({ capabilities: PROVIDER_CAPABILITIES, grants });
  const registered = ["tts.generate", "timeline.plan", "image.generate", "media.compose", "web.search", "video.generate", "publish.youtube", "analytics.fetch"];
  return {
    registeredCapabilityIds: registered,
    resolver,
    workerExecutionEnvironment: { status: "SUPPORTED", mediaLiveExecutionAllowed: true, reasonCode: null },
    workerRuntime: { mode: "PERSISTENT_PRODUCTION_WORKER", launcherClassification: "test", instanceId: "test", nodeVersion: process.version },
    mediaConfiguration: { ttsEndpointIdentityHash: "hash-fixture", ttsBaseHost: "api.runpod.ai" },
  };
}

test("R6 defect regression: timeline.plan registered but timeline caller not authorized => preflight FAIL", () => {
  const savedTts = process.env.TTS_PROVIDER;
  const savedImage = process.env.IMAGE_PROVIDER;
  try {
    process.env.TTS_PROVIDER = "voicetut";
    process.env.IMAGE_PROVIDER = "self-hosted-image";
    process.env.RUNPOD_API_KEY = "present-not-used";
    process.env.VOICETUT_TTS_ENDPOINT_ID = "present-not-used";
    process.env.RUNPOD_IMAGE_ENDPOINT_ID = "present-not-used";
    // Old shape: director-only grant for timeline.plan (no timeline grant)
    const oldGrants = DEFAULT_PROVIDER_GRANTS.filter(g => !(g.agentId === "timeline" && g.capabilityIds.includes("timeline.plan")));
    // Sanity: old grants still have director
    assert.ok(oldGrants.some(g => g.agentId === "director" && g.capabilityIds.includes("timeline.plan")));
    assert.ok(!oldGrants.some(g => g.agentId === "timeline"));
    const boundary = boundaryWithGrants(oldGrants);
    const result = mediaCapabilityPreflight(boundary, "Mohamed");
    assert.equal(result.pass, false);
    assert.ok(result.failureCodes.includes("TIMELINE_CALLER_NOT_AUTHORIZED"), `got ${result.failureCodes}`);
    assert.ok(!result.failureCodes.includes("TIMELINE_CAPABILITY_NOT_REGISTERED"));
  } finally {
    if (savedTts === undefined) delete process.env.TTS_PROVIDER; else process.env.TTS_PROVIDER = savedTts;
    if (savedImage === undefined) delete process.env.IMAGE_PROVIDER; else process.env.IMAGE_PROVIDER = savedImage;
    delete process.env.RUNPOD_API_KEY;
    delete process.env.VOICETUT_TTS_ENDPOINT_ID;
    delete process.env.RUNPOD_IMAGE_ENDPOINT_ID;
  }
});

test("repaired grant: timeline caller authorized => preflight PASS", () => {
  const savedTts = process.env.TTS_PROVIDER;
  const savedImage = process.env.IMAGE_PROVIDER;
  try {
    process.env.TTS_PROVIDER = "voicetut";
    process.env.IMAGE_PROVIDER = "self-hosted-image";
    process.env.RUNPOD_API_KEY = "present-not-used";
    process.env.VOICETUT_TTS_ENDPOINT_ID = "present-not-used";
    process.env.RUNPOD_IMAGE_ENDPOINT_ID = "present-not-used";
    const boundary = boundaryWithGrants(DEFAULT_PROVIDER_GRANTS);
    assert.ok(DEFAULT_PROVIDER_GRANTS.some(g => g.agentId === "timeline" && g.capabilityIds.includes("timeline.plan")));
    const result = mediaCapabilityPreflight(boundary, "Mohamed");
    assert.equal(result.pass, true, `failureCodes: ${result.failureCodes}`);
    assert.ok(!result.failureCodes.includes("TIMELINE_CALLER_NOT_AUTHORIZED"));
    assert.ok(!result.failureCodes.includes("TTS_CALLER_NOT_AUTHORIZED"));
    assert.ok(!result.failureCodes.includes("IMAGE_CALLER_NOT_AUTHORIZED"));
  } finally {
    if (savedTts === undefined) delete process.env.TTS_PROVIDER; else process.env.TTS_PROVIDER = savedTts;
    if (savedImage === undefined) delete process.env.IMAGE_PROVIDER; else process.env.IMAGE_PROVIDER = savedImage;
    delete process.env.RUNPOD_API_KEY;
    delete process.env.VOICETUT_TTS_ENDPOINT_ID;
    delete process.env.RUNPOD_IMAGE_ENDPOINT_ID;
  }
});

test("unrelated caller remains unauthorized and no wildcard grant exists", () => {
  const boundary = boundaryWithGrants(DEFAULT_PROVIDER_GRANTS);
  // research must not be able to call timeline.plan / tts.generate / image.generate
  assert.equal(boundary.resolver.isAuthorized("research", "timeline.plan"), false);
  assert.equal(boundary.resolver.isAuthorized("research", "tts.generate"), false);
  assert.equal(boundary.resolver.isAuthorized("research", "image.generate"), false);
  // No agent is authorized for all capabilities
  const allCaps = ["tts.generate", "timeline.plan", "image.generate", "web.search", "video.generate", "publish.youtube", "analytics.fetch"];
  const wildcardAgent = DEFAULT_PROVIDER_GRANTS.find(g => allCaps.every(c => g.capabilityIds.includes(c)));
  assert.equal(wildcardAgent, undefined);
});

test("real provider-boundary grants include the narrow timeline repair (integration sanity)", () => {
  // Build a real boundary through the production helper (stub adapters, real registry)
  // and verify the resolver authorizes the exact production callers.
  const adapters = stubAdapters();
  const real = createProviderCapabilityBoundary({
    adapters,
    publishStore: { get: async () => null, save: async () => {} },
    grants: DEFAULT_PROVIDER_GRANTS,
  });
  assert.equal(real.resolver.isAuthorized("timeline", "timeline.plan"), true);
  assert.equal(real.resolver.isAuthorized("tts", "tts.generate"), true);
  assert.equal(real.resolver.isAuthorized("scene-image", "image.generate"), true);
  assert.equal(real.resolver.isAuthorized("director", "timeline.plan"), true);
});
