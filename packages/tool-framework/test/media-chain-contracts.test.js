import { describe, it } from "node:test";
import { strictEqual, throws } from "node:assert";
import { assertMeasuredNarration, assertSceneLineage } from "../dist/index.js";

describe("production media-chain contracts", () => {
  it("accepts measured narration and rejects missing duration/integrity", () => {
    const valid = { workflowId: "wf", contentId: "c", scriptIdentity: "s", language: "en", voice: "hannah", provider: "fixture", audioArtifactReference: "audio.wav", durationMs: 4321, audioIntegrity: "VALID", generationId: "tts-1" };
    assertMeasuredNarration(valid);
    throws(() => assertMeasuredNarration({ ...valid, durationMs: 0 }), /NARRATION_ARTIFACT_INVALID/);
    throws(() => assertMeasuredNarration({ ...valid, audioIntegrity: "UNKNOWN" }), /NARRATION_ARTIFACT_INVALID/);
  });

  it("preserves stable scene ordering", () => {
    assertSceneLineage(["scene-001", "scene-002", "scene-003"], ["scene-001", "scene-002", "scene-003"]);
    throws(() => assertSceneLineage(["scene-001", "scene-002"], ["scene-002", "scene-001"]), /SCENE_IDENTITY_MISMATCH/);
    strictEqual(true, true);
  });
});
