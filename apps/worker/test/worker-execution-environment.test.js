import test from "node:test";
import assert from "node:assert/strict";
import { inspectWorkerExecutionEnvironment, safeWorkerRuntimeSummary } from "../dist/index.js";
import { mediaCapabilityPreflight } from "../../../packages/database/dist/index.js";

test("explicit network-disabled engineering sandbox is unsupported without probing network", () => {
  assert.deepEqual(inspectWorkerExecutionEnvironment({ CODEX_SANDBOX_NETWORK_DISABLED: "1" }), {
    status: "UNSUPPORTED",
    mediaLiveExecutionAllowed: false,
    reasonCode: "ENGINEERING_SANDBOX_NETWORK_DISABLED",
    reasonCodes: ["ENGINEERING_SANDBOX_NETWORK_DISABLED"],
    failedCheckNames: ["ENGINEERING_SANDBOX_NETWORK_POLICY"],
    passedCheckNames: [],
    runtimeFingerprint: { platform: process.platform, arch: process.arch, nodeMajor: Number(process.versions.node.split(".")[0]) },
  });
});

test("ordinary production launcher is supported when no denial marker is present", () => {
  assert.deepEqual(inspectWorkerExecutionEnvironment({}), {
    status: "SUPPORTED", mediaLiveExecutionAllowed: true, reasonCode: null,
    reasonCodes: [], failedCheckNames: [], passedCheckNames: ["ENGINEERING_SANDBOX_NETWORK_POLICY"],
    runtimeFingerprint: { platform: process.platform, arch: process.arch, nodeMajor: Number(process.versions.node.split(".")[0]) },
  });
});

test("unsupported classification retains bounded actionable diagnostics", () => {
  const result = inspectWorkerExecutionEnvironment({ CODEX_SANDBOX_NETWORK_DISABLED: "1" });
  assert.deepEqual(result.reasonCodes, ["ENGINEERING_SANDBOX_NETWORK_DISABLED"]);
  assert.deepEqual(result.failedCheckNames, ["ENGINEERING_SANDBOX_NETWORK_POLICY"]);
  assert.deepEqual(result.passedCheckNames, []);
  assert.deepEqual(Object.keys(result.runtimeFingerprint).sort(), ["arch", "nodeMajor", "platform"]);
  assert.equal(result.runtimeFingerprint.platform, process.platform);
  assert.equal(result.runtimeFingerprint.arch, process.arch);
  assert.equal(result.runtimeFingerprint.nodeMajor, Number(process.versions.node.split(".")[0]));
  assert.doesNotMatch(JSON.stringify(result), /OPENROUTER|API_KEY|Authorization/i);

  const summary = safeWorkerRuntimeSummary({
    workerInstanceId: "diagnostic-test-worker",
    runtimeMode: "PERSISTENT_PRODUCTION_WORKER",
    launcherClassification: "persistent-worker-script",
    nodeVersion: process.version,
    executionEnvironment: result,
    startedAt: "2026-10-05T00:00:00.000Z",
  });
  assert.match(summary, /reason=ENGINEERING_SANDBOX_NETWORK_DISABLED/);
  assert.match(summary, /failed=ENGINEERING_SANDBOX_NETWORK_POLICY/);
});

test("media preflight fails closed on unsupported launcher before capability execution", () => {
  const result = mediaCapabilityPreflight({
    registeredCapabilityIds: ["tts.generate", "timeline.plan", "image.generate"],
    workerExecutionEnvironment: inspectWorkerExecutionEnvironment({ CODEX_SANDBOX_NETWORK_DISABLED: "true" }),
  });
  assert.equal(result.pass, false);
  assert.equal(result.workerExecutionEnvironment, "UNSUPPORTED");
  assert.equal(result.mediaLiveExecutionAllowed, false);
  assert.ok(result.failureCodes.includes("ENGINEERING_SANDBOX_NETWORK_DISABLED"));
});

test("startup classification is immutable and a fresh runtime reconciles stale launch state", () => {
  const stale = inspectWorkerExecutionEnvironment({ CODEX_SANDBOX_NETWORK_DISABLED: "1" });
  const refreshed = inspectWorkerExecutionEnvironment({});
  assert.equal(stale.status, "UNSUPPORTED");
  assert.equal(refreshed.status, "SUPPORTED");
  assert.equal(stale.status, "UNSUPPORTED", "a running worker must not silently rewrite its startup trust state");
});

test("egress observations remain separate from execution-environment eligibility", () => {
  const egressDown = inspectWorkerExecutionEnvironment({ AMF_OPENROUTER_EGRESS_STATUS: "DOWN" });
  const egressUpButRestricted = inspectWorkerExecutionEnvironment({
    AMF_OPENROUTER_EGRESS_STATUS: "UP",
    CODEX_SANDBOX_NETWORK_DISABLED: "1",
  });
  assert.equal(egressDown.status, "SUPPORTED");
  assert.equal(egressUpButRestricted.status, "UNSUPPORTED");
});
