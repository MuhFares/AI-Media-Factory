/**
 * Slice 6 final reconciliation — corrections V1 (no prod writes here).
 * Pure transform tests run without DB; the apply path runs once against
 * the isolated TEST DB with PROPOSED-only + no-approval assertions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  correctStrategyIdentityMarker, correctStrategyExpansionTiming,
  clarifyContentDurationSemantics, strategyFormatArchetypeNote, planCorrection,
} from "../../../scripts/reconcile-strategy-corrections-v1.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const V3 = {
  essenceBasis: "morroway-brand-identity-v1.md (OWNER_BRAND_IDENTITY_REVIEW_REQUIRED - pending final review, no conflicting source)",
  platforms: { model: "PHASED_PORTFOLIO", primary: "Instagram Reels first", expansion: ["YouTube Shorts (after traction 4-8w)", "TikTok (after Shorts 8-12w)"] },
  format: { direction: "short-form", reel: "30s", aiVisual: "15s" },
  pilot: { model: "adaptive", gatesNote: "Experimental performance gates are hypotheses, NOT permanent KPIs", learningBatch: 4, learningBatchNote: "4 items = initial learning batch, NOT permanent fixed pilot size" },
  contentPillars: ["Historical POV", "AI Fantasy"],
};
const CS2 = {
  status: "READY_FOR_INITIAL_LEARNING_BATCH",
  decisionModel: ["PERFORMANCE_LED", "AGENT_RECOMMENDED", "OWNER_GOVERNED"],
  pilot: { model: "adaptive", size: "ADAPTIVE", duration: "ADAPTIVE", state: "planning" },
  learningBatch: { note: "initial batch only", items: [{ id: "MW-HIS-001" }, { id: "MW-HIS-002" }, { id: "MW-FAN-001" }, { id: "MW-FAN-002" }] },
  sourcing: { historicalPov: "real history", fantasy: "original" },
  gates: { note: "hypotheses, NOT permanent KPIs" },
};

test("1+7: transforms never mutate input; originals preserved verbatim", async () => {
  const frozenV3 = JSON.parse(JSON.stringify(V3));
  const frozenCS2 = JSON.parse(JSON.stringify(CS2));
  const v4 = strategyFormatArchetypeNote(correctStrategyExpansionTiming(correctStrategyIdentityMarker(V3)));
  const cs3 = clarifyContentDurationSemantics(CS2);
  assert.deepEqual(V3, frozenV3, "strategy input untouched");
  assert.deepEqual(CS2, frozenCS2, "content input untouched");
  assert.equal(v4.essenceReview.supersededMarkerText, frozenV3.essenceBasis);
  assert.deepEqual(v4.platforms.supersededTimingText, frozenV3.platforms.expansion);
  assert.deepEqual(cs3.learningBatch.items, frozenCS2.learningBatch.items, "batch items verbatim");
});

test("4: stale marker resolved structurally, never an Owner task", async () => {
  const v4 = correctStrategyIdentityMarker(V3);
  assert.equal(v4.essenceReview.status, "SUPERSEDED_FOR_DECIDED_COMPONENTS");
  assert.deepEqual(v4.essenceReview.decidedComponents, ["essence", "identityDirection", "logo", "palette", "typography"]);
  assert.equal(v4.essenceReview.actionableDecisionId, null, "no decision manufactured");
  assert.match(v4.essenceReview.openItem, /tagline NOT_APPROVED \(recorded state, not a task\)/);
  const historicalFraming = JSON.stringify(v4).split(/(?<=[.!?])\s+/).filter((s) => s.includes("REVIEW_REQUIRED"));
  assert.ok(historicalFraming.length > 0, "original marker text preserved");
  assert.ok(historicalFraming.every((s) => s.includes("SUPERSEDED")), "every live marker mention is historically framed, never a current claim");
});

test("5: expansion timing indicative, originals preserved, never automatic", async () => {
  const v4 = correctStrategyExpansionTiming(V3);
  assert.equal(v4.platforms.primary, "Instagram Reels first (initial primary platform)");
  for (const entry of v4.platforms.expansion) {
    assert.match(entry.timing, /indicative planning hypothesis only/);
    assert.match(entry.timing, /never automatic on elapsed weeks/);
  }
  assert.match(v4.platforms.expansionRule, /elapsed time alone authorizes nothing/);
  assert.deepEqual(v4.platforms.supersededTimingText, ["YouTube Shorts (after traction 4-8w)", "TikTok (after Shorts 8-12w)"]);
  assert.ok(!v4.platforms.expansion.some((e) => /after traction 4-8w$/.test(e.timing)), "no bare calendar gate remains");
});

test("6+7: gates stay hypotheses; durations clarify without redefining archetypes", async () => {
  const v4 = strategyFormatArchetypeNote(correctStrategyExpansionTiming(correctStrategyIdentityMarker(V3)));
  assert.equal(v4.pilot.gatesNote, V3.pilot.gatesNote, "gates note preserved verbatim");
  assert.equal(v4.format.reel, "30s", "archetypes preserved");
  assert.match(v4.format.note, /neither redefine nor override archetypes/);
  const cs3 = clarifyContentDurationSemantics(CS2);
  assert.match(cs3.durationSemantics.rule, /neither redefine nor override archetypes/);
  assert.match(cs3.durationSemantics.archetypes, /30s Reel \/ 15s AI visual/);
});

test("8+9+10: corrected payloads grant nothing and stay §D-complete", async () => {
  const v4 = strategyFormatArchetypeNote(correctStrategyExpansionTiming(correctStrategyIdentityMarker(V3)));
  const cs3 = clarifyContentDurationSemantics(CS2);
  for (const [name, p] of [["strategy-v4", v4], ["content-v3", cs3]]) {
    assert.doesNotMatch(JSON.stringify(p), /"GRANTED"/, `${name} grants nothing`);
    assert.doesNotMatch(JSON.stringify(p), /production approval granted|publication authorized/i);
  }
  assert.equal(cs3.decisionModel.join("+"), "PERFORMANCE_LED+AGENT_RECOMMENDED+OWNER_GOVERNED");
  assert.deepEqual(cs3.learningBatch.items.map((i) => i.id), ["MW-HIS-001", "MW-HIS-002", "MW-FAN-001", "MW-FAN-002"]);
});

test("idempotent: double application converges (no v5 drift)", async () => {
  const once = strategyFormatArchetypeNote(correctStrategyExpansionTiming(correctStrategyIdentityMarker(V3)));
  const twice = strategyFormatArchetypeNote(correctStrategyExpansionTiming(correctStrategyIdentityMarker(once)));
  assert.deepEqual(twice, once, "strategy correction is a fixed point");
  const csOnce = clarifyContentDurationSemantics(CS2);
  assert.deepEqual(clarifyContentDurationSemantics(csOnce), csOnce, "content correction is a fixed point");
  assert.deepEqual(planCorrection({ version: 4, payload: JSON.parse(JSON.stringify(once)) }, once), { action: "SKIP" });
});

test("2: planCorrection versions next, skips identical", async () => {
  assert.deepEqual(planCorrection(null, { a: 1 }), { action: "PROPOSE", version: 1 });
  assert.deepEqual(planCorrection({ version: 3, payload: { a: 2 } }, { a: 1 }), { action: "PROPOSE", version: 4 });
  const v4 = strategyFormatArchetypeNote(correctStrategyExpansionTiming(correctStrategyIdentityMarker(V3)));
  assert.deepEqual(planCorrection({ version: 4, payload: JSON.parse(JSON.stringify(v4)) }, v4), { action: "SKIP" });
});

test("13: script performs no external calls (imports only node/pg/database)", async () => {
  const source = fs.readFileSync(path.join(REPO, "scripts/reconcile-strategy-corrections-v1.mjs"), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /openrouter|agentrouter|llm|serper|apify|bright/i);
});

test("11+isolated-apply: TEST-DB apply creates PROPOSED-only rows, zero approvals", async () => {
  let testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    let cs = null;
    for (const line of fs.readFileSync(path.join(REPO, ".env"), "utf8").split(/\r?\n/)) {
      const i = line.indexOf("=");
      if (i > 0 && line.slice(0, i).trim() === "DATABASE_URL") {
        let raw = line.slice(i + 1).trim();
        if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
        cs = raw; break;
      }
    }
    if (!cs) { assert.ok(true, "no DATABASE_URL; isolated apply skipped"); return; }
    const u = new URL(cs); u.pathname = "/ai_media_factory_test"; testUrl = u.toString();
  }
  const { createPool, migrate, StrategicStore } = await import("../dist/index.js");
  const pool = createPool({ connectionString: testUrl });
  try {
    await migrate(pool);
    const strategic = new StrategicStore(pool);
    // Seed morroway baselines the corrections build upon (any payload shape).
    await strategic.propose({ projectId: "morroway", entityType: "STRATEGY", payload: { essenceBasis: "seed", platforms: { expansion: ["seed"] }, format: {}, pilot: {} }, createdBy: "test-seed" });
    await strategic.propose({ projectId: "morroway", entityType: "CONTENT_SYSTEM", payload: { pilot: {}, learningBatch: { items: [] } }, createdBy: "test-seed" });
    const before = await pool.query("SELECT count(*)::int AS n FROM control_approvals WHERE project_id='morroway'");
    const run = () => spawnSync(process.execPath, [path.join(REPO, "scripts/reconcile-strategy-corrections-v1.mjs"), "--apply"], {
      env: { ...process.env, DATABASE_URL: testUrl }, encoding: "utf8",
    });
    const first = run();
    assert.equal(first.status, 0, "apply exits 0: " + (first.stderr || "").slice(0, 300));
    const rows = await pool.query(
      "SELECT entity_type, version, status, supersedes_version, created_by FROM strategic_entities WHERE project_id='morroway' AND created_by='slice6-corrections-v1' ORDER BY entity_type");
    assert.ok(rows.rowCount >= 2, "correction versions created on TEST DB");
    for (const r of rows.rows) {
      assert.equal(r.status, "PROPOSED", "corrections are PROPOSED-only");
      assert.ok(r.supersedes_version !== null, "supersession recorded");
    }
    const second = run();
    assert.equal(second.status, 0);
    assert.match(second.stdout, /SKIP identical/, "re-run is an idempotent no-op");
    const after = await pool.query("SELECT count(*)::int AS n FROM control_approvals WHERE project_id='morroway'");
    assert.equal(after.rows[0].n, before.rows[0].n, "zero approvals created");
  } finally {
    await pool.end();
  }
});
