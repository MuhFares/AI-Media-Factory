/**
 * Slice 9 Owner UX remediation — Costs / Health / Global Mission Control.
 * Static-source contract tests over the shipped app.js (no DB, no providers).
 * Backend truth (costSummary/platformHealth/registry) is covered by
 * control-operational-v1.test.js; here we prove the Owner surface semantics.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const src = fs.readFileSync(path.join(REPO, "apps/api/src/ai_media_factory/static/app.js"), "utf8");

function takeBlock(start) {
  const lines = src.split("\n");
  const i = lines.findIndex((l) => l.includes(start));
  if (i < 0) throw new Error("missing " + start);
  let depth = 0;
  for (let end = i; end < lines.length; end++) {
    for (const ch of lines[end]) { if (ch === "{") depth++; if (ch === "}") depth--; }
    if (depth === 0) return lines.slice(i, end + 1).join("\n");
  }
  throw new Error("unbalanced " + start);
}
function takeLine(start) {
  const line = src.split("\n").find((l) => l.includes(start));
  if (!line) throw new Error("missing " + start);
  return line;
}
const lib = [
  "const esc=",
  "function costPricedState",
  "function healthCurrentStatus",
].map((s) => (s.endsWith("=") ? takeLine(s) : takeBlock(s))).join("\n");
const box = new Function(`${lib}; return { costPricedState, healthCurrentStatus };`)();
const { costPricedState, healthCurrentStatus } = box;

test("1+4: Costs & Health page renders BOTH sections; Advanced collapsed by default", () => {
  const body = takeBlock("async function costsHealth");
  assert.match(body, /<h2>Costs<\/h2>/);
  assert.match(body, /<h2>Platform Health<\/h2>/);
  assert.match(body, /id="co"/);
  assert.match(body, /id="he"/);
  const details = [...body.matchAll(/<details([^>]*)>/g)].map((m) => m[1]);
  assert.ok(details.length >= 2, "expected Costs + Health advanced sections");
  for (const attrs of details) assert.ok(!/\bopen\b/.test(attrs), "Advanced must default collapsed");
});

test("2+3: UNKNOWN cost never zero; priced UNKNOWN explicit, never $0/0", () => {
  const zero = costPricedState({ knownCount: 0, knownTotal: 0, knownCurrency: null, freeCount: 24, unknownCount: 123, byKind: {} });
  assert.equal(zero.hasPriced, false);
  assert.equal(zero.metric, "UNKNOWN");
  assert.match(zero.badge, /not \$0/);
  assert.match(zero.line, /UNKNOWN/);
  assert.ok(!/^\$?0(\.0+)?$/.test(zero.metric.trim()), "monetary spend must not render as 0 when unknown");
  const priced = costPricedState({ knownCount: 2, knownTotal: 1.5, knownCurrency: "USD", freeCount: 1, unknownCount: 3, byKind: {} });
  assert.equal(priced.hasPriced, true);
  assert.match(priced.metric, /1\.5/);
  const body = takeBlock("async function costsHealth");
  assert.match(body, /never summed as zero/);
  assert.match(body, /FREE \(0\) — provider confirmed/);
  assert.match(body, /UNKNOWN — never summed as zero/);
  assert.ok(!body.includes("Priced</div><div class=\"metric\">${c.knownCount"), "must not render priced count as spend");
});

test("5+6: current health distinct from historical failures; current queue distinct from totals", () => {
  const healthy = healthCurrentStatus({ db: "ok", workers: { liveCount: 1, stale: false }, queue: { queued: 0, running: 0, succeeded: 50, failed: 9 } });
  assert.equal(healthy.healthy, true);
  assert.equal(healthy.incidents.length, 0);
  const withHistory = healthCurrentStatus({ db: "ok", workers: { liveCount: 1, stale: false }, queue: { queued: 0, running: 0, succeeded: 500, failed: 40 } });
  assert.equal(withHistory.healthy, true, "historical failures must not make current health unhealthy");
  const bad = healthCurrentStatus({ db: "ok", workers: { liveCount: 1, stale: false }, queue: { queued: 2, running: 1, succeeded: 0, failed: 0 } });
  assert.equal(bad.queued, 2);
  assert.equal(bad.running, 1);
  const stale = healthCurrentStatus({ db: "ok", workers: { liveCount: 0, stale: true }, queue: { queued: 0, running: 0, succeeded: 0, failed: 0 } });
  assert.equal(stale.healthy, false);
  const body = takeBlock("async function costsHealth");
  assert.match(body, /Current incidents/);
  assert.match(body, /Historical failures never affect current status/);
  assert.match(body, /History \(informational only\)/);
  assert.match(body, /Current queue/);
});

test("7+8: Global System Mission Control summary + canonical registry count", () => {
  const body = takeBlock("async function missionControl");
  assert.match(body, /AMF Mission Control/);
  assert.match(body, /Platform status/);
  assert.match(body, /Database/);
  assert.match(body, /Workers/);
  assert.match(body, /Current queue/);
  assert.match(body, /Registered business projects/);
  assert.match(body, /canonical registry/);
  assert.match(body, /Providers \/ models/);
  assert.match(body, /\/api\/runtime\/projects/);
  assert.match(body, /\/api\/runtime\/health/);
  assert.match(body, /\/api\/runtime\/providers/);
  assert.ok(!/<details[^>]*\bopen\b/.test(body), "Mission Control Advanced must default collapsed");
  assert.match(body, /Decision Center is the sole source of Owner actionability/);
});

test("9+10: Decision Center + authority invariants untouched", () => {
  assert.match(src, /Decision Center is the ONLY source|Decision Center is the sole source|Decision Center remains the sole/);
  // No new approval/activation/workflow writes introduced by Slice 9 UX edit.
  const costsBody = takeBlock("async function costsHealth");
  const mcBody = takeBlock("async function missionControl");
  for (const b of [costsBody, mcBody]) {
    assert.ok(!/fetch\(['"]\/api\/(approvals\/decide|strategy\/activations|strategy\/proposals|command-room)/.test(b), "read-only surfaces must not write");
  }
  assert.match(src, /Production = NOT_GRANTED|Production \$\{esc\(auth\.production\)\}/);
  assert.match(src, /NOT_GRANTED/);
  assert.match(src, /NOT_PUBLISHED/);
});
