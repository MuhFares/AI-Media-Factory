/**
 * Strategic runtime integration (isolated TEST DB where DB is touched).
 * - Legacy fallback: no ACTIVE strategy -> legacy context + null snapshot.
 * - Snapshot lineage: strategicSnapshotId flows request -> provenance record.
 * - Grounding preserved: resolved Morroway context passes historical gates.
 * No provider calls (stub executor / no execution).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate, StrategicStore, ControlPlaneStore } from "@ai-media-factory/database";
import { resolveApprovedProjectContext, resolveStrategicProjectContext, assertMorrowayHistoricalContext, resolveOperationalContext } from "../dist/project-context.js";
import { GovernedAgentRuntime } from "../dist/governed-agent-runtime.js";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory_test";
if (TEST_DATABASE_URL === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must not reference DATABASE_URL");

let pool, strategic, control;
before(async () => {
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  strategic = new StrategicStore(pool);
  control = new ControlPlaneStore(pool);
});
after(async () => { await pool.end(); });

const runId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test("empty strategy falls back to legacy context with null snapshot", async () => {
  const projectId = `fallback-${runId()}`;
  const { context, snapshotId } = await resolveStrategicProjectContext(strategic, projectId, { artifactRefs: [] }, "writer");
  assert.equal(snapshotId, null);
  assert.deepEqual(context, resolveApprovedProjectContext(projectId, { artifactRefs: [] }));
});

test("active strategy overlays legacy, snapshots, and passes Morroway grounding", async () => {
  const projectId = `morroway`;
  const legacy = resolveApprovedProjectContext(projectId, { artifactRefs: [] });
  const key = `test-${runId()}`;
  const s = await strategic.propose({
    projectId, entityType: "STRATEGY", entityKey: key,
    payload: { essence: "A journey through time and imagination.", contentPillars: legacy.contentPillars },
    sourceArtifactIds: ["docs/strategy-council-v2-milestone.md"], createdBy: "test",
  });
  const created = await control.createApproval({
    approvalId: `approval-${runId()}`, projectId, targetType: "STRATEGY_ACTIVATION", targetId: s.entityId,
    agentRecommendation: {}, agentConfidence: null, evidenceRefs: [],
    status: "PENDING", supersedes: null, supersededBy: null, createdAt: new Date().toISOString(),
  });
  await control.decideApproval(created.approvalId, "APPROVE", "fixture");
  await strategic.activate({ entityId: s.entityId, approvalId: created.approvalId });
  try {
    const { context, snapshotId } = await resolveStrategicProjectContext(strategic, projectId, { artifactRefs: [] }, "writer");
    assert.ok(snapshotId && snapshotId.startsWith("snap-"));
    assert.equal(context._strategic.versions.STRATEGY, `${key}@v1`);
    assert.equal(context.essence, "A journey through time and imagination.");
    // Grounding gates still pass on the resolved context (no provider call).
    assertMorrowayHistoricalContext("Give a historical POV brief", context);
    const snap = await strategic.getSnapshot(snapshotId);
    assert.equal(snap.contextHash, context._strategic.contextHash);
  } finally {
    // Leave prod-shape rows out of the way: retire via direct status update is
    // intentionally unsupported; SUPERSEDE by activating v2 is tested at store
    // level. Here we only retire to keep the shared morroway project clean.
    await pool.query(`UPDATE strategic_entities SET status='RETIRED' WHERE entity_id=$1`, [s.entityId]);
  }
});

test("operational evidence merges without disturbing strategic lineage", async () => {
  const operational = await resolveOperationalContext({
    listApprovals: async () => [{ approvalId: "a1", status: "PENDING" }],
    approvalActionability: async () => ({ state: "ACTION_REQUIRED" }),
    projectLifecycles: async () => [{
      title: "T", overallState: "NEEDS_OWNER_ATTENTION", overallLabel: "L",
      attention: [{ kind: "APPROVAL" }], lastMilestone: "M",
      productionApproval: "NOT_GRANTED", publicationApproval: "NOT_GRANTED", publicStatus: "NOT_PUBLISHED",
    }],
  }, "morroway");
  assert.ok(operational);
  assert.equal(operational.approvals.actionable, 1);
  assert.deepEqual(operational.approvals.actionableIds, ["a1"]);
  assert.equal(operational.production, "NOT_GRANTED");
  const { context, snapshotId } = await resolveStrategicProjectContext(
    strategic, "morroway", { artifactRefs: [] }, "research", operational);
  assert.equal(context._operational.approvals.actionable, 1);
  assert.ok(context._strategic || snapshotId === null, "strategic trace preserved when configured");
});

test("strategicSnapshotId persists on execution provenance (lineage)", async () => {
  const saved = [];
  let lastArtifactId = null;
  const fakePersistence = {
    saveArtifact: async (artifact) => { lastArtifactId = artifact.artifactId; },
    listArtifacts: async () => [{ artifactId: lastArtifactId, payload: { visibleOutput: { concept: "c", historicalAngle: "h", evidenceConsiderations: ["e"], sourceability: "s", risks: ["r"], recommendation: "rec" } } }],
    saveExecutionProvenance: async (record) => { saved.push(record); },
  };
  const stubExecute = async () => ({
    output: { concept: "c", historicalAngle: "h", evidenceConsiderations: ["e"], sourceability: "s", risks: ["r"], recommendation: "rec" },
    provider: "openrouter", model: "m", usage: { inputTokens: 1, outputTokens: 1 },
  });
  const runtime = new GovernedAgentRuntime(fakePersistence, stubExecute);
  const result = await runtime.executeGovernedAgent({
    workflowId: "wf-test", correlationId: null, projectId: "morroway", agentId: "research",
    prompt: "Assess the recorded brand architecture", context: { projectId: "morroway" },
    strategicSnapshotId: "snap-deadbeef12345678-writer",
    config: { provider: "openrouter", model: "m", source: "GLOBAL" },
  });
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.strategicSnapshotId, "snap-deadbeef12345678-writer");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].strategicSnapshotId, "snap-deadbeef12345678-writer");
  // legacy executions carry explicit null (never undefined ambiguity in lineage UI)
  const result2 = await runtime.executeGovernedAgent({
    workflowId: "wf-test", correlationId: null, projectId: "morroway", agentId: "research",
    prompt: "Assess the recorded brand architecture", context: { projectId: "morroway" },
    config: { provider: "openrouter", model: "m", source: "GLOBAL" },
  });
  assert.equal(result2.strategicSnapshotId, null);
});
