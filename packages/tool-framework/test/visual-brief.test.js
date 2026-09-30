import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBriefImagePrompt,
  buildBriefNegativePrompt,
  buildSceneVisualBrief,
  evaluatePreWanImage,
  validateSceneVisualBrief,
  DeterministicTimelinePlanner,
} from "../dist/index.js";

const script = "ورا المعالم الشهيرة في القاهرة، شوارع كتير شكلت حياتنا وثقافتنا من أجيال. في الأسواق المزدحمة، محلات صغيرة عاملة على الرصيف، باعة، عجل، وموتوسيكلات. دي هي الحكايات اللي مخبية قدام عينينا. إنت شفتها؟";
const segments = [
  "ورا المعالم الشهيرة في القاهرة،",
  "شوارع كتير شكلت حياتنا وثقافتنا من أجيال.",
  "في الأسواق المزدحمة، محلات صغيرة عاملة على الرصيف، باعة، عجل،",
  "وموتوسيكلات. دي هي الحكايات اللي مخبية قدام عينينا.",
  "إنت شفتها؟",
];

test("Cairo brief is scene-specific and preserves exact narration segments", () => {
  const briefs = segments.map((segment, i) => buildSceneVisualBrief(`scene-${String(i + 1).padStart(3, "0")}`, segment, i, segments.length, "authentic Cairo everyday street documentary", "egyptian"));
  assert.equal(briefs.length, 5);
  for (const [i, brief] of briefs.entries()) {
    assert.ok(brief);
    assert.equal(brief.narrationSegment, segments[i]);
    assert.deepEqual(validateSceneVisualBrief(brief), []);
    assert.match(brief.location, /Cairo/iu);
    assert.match(brief.forbiddenElements.join(","), /computer/iu);
    assert.match(brief.forbiddenElements.join(","), /Gulf thobe/iu);
  }
});

test("Cairo prompt derives from physical scene meaning and excludes technology contamination", () => {
  const brief = buildSceneVisualBrief("scene-003", segments[2], 2, 5, "authentic Cairo everyday street documentary", "egyptian");
  const prompt = buildBriefImagePrompt(brief);
  const negative = buildBriefNegativePrompt(brief);
  assert.match(prompt, /street commerce|sidewalk shops|vendors/iu);
  assert.doesNotMatch(prompt, /modern workspace|technology elements|person working with technology/iu);
  assert.match(negative, /computer/iu);
  assert.match(negative, /readable text/iu);
  assert.match(negative, /collage/iu);
});

test("pre-Wan gate blocks material text and collage signals", () => {
  const result = evaluatePreWanImage({ textArtifactScore: 0.8, collageScore: 0.7 });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.canEnterWan, false);
  assert.match(result.reasons.join(";"), /text artifact/iu);
  assert.match(result.reasons.join(";"), /collage/iu);
});

test("pre-Wan gate fails closed when local OCR/layout inspection is unavailable", () => {
  const result = evaluatePreWanImage();
  assert.equal(result.status, "HUMAN_REVIEW_REQUIRED");
  assert.equal(result.ocr, "UNAVAILABLE_LOCAL_ONLY");
  assert.equal(result.canEnterWan, false);
});

test("external ASS is the only caption policy for generated imagery", () => {
  const brief = buildSceneVisualBrief("scene-001", segments[0], 0, 5, "authentic Cairo everyday street documentary", "egyptian");
  assert.match(brief.textPolicy, /captions/iu);
  assert.match(brief.singleShotRequirement, /one coherent/iu);
  assert.doesNotMatch(brief.requiredElements.join(","), /computer|laptop|office/iu);
});

test("timeline planner derives Cairo briefs from the current narration, not project-wide tech defaults", () => {
  const planner = new DeterministicTimelinePlanner();
  const plan = planner.plan({
    script,
    narrationDurationMs: 15980,
    language: "ar",
    dialect: "egyptian",
    culturalContext: "Egyptian Cairo",
    visualStyle: "authentic contemporary Cairo everyday street documentary",
    allowPeople: true,
    allowTalkingHead: false,
  });
  assert.equal(plan.scenes.length, 5);
  assert.equal(plan.scenes.map((scene) => scene.narration.text).join(" "), script);
  for (const scene of plan.scenes) {
    assert.ok(scene.visualBrief);
    assert.deepEqual(validateSceneVisualBrief(scene.visualBrief), []);
    assert.doesNotMatch(scene.imagePrompt, /modern workspace|technology elements|person working with technology|computer|laptop|office desk/iu);
    assert.doesNotMatch(scene.characters.join(" "), /technology creator|host/iu);
  }
  assert.match(plan.scenes[2].visualBrief.requiredElements.join(","), /sidewalk shops/iu);
  assert.match(plan.scenes[3].visualBrief.requiredElements.join(","), /bicycles|motorcycles/iu);
});
