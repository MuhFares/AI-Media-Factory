import test from "node:test";
import assert from "node:assert/strict";
import { inspectWorkerExecutionEnvironment } from "../dist/index.js";
import { mediaCapabilityPreflight } from "../../../packages/database/dist/index.js";

test("explicit network-disabled engineering sandbox is unsupported without probing network", () => {
  assert.deepEqual(inspectWorkerExecutionEnvironment({ CODEX_SANDBOX_NETWORK_DISABLED: "1" }), {
    status: "UNSUPPORTED",
    mediaLiveExecutionAllowed: false,
    reasonCode: "ENGINEERING_SANDBOX_NETWORK_DISABLED",
  });
});

test("ordinary production launcher is supported when no denial marker is present", () => {
  assert.deepEqual(inspectWorkerExecutionEnvironment({}), {
    status: "SUPPORTED", mediaLiveExecutionAllowed: true, reasonCode: null,
  });
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
