/**
 * VISUAL DIRECTION CONTRACT V2 — provider-free hardening tests.
 * Pure deterministic policy: zero provider calls, zero network, zero DB.
 * Provenance: R8 forensic RCA (wf-1789233193749-gvydpiah, attempt 8), where
 * narration-echo prompts with empty constraints produced five incoherent
 * images (incl. a UI/text-centric scene-002) and semantic UNAVAILABLE flowed
 * toward a policy bypass that manufactures human approvals.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  VISUAL_MODE_V2,
  validateVisualDirectionContract,
  compileScenePrompt,
  routeVisualSemanticStatus,
} from "../dist/visual-direction/visual-direction-contract-v2.js";
import { deterministicImageSeed } from "../dist/image-generation/visual-direction.js";

const identity = (overrides = {}) => ({
  visualMode: "photoreal_cinematic",
  realismLevel: "photoreal, natural skin texture, real-world materials",
  cinematicLanguage: "Morroway Threshold: mysterious, amber-shadowed, filmic",
  world: "contemporary writer's study adjoining imagined historical strata",
  era: "present day with historical imagination",
  locationLanguage: "lived-in interiors, paper, lamplight",
  lightingLanguage: "warm practical lighting with deep shadow",
  colorLanguage: "abyssal base with threshold amber accents",
  textureLanguage: "paper grain, wood, fabric weave",
  cameraLanguage: "35mm, shallow depth of field, motivated movement",
  motionLanguage: "slow drift, no lip movement",
  ...overrides,
});

const scene = (overrides = {}) => ({
  sceneId: "scene-001",
  sourceScriptSpan: "hook question about research vs info-dumping",
  narrativePurpose: "establish the writer's dilemma",
  subject: "a writer at a desk surrounded by history books and manuscript pages",
  characterIds: [],
  action: "sorting manuscript pages, setting aside a stack of excess research notes",
  setting: "a lamplit study at night",
  era: "present day",
  shotType: "medium wide",
  cameraAngle: "eye level, slight side angle",
  composition: "desk foreground, bookshelves behind, single subject",
  lighting: "warm desk lamp against cool night window",
  emotion: "curious, quietly overwhelmed",
  wardrobe: ["cardigan", "reading glasses"],
  mustInclude: ["manuscript pages", "stack of books"],
  mustNotInclude: ["screen", "text"],
  textPolicy: "FORBIDDEN",
  uiPolicy: "FORBIDDEN",
  ...overrides,
});

const contract = (sceneOverrides = {}, topOverrides = {}) => ({
  version: 2,
  contentId: "content-fixture",
  storyVisualIdentity: identity(),
  globalContinuity: {
    mustRemainConsistent: ["photoreal rendering", "lamplit study world"],
    allowedVariation: ["camera angle", "time of night"],
    forbiddenStyleShifts: ["cartoon", "anime", "3d render", "glamour portrait"],
  },
  characters: [],
  worldRules: ["no anachronistic devices on screen"],
  forbiddenVisualModes: ["animated_family", "stylized_illustration"],
  defaultTextUiPolicy: { textPolicy: "FORBIDDEN", uiPolicy: "FORBIDDEN" },
  scenes: [scene(sceneOverrides)],
  ...topOverrides,
});

// R8 defect class: narration-echo brief with no visual semantics must fail validation.
test("R8-class defect: narration-echo scene with empty subject/action fails validation", () => {
  const bad = contract({ subject: "", action: "", setting: "", shotType: "" });
  const result = validateVisualDirectionContract(bad);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("subject is required")));
  assert.ok(result.errors.some((e) => e.includes("action is required")));
});

// A: TEXT_POLICY=FORBIDDEN scene cannot compile a UI/text-centric positive prompt.
test("A: TEXT_POLICY=FORBIDDEN blocks UI/text-centric positive material at compile time", () => {
  const c = contract();
  const uiScene = scene({ sceneId: "scene-002", subject: "a mobile app display showing a dashboard interface", action: "scrolling a catalog of menu items", mustNotInclude: [] });
  const result = compileScenePrompt(c, uiScene, "plan-fixture");
  assert.equal(result.status, "BLOCKED");
  assert.match(result.reason, /TEXT_POLICY=FORBIDDEN/);
});

// UI_POLICY=FORBIDDEN independently blocks UI concepts.
test("UI_POLICY=FORBIDDEN blocks device-screen compositions", () => {
  const c = contract();
  const uiScene = scene({ sceneId: "scene-002", subject: "a writer holding a phone", action: "reading notifications on the display", textPolicy: "INCIDENTAL_NONREADABLE", mustNotInclude: [] });
  const result = compileScenePrompt(c, uiScene, "plan-fixture");
  assert.equal(result.status, "BLOCKED");
  assert.match(result.reason, /UI_POLICY=FORBIDDEN/);
});

// mustNotInclude is enforced against positive material, not hoped away by negatives.
test("mustNotInclude violation blocks compilation", () => {
  const c = contract();
  const bad = scene({ subject: "a writer at a desk with a glowing computer screen" });
  assert.equal(compileScenePrompt(c, bad, "plan-fixture").status, "BLOCKED");
});

// B: semantic UNAVAILABLE never becomes PASS.
test("B: UNAVAILABLE routes to human review when gate enabled, never PASS", () => {
  assert.equal(routeVisualSemanticStatus("UNAVAILABLE", true), "HUMAN_REVIEW_REQUIRED");
  assert.equal(routeVisualSemanticStatus("HUMAN_REVIEW_REQUIRED", true), "HUMAN_REVIEW_REQUIRED");
});

// C: semantic FAIL cannot proceed.
test("C: FAIL is BLOCKED regardless of gate policy", () => {
  assert.equal(routeVisualSemanticStatus("FAIL", true), "BLOCKED");
  assert.equal(routeVisualSemanticStatus("FAIL", false), "BLOCKED");
});

// D: gate disabled does not convert UNAVAILABLE into approval.
test("D: UNAVAILABLE with gate disabled is BLOCKED, not approval", () => {
  const route = routeVisualSemanticStatus("UNAVAILABLE", false);
  assert.equal(route, "BLOCKED");
  assert.notEqual(route, "PROCEED_PER_GATE_POLICY");
});

// E/F/G: style lock inherited by every scene; scenes share one visual mode.
test("E/F/G: every scene compiles under the single locked visual mode", () => {
  const c = contract({}, { scenes: [scene({}), scene({ sceneId: "scene-002" }), scene({ sceneId: "scene-003" }), scene({ sceneId: "scene-004" }), scene({ sceneId: "scene-005" })] });
  assert.equal(validateVisualDirectionContract(c).valid, true);
  for (const s of c.scenes) {
    const result = compileScenePrompt(c, s, "plan-fixture");
    assert.equal(result.status, "COMPILED");
    assert.equal(result.compiled.visualMode, "photoreal_cinematic");
    assert.ok(result.compiled.prompt.includes("STYLE LOCK: photoreal_cinematic"));
    assert.equal(result.compiled.lineage.styleLockApplied, true);
    assert.equal(result.compiled.sceneId, s.sceneId);
  }
});

// H: Director scene IDs remain stable (duplicates/renames rejected).
test("H: duplicate or blank scene IDs fail validation", () => {
  const dup = contract({}, { scenes: [scene({}), scene({})] });
  assert.equal(validateVisualDirectionContract(dup).valid, false);
  const blank = contract({}, { scenes: [scene({ sceneId: "  " })] });
  assert.equal(validateVisualDirectionContract(blank).valid, false);
});

// I: structured scene contract persists through lineage.
test("I: compiled output carries scene/contract lineage", () => {
  const c = contract();
  const result = compileScenePrompt(c, c.scenes[0], "plan-fixture");
  assert.equal(result.status, "COMPILED");
  assert.deepEqual(result.compiled.lineage, { contentId: "content-fixture", contractVersion: 2, styleLockApplied: true });
});

// J: validation failure performs no provider I/O (pure synchronous policy).
test("J: compile and validation are synchronous pure functions", () => {
  const c = contract();
  const validated = validateVisualDirectionContract(c);
  assert.equal(validated.valid, true);
  const compiled = compileScenePrompt(c, c.scenes[0], "plan-fixture");
  assert.equal(compiled.status, "COMPILED");
  assert.ok(compiled.compiled.prompt.length > 100);
  assert.ok(compiled.compiled.negativePrompt.includes("cartoon"));
});

// C: global photoreal lock + cartoon scene content fails before provider.
test("C2: scene contradicting the global style lock is BLOCKED", () => {
  const c = contract();
  const cartoon = scene({ sceneId: "scene-005", subject: "a cartoon dragon mascot", action: "posing cheerfully" });
  const blocked = compileScenePrompt(c, cartoon, "plan-fixture");
  assert.equal(blocked.status, "BLOCKED");
  assert.match(blocked.reason, /global style lock/);
  const glamour = scene({ sceneId: "scene-003", subject: "a glamour portrait session", action: "posing for the camera" });
  assert.equal(compileScenePrompt(c, glamour, "plan-fixture").status, "BLOCKED");
});

// G2: same contract compiles deterministically.
test("G2: compilation is deterministic for identical contracts", () => {
  const c = contract();
  const first = compileScenePrompt(c, c.scenes[0], "plan-fixture");
  const second = compileScenePrompt(c, c.scenes[0], "plan-fixture");
  assert.deepEqual(first, second);
});
test("locked visual mode conflicting with forbiddenVisualModes fails validation", () => {
  const c = contract({}, { forbiddenVisualModes: ["photoreal_cinematic"] });
  const result = validateVisualDirectionContract(c);
  assert.equal(result.valid, false);
});

// Dangling character references fail validation.
test("unknown characterIds fail validation", () => {
  const c = contract({ characterIds: ["ghost"] });
  assert.equal(validateVisualDirectionContract(c).valid, false);
});

test("VISUAL_MODE_V2 is a closed lock set", () => {
  assert.ok(VISUAL_MODE_V2.includes("photoreal_cinematic"));
  assert.ok(!VISUAL_MODE_V2.includes("documentary"));
});

// Attempt-3 lesson: foreign payloads (LLM output) must fail closed, never throw.
test("validator is total: garbage input returns invalid, never throws", () => {
  for (const bad of [null, undefined, 42, "nope", [], {}, { version: 2 }, { version: 2, scenes: "x" }, { version: 2, scenes: [null, 42, { sceneId: "scene-001" }] }, { version: 2, forbiddenVisualModes: "x", scenes: [] }, { version: 2, globalContinuity: null, scenes: [] }]) {
    const result = validateVisualDirectionContract(bad);
    assert.equal(result.valid, false, JSON.stringify(bad)?.slice(0, 80));
  }
});

test("compiler is total: garbage input BLOCKS, never throws", () => {
  const c = contract();
  for (const bad of [null, undefined, 42, "x", [], {}]) {
    const result = compileScenePrompt(bad, c.scenes[0], "p");
    assert.equal(result.status, "BLOCKED");
  }
  for (const badScene of [null, undefined, 42, "x", [], {}]) {
    const result = compileScenePrompt(c, badScene, "p");
    assert.equal(result.status, "BLOCKED");
  }
});

// Attempt-3a lesson: the provider omitted top-level forbiddenVisualModes.
// The old validator crashed TypeError here; the hardened validator returns
// invalid with reasons (same strictness outcome, no crash).
test("missing forbiddenVisualModes fails closed with reasons, never throws", () => {
  const c = contract();
  const { forbiddenVisualModes, ...withoutModes } = c;
  void forbiddenVisualModes;
  const result = validateVisualDirectionContract(withoutModes);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("forbiddenVisualModes")));
});

// Attempt-4 evidence: bare "table" is furniture until proven otherwise;
// data-table senses are still caught as phrases.
test("furniture table compiles; data-table phrases still block", () => {
  const c = contract();
  const furniture = scene({ sceneId: "scene-004", subject: "an archive box on a long oak table", action: "hands closing the lid" });
  assert.equal(compileScenePrompt(c, furniture, "p").status, "COMPILED");
  const dataTable = scene({ sceneId: "scene-004", subject: "a printed data table of figures", action: "reading the rows" });
  const blocked = compileScenePrompt(c, dataTable, "p");
  assert.equal(blocked.status, "BLOCKED");
  assert.match(blocked.reason, /data table/);
});

// Envelope reconciliation: comma-joined shift lists normalize to atomic
// terms (no duplicates); positive carries scene terms only, negative the
// full normalized set.
test("exclusion normalization dedupes; positive/negative separate by responsibility", () => {
  const c = contract({}, {
    globalContinuity: {
      mustRemainConsistent: ["same world"],
      allowedVariation: [],
      forbiddenStyleShifts: ["screens, interfaces, logos, title cards", "Screens", "cartoon"],
    },
  });
  const s = scene({ sceneId: "scene-001", mustNotInclude: ["logos", "phones"] });
  const result = compileScenePrompt(c, s, "p");
  assert.equal(result.status, "COMPILED");
  const negTerms = result.compiled.negativePrompt.split(",").map((t) => t.trim().toLowerCase());
  assert.equal(new Set(negTerms).size, negTerms.length, "no duplicate exclusion terms");
  assert.ok(negTerms.includes("screens") && negTerms.includes("interfaces") && negTerms.includes("cartoon"));
  const positiveExclusions = result.compiled.prompt.split("HARD EXCLUSIONS: ")[1] ?? "";
  assert.ok(!positiveExclusions.includes("cartoon"), "global-only shifts stay out of the positive prompt");
  assert.ok(positiveExclusions.includes("logos") && positiveExclusions.includes("phones"), "scene-salient exclusions stay positive");
});

// H/I: seed governance — same authorized execution reuses the seed; a new
// contract (new visual iteration) intentionally changes it.
test("H/I: deterministic seed is stable per execution identity, distinct per iteration", () => {
  const first = deterministicImageSeed("timeline-1", "scene-001", "resume-r8:contract-a");
  assert.equal(deterministicImageSeed("timeline-1", "scene-001", "resume-r8:contract-a"), first);
  assert.ok(Number.isSafeInteger(first) && first >= 0);
  assert.notEqual(deterministicImageSeed("timeline-1", "scene-001", "resume-r9:contract-b"), first);
  assert.notEqual(deterministicImageSeed("timeline-1", "scene-002", "resume-r8:contract-a"), first);
});
