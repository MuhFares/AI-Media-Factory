/**
 * Program 1 Workstream A — Owner UI publication/visibility contract.
 * Static-source test over shipped app.js (no DB): provider confirmation
 * renders separately from public visibility; a confirmed private record
 * never renders as publicly published.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const src = fs.readFileSync(path.join(REPO, "apps/api/src/ai_media_factory/static/app.js"), "utf8");

test("provider confirmation renders separately from public visibility", () => {
  assert.match(src, /Provider record:/);
  assert.match(src, /Provider publication exists/);
  assert.match(src, /integration truth, not public visibility/);
  assert.match(src, /Provider: \$\{esc\(lc\.providerPublication\.visibility/);
});

test("confirmed private never renders as publicly published", () => {
  const first = src.indexOf("w.providerPublication&&w.providerPublication.confirmed?");
  assert.ok(first > 0, "pipeline provider branch exists");
  const card = src.slice(first, first + 250);
  assert.ok(!card.includes("Published"), "pipeline provider branch must not say Published");
  assert.ok(card.includes("Provider record:"));
  const second = src.indexOf("w.providerPublication&&w.providerPublication.confirmed?", first + 1);
  assert.ok(second > 0, "workflow provider branch exists");
  const section = src.slice(second, second + 400);
  assert.ok(!section.includes("Published"), "workflow provider branch must not say Published");
  assert.ok(section.includes("integration truth, not public visibility"));
  assert.match(src, /Public status: <b>\$\{w\.publicStatus==='PUBLISHED'\?'Published':'Not published'\}/);
});

test("decision center and authority vocabulary untouched", () => {
  assert.match(src, /Decision Center is the sole source of Owner actionability|Decision Center remains the sole/);
  assert.match(src, /NOT_GRANTED/);
});
