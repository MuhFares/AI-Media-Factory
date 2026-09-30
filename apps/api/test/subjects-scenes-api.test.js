/**
 * Program 3 subject/scene API (isolated TEST DB): auth enforced, validation
 * fail-closed, reference bytes never duplicated. No execution, no decisions.
 */
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { createPool, migrate, PostgresPersistence, PostgresQueue, ControlPlaneStore, SubjectStore } from "@ai-media-factory/database";
import { createWorkflowApiHandler } from "@ai-media-factory/api";

process.env.AMF_OWNER_TOKEN ??= "test-owner-token";
const AUTH = { Authorization: "Bearer test-owner-token" };
const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory_test";
let pool, server, base;
async function req(path, options = {}) {
  const res = await fetch(`${base}${path}`, { headers: { "Content-Type": "application/json", ...AUTH }, ...options });
  return { status: res.status, body: await res.json() };
}
before(async () => {
  if (DATABASE_URL === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must not reference DATABASE_URL");
  pool = createPool({ connectionString: DATABASE_URL });
  await migrate(pool);
  const handler = createWorkflowApiHandler({
    persistence: new PostgresPersistence(pool),
    queue: new PostgresQueue(pool),
    control: new ControlPlaneStore(pool),
    subjects: new SubjectStore(pool),
  });
  server = createServer((req_, res) => void handler(req_, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); await pool.end(); });

test("subjects require auth; create/approve/attach round-trip", async () => {
  const anon = await fetch(`${base}/control/subjects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: "morroway", name: "H", description: "d" }) });
  assert.equal(anon.status, 401);
  const bad = await req("/control/subjects", { method: "POST", body: JSON.stringify({ projectId: "morroway", name: "", description: "d" }) });
  assert.equal(bad.status, 400);
  const created = await req("/control/subjects", { method: "POST", body: JSON.stringify({ projectId: "morroway", name: "Host", description: "host desc", voiceId: "Mohamed" }) });
  assert.equal(created.status, 201);
  assert.equal(created.body.subject.status, "DRAFT");
  const id = created.body.subject.subjectId;
  const noRat = await req(`/control/subjects/${id}/approve`, { method: "POST", body: JSON.stringify({ rationale: "" }) });
  assert.equal(noRat.status, 400);
  const approved = await req(`/control/subjects/${id}/approve`, { method: "POST", body: JSON.stringify({ approvedBy: "owner", rationale: "verified" }) });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.subject.status, "APPROVED");
  const badKind = await req(`/control/subjects/${id}/references`, { method: "POST", body: JSON.stringify({ projectId: "morroway", artifactId: "art-1", referenceKind: "nope" }) });
  assert.equal(badKind.status, 400);
  const ref = await req(`/control/subjects/${id}/references`, { method: "POST", body: JSON.stringify({ projectId: "morroway", artifactId: "art-1", referenceKind: "front_portrait" }) });
  assert.equal(ref.status, 201);
  const listed = await req(`/control/subjects/${id}/references`);
  assert.deepEqual(listed.body.references.map((r) => r.artifactId), ["art-1"]);
  const missing = await req("/control/subjects/subject-nope/references");
  assert.equal(missing.status, 404);
});

test("scenes require content linkage fields and persist bindings", async () => {
  const bad = await req("/control/scenes", { method: "POST", body: JSON.stringify({ sceneId: "s1" }) });
  assert.equal(bad.status, 400);
  const saved = await req("/control/scenes", { method: "POST", body: JSON.stringify({
    sceneId: "s1", contentId: "content-p3", projectId: "morroway", sequence: 1,
    purpose: "hook", subjects: [{ subjectId: "host-01", expression: "neutral" }],
    environment: "studio", shot: "medium", references: ["ref-1"],
    intent: { consistencyRequired: true },
  }) });
  assert.equal(saved.status, 201);
  assert.deepEqual(saved.body.scene.subjects, [{ subjectId: "host-01", expression: "neutral" }]);
  const listed = await req("/control/scenes?contentId=content-p3");
  assert.deepEqual(listed.body.scenes.map((s) => s.sceneId), ["s1"]);
  const noContent = await req("/control/scenes");
  assert.equal(noContent.status, 400);
});
