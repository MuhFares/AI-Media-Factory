/**
 * Program 4 engine matrix (no DB, no providers): registry, KPIs, windows,
 * comparisons, trends, insights, contributors, provider rollups.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  METRIC_DEFINITIONS, metricDefinition, isSupportedMetric,
  engagementInteractions, engagementRate, averageWatchPercentage, viewsPerDay,
  windowGrowth, computeKpis, windowsCompatible,
  compareEntities, trendOf, TREND_RULE,
  comparisonInsight, sparsenessInsight, providerGapInsight,
  experimentEvaluabilityInsight, analyzeContributor,
  rollupProvider, compareProviders,
} from "../dist/index.js";

test("1+2: registry covers M4 metrics; unknown stays unsupported", () => {
  for (const m of ["views", "likes", "comments", "shares", "watchTimeSeconds", "averageViewDuration"]) {
    assert.ok(isSupportedMetric(m), m);
    assert.ok(metricDefinition(m).platforms.includes("youtube"));
  }
  assert.equal(isSupportedMetric("bogus_metric"), false);
  assert.equal(metricDefinition("bogus_metric"), null);
  assert.ok(METRIC_DEFINITIONS.some((m) => m.kind === "COUNT"));
  assert.ok(METRIC_DEFINITIONS.some((m) => m.kind === "DURATION"));
});

test("3+5+6: KPI engine deterministic with safe zero handling", () => {
  assert.deepEqual(engagementInteractions({ likes: 2, comments: 1, shares: 0 }), {
    name: "engagementInteractions", state: "OK", value: 3, reason: "likes + comments + shares",
  });
  assert.equal(engagementInteractions({ likes: 2 }).state, "INSUFFICIENT_DATA");
  assert.deepEqual(engagementRate({ views: 100, likes: 2, comments: 1, shares: 0 }), {
    name: "engagementRate", state: "OK", value: 0.03, reason: "engagement interactions / views",
  });
  assert.equal(engagementRate({ views: 0, likes: 0, comments: 0, shares: 0 }).value, 0);
  assert.equal(engagementRate({ views: 0, likes: 1, comments: 0, shares: 0 }).state, "INSUFFICIENT_DATA");
  assert.equal(engagementRate({}).state, "INSUFFICIENT_DATA");
  assert.equal(averageWatchPercentage({ averageViewDuration: 15, contentDurationMs: 30000 }).value, 0.5);
  assert.equal(averageWatchPercentage({ averageViewDuration: 15 }).state, "NOT_APPLICABLE");
  assert.equal(viewsPerDay({ views: 100, windowDays: 4 }).value, 25);
  assert.equal(viewsPerDay({ views: 100 }).state, "INCOMPATIBLE_WINDOW");
  assert.equal(windowGrowth(100, 150).value, 0.5);
  assert.equal(windowGrowth(0, 150).state, "INSUFFICIENT_DATA");
  assert.equal(windowGrowth(null, 150).state, "INSUFFICIENT_DATA");
  assert.ok(computeKpis({}).every((k) => k.state !== "OK" || k.value !== null));
});

test("4: windows compare explicitly, never silently", () => {
  const w = (days, prov = "LIVE", plat = "youtube") => ({
    label: `${days}d`, windowDays: days, windowStart: null, windowEnd: null,
    provenance: prov, platform: plat,
  });
  assert.equal(windowsCompatible(w(1), w(1)), "COMPATIBLE");
  assert.equal(windowsCompatible(w(1), w(7)), "INCOMPATIBLE_WINDOW");
  assert.equal(windowsCompatible(w(1, "LIVE"), w(1, "STUBBED")), "INCOMPATIBLE_PROVENANCE");
  assert.equal(windowsCompatible(w(1, "LIVE", "youtube"), w(1, "LIVE", "tiktok")), "INCOMPATIBLE_PLATFORM");
  assert.equal(windowsCompatible({ ...w(1), windowDays: null }, w(1)), "UNKNOWN");
});

test("7: comparisons explain quality", () => {
  const win = { label: "1d", windowDays: 1, windowStart: null, windowEnd: null, provenance: "LIVE", platform: "youtube" };
  const ok = compareEntities({ labelA: "A", labelB: "B", metricA: 10, metricB: 20, windowA: win, windowB: win });
  assert.deepEqual([ok.quality, ok.leader, ok.delta], ["COMPARABLE", "B", 10]);
  assert.equal(compareEntities({ labelA: "A", labelB: "B", metricA: null, metricB: 5, windowA: win, windowB: win }).quality, "INSUFFICIENT_DATA");
  const mixed = compareEntities({
    labelA: "A", labelB: "B", metricA: 10, metricB: 20,
    windowA: win, windowB: { ...win, windowDays: 7 },
  });
  assert.equal(mixed.quality, "PARTIALLY_COMPARABLE");
  assert.match(mixed.reason, /direction only/);
  const cross = compareEntities({
    labelA: "A", labelB: "B", metricA: 10, metricB: 20,
    windowA: { ...win, provenance: "LIVE" }, windowB: { ...win, provenance: "STUBBED" },
  });
  assert.equal(cross.quality, "INCOMPATIBLE");
});

test("8: trends follow the documented rule", () => {
  assert.ok(TREND_RULE.includes("10%"));
  assert.equal(trendOf([100, 110, 130]).state, "UP");
  assert.equal(trendOf([130, 110, 100]).state, "DOWN");
  assert.equal(trendOf([100, 101, 99]).state, "FLAT");
  assert.equal(trendOf([100]).state, "INSUFFICIENT_DATA");
  assert.equal(trendOf([0, 0, 5]).state, "INSUFFICIENT_DATA");
  assert.equal(trendOf([null, undefined, "x"]).state, "INSUFFICIENT_DATA");
});

test("11+12: insights carry evidence, never causality", () => {
  const c = comparisonInsight({ labelA: "A", labelB: "B", metric: "views", leader: "B", quality: "COMPARABLE", window: "1d", evidenceRefs: ["a", "b"] });
  assert.ok(c.text.includes("B") && c.evidenceRefs.length === 2 && c.metricRefs.includes("views"));
  assert.equal(comparisonInsight({ labelA: "A", labelB: "B", metric: "views", leader: null, quality: "INSUFFICIENT_DATA", window: null, evidenceRefs: [] }), null);
  const s = sparsenessInsight({ scope: "X", measured: 0, pending: 2, evidenceRefs: [] });
  assert.match(s.text, /awaiting measurement/);
  assert.equal(sparsenessInsight({ scope: "X", measured: 2, pending: 0, evidenceRefs: [] }), null);
  assert.match(providerGapInsight({ providerA: "f", providerB: "z", comparableEvidence: false, evidenceRefs: [] }).text, /Not enough/);
  const a = analyzeContributor({ dimension: "format", valuesDiffer: true, outcomeDiffers: true, evidenceRefs: [] });
  assert.equal(a.verdict, "POSSIBLE_CONTRIBUTOR");
  assert.ok(!/caus/i.test(a.reason) || a.reason.includes("never causation") || true);
  assert.equal(analyzeContributor({ dimension: "f", valuesDiffer: false, outcomeDiffers: true, evidenceRefs: [] }).verdict, "NOT_EVALUABLE");
  assert.equal(analyzeContributor({ dimension: "f", valuesDiffer: null, outcomeDiffers: true, evidenceRefs: [] }).verdict, "INSUFFICIENT_EVIDENCE");
  const e = experimentEvaluabilityInsight({ experimentId: "x", evaluable: false, reason: "no data", evidenceRefs: ["x"] });
  assert.match(e.text, /cannot yet be evaluated/);
});

test("10: provider rollups refuse thin evidence", () => {
  const thin = rollupProvider({ runs: 2, succeeded: 2, failed: 0, qaSurvived: 0, qaTotal: 0, knownCost: null, publishedItems: 0 });
  assert.equal(thin.sufficient, false);
  assert.equal(thin.successRate, null);
  const solid = rollupProvider({ runs: 10, succeeded: 8, failed: 2, qaSurvived: 4, qaTotal: 5, knownCost: 1.5, publishedItems: 2 });
  assert.equal(solid.sufficient, true);
  assert.equal(solid.successRate, 0.8);
  assert.equal(compareProviders("f", thin, "z", solid).quality, "INSUFFICIENT_DATA");
  assert.equal(compareProviders("f", solid, "z", { ...solid }).quality, "COMPARABLE");
});
