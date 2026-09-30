/**
 * Slice 8 domain remediation — canonical Project Registry tests.
 * Positive membership: only registered projects appear, regardless of
 * naming. Operational rows alone never create Hub projects.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate, ControlPlaneStore } from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();

let pool, control;
before(async () => {
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  control = new ControlPlaneStore(pool);
});
after(async () => { await pool.end(); });

const runId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function submitWorkflow(projectId) {
  const wf = `wf-reg-${runId()}`;
  await pool.query(
    `INSERT INTO workflow_submissions (submission_key, workflow_id, directive, correlation_id, brand_id, definition, status, created_at, updated_at)
     VALUES ($1,$2,'research','corr-reg', $3,'{}','completed', $4, $4)
     ON CONFLICT (submission_key) DO NOTHING`,
    [`sub-${wf}`, wf, projectId, new Date().toISOString()]);
  return wf;
}

test("migrate seeds Morroway as the canonical reference project", async () => {
  const m = await control.getProject("morroway");
  assert.ok(m, "morroway registered by migration");
  assert.equal(m.displayName, "Morroway");
  assert.equal(m.status, "ACTIVE");
  const again = await control.registerProject({ projectId: "morroway" });
  assert.equal(again.created, false, "re-registration is idempotent");
  assert.equal(again.project.displayName, "Morroway", "seed values win over empty re-register");
});

test("arbitrary operational project_ids never become Hub projects", async () => {
  const ghost = `random-internal-${runId()}`;
  await submitWorkflow(ghost);
  await pool.query(
    `INSERT INTO control_approvals (approval_id, project_id, target_type, target_id, agent_recommendation, evidence_refs, status, created_at)
     VALUES ($1,$2,'artifact','t','{}','[]','PENDING',$3) ON CONFLICT (approval_id) DO NOTHING`,
    [`approval-${runId()}`, ghost, new Date().toISOString()]);
  const projects = await control.listProjects();
  assert.ok(!projects.some((p) => p.projectId === ghost), "operational rows alone create nothing");
  assert.equal(await control.getProject(ghost), null);
});

test("strat-dec-* style internal namespaces stay out of the Hub", async () => {
  const internal = `strat-dec-${runId()}`;
  await submitWorkflow(internal);
  const projects = await control.listProjects();
  assert.ok(!projects.some((p) => p.projectId === internal));
});

test("registered second project appears regardless of name; stats aggregate", async () => {
  const second = `brand2-${runId()}`;
  const res = await control.registerProject({ projectId: second, displayName: "Second Brand", createdBy: "test" });
  assert.equal(res.created, true);
  assert.deepEqual(res.project, { projectId: second, displayName: "Second Brand", status: "ACTIVE" });
  await submitWorkflow(second);
  const projects = await control.listProjects();
  const found = projects.find((p) => p.projectId === second);
  assert.ok(found, "registered project listed by any name");
  assert.equal(found.displayName, "Second Brand");
  assert.equal(found.workflowCount, 1, "workflow stats aggregate onto registry rows");
  assert.ok(found.latestWorkflowId.startsWith("wf-reg-"));
  // Morroway still present alongside.
  assert.ok(projects.some((p) => p.projectId === "morroway"));
});

test("registration validates input; missing project lookup is null, not an error", async () => {
  await assert.rejects(control.registerProject({ projectId: "  " }), /CONTROL_PROJECT_ID_REQUIRED/);
  assert.equal(await control.getProject(`never-registered-${runId()}`), null);
});

test("restart-stable: re-migrate keeps registry rows, Hub membership unchanged", async () => {
  const before = (await control.listProjects()).map((p) => p.projectId).sort();
  await migrate(pool);
  const after = (await control.listProjects()).map((p) => p.projectId).sort();
  assert.deepEqual(after, before);
  assert.ok(after.includes("morroway"));
});
