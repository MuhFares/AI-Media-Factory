/**
 * Program 6 — Governed Automation Owner UI contract (no DB).
 * Business language first (running/waiting/needs-me/next/stopped/budget);
 * no queue IDs, cron, or worker internals as the primary experience;
 * automation never publishes from the UI; Decision Center stays the sole
 * actionability truth.
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
const body = takeBlock("async function automationView");

test("automation answers the Owner questions in business language", () => {
  for (const section of ["Automation status", "What needs me", "Scheduled &amp; waiting work",
    "What would automation do next", "Budget remaining", "Automation controls",
    "All projects at a glance", "Recent automation history"]) {
    assert.match(body, new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), section);
  }
  assert.match(body, /never publishes, spends, or grants authority/);
  assert.match(body, /Dry-run only/);
});

test("controls are OFF-by-default with governed levels, not infrastructure", () => {
  assert.match(body, /Automation OFF/);
  assert.match(body, /Governed automation/);
  assert.match(body, /only you start it/);
  assert.ok(!/cron|queue ID|worker internals|job_id/.test(body), "no infrastructure as product");
  assert.match(body, /Advanced/);
});

test("attention links to Decision Center; decisions stay canonical", () => {
  assert.match(src, /Review in Decision Center/);
  assert.match(src, /setView\('approvals'\)/);
  assert.match(src, /automation\/explain/);
  assert.match(src, /automation\/tick/);
  const nav = lines.find((l) => l.includes("const nav="));
  assert.ok(nav.includes("automation"), "Automation in navigation");
  assert.ok(src.includes("else if(view==='automation')automationView()"), "view routed");
});

test("no publication path from automation UI; budgets count calls not money", () => {
  assert.ok(!/publish\.youtube|START_GOVERNED_TASK|public.*publish/i.test(body.replace(/never publishes/gi, "")), "no publish path");
  assert.match(body, /never money/);
  assert.match(body, /UNKNOWN/);
});
