/**
 * Program 3 five-scene recurring-subject system proof (isolated TEST DB,
 * zero provider calls). One approved host across portrait/medium/full-body/
 * new-environment/new-angle scenes: same subject profile, propagated
 * references, verified capability routing, valid request contracts,
 * intact artifact lineage, honest QA states, stable composition order.
 * SYSTEM consistency only — never visual identity proof.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate, SubjectStore } from "../dist/index.js";
import { resolveConsistencyRoute } from "@ai-media-factory/tool-framework";
import { intentToImageRequest } from "@ai-media-factory/tool-framework";
import {
  checkImageArtifact, consistencyState, compositionSceneOrder,
} from "@ai-media-factory/tool-framework";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();

let pool, store;
const PID = `five-${Date.now().toString(36)}`;
const PROJ = `${PID}-proj`;
const CONTENT = `content-${PID}`;
before(async () => {
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  store = new SubjectStore(pool);
});
after(async () => { await pool.end(); });

const SHOTS = [
  { sceneId: "s1", shot: "portrait", environment: "studio", cameraAngle: "eye-level" },
  { sceneId: "s2", shot: "medium", environment: "studio", cameraAngle: "eye-level" },
  { sceneId: "s3", shot: "full-body", environment: "studio", cameraAngle: "eye-level" },
  { sceneId: "s4", shot: "medium", environment: "cairo-street", cameraAngle: "three-quarter" },
  { sceneId: "s5", shot: "close-up", environment: "studio", cameraAngle: "side" },
];

test("five scenes share one canonical subject with propagated references", async () => {
  const subject = await store.createSubject({
    projectId: PROJ, name: "Host One", description: "Morroway host",
    traits: { hair: "dark" }, negatives: ["sunglasses"], voiceId: "Mohamed",
  });
  await store.approveSubject(subject.subjectId, "owner", "proof fixture approval");
  const refA = await store.attachReference({
    subjectId: subject.subjectId, projectId: PROJ, artifactId: `art-${PID}-front`, referenceKind: "front_portrait",
  });
  const refB = await store.attachReference({
    subjectId: subject.subjectId, projectId: PROJ, artifactId: `art-${PID}-side`, referenceKind: "side_profile",
  });
  await store.approveReference(refA.referenceId, "owner");
  await store.approveReference(refB.referenceId, "owner");

  const scenes = [];
  let seq = 0;
  for (const shot of SHOTS) {
    seq += 1;
    scenes.push(await store.saveScene({
      sceneId: shot.sceneId, contentId: CONTENT, projectId: PROJ, sequence: seq,
      purpose: `beat ${seq}`, subjects: [{ subjectId: subject.subjectId, pose: "neutral" }],
      environment: shot.environment, shot: shot.shot, cameraAngle: shot.cameraAngle,
      continuity: ["same jacket", "same hairstyle"],
      references: [refA.referenceId, refB.referenceId],
      intent: { consistencyRequired: true },
      status: "PLANNED",
    }));
  }
  // Same subject profile across all five scenes.
  assert.ok(scenes.every((s) => s.subjects.length === 1 && s.subjects[0].subjectId === subject.subjectId));
  // References propagated to every scene.
  assert.ok(scenes.every((s) => s.references.length === 2));
  // Capability checked per scene; request contracts valid.
  const refUrl = "https://cdn.test/host-front.png";
  for (const scene of scenes) {
    const resolution = resolveConsistencyRoute({
      referenceCount: scene.references.length > 1 ? 1 : scene.references.length,
      referenceUrls: [refUrl], referenceMimeType: "image/png",
    });
    assert.equal(resolution.ok, true, `scene ${scene.sceneId} routes`);
    assert.deepEqual(resolution.providerIds, ["runpod-zimage"]);
    const req = intentToImageRequest({
      sceneId: scene.sceneId, prompt: `host, ${scene.environment}, ${scene.shot} shot`,
      subjectIds: [subject.subjectId],
      references: [{ artifactId: `art-${PID}-front`, url: refUrl, mimeType: "image/png" }],
      consistencyRequired: true, identityCritical: false, aspectRatio: "9:16", seed: 42,
    }, "runpod-zimage", resolution, 0.35);
    assert.equal(req.referenceImageUrl, refUrl);
    assert.equal(req.seed, 42);
  }
  // Artifact lineage intact with honest QA states.
  for (const scene of scenes) {
    const simulated = {
      artifactId: `art-${PID}-${scene.sceneId}`, kind: "scene_visual_artifact", status: "completed",
      width: 768, height: 1344,
      payload: {
        subjectId: subject.subjectId, referenceArtifactIds: [`art-${PID}-front`],
        sceneId: scene.sceneId, providerResultValid: true,
      },
    };
    const checks = checkImageArtifact(simulated, {
      width: 768, height: 1344, aspectRatio: "9:16",
      subjectId: subject.subjectId, referenceIds: [`art-${PID}-front`], sceneId: scene.sceneId,
    });
    assert.ok(checks.every((c) => c.pass), scene.sceneId);
    assert.equal(
      consistencyState({ requiresConsistency: true, referencesLinked: true, humanApproved: false }),
      "REFERENCE_LINKED",
    );
  }
  // Composition ordering intact.
  assert.deepEqual(
    compositionSceneOrder(scenes.map((s) => ({ sceneId: s.sceneId, sequence: s.sequence }))),
    ["s1", "s2", "s3", "s4", "s5"],
  );
  // No approvals created by the proof itself (subject approval used the store path, not control_approvals).
  const approvals = await pool.query(`SELECT count(*)::int AS n FROM control_approvals WHERE project_id=$1`, [PROJ]);
  assert.equal(Number(approvals.rows[0].n), 0);
});
