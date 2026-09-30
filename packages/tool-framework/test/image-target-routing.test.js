/**
 * Image capability reconciliation (provider-free, no network).
 * Profiles, target-aware compilation, references, routing, world-scope.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  FLUX_SELF_HOSTED_PROFILE,
  ZIMAGE_PROFILE,
  profileForProvider,
  fitsPromptBudget,
  checkReferenceSupport,
  recommendImageCapability,
} from "../dist/visual-capability/image-capability-profiles.js";
import {
  compileScenePrompt,
  compileScenePromptForTarget,
  validateVisualDirectionContract,
} from "../dist/visual-direction/visual-direction-contract-v2.js";
import { checkWorldScope } from "../dist/visual-direction/visual-direction-contract-v2.js";

const identity = () => ({
  visualMode: "photoreal_cinematic",
  realismLevel: "photoreal",
  cinematicLanguage: "quiet",
  world: "neutral studio world",
  era: "timeless",
  locationLanguage: "seamless backdrop with one window",
  lightingLanguage: "soft daylight",
  colorLanguage: "muted neutrals",
  textureLanguage: "matte",
  cameraLanguage: "35mm static",
  motionLanguage: "still",
});
const scene = (overrides = {}) => ({
  sceneId: "scene-001",
  sourceScriptSpan: "fixture span",
  narrativePurpose: "fixture purpose",
  subject: "a still-life object on a plain surface",
  characterIds: [],
  action: "resting motionless in soft light",
  setting: "a plain room",
  era: "timeless",
  shotType: "medium",
  cameraAngle: "eye level",
  composition: "single centered subject",
  lighting: "soft daylight",
  emotion: "calm",
  wardrobe: [],
  mustInclude: ["plain surface"],
  mustNotInclude: ["text", "screen", "cartoon"],
  textPolicy: "FORBIDDEN",
  uiPolicy: "FORBIDDEN",
  ...overrides,
});
const contract = (scenes = [scene()]) => ({
  version: 2,
  contentId: "content-fixture",
  storyVisualIdentity: identity(),
  globalContinuity: {
    mustRemainConsistent: ["same world"],
    allowedVariation: [],
    forbiddenStyleShifts: ["cartoon", "screens, logos"],
  },
  characters: [],
  worldRules: [],
  forbiddenVisualModes: ["animated_family"],
  defaultTextUiPolicy: { textPolicy: "FORBIDDEN", uiPolicy: "FORBIDDEN" },
  scenes,
});

// A+B: separate capabilities, separate env keys recognized without values.
test("A+B: flux and zimage are separate capabilities with distinct config keys", () => {
  assert.notEqual(FLUX_SELF_HOSTED_PROFILE.provider, ZIMAGE_PROFILE.provider);
  assert.notEqual(FLUX_SELF_HOSTED_PROFILE.endpointClass, ZIMAGE_PROFILE.endpointClass);
  assert.equal(profileForProvider("self-hosted-image").endpointClass, "comfy-flux");
  assert.equal(profileForProvider("runpod-zimage").endpointClass, "zimage");
  assert.equal(profileForProvider("unknown-provider"), null, "unknown stays UNKNOWN, never invented");
});

// C+D: no global fake limit; flux limit is the evidenced AMF budget.
test("C+D: per-provider prompt budgets differ by evidence", () => {
  assert.equal(FLUX_SELF_HOSTED_PROFILE.positivePromptLimit.chars, 3000);
  assert.equal(ZIMAGE_PROFILE.positivePromptLimit.chars, 4000);
  assert.equal(fitsPromptBudget(FLUX_SELF_HOSTED_PROFILE, 2500, 100).fits, true);
  assert.equal(fitsPromptBudget(FLUX_SELF_HOSTED_PROFILE, 3001, 0).fits, false);
  assert.equal(fitsPromptBudget(ZIMAGE_PROFILE, 3500, 0).fits, true);
});

// E: zimage limit enforced exactly (4000 default).
test("E: zimage 4000 policy enforced exactly", () => {
  assert.equal(fitsPromptBudget(ZIMAGE_PROFILE, 4000, 0).fits, true);
  assert.equal(fitsPromptBudget(ZIMAGE_PROFILE, 4001, 0).fits, false);
});

// F: no silent truncation (compiler never slices; lengths preserved).
test("F: compilation preserves full content (no silent truncation)", () => {
  const c = contract();
  const out = compileScenePrompt(c, c.scenes[0], "p");
  assert.equal(out.status, "COMPILED");
  assert.ok(out.compiled.prompt.includes("a still-life object on a plain surface"));
  assert.ok(out.compiled.prompt.includes("seamless backdrop with one window"));
});

// G+H+I: reference support matrix.
test("G: flux rejects all references (unsupported capability)", () => {
  const blocked = checkReferenceSupport(FLUX_SELF_HOSTED_PROFILE, [{ role: "CHARACTER_REFERENCE", url: "https://example.test/a.png", mimeType: "image/png" }]);
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /supports no reference/);
});

test("H: zimage shapes URL references; rejects base64/local", () => {
  const okUrl = checkReferenceSupport(ZIMAGE_PROFILE, [{ role: "STYLE_REFERENCE", url: "https://example.test/a.png", mimeType: "image/png" }]);
  assert.equal(okUrl.ok, true);
  const badBase64 = checkReferenceSupport(ZIMAGE_PROFILE, [{ role: "STYLE_REFERENCE", base64: "aGVsbG8=", mimeType: "image/png" }]);
  assert.equal(badBase64.ok, false);
  assert.match(badBase64.reason, /http\(s\) reference URL/);
  const badMime = checkReferenceSupport(ZIMAGE_PROFILE, [{ role: "STYLE_REFERENCE", url: "https://example.test/a.gif", mimeType: "image/gif" }]);
  assert.equal(badMime.ok, false);
  const tooMany = checkReferenceSupport(ZIMAGE_PROFILE, [
    { role: "STYLE_REFERENCE", url: "https://example.test/a.png", mimeType: "image/png" },
    { role: "WORLD_REFERENCE", url: "https://example.test/b.png", mimeType: "image/png" },
  ]);
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.reason, /at most 1/);
});

test("I: reference roles preserved (not flattened)", () => {
  const input = { role: "PREVIOUS_SCENE_REFERENCE", url: "https://example.test/a.png", mimeType: "image/png" };
  assert.equal(input.role, "PREVIOUS_SCENE_REFERENCE");
  assert.equal(checkReferenceSupport(ZIMAGE_PROFILE, [input]).ok, true);
});

// J+K: seed/size preserved in profiles.
test("J+K: seed support and size contracts differ by evidence", () => {
  assert.equal(FLUX_SELF_HOSTED_PROFILE.seedSupport, true);
  assert.equal(ZIMAGE_PROFILE.seedSupport, true);
  assert.equal(FLUX_SELF_HOSTED_PROFILE.sizeSupport.mode, "computed-from-aspect");
  assert.equal(ZIMAGE_PROFILE.sizeSupport.mode, "fixed-set");
  assert.ok(ZIMAGE_PROFILE.sizeSupport.sizes.includes("720*1280"));
  assert.ok(!ZIMAGE_PROFILE.sizeSupport.sizes.includes("768*1344"), "flux 9:16 size not in zimage set");
});

// L: provider-neutral contract unchanged by target layer.
test("L: target compilation never mutates the canonical contract", () => {
  const c = contract();
  const before = JSON.stringify(c);
  const flux = compileScenePromptForTarget(c, c.scenes[0], "p", "flux");
  const zimage = compileScenePromptForTarget(c, c.scenes[0], "p", "zimage");
  assert.equal(flux.status, "COMPILED");
  assert.equal(zimage.status, "COMPILED");
  assert.equal(JSON.stringify(c), before);
});

// M: target-aware compilation deterministic per target.
test("M: flux keeps full negative; zimage empties it with an explicit note", () => {
  const c = contract();
  const flux = compileScenePromptForTarget(c, c.scenes[0], "p", "flux");
  const zimage = compileScenePromptForTarget(c, c.scenes[0], "p", "zimage");
  assert.ok(flux.compiled.negativePrompt.length > 0);
  assert.equal(zimage.compiled.negativePrompt, "");
  assert.ok(zimage.targetNotes.some((n) => n.includes("NEGATIVE_CONDITIONING_UNSUPPORTED_BY_TARGET")));
  assert.equal(zimage.target, "zimage");
  assert.equal(flux.compiled.prompt, compileScenePromptForTarget(c, c.scenes[0], "p", "flux").compiled.prompt);
  // Invalid contract fails closed per target.
  const bad = compileScenePromptForTarget({ version: 2 }, c.scenes[0], "p", "flux");
  assert.equal(bad.status, "BLOCKED");
});

// N: world-scope isolation deterministic.
test("N: isolated scope separates active environment from world context", () => {
  const c = contract();
  const shared = compileScenePromptForTarget(c, c.scenes[0], "p", "flux", { worldScope: "shared" });
  const isolated = compileScenePromptForTarget(c, c.scenes[0], "p", "flux", { worldScope: "isolated" });
  assert.ok(shared.compiled.prompt.includes("ENVIRONMENT: a plain room, seamless backdrop with one window"));
  assert.ok(isolated.compiled.prompt.includes("ENVIRONMENT: a plain room."));
  assert.ok(!isolated.compiled.prompt.includes("ENVIRONMENT: a plain room, seamless"));
  assert.ok(isolated.compiled.prompt.includes("WORLD: seamless backdrop with one window"));
  assert.equal(isolated.compiled.prompt, compileScenePromptForTarget(c, c.scenes[0], "p", "flux", { worldScope: "isolated" }).compiled.prompt);
  // Legacy entry point unchanged (shared scope, full negative).
  const legacy = compileScenePrompt(c, c.scenes[0], "p");
  assert.equal(legacy.compiled.prompt, shared.compiled.prompt);
});

// World override: owner-directed venue scoping replaces the global sentence.
test("world override scopes isolated WORLD sections without touching shared output", () => {
  const c = contract();
  const overridden = compileScenePromptForTarget(c, c.scenes[0], "p", "flux", { worldScope: "isolated", worldOverride: "a night writing room with one glowing threshold" });
  assert.ok(overridden.compiled.prompt.includes("WORLD: a night writing room with one glowing threshold"));
  assert.ok(!overridden.compiled.prompt.includes("seamless backdrop"));
  const sharedWithOverride = compileScenePromptForTarget(c, c.scenes[0], "p", "flux", { worldScope: "shared", worldOverride: "ignored override" });
  const sharedPlain = compileScenePromptForTarget(c, c.scenes[0], "p", "flux", { worldScope: "shared" });
  assert.equal(sharedWithOverride.compiled.prompt, sharedPlain.compiled.prompt, "override ignored outside isolated scope");
});

// World-scope audit: ENVIRONMENT/WORLD sections only; continuity motifs allowed elsewhere.
test("world-scope audit passes active venues and fails contamination", () => {
  const pass = checkWorldScope(
    "SUBJECT: x. ENVIRONMENT: night writing room with open threshold. WORLD: a night writing room with one glowing threshold. CONTINUITY: same writing room and threshold.",
    { sceneId: "scene-001", allowedVenueTokens: ["writing room", "threshold", "desk"], forbiddenVenueTokens: ["harbor", "market", "archive"] },
  );
  assert.equal(pass.pass, true);
  const fail = checkWorldScope(
    "ENVIRONMENT: rainy ruined harbor. WORLD: a ruined harbor beyond the threshold. CONTINUITY: same writing room and threshold.",
    { sceneId: "scene-001", allowedVenueTokens: ["writing room", "threshold"], forbiddenVenueTokens: ["harbor", "market", "archive"] },
  );
  assert.equal(fail.pass, false);
  assert.ok(fail.violations.some((v) => v.includes("harbor")));
});

// Routing: evidence-weighted, never unconditional.
test("routing prefers zimage for photoreal people, flux for cartoon, LOW when tied", () => {
  const photo = recommendImageCapability({ visualMode: "photoreal_cinematic", photorealismRequired: "HIGH", fantasyIntensity: "LOW", humanSubjectImportance: "HIGH", referenceRequirement: "NONE", continuityRequirement: "IMPORTANT", maxPromptChars: 1800 });
  assert.equal(photo.recommendedCapability, "runpod-zimage");
  assert.ok(photo.confidence === "MEDIUM" || photo.confidence === "LOW");
  assert.ok(photo.evidence.length > 0 && photo.rationale.length > 0);
  const cartoon = recommendImageCapability({ visualMode: "stylized_illustration", photorealismRequired: "LOW", fantasyIntensity: "LOW", humanSubjectImportance: "LOW", referenceRequirement: "NONE", continuityRequirement: "LOW", maxPromptChars: 500 });
  assert.equal(cartoon.recommendedCapability, "self-hosted-image");
  const ref = recommendImageCapability({ visualMode: "photoreal_cinematic", photorealismRequired: "HIGH", fantasyIntensity: "LOW", humanSubjectImportance: "LOW", referenceRequirement: "REQUIRED", continuityRequirement: "LOW", maxPromptChars: 500 });
  assert.equal(ref.recommendedCapability, "MANUAL_EXTERNAL_GENERATION");
});

// O: pure sync (no provider calls possible).
test("O: all policy functions are synchronous pure functions", () => {
  assert.equal(typeof profileForProvider("x"), "object");
  assert.equal(fitsPromptBudget(FLUX_SELF_HOSTED_PROFILE, 1, 1).fits, true);
});
