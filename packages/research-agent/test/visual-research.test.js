import test from "node:test";
import assert from "node:assert/strict";
import { isVisualResearchResult } from "../../tool-framework/dist/visual-capability/visual-capability.js";

test("visual research contract accepts image and provenance fields", () => {
  assert.equal(isVisualResearchResult({ topic: "a stadium", visualMode: "sports/action", referenceStrategy: "WEB_VISUAL_RESEARCH", imageRefs: [], sourceRefs: [], observations: ["floodlights"], environment: ["stadium"], styleCues: ["editorial"], avoidCues: ["logos"], provenance: "web" }), true);
});

test("visual research contract rejects unsupported modes and missing refs", () => {
  assert.equal(isVisualResearchResult({ topic: "x", visualMode: "cairo_only", referenceStrategy: "NO_REFERENCE", imageRefs: [], sourceRefs: [], observations: [], provenance: "none" }), false);
});
