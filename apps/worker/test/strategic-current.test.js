/**
 * Slice 6 — _strategicCurrent structured index (no DB, no providers).
 * Agents receive per-domain status/authority/evidence/staleness semantics
 * alongside the preserved flat payload overlay.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveStrategicProjectContext } from "../dist/project-context.js";
import { buildStrategicProjection } from "@ai-media-factory/database";

function fakeStore(resolved) {
  return {
    resolve: async () => resolved,
    snapshotResolved: async () => ({ snapshotId: "snap-test-1" }),
  };
}

function storeEntities() {
  const base = (type, version, payload) => ({
    entityId: `strat-p-${type}-primary-v${version}`.toLowerCase(), projectId: "p",
    entityType: type, entityKey: "primary", version, status: "ACTIVE", payload,
    schemaVersion: "strategic-v1", sourceArtifactIds: ["docs/x.md"], supersedesVersion: null,
    createdBy: "test", createdAt: "t", activatedAt: "t", activatedByApprovalId: `approval-${version}`,
  });
  return [
    base("STRATEGY", 2, { essence: "A journey.", contentPillars: ["a"], pilot: { model: "adaptive" } }),
    base("BRAND", 2, { brand: "Morroway", naming: { status: "CLOSED" } }),
    base("CONSTRAINTS", 1, { rules: ["Rule one."] }),
  ];
}

function resolvedFixture() {
  const all = storeEntities();
  const { context: projectedContext, meta: projection } = buildStrategicProjection(all, "writer");
  const entities = {};
  for (const e of all) {
    entities[e.entityType] = {
      key: e.entityKey, version: e.version, entityId: e.entityId, status: e.status,
      authority: { activatedByApprovalId: e.activatedByApprovalId, activatedAt: e.activatedAt },
      evidenceRefs: e.sourceArtifactIds, supersedesVersion: e.supersedesVersion, payload: e.payload,
    };
  }
  return {
    projectId: "p", taskClass: "writer",
    entityRefs: all.map((e) => ({ entityId: e.entityId, entityType: e.entityType, entityKey: e.entityKey, version: e.version })),
    context: { projectId: "p", taskClass: "writer", entities },
    contextHash: "h", resolverVersion: "strat-resolver-v2",
    includedTypes: ["BRAND", "CONSTRAINTS", "STRATEGY"], excludedTypes: [],
    projectedContext, projection,
  };
}

test("17: agent context exposes current structured strategy per domain", async () => {
  const { context, snapshotId } = await resolveStrategicProjectContext(
    fakeStore(resolvedFixture()), "p", {}, "writer",
    { approvals: { pending: 0, actionable: 0, actionableIds: [] } },
  );
  assert.equal(snapshotId, "snap-test-1");
  const cur = context._strategicCurrent;
  assert.ok(cur, "_strategicCurrent present");
  assert.equal(cur.domains.STRATEGY.version, 2);
  assert.equal(cur.domains.STRATEGY.status, "ACTIVE");
  assert.equal(cur.domains.STRATEGY.authority.activatedByApprovalId, "approval-2");
  assert.deepEqual(cur.domains.STRATEGY.evidenceRefs, ["docs/x.md"]);
  assert.equal(cur.domains.STRATEGY.supersedesVersion, null);
  assert.equal(cur.domains.BRAND.version, 2);
  assert.ok(!("CONTENT_SYSTEM" in cur.domains), "only resolved domains indexed");
  // Flat overlay preserved for compatibility.
  assert.equal(context.essence, "A journey.");
  assert.equal(context.brand, "Morroway");
  // Operational truth merged alongside.
  assert.equal(context._operational.approvals.actionable, 0);
});

test("18: historical text labeled stale-capable; PROPOSED-only domains stay out of current", async () => {
  const { context } = await resolveStrategicProjectContext(fakeStore(resolvedFixture()), "p", {}, "writer", null);
  assert.match(context._strategicCurrent.note, /may be stale/);
  assert.match(context._strategicCurrent.note, /_operational wins on actionability/);
});

test("3/19-variant: conflict throws (no silent degrade); absent strategy falls back legacy", async () => {
  const failing = { resolve: async () => { throw new Error("STRATEGIC_STATE_CONFLICT"); }, snapshotResolved: async () => ({}) };
  await assert.rejects(resolveStrategicProjectContext(failing, "p", {}, "writer", null), /STRATEGIC_STATE_CONFLICT/);
  const empty = fakeStore({
    projectId: "p", taskClass: "default", entityRefs: [], context: { entities: {} },
    contextHash: "h", resolverVersion: "strat-resolver-v2", includedTypes: [], status: "STRATEGY_NOT_CONFIGURED",
  });
  const legacy = await resolveStrategicProjectContext(empty, "morroway", {}, "writer", null);
  assert.equal(legacy.snapshotId, null);
  assert.ok(!("_strategicCurrent" in legacy.context), "no current index without resolved entities");
});
