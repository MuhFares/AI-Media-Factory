/**
 * Program 5 Owner surfaces (no DB): portfolio hub with per-project counts,
 * project creation/switching without state mutation, dashboard channels,
 * Decision Center project context. Business labels primary, IDs Advanced.
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

test("portfolio hub shows per-project counts and creation journey", () => {
  const hub = takeBlock("async function hub");
  assert.match(hub, /content:/);
  assert.match(hub, /channels:/);
  assert.match(hub, /decisions waiting/);
  assert.match(hub, /New project/);
  assert.match(hub, /creates no strategy, content, workflows, or authority/i);
  assert.match(src, /window\.openProject=id=>\{location\.search/);
  assert.match(src, /window\.createProject/);
});

test("project switching changes context without mutating state", () => {
  assert.match(src, /location\.search='\?project='\+encodeURIComponent\(id\)/);
  assert.match(src, /projChip/);
  assert.match(src, /project: \$\{esc\(label\)\}/);
  const hub = takeBlock("async function hub");
  assert.ok(!/POST|PUT|DELETE/.test(hub), "hub switching performs no mutations");
});

test("dashboard channels surface with verify and dry-run route", () => {
  const dash = takeBlock("async function loadDashboardChannels");
  assert.match(dash, /External identity:/);
  assert.match(dash, /No credential bindings/);
  assert.match(dash, /nothing uploads/);
  assert.match(src, /window\.createChannel/);
  assert.match(src, /window\.verifyChannel=/);
  assert.match(src, /window\.routeCheck=/);
  assert.match(src, /Dry-run publication route/);
  assert.match(src, /window\.bindCredential/);
  assert.ok(!/videos\.insert|uploadBytes/.test(dash), "no provider upload path in UI");
});

test("decision cards carry project context; no second approval system", () => {
  const approvals = takeBlock("async function approvals");
  assert.match(approvals, /Project: \$\{esc\(a\.projectId\|\|PROJ\)\}/);
  assert.ok(!/\/control\/approvals" *, *\{ *method: *"POST"/.test(approvals), "decisions made only via canonical decision flow");
});

test("no native dialogs in program 5 journeys", () => {
  for (const name of ["async function hub", "async function loadDashboardChannels"]) {
    const body = takeBlock(name).replace(/confirmModal/g, "");
    assert.ok(!/(^|[^a-zA-Z])alert\(|(^|[^a-zA-Z])confirm\(/.test(body), `no native dialogs in ${name}`);
  }
});
