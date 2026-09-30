import test from "node:test";
import assert from "node:assert/strict";
import { createVisualStrategy, evaluateImageGate } from "../dist/visual-capability/visual-capability.js";

test("visual strategy supports generic modes and reference policies", () => {
  const s = createVisualStrategy({ topic: "football counterattack", visualMode: "sports/action", referenceStrategy: "NO_REFERENCE", observations: ["stadium", "single decisive action"] });
  assert.equal(s.visualMode, "sports/action");
  assert.match(s.imageBrief, /stadium/);
});

test("image gate fails closed without multimodal runtime", () => {
  const result = evaluateImageGate({ hasMultimodalRuntime: false }, { hasMultimodalRuntime: false });
  assert.equal(result.status, "HUMAN_REVIEW_REQUIRED");
  assert.equal(result.canEnterWan, false);
});

test("image gate blocks visible defects and passes only with both reviews", () => {
  const baseReview = { hasMultimodalRuntime: true, semanticAlignment: true, subjectLocationStyleFidelity: true, genericOrStereotypeDrift: false, sceneIntent: true, referenceAdherence: true };
  const baseQa = { hasMultimodalRuntime: true, generatedText: "none", collageOrGrid: false, anatomy: "clean", duplication: false, geometry: "clean", blurOrArtifacts: false, dimensionsValid: true, fileIntegrityValid: true };
  assert.equal(evaluateImageGate(baseReview, baseQa).status, "PASS");
  assert.equal(evaluateImageGate(baseReview, { ...baseQa, collageOrGrid: true }).status, "FAIL");
});
