/**
 * Slice 6 budget remediation — deterministic task-aware projection.
 * Pure builder tests (no DB) + resolve() integration on TEST DB fixtures
 * mirroring the live Morroway ACTIVE baseline shapes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildStrategicProjection, canonicalJson, strategicContextHash,
  createPool, migrate, StrategicStore,
  STRATEGIC_PROJECTION_POLICY_VERSION, STRATEGIC_PROJECTED_CONTEXT_MAX_BYTES,
} from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

function ent(type, key, version, payload, extra = {}) {
  return {
    entityId: `strat-p-${type}-${key}-v${version}`.toLowerCase(), projectId: "p",
    entityType: type, entityKey: key, version, status: "ACTIVE",
    payload, schemaVersion: "strategic-v1", sourceArtifactIds: ["docs/x.md"],
    supersedesVersion: version > 1 ? version - 1 : null,
    createdBy: "test", createdAt: "2026-09-21", activatedAt: "2026-09-21",
    activatedByApprovalId: `approval-${type}-${version}`, ...extra,
  };
}

// Prod-shaped fixtures (values mirror live Morroway semantics).
const STRATEGY = {
  contentPillars: ["REAL-WORLD HISTORICAL POV", "ORIGINAL AI-GENERATED FANTASY"],
  pilot: { model: "adaptive", learningBatch: 4, learningBatchNote: "4 items = initial learning batch, NOT permanent fixed pilot size", gatesNote: "Experimental performance gates are hypotheses, NOT permanent KPIs", approvalBasis: "strategy-council-v2 (APPROVED_WITH_CHANGES, pilot-only gates)" },
  platforms: { primary: "Instagram Reels first (initial primary platform)", expansionRule: "Expansion decisions are evidence/performance-led and Owner-governed; elapsed time alone authorizes nothing." },
  format: { direction: "short-form", reel: "30s", aiVisual: "15s" },
  ownerDecision: "APPROVED_WITH_CHANGES", councilStatus: "CLOSED", essence: "A journey through time and imagination.",
};
const BRAND = {
  brand: "Morroway", brandStatus: "APPROVED_MASTER_BRAND",
  naming: { status: "CLOSED", winner: "Morroway" }, essence: "A journey through time and imagination.",
  identityDirection: { primary: "Threshold", secondary: "Cinematic Worlds", status: "APPROVED_DIRECTION" },
  logo: { status: "APPROVED" }, palette: { status: "APPROVED" }, typography: { status: "APPROVED" },
  tagline: { status: "NOT_APPROVED" }, handle: { status: "NOT_SELECTED_OR_RESERVED" },
  domain: { status: "NOT_SELECTED_OR_REGISTERED" }, trademark: { status: "NOT_COMPLETED" },
  legalEntity: { status: "NOT_FINALIZED" }, positioning: "Use Morroway as audience-facing brand.",
};
const CONTENT = {
  status: "READY_FOR_INITIAL_LEARNING_BATCH",
  decisionModel: ["PERFORMANCE_LED", "AGENT_RECOMMENDED", "OWNER_GOVERNED"],
  pilot: { model: "adaptive", state: "planning" },
  learningBatch: { note: "initial learning batch only", items: [{ id: "MW-HIS-001" }, { id: "MW-HIS-002" }, { id: "MW-FAN-001" }, { id: "MW-FAN-002" }] },
  sourcing: { historicalPov: "must use real-world/source-supported history", fantasy: "original AI-generated storytelling" },
  gates: { note: "Experimental performance gates are hypotheses, NOT permanent KPIs" },
  governance: { qaRequired: true, publicationPolicy: { rule: "Publication must follow the active governed publication policy.", currentMode: "OWNER_APPROVAL_REQUIRED", autonomousPublication: "Permitted only when explicitly enabled by Owner-approved autonomy and publication authority." } },
  durationSemantics: { rule: "item ranges neither redefine nor override archetypes" },
};
const CONSTRAINTS = { rules: ["Validation success is not production approval", "Publication must follow the active governed publication policy. Automatic publication is prohibited unless explicitly enabled by Owner-approved autonomy and publication authority.", "No workstream may trap the brand in one pillar."] };
const EXPERIMENT = {
  hypothesis: "pilot performance gates", status: "EXPERIMENTAL",
  experimentalEvaluationSignals: ["5% engagement across 10 Reels", "10k views threshold", "10% weekly follower growth", "$100 monetization"],
  decisionUse: "Performance against these signals informs governed evaluation only.",
  decisionModel: ["PERFORMANCE_LED", "AGENT_RECOMMENDED", "OWNER_GOVERNED"],
  automaticDecisionRule: "No signal crossing automatically selects Scale, Continue, Iterate, Retest, Pause, or Retire.",
  rule: "hypotheses, NOT permanent KPIs; promotion to permanent only via governed Owner decision",
};
const ALL = [
  ent("STRATEGY", "primary", 4, STRATEGY), ent("BRAND", "primary", 2, BRAND),
  ent("CONTENT_SYSTEM", "primary", 4, CONTENT), ent("CONSTRAINTS", "primary", 2, CONSTRAINTS),
  ent("EXPERIMENT", "pilot-gates", 2, EXPERIMENT),
];

const bytesOf = (ctx) => Buffer.byteLength(canonicalJson(ctx), "utf8");

test("projection: all five task classes fit 8000B with exact pinned counts", async () => {
  const seen = {};
  for (const tc of ["research", "planner", "writer", "ceo", "default"]) {
    const { context, meta } = buildStrategicProjection(ALL, tc);
    assert.ok(meta.byteCount <= 8000, `${tc}: ${meta.byteCount}B fits`);
    assert.equal(meta.byteCount, bytesOf(context), "byteCount is exact, not estimated");
    assert.equal(meta.policyVersion, STRATEGIC_PROJECTION_POLICY_VERSION);
    seen[tc] = meta.byteCount;
  }
  console.log("PROJECTED_BYTES=" + JSON.stringify(seen));
  // Serialization equivalence: canonicalJson measures exactly what the
  // governed runtime embeds (JSON.stringify differs only in key order).
  const { context } = buildStrategicProjection(ALL, "ceo");
  assert.equal(bytesOf(context), Buffer.byteLength(JSON.stringify(context), "utf8"));
});

test("projection is deterministic with stable hash", async () => {
  const a = buildStrategicProjection(ALL, "planner");
  const b = buildStrategicProjection(ALL, "planner");
  assert.deepEqual(a, b);
  assert.equal(a.meta.projectionHash.length, 64);
});

test("research semantics: sourcing/pillars/experiment, no brand leakage", async () => {
  const { context, meta } = buildStrategicProjection(ALL, "research");
  assert.deepEqual(context.domains.STRATEGY.pillars, STRATEGY.contentPillars);
  assert.equal(context.domains.STRATEGY.pilotModel, "adaptive");
  assert.deepEqual(context.domains.CONSTRAINTS.rules, CONSTRAINTS.rules);
  assert.deepEqual(context.domains.EXPERIMENT.items[0].signals, EXPERIMENT.experimentalEvaluationSignals);
  assert.match(context.domains.EXPERIMENT.items[0].automaticRule, /No signal crossing automatically selects/);
  assert.ok(!("BRAND" in context.domains), "research receives no brand domain");
  assert.ok(meta.requiredSemanticChecks.includes("EXPERIMENT.items"));
});

test("planner semantics: sequence/readiness/authority facts", async () => {
  const { context } = buildStrategicProjection(ALL, "planner");
  assert.equal(context.domains.BRAND.namingStatus, "CLOSED");
  assert.deepEqual(context.domains.CONTENT_SYSTEM.learningBatchIds, ["MW-HIS-001", "MW-HIS-002", "MW-FAN-001", "MW-FAN-002"]);
  assert.equal(context.domains.CONTENT_SYSTEM.publicationMode, "OWNER_APPROVAL_REQUIRED");
  assert.match(context.domains.CONTENT_SYSTEM.sourcingHistorical, /source-supported/);
  assert.equal(context.domains.STRATEGY.platformsPrimary, STRATEGY.platforms.primary);
  assert.ok(context.domains.STRATEGY.format.reel === "30s");
});

test("writer semantics: brand voice + sourcing + publication safety", async () => {
  const { context } = buildStrategicProjection(ALL, "writer");
  assert.equal(context.domains.BRAND.brand, "Morroway");
  assert.match(context.domains.CONTENT_SYSTEM.sourcingHistorical, /source-supported/);
  assert.equal(context.domains.CONTENT_SYSTEM.publicationMode, "OWNER_APPROVAL_REQUIRED");
});

test("ceo semantics: broad coverage with compact facts", async () => {
  const { context, meta } = buildStrategicProjection(ALL, "ceo");
  for (const d of ["STRATEGY", "BRAND", "CONTENT_SYSTEM", "CONSTRAINTS", "EXPERIMENT"]) {
    assert.ok(d in context.domains, `ceo covers ${d}`);
  }
  // Selection proof: 10KB of unselected payload fields never reach any
  // projection (byte-identical output with or without them).
  const padded = ALL.map((e) => ({ ...e, payload: { ...e.payload, internalNotes: "x".repeat(5000), designRationale: "y".repeat(5000) } }));
  for (const tc of ["research", "planner", "writer", "ceo", "default"]) {
    const a = buildStrategicProjection(ALL, tc);
    const b = buildStrategicProjection(padded, tc);
    assert.deepEqual(b.context, a.context, `${tc}: unselected fields never reach context`);
    assert.equal(b.meta.byteCount, a.meta.byteCount);
  }
});

test("default semantics: compact baseline + identity", async () => {
  const { context } = buildStrategicProjection(ALL, "default");
  assert.ok("STRATEGY" in context.domains && "BRAND" in context.domains);
  assert.equal(context.domains.BRAND.brand, "Morroway");
});

test("authority-critical invariants preserved in every projection", async () => {
  for (const tc of ["research", "planner", "writer", "ceo", "default"]) {
    const { context } = buildStrategicProjection(ALL, tc);
    assert.ok(context.authority.doctrine.some((d) => /never grants production\/publication authority/.test(d)), `${tc} doctrine`);
    assert.ok(context.authority.doctrine.some((d) => /operational truth/.test(d)), `${tc} operational precedence`);
  }
  const { context } = buildStrategicProjection(ALL, "planner");
  assert.equal(context.authority.publicationMode, "OWNER_APPROVAL_REQUIRED");
});

test("provenance traces every fact to its canonical ACTIVE entity", async () => {
  const { meta } = buildStrategicProjection(ALL, "ceo");
  assert.deepEqual(meta.sourceEntities, ALL.map((e) => e.entityId).sort());
  assert.deepEqual(meta.sourceVersions, [
    "BRAND/primary@v2", "CONSTRAINTS/primary@v2", "CONTENT_SYSTEM/primary@v4",
    "EXPERIMENT/pilot-gates@v2", "STRATEGY/primary@v4",
  ]);
});

test("superseded versions never win: non-ACTIVE input fails closed", async () => {
  const stale = [ent("STRATEGY", "primary", 1, { contentPillars: ["old"] }, { status: "SUPERSEDED" })];
  assert.throws(() => buildStrategicProjection(stale, "research"), /STRATEGIC_PROJECTION_NOT_ACTIVE/);
});

test("unknown task class uses the documented default policy", async () => {
  const { context, meta } = buildStrategicProjection(ALL, "nope");
  assert.equal(context.taskClass, "default");
  assert.equal(meta.taskClass, "default");
});

test("missing required semantic key fails closed (schema drift)", async () => {
  const noPillars = ALL.map((e) => {
    if (e.entityType !== "STRATEGY") return e;
    const p = { ...STRATEGY };
    delete p.contentPillars;
    return { ...e, payload: p };
  });
  assert.throws(() => buildStrategicProjection(noPillars, "planner"), /STRATEGIC_PROJECTION_SEMANTIC_GAP:planner:STRATEGY\.pillars/);
});

test("oversized safe projection fails closed without truncation", async () => {
  const huge = "x".repeat(9000);
  const bloated = ALL.map((e) => e.entityType === "CONSTRAINTS" ? { ...e, payload: { rules: [huge] } } : e);
  let message = null;
  try {
    buildStrategicProjection(bloated, "research");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.ok(message !== null, "oversized projection throws");
  assert.match(message, /STRATEGIC_PROJECTED_CONTEXT_OVERSIZED:research:\d+>8000/);
  assert.equal(STRATEGIC_PROJECTED_CONTEXT_MAX_BYTES, 8000, "cap not raised");
});

test("unknown entity type excluded by relevance allowlists (never projected, never crashes)", async () => {
  const weird = [...ALL, ent("FUTURE_TYPE", "primary", 1, { a: 1 })];
  const { context, meta } = buildStrategicProjection(weird, "ceo");
  assert.ok(!("FUTURE_TYPE" in context.domains), "outside every relevance list: not projected");
  assert.ok(!meta.sourceEntities.some((id) => id.includes("future-type")), "not in provenance");
  assert.ok(meta.byteCount <= 8000);
});

test("resolve() integrates projection on TEST DB; snapshots carry audit metadata", async () => {
  assertTestDatabaseIsolation();
  const pool = createPool({ connectionString: TEST_DATABASE_URL });
  try {
    await migrate(pool);
    const strategic = new StrategicStore(pool);
    const p = `proj-${Date.now().toString(36)}`;
    for (const e of ALL) {
      await strategic.propose({ projectId: p, entityType: e.entityType, entityKey: e.entityKey, payload: e.payload, createdBy: "test" });
    }
    // Activate all via direct status update? No — use governed path? Activation
    // needs approvals; simpler: propose then UPDATE status (fixture setup only,
    // production path always uses governed activation).
    await pool.query(`UPDATE strategic_entities SET status='ACTIVE' WHERE project_id=$1`, [p]);
    for (const tc of ["research", "planner", "writer", "ceo", "default"]) {
      const r = await strategic.resolve({ projectId: p, agentId: tc });
      assert.equal(r.taskClass, tc, "distinct task class per role");
      assert.ok(r.projection.byteCount <= 8000, `${tc} resolves within budget`);
      assert.equal(r.projection.policyVersion, STRATEGIC_PROJECTION_POLICY_VERSION);
      assert.equal(r.projectedContext.taskClass, tc);
      const snap = await strategic.snapshotResolved(r, tc);
      assert.ok(snap.snapshotId.startsWith("snap-"));
      const reloaded = await strategic.getSnapshot(snap.snapshotId);
      assert.deepEqual(reloaded.context._projection, r.projection, "snapshot carries projection audit metadata");
      const { _projection, ...canonical } = reloaded.context;
      assert.equal(strategicContextHash(canonical), reloaded.contextHash, "hash still verifies canonical truth");
    }
  } finally {
    await pool.end();
  }
});
