import assert from "node:assert/strict";
import test from "node:test";
import { assessNarrationFit, assertNarrationWillNotBeCut } from "../dist/media-compose/narration-fit.js";
import { layoutCaption } from "../dist/media-compose/caption-layout.js";

const validationPadPolicy = {
  policyId: "platform-validation-video-tail-pad-v1",
  classification: "PLATFORM_VALIDATION_ONLY",
  enabled: true,
  mode: "LAST_FRAME_HOLD",
  maximumExtensionMs: 6500,
  maximumExtensionRatio: 0.25,
  safetyTailMs: 300,
  measurementToleranceMs: 32,
};
const fitPolicy = { speechSafetyTailMs: 300, maxTempoSpeedup: 1.15, videoTailPad: validationPadPolicy };

test("narration fit passes with a safety tail", () => assert.equal(assessNarrationFit(5031, 4200).fitStatus, "PASS"));
test("slightly long narration requests bounded tempo", () => assert.equal(assessNarrationFit(5031, 4900).fitStatus, "BOUNDED_TEMPO_REQUIRED"));
test("materially long narration fails instead of truncating", () => assert.equal(assessNarrationFit(5031, 6320).fitStatus, "NARRATION_DURATION_MISMATCH"));
test("video already sufficient does not request padding", () => assert.equal(assessNarrationFit(31250, 30920, fitPolicy).fitStatus, "PASS"));
test("short video within governed policy explicitly requests a last-frame hold", () => {
  const result = assessNarrationFit(25156, 30920, fitPolicy);
  assert.equal(result.fitStatus, "VIDEO_TAIL_PAD_REQUIRED");
  assert.deepEqual(result.videoPad, { mode: "LAST_FRAME_HOLD", requiredDurationMs: 6064, targetVideoDurationMs: 31220, reason: "NARRATION_LONGER_THAN_VIDEO_WITHIN_DETERMINISTIC_PAD_POLICY", policyId: validationPadPolicy.policyId });
});
test("tail-pad decision is deterministic across duplicate evaluation", () => assert.deepEqual(assessNarrationFit(25156, 30920, fitPolicy), assessNarrationFit(25156, 30920, fitPolicy)));
test("required padding above the governed limit blocks", () => assert.deepEqual(assessNarrationFit(20000, 30920, fitPolicy).blockReason, "VIDEO_TAIL_PAD_POLICY_EXCEEDED"));
test("disabled tail-pad policy blocks", () => assert.deepEqual(assessNarrationFit(25156, 30920, { ...fitPolicy, videoTailPad: { ...validationPadPolicy, enabled: false } }).blockReason, "VIDEO_TAIL_PAD_DISABLED"));
test("one-frame timebase tolerance permits a fully preserved narration", () => assert.equal(assessNarrationFit(31219, 30920, fitPolicy).fitStatus, "PASS"));
test("measured padded output beyond timebase tolerance still blocks", () => assert.notEqual(assessNarrationFit(31180, 30920, fitPolicy).fitStatus, "PASS"));
test("bounded tempo behavior takes precedence and remains unchanged", () => assert.equal(assessNarrationFit(5031, 4900, fitPolicy).fitStatus, "BOUNDED_TEMPO_REQUIRED"));
test("audio cut guard fails before compose", () => assert.throws(() => assertNarrationWillNotBeCut(5031, 4800), /AUDIO_WOULD_BE_CUT/));
test("full narration is accepted after adequate deterministic padding", () => assert.doesNotThrow(() => assertNarrationWillNotBeCut(31250, 30920)));
test("short caption fits exact 480x832 safe area", () => assert.equal(layoutCaption("Hello world").verdict, "PASS"));
test("long English caption wraps safely", () => { const r = layoutCaption("Two friends, a rooftop garden, and a harvest worth sharing."); assert.equal(r.verdict, "PASS"); assert.ok(r.lines.length <= 2); assert.ok(r.boundingBox.right <= r.safeArea.right); });
test("unsafe unbreakable caption fails", () => assert.equal(layoutCaption("W".repeat(200)).verdict, "CAPTION_LAYOUT_INVALID"));
test("caption wider than safe area fails", () => assert.equal(layoutCaption("x".repeat(100)).verdict, "CAPTION_LAYOUT_INVALID"));
