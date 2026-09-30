/**
 * Slice 10 timezone remediation — Owner local-time presentation.
 * Static-source tests over the shipped app.js (no DB, no providers).
 * Canonical UTC stays untouched in storage/API/audit; Owner-facing
 * timestamps render via the shared localTime() helper in the
 * browser/device local timezone. No hardcoded zones, no manual offsets.
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
const box = new Function(`${takeBlock("function localTime")}; return { localTime };`)();
const { localTime } = box;

test("canonical UTC input is never mutated at source", () => {
  const body = takeBlock("async function loadGates");
  assert.match(body, /JSON\.stringify\(evs/);
  assert.match(body, /\/api\/projects\/morroway\/gates\/events/);
  assert.ok(!/changedAt\s*=\s*localTime/.test(body), "canonical event objects must not be rewritten");
  assert.ok(!/toISOString\(\).*changedAt|changedAt.*toISOString/.test(body), "no UTC rewrite of audit data");
});

test("human-facing renderer converts through browser-local formatting", () => {
  const raw = "2026-09-22T12:17:23.191Z";
  const got = localTime(raw);
  assert.equal(got, new Date(Date.parse(raw)).toLocaleString());
  assert.ok(!got.includes("2026-09-22T12:17:23.191Z"), "raw UTC must not leak into Owner presentation");
  const loadGates = takeBlock("async function loadGates");
  assert.match(loadGates, /localTime\(e\.changedAt\)/);
  for (const site of ["localTime(c.created_at)", "localTime(a.decidedAt)",
    "localTime(o.createdAt)", "localTime(h.createdAt)", "localTime(x.createdAt)",
    "localTime(en.createdAt)", "localTime(en.activatedAt)", "localTime(a.activatedAt)",
    "localTime(a.created_at||a.createdAt)", "localTime(latest.createdAt)",
    "localTime(w.createdAt)", "localTime(w.latestHeartbeatAt)"]) {
    assert.ok(src.includes(site), "Owner surface renders local time: " + site);
  }
});

test("no hardcoded Cairo/UTC-offset timezone exists", () => {
  assert.ok(!/Africa\/Cairo/i.test(src), "no Cairo zone");
  assert.ok(!/UTC\s*[+-]\s*\d/i.test(src), "no manual UTC offset");
  assert.ok(!/getTimezoneOffset/.test(src), "no manual offset arithmetic");
  assert.ok(!/timeZone\s*:/.test(src), "no pinned timeZone option; device default applies");
  assert.ok(!/\+0?2:?00/.test(src.match(/localTime[\s\S]{0,400}/)?.[0] ?? ""), "helper adds no offset");
});

test("invalid/missing timestamps fail safely without fabricating dates", () => {
  for (const bad of [null, undefined, "", "   ", "not-a-date", "2026-13-99"]) {
    assert.equal(localTime(bad), "—", "fail-safe for " + String(bad));
  }
  assert.equal(localTime("2026-09-22T12:17:23.191Z").length > 0, true);
});

test("raw Advanced UTC remains available where applicable", () => {
  const loadGates = takeBlock("async function loadGates");
  assert.match(loadGates, /Advanced — raw event detail/);
  assert.match(loadGates, /Advanced — raw gate keys/);
  const mc = takeBlock("async function missionControl");
  assert.ok(mc.includes("heartbeat ${esc((w.workers&&w.workers.latestHeartbeatAt)||'unknown')}"),
    "Mission Control Advanced preserves raw UTC heartbeat");
});

test("no native alert/confirm regressions; no new write paths", () => {
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const natives = [...codeOnly.matchAll(/(^|[^a-zA-Z])alert\(|(^|[^a-zA-Z])confirm\(/gm)];
  assert.equal(natives.length, 0, "zero native dialogs in Owner bundle");
  assert.match(src, /function localTime/);
  const helper = takeBlock("function localTime");
  assert.ok(!/fetch\(/.test(helper), "renderer is pure presentation");
  assert.ok(!/POST|PUT|DELETE/.test(helper), "renderer performs no mutation");
});
