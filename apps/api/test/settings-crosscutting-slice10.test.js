/**
 * Slice 10 Settings + cross-cutting cleanup — Owner UX contract tests.
 * Static-source tests over the shipped app.js (no DB, no providers).
 * Gate semantics live in the backend; here we prove the Owner journey:
 * business labels primary, raw keys Advanced-only, app-modal confirmation,
 * inline validation, canonical refresh, history preserved, no native dialogs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const src = fs.readFileSync(path.join(REPO, "apps/api/src/ai_media_factory/static/app.js"), "utf8");
const lines = src.split("\n");
function takeBlock(start) {
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
  const i = lines.findIndex((l) => l.includes(start));
  if (i < 0) throw new Error("missing " + start);
  return lines[i];
}
const lib = [
  "const esc=",
  "function gateLabel",
  "function gateImpactText",
  "function gateResetText",
].map((s) => (s.endsWith("=") ? takeLine(s) : takeBlock(s))).join("\n");
const box = new Function(`${lib}; return { gateLabel, gateImpactText, gateResetText };`)();
const { gateLabel, gateImpactText, gateResetText } = box;
const setGateSrc = takeLine("window.setGate=");
const resetGateSrc = takeLine("window.resetGate=");
const loadGatesSrc = takeBlock("async function loadGates");
const viewSnapshotSrc = takeLine("window.viewSnapshot=");

test("1+2: business gate labels primary; raw keys Advanced-only", () => {
  assert.equal(gateLabel("pre_production"), "Require human approval before media production");
  assert.equal(gateLabel("visual"), "Require human approval after Visual QA");
  assert.match(loadGatesSrc, /g\.label\|\|gateLabel\(g\.gateKey\)/);
  assert.match(loadGatesSrc, /Advanced — raw gate keys/);
  assert.ok(!loadGatesSrc.includes("<b>${esc(g.gateKey)}</b>"), "raw key must not be the primary card label");
  assert.ok(!loadGatesSrc.includes("${esc(e.gateKey)}</td><td>"), "history must not lead with raw key");
  assert.match(loadGatesSrc, /gateLabel\(e\.gateKey\)/);
});

test("3+4: gate mutation requires app confirmation; no native confirm in gate paths", () => {
  assert.match(setGateSrc, /confirmModal\(/);
  assert.match(resetGateSrc, /confirmModal\(/);
  assert.ok(!/(^|[^a-zA-Z])confirm\(/.test(setGateSrc), "no native confirm in setGate");
  assert.ok(!/(^|[^a-zA-Z])confirm\(/.test(resetGateSrc), "no native confirm in resetGate");
  assert.match(setGateSrc, /Requested state:/);
  assert.match(setGateSrc, /Future impact:/);
  assert.match(resetGateSrc, /Future impact:/);
});

test("5: missing rationale uses inline validation, not alert", () => {
  for (const body of [setGateSrc, resetGateSrc]) {
    assert.ok(!/(^|[^a-zA-Z])alert\(/.test(body), "no native alert in gate path");
    assert.match(body, /fieldErr\('#gateResult',/);
  }
  assert.match(setGateSrc, /rationale is required before changing a gate/);
  assert.match(resetGateSrc, /rationale is required before resetting a gate/);
});

test("6+7: success refreshes canonical truth; failure renders inline without success claim", () => {
  for (const body of [setGateSrc, resetGateSrc]) {
    assert.match(body, /loadGates\(\)/);
    assert.match(body, /fieldErr\('#gateResult',x\.detail/);
  }
  assert.match(setGateSrc, /refreshed from canonical truth/);
  assert.match(resetGateSrc, /refreshed from canonical truth/);
  assert.ok(!setGateSrc.includes("optimistic") && !setGateSrc.includes("assume"),
    "no optimistic success language");
});

test("8: gate history remains available in business-readable form", () => {
  assert.match(loadGatesSrc, /\/api\/projects\/morroway\/gates\/events/);
  assert.match(loadGatesSrc, /Gate change history|gateLabel\(e\.gateKey\)/);
  assert.match(loadGatesSrc, /Advanced — raw event detail/);
});

test("9: viewSnapshot alerts replaced without semantic change", () => {
  assert.ok(!/(^|[^a-zA-Z])alert\(/.test(viewSnapshotSrc), "no native alert in viewSnapshot");
  assert.match(viewSnapshotSrc, /confirmModal\(/);
  assert.match(viewSnapshotSrc, /Snapshot unavailable/);
  assert.match(viewSnapshotSrc, /snapshotId/);
  assert.match(viewSnapshotSrc, /taskClass/);
  assert.match(viewSnapshotSrc, /contextHash/);
  assert.match(viewSnapshotSrc, /entityRefs/);
});

test("10: Advanced disclosure preserves technical/raw truth", () => {
  assert.match(loadGatesSrc, /raw gate keys/);
  assert.match(loadGatesSrc, /raw event detail/);
  assert.match(loadGatesSrc, /JSON\.stringify\(evs/);
});

test("future-impact + no-auto-release semantics present", () => {
  const on = gateImpactText("pre_production", true);
  const off = gateImpactText("pre_production", false);
  const rst = gateResetText("visual");
  for (const t of [on, off, rst]) {
    assert.match(t.future, /never released automatically/);
    assert.match(t.nots, /does not start production/i);
    assert.match(t.nots, /publish/i);
    assert.match(t.nots, /strategy/i);
  }
  assert.match(on.future, /stop at this gate/);
  assert.match(off.future, /automatically/);
  assert.match(rst.future, /inherits the global default/);
});

test("11+12: authority + Decision Center untouched", () => {
  for (const body of [setGateSrc, resetGateSrc, loadGatesSrc]) {
    assert.ok(!/approvals\/decide|strategy\/activations|strategy\/proposals|command-room/.test(body),
      "settings paths must not touch decisions/activations/commands");
  }
  assert.match(src, /NOT_GRANTED/);
  assert.match(src, /NOT_PUBLISHED/);
  assert.match(src, /Decision Center is the sole source of Owner actionability|Decision Center remains the sole/);
});
