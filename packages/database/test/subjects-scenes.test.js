/**
 * Program 3 — subject/reference/scene persistence matrix (isolated TEST DB).
 * Metadata only; bytes stay in artifacts. Approvals recorded, never rewritten.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate, SubjectStore, REFERENCE_KINDS } from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();

let pool, store;
const PID = `subj-${Date.now().toString(36)}`;
before(async () => {
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  store = new SubjectStore(pool);
});
after(async () => { await pool.end(); });

test("1: subject profile persistence with validation", async () => {
  await assert.rejects(store.createSubject({ projectId: "p", name: " ", description: "d" }), /SUBJECT_NAME_REQUIRED/);
  await assert.rejects(store.createSubject({ projectId: "p", name: "n", description: " " }), /SUBJECT_DESCRIPTION_REQUIRED/);
  const s = await store.createSubject({
    projectId: `${PID}-proj`, name: "Host One", description: "Morroway host, 30s, warm tone",
    traits: { hair: "dark" }, wardrobe: { top: "navy" }, negatives: ["sunglasses"],
    styleContext: "cinematic", voiceId: "Mohamed",
  });
  assert.equal(s.status, "DRAFT");
  assert.deepEqual(s.negatives, ["sunglasses"]);
  assert.equal(s.voiceId, "Mohamed");
  assert.deepEqual((await store.listSubjects(`${PID}-proj`)).map((x) => x.subjectId), [s.subjectId]);
  assert.deepEqual(await store.listSubjects(`${PID}-other`), []);
});

test("2+6: approval recorded with rationale; reference linkage and kinds", async () => {
  const s = await store.createSubject({ projectId: `${PID}-proj`, name: "Host Two", description: "d" });
  await assert.rejects(store.approveSubject(s.subjectId, "owner", " "), /SUBJECT_APPROVAL_RATIONALE_REQUIRED/);
  const approved = await store.approveSubject(s.subjectId, "owner", "face verified by owner");
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.approvalRationale, "face verified by owner");
  await assert.rejects(
    store.attachReference({ subjectId: s.subjectId, projectId: `${PID}-proj`, artifactId: "art-1", referenceKind: "bogus" }),
    /SUBJECT_REFERENCE_KIND_INVALID/);
  const ref = await store.attachReference({ subjectId: s.subjectId, projectId: `${PID}-proj`, artifactId: "art-1", referenceKind: "front_portrait" });
  assert.equal(ref.approved, false);
  assert.ok(REFERENCE_KINDS.includes("front_portrait") && REFERENCE_KINDS.includes("full_body"));
  const ref2 = await store.approveReference(ref.referenceId, "owner");
  assert.equal(ref2.approved, true);
  // Idempotent re-attach returns the same canonical row, never a duplicate.
  const dup = await store.attachReference({ subjectId: s.subjectId, projectId: `${PID}-proj`, artifactId: "art-1", referenceKind: "front_portrait" });
  assert.equal(dup.referenceId, ref.referenceId);
  assert.deepEqual((await store.listReferences(s.subjectId)).map((r) => r.referenceId), [ref.referenceId]);
});

test("3+11: scene subject binding persists and lists in sequence", async () => {
  await assert.rejects(store.saveScene({ sceneId: " ", contentId: "c", projectId: "p", sequence: 1 }), /SCENE_IDENTITY_REQUIRED/);
  await assert.rejects(store.saveScene({
    sceneId: "s", contentId: "c", projectId: "p", sequence: 1, subjects: [{ pose: "x" }],
  }), /SCENE_SUBJECT_ID_REQUIRED/);
  await store.saveScene({
    sceneId: "s2", contentId: `${PID}-c`, projectId: `${PID}-proj`, sequence: 2,
    purpose: "hook", subjects: [{ subjectId: "host-01", pose: "neutral" }],
    environment: "studio", shot: "close-up", references: ["ref-1"],
    intent: { consistencyRequired: true }, status: "PLANNED",
  });
  await store.saveScene({
    sceneId: "s1", contentId: `${PID}-c`, projectId: `${PID}-proj`, sequence: 1,
    subjects: [{ subjectId: "host-01" }], status: "PLANNED",
  });
  const scenes = await store.listScenes(`${PID}-c`);
  assert.deepEqual(scenes.map((s) => s.sceneId), ["s1", "s2"]);
  assert.deepEqual(scenes[1].subjects, [{ subjectId: "host-01", pose: "neutral" }]);
  assert.deepEqual(scenes[1].references, ["ref-1"]);
  assert.deepEqual(scenes[1].intent, { consistencyRequired: true });
});
