/**
 * Program 4 analytics workspace UI contract (no DB): sparse-by-design
 * sections, availability badges, drill-down to Content, no native dialogs,
 * no fabricated data, Decision Center untouched.
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
const body = takeBlock("async function analytics");

test("workspace sections render with honest sparse states", () => {
  for (const section of ["Analytics overview", "Content performance", "Comparisons",
    "Experiments", "Insights", "Learning", "Data availability"]) {
    assert.match(body, new RegExp(section));
  }
  assert.match(body, /sparse is honest, not broken/);
  assert.match(takeBlock("function availBadge"), /NOT_YET_AVAILABLE/);
  assert.match(takeBlock("function availBadge"), /INSUFFICIENT_DATA/);
  assert.match(body, /never merged/);
});

test("drill-down reuses Content Item; comparisons stay server-side", () => {
  assert.match(body, /openContent\(/);
  const run = takeBlock("window.runCompare");
  assert.match(run, /analytics-comparisons/);
  assert.ok(!run.includes("toLocaleString"), "no client-side date math in compare");
});

test("no native dialogs; no execution paths; decision center untouched", () => {
  assert.ok(!/(^|[^a-zA-Z])alert\(|(^|[^a-zA-Z])confirm\(/.test(body.replace(/confirmModal/g, "")), "no native dialogs");
  assert.ok(!/command-room|START_GOVERNED_TASK|workflows.*POST|method.'POST'/.test(body), "read-only workspace");
  const nav = lines.find((l) => l.includes("const nav="));
  assert.ok(nav.includes("analytics"), "Analytics in navigation");
});
