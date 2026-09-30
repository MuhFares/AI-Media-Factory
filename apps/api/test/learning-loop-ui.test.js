/**
 * M2 Owner surface (no DB): static-source contract over shipped app.js.
 * Learning loop renders business summaries primary, VALIDATION ONLY
 * badges on non-live evidence, technical provenance under Advanced,
 * local timestamps, and zero native dialogs.
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
const body = takeBlock("async function loadLearning");

test("learning section renders business summaries with validation-only badges", () => {
  assert.match(body, /\/api\/runtime\/learning-summary/);
  assert.match(body, /Performance observations/);
  assert.match(body, /Persisted learning/);
  assert.match(body, /Recommendations/);
  assert.match(body, /Next-cycle proposals/);
  assert.match(body, /VALIDATION ONLY/);
  assert.match(body, /nothing starts|awaits Owner decision/i);
  assert.match(body, /Owner decision required/);
});

test("technical provenance under Advanced; local time; no native dialogs", () => {
  assert.match(body, /Advanced — raw learning records/);
  assert.match(body, /localTime\(o\.observedAt\)/);
  assert.match(body, /localTime\(l\.createdAt\)/);
  assert.ok(!/(^|[^a-zA-Z])alert\(|(^|[^a-zA-Z])confirm\(/.test(
    body.replace(/confirmModal/g, "")), "no native dialogs in learning view");
  assert.ok(!/fetch\([^)]*POST/.test(body), "read-only: no mutations from learning view");
});

test("learning section is wired into Strategy view without new top-level nav", () => {
  assert.match(src, /det-stLearn.*Learning loop.*stLearn/);
  assert.match(src, /'det-stLearn'/);
  const nav = lines.find((l) => l.includes("const nav="));
  assert.ok(!/Learning/.test(nav), "no new top-level navigation section");
});
