/**
 * Visual Director spec: full + compact input-package builders (provider-free).
 * The compact V2 builder is the Attempt-2 lesson: identical creative evidence
 * at a fraction of the size, with data-URL exclusion enforced structurally.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVisualDirectorInputPackage,
  buildCompactVisualDirectorInput,
  VISUAL_DIRECTOR_AGENT_ID,
  VISUAL_DIRECTOR_CONSTRAINTS,
} from "../dist/visual-direction/visual-director-spec.js";

const ids = {
  workflowId: "wf-1789233193749-gvydpiah",
  contentId: "2b0f94c8-7a11-4b69-8c31-3d2c45f8a7e1",
  scriptArtifactId: "art-writer",
  brandArtifactId: "art-brand",
  reviewArtifactId: "art-review",
  directorArtifactId: "art-director",
  narrationArtifactId: "art-narration",
  timelineArtifactId: "art-timeline",
  iterationId: "visual-iteration-wf-1",
};
const beats = [
  "hook: writer dilemma, too much research",
  "question: research serving story",
  "rule: keep only the serving detail",
  "method: archive the non-serving research",
  "payoff: narrate only what is needed",
];
const digest = [
  "no global visual world",
  "narration echo used as prompt",
  "scene-002 became fake UI/gibberish",
  "rendering mode drifted across glamour/UI/portrait/cartoon",
];

test("compact package builds with measurement and stays small", () => {
  const result = buildCompactVisualDirectorInput({
    ids, script: "exact approved script text", brand: { brand: "MORROWAY" }, beats, failureDigest: digest,
  });
  assert.equal(result.valid, true);
  assert.equal(result.package.packageVersion, 2);
  assert.ok(result.characterCount > 500, "carries real evidence");
  assert.ok(result.characterCount < 6000, `compact by construction (got ${result.characterCount})`);
  assert.equal(result.approxTokenCount, Math.ceil(result.characterCount / 4));
});

test("compact package requires exactly five beats", () => {
  const short = buildCompactVisualDirectorInput({ ids, script: "s", brand: { b: "m" }, beats: beats.slice(0, 4), failureDigest: digest });
  assert.equal(short.valid, false);
  assert.ok(short.errors.some((e) => e.includes("five narrative beats")));
});

test("compact package rejects image data URLs structurally", () => {
  const bad = buildCompactVisualDirectorInput({
    ids, script: "s", brand: { b: "m" }, beats,
    failureDigest: ["note with data:image/png;base64,xx embedded"],
  });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.some((e) => e.includes("data URLs")));
});

test("compact package fails closed on thin inputs", () => {
  const thin = buildCompactVisualDirectorInput({ workflowId: "wf" });
  assert.equal(thin.valid, false);
  assert.ok(thin.errors.length >= 4);
});

test("full input package still builds and fails closed when thin", () => {
  const good = buildVisualDirectorInputPackage({
    workflowId: "wf", contentId: "c", script: "s", scriptArtifactId: "a",
    brandContext: { brand: "M" }, reviewArtifactId: "r", directorArtifactId: "d",
  });
  assert.equal(good.valid, true);
  const thin = buildVisualDirectorInputPackage({ workflowId: "wf" });
  assert.equal(thin.valid, false);
});

test("director descriptor forbids execution-adjacent powers", () => {
  assert.equal(VISUAL_DIRECTOR_AGENT_ID, "visual-director");
  for (const ban of ["MUST_NOT_GENERATE_IMAGES", "MUST_NOT_APPROVE_OWN_WORK", "MUST_NOT_INVENT_HUMAN_IDENTITY"]) {
    assert.ok(VISUAL_DIRECTOR_CONSTRAINTS.includes(ban));
  }
});
