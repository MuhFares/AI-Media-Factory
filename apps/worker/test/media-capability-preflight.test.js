import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { buildProviderBoundary } from "../dist/index.js";
import { mediaCapabilityPreflight } from "../../../packages/database/dist/index.js";

const KEYS = [
  "TTS_PROVIDER", "RUNPOD_API_KEY", "VOICETUT_TTS_ENDPOINT_ID",
  "IMAGE_PROVIDER", "RUNPOD_IMAGE_ENDPOINT_ID", "GROQ_API_KEY",
];
const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

function restoreEnv() {
  for (const key of KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(restoreEnv);

function configureImage() {
  process.env.IMAGE_PROVIDER = "self-hosted-image";
  process.env.RUNPOD_API_KEY = "present-not-used";
  process.env.RUNPOD_IMAGE_ENDPOINT_ID = "present-not-used";
}

function inspect() {
  // Capability-registration cases model the intended persistent production
  // launcher, not this test runner's Codex sandbox.
  const marker = process.env.CODEX_SANDBOX_NETWORK_DISABLED;
  delete process.env.CODEX_SANDBOX_NETWORK_DISABLED;
  try { return mediaCapabilityPreflight(buildProviderBoundary()); }
  finally {
    if (marker === undefined) delete process.env.CODEX_SANDBOX_NETWORK_DISABLED;
    else process.env.CODEX_SANDBOX_NETWORK_DISABLED = marker;
  }
}

test("r1 regression: credentials without TTS_PROVIDER leave tts.generate unregistered provider-free", () => {
  configureImage();
  process.env.VOICETUT_TTS_ENDPOINT_ID = "present-not-used";
  delete process.env.TTS_PROVIDER;
  const result = inspect();
  assert.equal(result.pass, false);
  assert.equal(result.tts.registered, false);
  assert.equal(result.tts.failureCode, "TTS_PROVIDER_SELECTOR_MISSING");
});

test("explicit VoiceTut selector registers the real production TTS capability provider-free", () => {
  configureImage();
  process.env.TTS_PROVIDER = "voicetut";
  process.env.VOICETUT_TTS_ENDPOINT_ID = "present-not-used";
  const result = inspect();
  assert.equal(result.pass, true);
  assert.equal(result.tts.provider, "voicetut");
  assert.equal(result.tts.registered, true);
  assert.equal(result.timeline.registered, true);
  assert.equal(result.image.registered, true);
});

test("unsupported and incomplete VoiceTut selection fail closed", () => {
  configureImage();
  process.env.TTS_PROVIDER = "unsupported";
  let result = inspect();
  assert.equal(result.pass, false);
  assert.equal(result.tts.failureCode, "TTS_PROVIDER_UNSUPPORTED");

  process.env.TTS_PROVIDER = "voicetut";
  delete process.env.VOICETUT_TTS_ENDPOINT_ID;
  result = inspect();
  assert.equal(result.pass, false);
  assert.deepEqual(result.tts.missingConfigurationKeys, ["VOICETUT_TTS_ENDPOINT_ID"]);

  process.env.VOICETUT_TTS_ENDPOINT_ID = "present-not-used";
  delete process.env.RUNPOD_API_KEY;
  result = inspect();
  assert.equal(result.pass, false);
  assert.ok(result.tts.missingConfigurationKeys.includes("RUNPOD_API_KEY"));
});

test("timeline and image registration failures are reported without provider calls", () => {
  configureImage();
  process.env.TTS_PROVIDER = "voicetut";
  process.env.VOICETUT_TTS_ENDPOINT_ID = "present-not-used";
  let result = mediaCapabilityPreflight({ registeredCapabilityIds: ["tts.generate", "image.generate"] });
  assert.equal(result.pass, false);
  assert.equal(result.timeline.failureCode, "TIMELINE_CAPABILITY_NOT_REGISTERED");
  result = mediaCapabilityPreflight({ registeredCapabilityIds: ["tts.generate", "timeline.plan"] });
  assert.equal(result.pass, false);
  assert.equal(result.image.failureCode, "IMAGE_CAPABILITY_NOT_REGISTERED");
});
