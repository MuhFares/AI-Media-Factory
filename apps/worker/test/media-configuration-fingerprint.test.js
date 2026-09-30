/**
 * Governed media configuration fingerprint V2 (DB-free, zero-network).
 *
 * Proves the canonical lineage semantics: endpoint swaps, provider swaps,
 * base-host swaps, and generation-significant voice changes all change the
 * fingerprint; identical config is stable; no secret or raw endpoint value
 * ever appears in fingerprint inputs or outputs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { voicetutExecutionIdentityFromEnv } from "@ai-media-factory/provider-adapters";
import {
  buildMediaConfigurationFingerprintV2,
  snapshotMediaConfigurationInput,
  mediaCapabilityPreflight,
  MEDIA_CONFIGURATION_FINGERPRINT_VERSION,
} from "../../../packages/database/dist/index.js";

const BASE = {
  registered: ["tts.generate", "timeline.plan", "image.generate"],
  ttsProvider: "voicetut",
  imageProvider: "self-hosted-image",
  ttsBaseHost: "api.runpod.ai",
  voice: "Mohamed",
};

const identityFor = (endpointId) => voicetutExecutionIdentityFromEnv({
  VOICETUT_TTS_ENDPOINT_ID: endpointId,
  RUNPOD_BASE_URL: "https://api.runpod.ai/v2",
});

const fpForEndpoint = (endpointId, voice = "Mohamed") => {
  const identity = identityFor(endpointId);
  return buildMediaConfigurationFingerprintV2({ ...BASE, ttsEndpointIdentityHash: identity.endpointIdentityHash, voice });
};

test("fingerprint lineage is version 2", () => {
  assert.equal(MEDIA_CONFIGURATION_FINGERPRINT_VERSION, 2);
});

test("different VoiceTut endpoint IDs produce different fingerprints", () => {
  const a = fpForEndpoint("endpoint-alpha-fixture");
  const b = fpForEndpoint("endpoint-beta-fixture");
  assert.notEqual(a, b);
  assert.equal(a.length, 64);
  assert.equal(b.length, 64);
});

test("same endpoint and config produce a stable fingerprint (registration order irrelevant)", () => {
  const a = fpForEndpoint("endpoint-alpha-fixture");
  const reordered = buildMediaConfigurationFingerprintV2({
    ...BASE,
    registered: ["image.generate", "tts.generate", "timeline.plan"],
    ttsEndpointIdentityHash: identityFor("endpoint-alpha-fixture").endpointIdentityHash,
  });
  assert.equal(a, reordered);
});

test("provider, base-host, and generation-significant voice changes all change the fingerprint", () => {
  const base = fpForEndpoint("endpoint-alpha-fixture", "Mohamed");
  const otherVoice = fpForEndpoint("endpoint-alpha-fixture", "Asmaa");
  assert.notEqual(base, otherVoice);
  const otherProvider = buildMediaConfigurationFingerprintV2({
    ...BASE, ttsProvider: "groq", ttsEndpointIdentityHash: null, ttsBaseHost: null, voice: "Hannah",
  });
  assert.notEqual(base, otherProvider);
  const otherHost = buildMediaConfigurationFingerprintV2({
    ...BASE, ttsBaseHost: "api.example.test",
    ttsEndpointIdentityHash: identityFor("endpoint-alpha-fixture").endpointIdentityHash,
  });
  assert.notEqual(base, otherHost);
  const unconfigured = buildMediaConfigurationFingerprintV2({ ...BASE, ttsEndpointIdentityHash: null, ttsBaseHost: null });
  assert.notEqual(base, unconfigured);
});

test("no secret or raw endpoint value appears in fingerprint inputs or outputs", () => {
  const secretEndpoint = "endpoint-super-secret-fixture";
  const identity = identityFor(secretEndpoint);
  const input = { ...BASE, ttsEndpointIdentityHash: identity.endpointIdentityHash };
  const fp = buildMediaConfigurationFingerprintV2(input);
  const dumped = JSON.stringify(input);
  assert.ok(!dumped.includes(secretEndpoint), "raw endpoint ID must never be a fingerprint input");
  assert.ok(!dumped.toLowerCase().includes("rpa-"), "no key material in inputs");
  assert.ok(!fp.includes(secretEndpoint), "raw endpoint ID must never appear in output");
  assert.ok(identity.endpointIdentityHash !== secretEndpoint, "identity is one-way");
});

test("snapshot carries boundary derivations into the canonical input provider-free", () => {
  const identity = identityFor("endpoint-alpha-fixture");
  const boundary = {
    registeredCapabilityIds: ["tts.generate", "timeline.plan", "image.generate"],
    mediaConfiguration: { ttsEndpointIdentityHash: identity.endpointIdentityHash, ttsBaseHost: identity.baseHost },
  };
  const snap = snapshotMediaConfigurationInput(boundary, "Mohamed", { ttsProvider: "voicetut", imageProvider: "self-hosted-image" });
  assert.equal(snap.ttsEndpointIdentityHash, identity.endpointIdentityHash);
  assert.equal(snap.ttsBaseHost, "api.runpod.ai");
  assert.equal(snap.voice, "Mohamed");
  assert.equal(buildMediaConfigurationFingerprintV2(snap), fpForEndpoint("endpoint-alpha-fixture"));
});

test("preflight reports v2 fingerprint, version, and effective voice without provider calls", (t) => {
  const savedTts = process.env.TTS_PROVIDER;
  const savedImage = process.env.IMAGE_PROVIDER;
  t.after(() => {
    if (savedTts === undefined) delete process.env.TTS_PROVIDER; else process.env.TTS_PROVIDER = savedTts;
    if (savedImage === undefined) delete process.env.IMAGE_PROVIDER; else process.env.IMAGE_PROVIDER = savedImage;
  });
  process.env.TTS_PROVIDER = "voicetut";
  process.env.IMAGE_PROVIDER = "self-hosted-image";
  const identity = identityFor("endpoint-alpha-fixture");
  const result = mediaCapabilityPreflight({
    registeredCapabilityIds: ["tts.generate", "timeline.plan", "image.generate"],
    workerExecutionEnvironment: { status: "SUPPORTED", mediaLiveExecutionAllowed: true, reasonCode: null },
    mediaConfiguration: { ttsEndpointIdentityHash: identity.endpointIdentityHash, ttsBaseHost: identity.baseHost },
  }, "Mohamed");
  assert.equal(result.configurationFingerprintVersion, 2);
  assert.equal(result.effectiveVoice, "Mohamed");
  assert.equal(result.configurationFingerprint, fpForEndpoint("endpoint-alpha-fixture"));
});
