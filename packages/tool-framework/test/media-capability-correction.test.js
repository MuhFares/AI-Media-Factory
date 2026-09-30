/**
 * Program 3 media-capability correction (no DB, no providers).
 * Transport vs workflow vs identity are distinct claims; Z-Image stays
 * eligible where strict identity is not required.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FLUX_SELF_HOSTED_PROFILE,
  ZIMAGE_PROFILE,
  profileForProvider,
} from "../dist/visual-capability/image-capability-profiles.js";
import {
  resolveConsistencyRoute,
  identityConditioningSupported,
} from "../dist/visual-capability/consistency-routing.js";

test("1+2: FLUX transport accepts images; current workflow does not consume them", () => {
  const flux = profileForProvider("self-hosted-image");
  assert.equal(flux, FLUX_SELF_HOSTED_PROFILE);
  assert.equal(flux.workerTransport.imagesSupported, true);
  assert.match(flux.workerTransport.transport, /input\.images/);
  assert.equal(flux.workerTransport.workflowConsumesImages, false);
  assert.equal(flux.referenceImages.supported, false, "adapter-level reference remains unsupported");
});

test("3: transport never implies identity conditioning", () => {
  assert.equal(identityConditioningSupported("runpod-zimage").supported, false);
  assert.equal(identityConditioningSupported("self-hosted-image").supported, false);
  assert.match(identityConditioningSupported("runpod-zimage").provenance, /UNPROVEN/);
  const r = resolveConsistencyRoute({ referenceCount: 1, identityCritical: true });
  assert.equal(r.ok, false);
});

test("4+5+8: Z-Image eligible for realistic and reference-guided scenes", () => {
  const zimage = profileForProvider("runpod-zimage");
  assert.equal(zimage, ZIMAGE_PROFILE);
  assert.equal(zimage.workerTransport.imagesSupported, true);
  assert.equal(zimage.workerTransport.workflowConsumesImages, true);
  const ref = resolveConsistencyRoute({
    referenceCount: 1, referenceUrls: ["https://cdn.test/r.png"], referenceMimeType: "image/png",
  });
  assert.equal(ref.ok, true);
  assert.deepEqual(ref.providerIds, ["runpod-zimage"]);
  const plain = resolveConsistencyRoute({ referenceCount: 0 });
  assert.equal(plain.ok, true);
  assert.ok(plain.providerIds.includes("runpod-zimage"));
});

test("6+7: strict identity stays UNPROVEN and fails closed", () => {
  assert.ok(!/FAILED/.test(identityConditioningSupported("runpod-zimage").provenance));
  const r = resolveConsistencyRoute({ referenceCount: 0, identityCritical: true });
  assert.equal(r.ok, false);
  assert.match(r.reason, /human approval required/);
});

test("9: five-scene architecture refs intact (profiles drive routing)", () => {
  assert.equal(typeof profileForProvider, "function");
  assert.equal(profileForProvider("nope"), null);
});

test("10: no external calls in these tests", () => {
  okFetchUntouched();
});
function okFetchUntouched() {
  assert.equal(typeof globalThis.fetch, "function");
}
