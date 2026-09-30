/**
 * MORROWAY ITERATION DRAFT — structural certification (provider-free, no DB).
 *
 * The draft is an agent-authored creative PROPOSAL (authority:
 * OWNER_REVIEW_REQUIRED), never canonical direction. These tests prove the
 * structural contract: real validator, real compiler, adapter limits,
 * no narration echoes, no demographic invention, deterministic seeds.
 * Creative quality itself remains OWNER_REVIEW_REQUIRED.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateVisualDirectionContract,
  compileScenePrompt,
} from "@ai-media-factory/tool-framework";
import { deterministicImageSeed } from "@ai-media-factory/tool-framework";
import { buildVisualDirectorInputPackage } from "@ai-media-factory/tool-framework";
import { buildMorrowayIterationDraft } from "./visual-iteration-morroway-draft.js";

const draft = buildMorrowayIterationDraft();
const contract = draft.contract;

test("draft provenance is explicitly non-canonical", () => {
  assert.equal(draft.provenance.authority, "agent-drafted");
  assert.equal(draft.provenance.ownerReview, "REQUIRED");
  assert.ok(draft.provenance.basis.length >= 4);
});

test("draft contract validates under the real V2 validator", () => {
  const result = validateVisualDirectionContract(contract);
  assert.equal(result.valid, true, JSON.stringify(result.valid === false ? result.errors : []));
});

test("exactly five scene contracts validate with script-span lineage", () => {
  assert.equal(contract.scenes.length, 5);
  assert.deepEqual(contract.scenes.map((s) => s.sceneId), ["scene-001", "scene-002", "scene-003", "scene-004", "scene-005"]);
  for (const scene of contract.scenes) {
    assert.ok(scene.sourceScriptSpan && scene.sourceScriptSpan.length > 10, `${scene.sceneId} references its script span`);
    assert.ok(scene.subject && scene.action && scene.setting && scene.shotType);
    assert.equal(scene.textPolicy, "FORBIDDEN");
    assert.equal(scene.uiPolicy, "FORBIDDEN");
  }
  assert.equal(contract.characters.length, 0, "no visible identity: hands/silhouette grammar only");
});

test("all five scenes compile with the style lock and fit the adapter contract", () => {
  for (const scene of contract.scenes) {
    const result = compileScenePrompt(contract, scene, "art-director-r8");
    assert.equal(result.status, "COMPILED", scene.sceneId);
    assert.ok(result.compiled.prompt.includes("STYLE LOCK: photoreal_cinematic"), scene.sceneId);
    assert.ok(result.compiled.prompt.length <= 1000, `${scene.sceneId} fits the 1000-char adapter contract`);
    assert.ok(result.compiled.prompt.length > 200, `${scene.sceneId} carries real visual content`);
    assert.equal(result.compiled.lineage.styleLockApplied, true);
    assert.equal(result.compiled.negativePrompt.includes("cartoon"), true);
  }
});

test("no narration echo survives compilation", () => {
  for (const scene of contract.scenes) {
    const result = compileScenePrompt(contract, scene, "art-director-r8");
    assert.equal(result.status, "COMPILED");
    assert.ok(!result.compiled.prompt.includes("Visually advance:"), scene.sceneId);
  }
});

test("no unsupported demographic claims anywhere in the draft", () => {
  const text = JSON.stringify(draft);
  const forbidden = ["egyptian", "blonde", "brunette", "male", "female", "\\bman\\b", "\\bwow\\b", "\\bwoman\\b", "\\bboy\\b", "\\bgirl\\b", "\\bchild\\b", "nationality", "ethnicity", "year-old", "\\b30s\\b", "arab(?![a-z])"];
  for (const token of forbidden) {
    assert.ok(!new RegExp(token, "i").test(text), `demographic token present: ${token}`);
  }
});

test("seeds are deterministic per scene and distinct across scenes", () => {
  const seeds = contract.scenes.map((scene) => deterministicImageSeed("timeline-r8", scene.sceneId, "visual-iteration-draft:contract-v1"));
  assert.equal(new Set(seeds).size, 5);
  for (const seed of seeds) assert.ok(Number.isSafeInteger(seed) && seed >= 0);
  assert.equal(deterministicImageSeed("timeline-r8", "scene-001", "visual-iteration-draft:contract-v1"), seeds[0]);
});

test("visual director input package builds from canonical evidence, fails closed when thin", () => {
  const good = buildVisualDirectorInputPackage({
    workflowId: "wf-1789233193749-gvydpiah",
    contentId: "2b0f94c8-7a11-4b69-8c31-3d2c45f8a7e1",
    script: "canonical script text",
    scriptArtifactId: "art-writer",
    brandContext: { brand: "MORROWAY", essence: "A journey through time and imagination." },
    reviewArtifactId: "art-review",
    directorArtifactId: "art-director",
    policy: { textPolicy: "FORBIDDEN", uiPolicy: "FORBIDDEN", requireNoVisibleIdentity: true },
  });
  assert.equal(good.valid, true);
  const thin = buildVisualDirectorInputPackage({ workflowId: "wf" });
  assert.equal(thin.valid, false);
  assert.ok(thin.errors.length >= 4, "missing creative evidence fails closed, never fabricated");
});
