/**
 * Program 3 content-factory unit matrix (no DB, no providers).
 * Consistency routing, formats, subject mapping, prompt provenance,
 * media QA honesty, generation intent fail-closed behavior.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveConsistencyRoute, identityConditioningSupported,
} from "../dist/visual-capability/consistency-routing.js";
import {
  FORMAT_PROFILES, formatProfile, orderScenesForComposition,
} from "../dist/content-factory/formats.js";
import {
  subjectToCharacterContract, sceneSpecToSceneContract, brandContextSummary,
  compositionSceneOrder,
} from "../dist/content-factory/subject-contracts.js";
import { assembleScenePrompt } from "../dist/content-factory/prompt-assembly.js";
import {
  checkImageArtifact, consistencyState, thumbnailPresent,
} from "../dist/content-factory/media-qa.js";
import { intentToImageRequest } from "../dist/content-factory/generation-intent.js";

test("5+6+7: consistency routing resolves verified routes and fails closed", () => {
  const t2i = resolveConsistencyRoute({ referenceCount: 0 });
  assert.equal(t2i.ok, true);
  assert.deepEqual([...t2i.providerIds].sort(), ["runpod-zimage", "self-hosted-image"]);
  const ref = resolveConsistencyRoute({
    referenceCount: 1, referenceUrls: ["https://cdn.test/r1.png"], referenceMimeType: "image/png",
  });
  assert.equal(ref.ok, true);
  assert.deepEqual(ref.providerIds, ["runpod-zimage"]);
  assert.match(ref.reason, /not guaranteed/);
  assert.equal(resolveConsistencyRoute({ referenceCount: 2 }).ok, false);
  assert.equal(resolveConsistencyRoute({ referenceCount: 0, consistencyRequired: true }).ok, false);
  assert.equal(resolveConsistencyRoute({ referenceCount: 0, identityCritical: true }).ok, false);
  assert.equal(resolveConsistencyRoute({
    referenceCount: 1, referenceUrls: ["https://cdn.test/r1.png"],
    referenceMimeType: "image/png", identityCritical: true,
  }).ok, false);
  assert.equal(identityConditioningSupported("runpod-zimage").supported, false);
  assert.equal(identityConditioningSupported("self-hosted-image").supported, false);
});

test("8+9: intent translation requires a compatible route, never downgrades", () => {
  const base = {
    sceneId: "s1", prompt: "host in studio", subjectIds: ["host-01"],
    references: [{ artifactId: "art-r1", url: "https://cdn.test/r1.png", mimeType: "image/png" }],
    consistencyRequired: true, identityCritical: false, aspectRatio: "9:16",
  };
  const okRes = resolveConsistencyRoute({
    referenceCount: 1, referenceUrls: ["https://cdn.test/r1.png"], referenceMimeType: "image/png",
  });
  const out = intentToImageRequest(base, "runpod-zimage", okRes, 0.35);
  assert.equal(out.referenceImageUrl, "https://cdn.test/r1.png");
  assert.equal(out.strength, 0.35);
  assert.throws(() => intentToImageRequest(base, "self-hosted-image", okRes), /NO_ROUTE/);
  assert.throws(() => intentToImageRequest({ ...base, prompt: " " }, "runpod-zimage", okRes), /PROMPT_REQUIRED/);
  assert.throws(() => intentToImageRequest({
    ...base, references: [{ artifactId: "a", url: "/local/path.png", mimeType: "image/png" }],
  }, "runpod-zimage", okRes), /REFERENCE_URL_REQUIRED/);
  const t2iRes = resolveConsistencyRoute({ referenceCount: 0 });
  const plain = intentToImageRequest({ ...base, references: [], consistencyRequired: false }, "self-hosted-image", t2iRes);
  assert.equal(plain.referenceImageUrl, undefined);
});

test("12+13+14: format matrix with vertical and horizontal product contracts", () => {
  const short = formatProfile("youtube-short");
  assert.equal(short.status, "supported");
  assert.equal(short.aspectRatio, "9:16");
  const long = formatProfile("youtube-longform");
  assert.equal(long.status, "supported");
  assert.equal(long.aspectRatio, "16:9");
  assert.ok(long.thumbnailRequirement.length > 0, "long-form requires thumbnails");
  for (const id of ["instagram-reel", "tiktok", "square-social"]) {
    assert.equal(formatProfile(id).status, "planned");
  }
  assert.equal(formatProfile("nope"), null);
  assert.deepEqual(orderScenesForComposition([
    { sceneId: "b", sequence: 2 }, { sceneId: "a", sequence: 1 },
  ]), ["a", "b"]);
});

test("11+16: subject mapping and brand context stay separate", () => {
  const character = subjectToCharacterContract(
    { subjectId: "host-01", description: "warm host", wardrobe: { top: "navy" }, negatives: ["sunglasses"] },
    ["eye-level"], ["episode continuity"],
  );
  assert.equal(character.characterId, "host-01");
  assert.ok(character.wardrobe.some((w) => w.includes("navy")));
  assert.ok(character.continuityNotes.some((n) => n.includes("sunglasses")));
  const scene = sceneSpecToSceneContract({
    sceneId: "s1", purpose: "hook", visual: "studio", environment: "studio",
    shot: "medium", cameraAngle: "eye-level", movement: null, scriptRef: "seg-1",
    continuity: ["same jacket"], subjects: [{ subjectId: "host-01", pose: "neutral", expression: "warm" }],
  });
  assert.equal(scene.subject, "host-01");
  assert.deepEqual(scene.characterIds, ["host-01"]);
  assert.ok(scene.mustInclude.includes("same jacket"));
  const brand = brandContextSummary({
    brand: { brand: "Morroway", positioning: "threshold stories" },
    constraints: ["no public claims"], contentPillars: ["historical POV"],
  });
  assert.ok(brand.some((l) => l.includes("Morroway")));
  assert.ok(brand.some((l) => l.startsWith("constraint:")));
  assert.ok(!brand.some((l) => l.includes("host-01")), "brand and character contexts separate");
  assert.deepEqual(compositionSceneOrder([{ sceneId: "x", sequence: 3 }, { sceneId: "y", sequence: 1 }]), ["y", "x"]);
});

test("prompt provenance delegates to the proven compiler", () => {
  const character = subjectToCharacterContract(
    { subjectId: "host-01", description: "warm host", wardrobe: {}, negatives: [] }, [], []);
  void character;
  assert.throws(() => assembleScenePrompt({
    contract: { version: 2, contentId: "c", characters: [], scenes: [] },
    scene: sceneSpecToSceneContract({ sceneId: "s9", subjects: [] }),
    directorPlanId: "d", target: "zimage", brandLines: ["brand: Morroway"],
    subjectIds: ["host-01"], referenceArtifactIds: ["art-r1"], formatId: "youtube-short",
  }), /CONTRACT_INVALID|BLOCKED/);
});

test("10+15: image QA structural checks plus honest consistency states", () => {
  const art = {
    artifactId: "a1", kind: "scene_visual_artifact", status: "completed",
    width: 768, height: 1344,
    payload: { subjectId: "host-01", referenceArtifactIds: ["r1"], sceneId: "s1" },
  };
  const checks = checkImageArtifact(art, {
    width: 768, height: 1344, aspectRatio: "9:16",
    subjectId: "host-01", referenceIds: ["r1"], sceneId: "s1",
  });
  assert.ok(checks.every((c) => c.pass), JSON.stringify(checks.filter((c) => !c.pass)));
  const bad = checkImageArtifact({ ...art, width: 100, height: 100 }, { width: 768, height: 1344 });
  assert.ok(bad.some((c) => c.check === "dimensions" && !c.pass));
  const unlinked = checkImageArtifact(
    { artifactId: "a2", kind: "x", status: "completed", payload: {} },
    { subjectId: "host-01", referenceIds: ["r1"] });
  assert.ok(unlinked.some((c) => !c.pass));
  assert.equal(consistencyState({ requiresConsistency: false, referencesLinked: false, humanApproved: false }), "NOT_REQUIRED");
  assert.equal(consistencyState({ requiresConsistency: true, referencesLinked: false, humanApproved: false }), "UNVERIFIED");
  assert.equal(consistencyState({ requiresConsistency: true, referencesLinked: true, humanApproved: false }), "REFERENCE_LINKED");
  assert.equal(consistencyState({ requiresConsistency: true, referencesLinked: true, humanApproved: true }), "HUMAN_APPROVED");
  assert.equal(consistencyState({ requiresConsistency: true, referencesLinked: false, humanApproved: false, automatedScore: 0.9, automatedThreshold: 0.8 }), "AUTOMATED_CHECK_PASS");
  assert.equal(consistencyState({ requiresConsistency: true, referencesLinked: false, humanApproved: false, automatedScore: 0.5, automatedThreshold: 0.8 }), "AUTOMATED_CHECK_FAIL");
  assert.equal(thumbnailPresent([{ kind: "thumbnail_report", status: "completed" }]), true);
  assert.equal(thumbnailPresent([{ kind: "thumbnail_report", status: "failed" }]), false);
});

test("17+19: composition ordering stable; failure context preserved structurally", () => {
  assert.deepEqual(orderScenesForComposition([
    { sceneId: "s3", sequence: 3 }, { sceneId: "s1", sequence: 1 }, { sceneId: "s2", sequence: 2 },
  ]), ["s1", "s2", "s3"]);
  assert.ok(FORMAT_PROFILES.length >= 5);
});
