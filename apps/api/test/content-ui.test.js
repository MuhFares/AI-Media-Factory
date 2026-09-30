/**
 * Program 2 content UI contract (no DB): business objects primary,
 * technical IDs Advanced-only, inline validation, Decision Center
 * routing preserved, no native dialogs in new journeys.
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
  const line = lines.find((l) => l.includes(start));
  if (!line) throw new Error("missing " + start);
  return line;
}
const box = new Function(`${takeLine("const esc=")}\n${takeBlock("function contentStatusChip")}; return { contentStatusChip };`)();
const { contentStatusChip } = box;

test("12: content navigation and workspace render business objects", () => {
  assert.match(src, /\['content','Content'\]/);
  assert.match(src, /view==='content'\)content\(\)/);
  assert.match(src, /view==='content-detail'\)contentDetail\(\)/);
  assert.match(src, /Morroway content/);
  assert.match(src, /Create content/);
  assert.match(src, /Needs attention/);
  assert.match(src, /Ready and published/);
});

test("business status chips read Owner-first for every lifecycle state", () => {
  const expected = {
    IDEA: "Idea", PLANNING: "Planning", SCRIPTING: "Scripting", PRODUCTION: "Producing",
    QA: "Quality review", AWAITING_APPROVAL: "Needs your decision",
    READY_TO_PUBLISH: "Ready to publish", PUBLISHED: "Published",
    MEASURING: "Measuring", LEARNING: "Learning", COMPLETED: "Completed",
    FAILED: "Needs attention",
  };
  for (const [raw, label] of Object.entries(expected)) {
    assert.match(contentStatusChip(raw), new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.ok(!contentStatusChip("IDEA").includes("IDEA"), "raw enum not primary");
});

test("technical IDs live under Advanced; no native dialogs in content journeys", () => {
  const detail = takeBlock("async function contentDetail");
  assert.match(detail, /Advanced — identifiers/);
  assert.match(detail, /Content \$\{esc\(c\.contentId\)\}/);
  const card = takeBlock("async function content").slice(0, 3000);
  assert.ok(!/workflowId|workflow_id/.test(card.split("ctNew")[0]), "workspace cards lead with business fields");
  for (const body of [takeBlock("async function content"), detail,
    takeBlock("async function loadContentAnalytics"), takeBlock("async function loadContentLearning")]) {
    assert.ok(!/(^|[^a-zA-Z])alert\(|(^|[^a-zA-Z])confirm\(/.test(body.replace(/confirmModal/g, "")), "no native dialogs");
  }
});

test("decision center stays canonical; publication preparation never executes", () => {
  const detail = takeBlock("async function contentDetail");
  assert.match(detail, /Open Decision Center/);
  assert.match(detail, /Preparing never uploads/);
  assert.match(detail, /does not grant production or publication authority/);
  assert.ok(!/command-room|START_GOVERNED_TASK/.test(detail), "content never starts execution paths");
  const create = takeBlock("async function content");
  assert.match(create, /Nothing starts until you review the brief/);
});

test("factory surfaces: subjects, scenes, and governed start-production", () => {
  const detail = takeBlock("async function contentDetail");
  assert.match(detail, /Characters and subjects/);
  assert.match(detail, /Scenes/);
  assert.match(detail, /loadContentSubjects/);
  assert.match(detail, /loadContentScenes/);
  const subj = takeBlock("async function loadContentSubjects");
  assert.match(subj, /VALIDATION ONLY|never claimed as guaranteed identity/);
  assert.match(subj, /Approve/);
  const scenes = takeBlock("async function loadContentScenes");
  assert.match(scenes, /Subjects:/);
  const start = takeBlock("window.startProductionForContent");
  assert.match(start, /\/start-production/);
  assert.ok(!/command-room|pendingCommandDraft/.test(start), "normal production no longer requires Command Room");
  for (const body of [subj, scenes, takeBlock("window.createSubject"),
    takeBlock("window.approveSubject"), takeBlock("window.saveScene"), start]) {
    assert.ok(!/(^|[^a-zA-Z])alert\(|(^|[^a-zA-Z])confirm\(/.test(body.replace(/confirmModal/g, "")), "no native dialogs");
  }
});

test("production enablement journey exposes brief, budgets, review, revision, metadata and private preparation", () => {
  const create = takeBlock("async function content");
  for (const field of ["ctAudience","ctPlatform","ctFormat","ctType","ctLanguage","ctDuration","ctScenes","ctResearch","ctCharacter"]) assert.match(create,new RegExp(field));
  const detail = takeBlock("async function contentDetail");
  for (const label of ["Production brief","Phase-1 call budgets","PRE-MEDIA REVIEW REQUIRED","Targeted revision","Final review","Metadata review","Private publication preparation"]) assert.match(detail,new RegExp(label));
  assert.match(detail,/UCA5ECzcK_96akfUT5fQUT3A/);
  assert.match(src,/HUMAN_REVIEW_REQUIRED/);
  assert.match(src,/maxlength="100"/);
});
