import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createWorkflowApiHandler } from "../dist/index.js";

let server;
let base;
let inspectionCalls = 0;
let authorizationCalls = 0;

process.env.AMF_OWNER_TOKEN ??= "test-owner-token";

const preflight = {
  pass: true,
  failureCodes: [],
  tts: { capability: "tts.generate", provider: "voicetut", selectorPresent: true, registered: true, missingConfigurationKeys: [], failureCode: null },
  timeline: { capability: "timeline.plan", provider: "deterministic-local", selectorPresent: true, registered: true, missingConfigurationKeys: [], failureCode: null },
  image: { capability: "image.generate", provider: "self-hosted-image", selectorPresent: true, registered: true, missingConfigurationKeys: [], failureCode: null },
  visualSemanticReviewReady: true,
  visualTechnicalQaReady: true,
  visualHumanGateReady: true,
  visualHumanGateEnabled: true,
  configurationFingerprint: "a".repeat(64),
};

before(async () => {
  const mediaResumes = {
    eligibility: async ({ workflowId }) => ({ eligible: true, workflowId, providerBudget: 9 }),
    preflight: () => { inspectionCalls += 1; return preflight; },
    authorizeAndDispatch: async () => {
      authorizationCalls += 1;
      throw new Error("MEDIA_CAPABILITY_PREFLIGHT_FAILED:TTS_PROVIDER_SELECTOR_MISSING");
    },
  };
  const handler = createWorkflowApiHandler({ persistence: {}, queue: {}, control: {}, mediaResumes });
  server = createServer((req, res) => void handler(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => new Promise((resolve) => server.close(resolve)));

test("GET eligibility exposes complete safe media preflight diagnostics", async () => {
  const response = await fetch(`${base}/control/media-resumes/wf-fixture/eligibility`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.mediaCapabilityPreflight, preflight);
  assert.equal(inspectionCalls, 1);
  assert.equal(JSON.stringify(body).includes("present-not-used"), false);
});

test("POST authorize independently reaches enforcement and returns typed preflight conflict", async () => {
  const response = await fetch(`${base}/control/media-resumes/wf-fixture/authorize`, {
    method: "POST",
    headers: { "content-type": "application/json", "Authorization": "Bearer test-owner-token" },
    body: JSON.stringify({ authorizedBy: "owner", rationale: "certification fixture" }),
  });
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error, "MEDIA_CAPABILITY_PREFLIGHT_FAILED:TTS_PROVIDER_SELECTOR_MISSING");
  assert.equal(authorizationCalls, 1);
});
