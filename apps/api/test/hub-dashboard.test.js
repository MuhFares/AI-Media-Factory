/**
 * Slice 8 — Hub + Dashboard action orientation (no DB, no providers).
 * Tests shipped app.js functions by extraction: deterministic next-step
 * derivation, fixture filtering, and rendered Owner surfaces.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const src = fs.readFileSync(path.join(REPO, "apps/api/src/ai_media_factory/static/app.js"), "utf8");
const lines = src.split(/\r?\n/);
function takeLine(start) {
  const i = lines.findIndex((l) => l.includes(start));
  if (i < 0) throw new Error("missing " + start);
  return lines[i];
}
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
const lib = [
  "const esc=", "function localTime", "function hubStatusChip", "function labelize",
  "function authLine",
].map(takeLine).join("\n") + "\n" + [
  "function dashNextStep", "function artCategoryOf", "function artTitle",
].map(takeBlock).join("\n");
const box = new Function(`${lib}; return { hubStatusChip, authLine, dashNextStep, artCategoryOf, artTitle };`)();

test("next-step derivation: decision first, never infers authority", async () => {
  assert.deepEqual(box.dashNextStep({ needsDecisionCount: null }).target, "approvals");
  const one = box.dashNextStep({ needsDecisionCount: 1 });
  assert.equal(one.kind, "decision");
  assert.equal(one.target, "approvals");
  assert.equal(one.requiresOwnerDecision, true);
  assert.match(one.title, /1 decision needs your review/);
  const many = box.dashNextStep({ needsDecisionCount: 3 });
  assert.match(many.title, /3 decisions need your review/);
  const run = box.dashNextStep({ needsDecisionCount: 0, queueRunning: 2 });
  assert.equal(run.kind, "monitor");
  assert.equal(run.requiresOwnerDecision, false);
  for (const st of ["failed", "FAILED_TERMINAL", "BLOCKED"]) {
    const f = box.dashNextStep({ needsDecisionCount: 0, latestWorkflow: { workflowId: "w", status: st } });
    assert.equal(f.kind, "inspect");
    assert.equal(f.requiresOwnerDecision, false);
  }
  const done = box.dashNextStep({ needsDecisionCount: 0, latestWorkflow: { workflowId: "w", status: "completed" } });
  assert.equal(done.target, "artifacts");
  const fresh = box.dashNextStep({ needsDecisionCount: 0 });
  assert.equal(fresh.kind, "workspace");
  assert.equal(fresh.target, "command");
  const dumped = JSON.stringify([
    box.dashNextStep({ needsDecisionCount: 2 }),
    box.dashNextStep({ needsDecisionCount: 0, queueRunning: 1 }),
    box.dashNextStep({ needsDecisionCount: 0 }),
  ]);
  assert.doesNotMatch(dumped, /production approval|publication authorized|GRANTED|permitted|allowed/i);
});

test("hub renders registered projects with display names; no client-side blacklist", async () => {
  assert.match(box.hubStatusChip("revision_required"), /Revision Required/);
  const src = takeBlock("async function hub");
  assert.ok(!src.includes("hubIsFixture") && !src.includes("hubShowFixtures") && !src.includes("test namespace"), "no blacklist mechanism remains in Hub");
});

test("authority display preserves canonical tokens; UNKNOWN only when unavailable", async () => {
  const full = box.authLine({ productionApproval: "NOT_GRANTED", publicationApproval: "NOT_GRANTED", publicStatus: "NOT_PUBLISHED" });
  assert.deepEqual([full.production, full.publication, full.public], ["Not granted", "Not granted", "Not published"]);
  assert.deepEqual(full.raw, { production: "NOT_GRANTED", publication: "NOT_GRANTED", public: "NOT_PUBLISHED" });
  const granted = box.authLine({ productionApproval: "GRANTED", publicationApproval: "NOT_GRANTED", publicStatus: "PUBLISHED" });
  assert.deepEqual([granted.production, granted.publication, granted.public], ["Granted", "Not granted", "Published"]);
  const missing = box.authLine(null);
  assert.deepEqual([missing.production, missing.publication, missing.public], ["Unknown", "Unknown", "Unknown"]);
  const partial = box.authLine({ productionApproval: "NOT_GRANTED" });
  assert.equal(partial.publication, "Unknown", "genuinely unavailable renders UNKNOWN");
  assert.equal(partial.production, "Not granted", "known truth never degrades");
});

function harness({ projects, dash, queue, effective }) {
  const elements = {};
  const el = () => {
    const e = {
      children: [], style: {}, appendChild() {}, addEventListener() {},
      set innerHTML(v) { e.html = (e.html || "") + v; },
      querySelector: (sel) => ((e._kids ??= {})[sel] ??= el()),
    };
    return e;
  };
  let shellHtml = "";
  const shells = [];
  const documentStub = {
    querySelector: (sel) => (elements[sel] ??= el()),
    createElement: () => el(),
  };
  async function jget(u) {
    if (u.includes("/api/runtime/projects")) return { projects };
    if (u.includes("/api/runtime/health")) return { health: { db: "ok", workers: { liveCount: 1, latestHeartbeatAt: "t" }, queue: { queued: 0, running: 0, succeeded: 1, failed: 0 } } };
    if (u.includes("/api/projects/morroway/dashboard")) return dash;
    if (u.includes("decision-queue")) return queue;
    if (u.includes("strategy-effective")) return effective;
    if (u.includes("/api/lifecycle")) return { lifecycles: [{ title: "T", productionApproval: "NOT_GRANTED", publicationApproval: "NOT_GRANTED", publicStatus: "NOT_PUBLISHED" }] };
    throw new Error("unexpected " + u);
  }
  const prefix = `let view='hub',dash=null,projects=[],healthInfo=null,approvalsCache=[],workflowsCache=[];\n`;
  const runHub = () => new Function("document", "jget", "shell",
    prefix + lib + "\n" + takeBlock("async function hub") + "\nreturn hub();",
  )(documentStub, jget, (c) => { shellHtml = c; });
  const runDash = () => new Function("document", "jget", "PROJ", "shell", "ensureDash",
    "loadDashboardChannels", prefix.replace("__SHOW__", "false") + lib + "\n" + takeBlock("async function dashboard") + "\nreturn dashboard();",
  )(documentStub, jget, "morroway", (c) => { shellHtml = c; }, async () => dash, async () => {});
  return { elements, shells, runHub, runDash, html: () => shellHtml + "\n" + Object.values(elements).map((e) => e.html || "").join("\n") };
}

const PROJECTS = [
  { projectId: "morroway", displayName: "Morroway", status: "ACTIVE", workflowCount: 3, latestWorkflowId: "wf-1", latestStatus: "completed" },
  { projectId: "my-project", displayName: "My Project", status: "ACTIVE", workflowCount: 2, latestWorkflowId: "wf-m", latestStatus: "revision_required" },
];
const DASH = {
  workflows: [{ workflowId: "wf-1", directive: "research", status: "completed", createdAt: "2026-09-20" }],
  approvals: [],
  needsDecisionCount: 0,
  readiness: { integrationValidation: "ok", productionApproval: "NOT_GRANTED", publicPublishApproval: "NOT_GRANTED", finalMediaArtifactId: null, readyForExternalPublish: false, blockers: [] },
  health: { queue: { running: 0 } },
  artifacts: [
    { artifact_id: "a1", kind: "writer_report", producer_agent: "writer", workflow_id: "wf-1", status: "completed", created_at: "2026-09-20", payload: { hook: "Hook" } },
  ],
};
const EFF = { health: { status: "READY" }, conflicts: [], active: [{ entityType: "STRATEGY", entityKey: "primary", version: 4, status: "ACTIVE", entityId: "e", activatedAt: "t", sourceArtifactIds: [], payload: {} }] };
const QUEUE_EMPTY = { needsDecision: [], counts: { needsDecision: 0 } };

test("hub: registered business projects render; no blacklist, no fixture toggle", async () => {
  const h = harness({ projects: PROJECTS });
  await h.runHub();
  const html = h.html();
  assert.match(html, /Morroway/);
  assert.match(html, /My Project/, "registered second project renders by display name");
  assert.match(html, /Revision Required/, "stage humanized");
  assert.ok(!html.includes("test namespace"), "no fixture labeling without registry data");
  assert.ok(!html.includes("Show test namespaces") && !html.includes("Hide test namespaces"), "no blacklist toggle remains");
  assert.ok(!html.includes("pending approvals"), "no raw pending counts on cards");
  assert.match(html, /Open project/);
  assert.match(html, /Completed/);
  const primary = html.split("<details>")[0];
  assert.ok(!primary.includes("queue q:"), "telemetry out of primary hierarchy");
  assert.match(html, /queue q:/, "telemetry capability preserved under Advanced");
});

test("dashboard: current state, clean zero attention, work, outputs, next step, drill-downs", async () => {
  const h = harness({ projects: PROJECTS, dash: DASH, queue: QUEUE_EMPTY, effective: EFF });
  await h.runDash();
  const html = h.html();
  assert.match(html, /Current state/);
  assert.match(html, /READY/);
  assert.match(html, /1 active entit/);
  assert.match(html, /Production Not granted/);
  assert.match(html, /Publication Not granted · Public Not published/);
  assert.match(html, /Pipeline stage does not grant operational authority/);
  assert.match(html, /No decisions need you right now\. Decision Center is clear\./);
  assert.match(html, /Latest:.*Research/);
  assert.match(html, /Recent outputs/);
  assert.match(html, /Hook/);
  assert.match(html, /Script/);
  assert.match(html, /Next operational step/);
  assert.match(html, /Review the latest outputs/);
  assert.match(html, /Artifacts/);
  for (const target of ["pipeline", "approvals", "agents", "command", "artifacts", "strategy"]) {
    assert.ok(html.includes(`setView('${target}')`), `drill-down to ${target}`);
  }
  assert.match(html, /Advanced — identifiers/);
  assert.ok(!html.includes("wf-1</div><div class=\"metric\""), "no raw workflow ID as primary metric");
});

test("dashboard: non-zero actionable attention links to Decision Center", async () => {
  const queue = { needsDecision: [{ approvalId: "a-1", targetId: "t-1", business: { title: "Approve launch", why: "Gate waiting" } }], counts: { needsDecision: 1 } };
  const h = harness({ projects: PROJECTS, dash: { ...DASH, needsDecisionCount: 1 }, queue, effective: EFF });
  await h.runDash();
  const html = h.html();
  assert.match(html, /1 decision needs your review/);
  assert.match(html, /Needs your decision/);
  assert.match(html, /Approve launch/);
  assert.match(html, /openDecision\('a-1'\)/);
});

test("dashboard: empty and unknown states stay honest", async () => {
  const h = harness({
    projects: [], dash: { workflows: [], approvals: [], readiness: {}, health: {}, artifacts: [] },
    queue: QUEUE_EMPTY, effective: { health: { status: "NOT_CONFIGURED" }, conflicts: [], active: [] },
  });
  await h.runDash();
  const html = h.html();
  assert.match(html, /No workflows recorded yet\./);
  assert.match(html, /No artifacts recorded yet\./);
  assert.match(html, /Ask the team a question/);
  assert.match(html, /analysis only/);
});

test("authority parity: exact tokens in Advanced; UNKNOWN only when unavailable", async () => {
  const h = harness({ projects: PROJECTS, dash: DASH, queue: QUEUE_EMPTY, effective: EFF });
  await h.runDash();
  const html = h.html();
  assert.match(html, /NOT_GRANTED\/NOT_GRANTED\/NOT_PUBLISHED/, "exact canonical tokens visible for parity");
  assert.ok(!html.includes("Production NO"), "readiness YES/NO vocabulary never leaks");
  assert.ok(!html.includes("Publication UNKNOWN"), "known truth never degrades");
});

test("hub renders every registered row without client-side hiding", async () => {
  const h = harness({ projects: PROJECTS });
  await h.runHub();
  const html = h.html();
  assert.ok(html.includes("Morroway") && html.includes("My Project"), "all registry rows render");
});
