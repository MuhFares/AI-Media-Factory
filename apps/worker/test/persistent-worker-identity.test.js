/**
 * Persistent production worker identity + operational certification (DB-free, zero-network).
 *
 * Proves the safe worker-runtime identity (mode/launcher/instance/node/env —
 * never secrets) and that the shared boundary + zero-network preflight carry
 * WORKER_RUNTIME_MODE for future live authorization, while the narrow
 * CODEX_SANDBOX_NETWORK_DISABLED guard is unchanged.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProviderBoundary,
  createWorkerRuntimeIdentity,
  resolveWorkerLauncher,
  resolveWorkerRuntimeMode,
} from "../dist/index.js";
import { mediaCapabilityPreflight } from "../../../packages/database/dist/index.js";

const PROVIDER_KEYS = [
  "TTS_PROVIDER", "RUNPOD_API_KEY", "VOICETUT_TTS_ENDPOINT_ID", "GROQ_API_KEY",
  "IMAGE_PROVIDER", "RUNPOD_IMAGE_ENDPOINT_ID", "OPENROUTER_API_KEY",
  "OPENAI_API_KEY", "ANTHROPIC_AUTH_TOKEN", "BRAVE_API_KEY",
];
const saved = Object.fromEntries(PROVIDER_KEYS.concat(["AMF_WORKER_RUNTIME_MODE", "AMF_WORKER_LAUNCHER", "CODEX_SANDBOX_NETWORK_DISABLED"]).map((k) => [k, process.env[k]]));

function scrubProviders() {
  for (const k of PROVIDER_KEYS) delete process.env[k];
}
function restoreEnv() {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

test("engineering sessions default to OPERATOR_WORKER; explicit marker selects persistent mode", (t) => {
  t.after(restoreEnv);
  delete process.env.AMF_WORKER_RUNTIME_MODE;
  assert.equal(resolveWorkerRuntimeMode({}), "OPERATOR_WORKER");
  assert.equal(resolveWorkerRuntimeMode({ AMF_WORKER_RUNTIME_MODE: "persistent-production-worker" }), "PERSISTENT_PRODUCTION_WORKER");
  assert.equal(resolveWorkerLauncher({}), "unspecified");
  assert.equal(resolveWorkerLauncher({ AMF_WORKER_LAUNCHER: "persistent-worker-script" }), "persistent-worker-script");
});

test("worker identity carries safe metadata only and unique instance ids", (t) => {
  t.after(restoreEnv);
  process.env.RUNPOD_API_KEY = "decoy-secret-abc123";
  process.env.AMF_WORKER_RUNTIME_MODE = "persistent-production-worker";
  process.env.AMF_WORKER_LAUNCHER = "persistent-worker-script";
  const a = createWorkerRuntimeIdentity();
  const b = createWorkerRuntimeIdentity();
  assert.equal(a.runtimeMode, "PERSISTENT_PRODUCTION_WORKER");
  assert.equal(a.launcherClassification, "persistent-worker-script");
  assert.equal(a.nodeVersion, process.version);
  assert.notEqual(a.workerInstanceId, b.workerInstanceId);
  const dumped = JSON.stringify(a);
  assert.ok(!dumped.includes("decoy-secret-abc123"), "identity must never embed credentials");
});

test("shared buildProviderBoundary carries worker runtime identity provider-free", (t) => {
  t.after(restoreEnv);
  scrubProviders();
  delete process.env.CODEX_SANDBOX_NETWORK_DISABLED;
  process.env.AMF_WORKER_RUNTIME_MODE = "persistent-production-worker";
  process.env.AMF_WORKER_LAUNCHER = "persistent-worker-script";
  const boundary = buildProviderBoundary({ workerInstanceId: "instance-fixture-1" });
  assert.equal(boundary.workerRuntime.mode, "PERSISTENT_PRODUCTION_WORKER");
  assert.equal(boundary.workerRuntime.launcherClassification, "persistent-worker-script");
  assert.equal(boundary.workerRuntime.instanceId, "instance-fixture-1");
  assert.equal(boundary.workerRuntime.nodeVersion, process.version);
  assert.equal(boundary.workerExecutionEnvironment.status, "SUPPORTED");
});

test("preflight reports WORKER_RUNTIME_MODE without claiming provider reachability", (t) => {
  t.after(restoreEnv);
  scrubProviders();
  delete process.env.CODEX_SANDBOX_NETWORK_DISABLED;
  const boundary = buildProviderBoundary({
    workerRuntimeMode: "PERSISTENT_PRODUCTION_WORKER",
    workerLauncher: "persistent-worker-script",
    workerInstanceId: "instance-fixture-2",
  });
  const result = mediaCapabilityPreflight(boundary);
  assert.equal(result.workerRuntimeMode, "PERSISTENT_PRODUCTION_WORKER");
  assert.equal(result.workerExecutionEnvironment, "SUPPORTED");
  assert.equal(result.mediaLiveExecutionAllowed, true);
});

test("explicit sandbox marker keeps boundary unsupported with persistent-mode reporting intact", (t) => {
  t.after(restoreEnv);
  scrubProviders();
  process.env.CODEX_SANDBOX_NETWORK_DISABLED = "1";
  process.env.AMF_WORKER_RUNTIME_MODE = "persistent-production-worker";
  const boundary = buildProviderBoundary({});
  assert.equal(boundary.workerExecutionEnvironment.status, "UNSUPPORTED");
  const result = mediaCapabilityPreflight(boundary);
  assert.equal(result.pass, false);
  assert.ok(result.failureCodes.includes("ENGINEERING_SANDBOX_NETWORK_DISABLED"));
  assert.equal(result.workerRuntimeMode, "PERSISTENT_PRODUCTION_WORKER");
});
