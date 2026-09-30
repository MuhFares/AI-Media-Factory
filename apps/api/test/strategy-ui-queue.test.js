/**
 * Slice 6 acceptance remediation — derived review queue + wording (no DB).
 * Tests the shipped app.js functions by extraction: chain-head candidates,
 * older/stale labeling, content-system eligibility, and the rendered
 * Strategy view (proposals-vs-action separation, coverage wording).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const src = fs.readFileSync(path.join(REPO, "apps/api/src/ai_media_factory/static/app.js"), "utf8");
const lines = src.split("\n");
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
  "const esc=", "function localTime", "const humanType=", "const humanKey=", "function renderStructured",
  "function labelize", "function statusBadge",
  "const STRAT_ABSORBED_AS_STALE=", "function stratChainGroups",
  "function stratReviewQueue", "function stratContentSystemEligible", "function stratIterationState",
  "const STRAT_DETAIL_IDS=", "function stratDetails", "function stratPersistCollapsed",
  "function stratRestoreCollapsed", "function stratAttachCollapse", "const stratCap=",
  "const stratShortParen=", "const stratHumanStatus=", "function stratConstraintTags",
  "function stratExperimentTags",
].map(takeLine).join("\n") + "\n" + takeBlock("function stratDomainFacts") + "\n" + takeBlock("function stratDomainHead") + "\n" + takeBlock("async function loadLearning");
const box = new Function(`${lib}; return { STRAT_ABSORBED_AS_STALE, stratChainGroups, stratReviewQueue, stratContentSystemEligible, stratIterationState, stratDetails, stratDomainFacts, stratDomainHead, stratConstraintTags, stratExperimentTags };`)();

function ent(type, key, version, status) {
  return {
    entityType: type, entityKey: key, version, status,
    entityId: `strat-x-${type}-${key}-v${version}`.toLowerCase().replace(/_/g, "-"),
    createdAt: "2026-09-20", activatedAt: null, activatedByApprovalId: null,
    supersedesVersion: version > 1 ? version - 1 : null,
    sourceArtifactIds: ["docs/x.md"], payload: {},
  };
}
// Mirrors live Morroway: 7 proposals across 6 chains.
const SEVEN = [
  ent("BRAND", "primary", 2, "PROPOSED"),
  ent("CONSTRAINTS", "primary", 1, "PROPOSED"),
  ent("CONTENT_SYSTEM", "primary", 2, "PROPOSED"),
  ent("CONTENT_SYSTEM", "primary", 1, "PROPOSED"),
  ent("DECISION", "pilot-model", 1, "PROPOSED"),
  ent("EXPERIMENT", "pilot-gates", 1, "PROPOSED"),
  ent("STRATEGY", "primary", 3, "PROPOSED"),
];

test("J-1/14: latest proposal per chain is the review candidate (deterministic)", async () => {
  const q = box.stratReviewQueue(SEVEN);
  assert.deepEqual(q.candidates.map((x) => `${x.entityType}/${x.entityKey}@v${x.version}`).sort(), [
    "BRAND/primary@v2", "CONSTRAINTS/primary@v1", "CONTENT_SYSTEM/primary@v2",
    "EXPERIMENT/pilot-gates@v1", "STRATEGY/primary@v3",
  ].sort(), "absorbed DECISION head is stale, not a candidate");
  // Re-run determinism.
  assert.deepEqual(box.stratReviewQueue(SEVEN), box.stratReviewQueue([...SEVEN].reverse()));
});

test("J-3-corrections: corrected v4/v3 supersede v3/v2 in the derived queue", async () => {
  const rows = [
    ent("STRATEGY", "primary", 4, "PROPOSED"),
    ent("STRATEGY", "primary", 3, "PROPOSED"),
    ent("STRATEGY", "primary", 2, "ACTIVE"),
    ent("STRATEGY", "primary", 1, "SUPERSEDED"),
    ent("CONTENT_SYSTEM", "primary", 3, "PROPOSED"),
    ent("CONTENT_SYSTEM", "primary", 2, "PROPOSED"),
    ent("CONTENT_SYSTEM", "primary", 1, "PROPOSED"),
  ];
  const q = box.stratReviewQueue(rows);
  assert.deepEqual(q.candidates.map((x) => `v${x.version}`).sort(), ["v3", "v4"]);
  assert.deepEqual(q.older.map((x) => `${x.entity.entityType}@v${x.entity.version}`).sort(),
    ["CONTENT_SYSTEM@v1", "CONTENT_SYSTEM@v2", "STRATEGY@v3"]);
  assert.match(q.older.find((x) => x.entity.version === 3).reason, /current candidate is v4/);
});

test("J-2/3: older proposal stays inspectable but leaves the default queue", async () => {
  const q = box.stratReviewQueue(SEVEN);
  assert.ok(!q.candidates.some((x) => x.entityType === "CONTENT_SYSTEM" && x.version === 1));
  assert.equal(q.older.length, 1);
  assert.equal(q.older[0].entity.version, 1);
  assert.match(q.older[0].reason, /current candidate is v2/);
});

test("J-absorbed: DECISION/pilot-model leaves the queue with documented reason", async () => {
  const q = box.stratReviewQueue(SEVEN);
  assert.ok(!q.candidates.some((x) => x.entityType === "DECISION"));
  assert.equal(q.stale.length, 1);
  assert.match(q.stale[0].reason, /absorbed/);
  assert.equal(Object.keys(box.STRAT_ABSORBED_AS_STALE).length, 1, "curated list stays minimal");
});

test("iteration-state: unchanged v1 after REQUEST_ITERATION routes to revision, never resubmit", async () => {
  const v1 = { entityId: "e-c1", entityType: "CONSTRAINTS", entityKey: "primary", version: 1, status: "PROPOSED" };
  const v2 = { entityId: "e-c2", entityType: "CONSTRAINTS", entityKey: "primary", version: 2, status: "PROPOSED" };
  const iter = { approvalId: "a-iter", targetType: "CONSTRAINTS_ACTIVATION", targetId: "e-c1", status: "DECIDED", ownerDecision: "REQUEST_ITERATION", ownerRationale: "Revise rule two.", decidedAt: "2026-09-20T22:00:00Z", createdAt: "2026-09-20T21:00:00Z" };
  assert.deepEqual(box.stratIterationState(v1, [], [v1]).mode, "NONE", "no decision, no state");
  const appr = { approvalId: "a-ok", targetType: "CONSTRAINTS_ACTIVATION", targetId: "e-c1", status: "DECIDED", ownerDecision: "APPROVE", decidedAt: "2026-09-20T22:00:00Z", createdAt: "2026-09-20T21:00:00Z" };
  assert.deepEqual(box.stratIterationState(v1, [appr], [v1]).mode, "NONE", "APPROVE is not iteration");
  const required = box.stratIterationState(v1, [iter], [v1]);
  assert.equal(required.mode, "REVISION_REQUIRED");
  assert.equal(required.rationale, "Revise rule two.");
  const available = box.stratIterationState(v1, [iter], [v1, v2]);
  assert.equal(available.mode, "REVISION_AVAILABLE");
  assert.equal(available.newer.entityId, "e-c2", "revised proposal linked");
  const active = box.stratIterationState({ ...v1, status: "ACTIVE" }, [iter], [v1]);
  assert.equal(active.mode, "NONE", "active versions are not revision sources");
  const other = box.stratIterationState(v1, [{ ...iter, targetId: "e-other" }], [v1, v2]);
  assert.equal(other.mode, "NONE", "unrelated decisions ignored");
});

test("iteration-queue: constraints v2 is the candidate, v1 stays History-visible", async () => {
  const rows = [
    { entityType: "CONSTRAINTS", entityKey: "primary", version: 2, status: "PROPOSED", entityId: "e-c2", createdAt: "t2" },
    { entityType: "CONSTRAINTS", entityKey: "primary", version: 1, status: "PROPOSED", entityId: "e-c1", createdAt: "t1" },
  ];
  const q = box.stratReviewQueue(rows);
  assert.deepEqual(q.candidates.map((x) => x.version), [2]);
  assert.equal(q.older.length, 1);
  assert.match(q.older[0].reason, /current candidate is v2/);
});

test("J-13: content-system eligibility evaluates without activation", async () => {
  const good = {
    decisionModel: ["PERFORMANCE_LED", "AGENT_RECOMMENDED", "OWNER_GOVERNED"],
    pilot: { model: "adaptive", size: "ADAPTIVE", duration: "ADAPTIVE" },
    learningBatch: { items: [{ id: "MW-HIS-001" }, { id: "MW-HIS-002" }, { id: "MW-FAN-001" }, { id: "MW-FAN-002" }] },
    sourcing: { historicalPov: "real history", fantasy: "original" },
    gates: { note: "hypotheses, NOT permanent KPIs" },
  };
  assert.equal(box.stratContentSystemEligible(good).eligible, true);
  assert.equal(box.stratContentSystemEligible({ ...good, pilot: { model: "fixed" } }).eligible, false);
  assert.equal(box.stratContentSystemEligible({ ...good, decisionModel: ["PERFORMANCE_LED"] }).eligible, false);
  const granting = { ...good, note: "production GRANTED" };
  assert.equal(box.stratContentSystemEligible(granting).eligible, false, "grants never eligible");
});

test("iteration-render: v1 review page routes to revision with rationale, never resubmit", async () => {
  const viewSrc = takeBlock("async function strategyReview");
  const captured = {};
  const el = () => ({ children: [], style: {}, appendChild() {}, set innerHTML(v) { this.html = (this.html || "") + v; } });
  const elements = {};
  const documentStub = { querySelector: (sel) => (elements[sel] ??= el()), createElement: () => el() };
  const v1ent = { entityId: "e-c1", entityType: "CONSTRAINTS", entityKey: "primary", version: 1, status: "PROPOSED", createdAt: "t", sourceArtifactIds: [], payload: { rules: ["a"] }, schemaVersion: "s" };
  const v2ent = { ...v1ent, entityId: "e-c2", version: 2 };
  const iterAppr = { approvalId: "a-iter", targetType: "CONSTRAINTS_ACTIVATION", targetId: "e-c1", status: "DECIDED", ownerDecision: "REQUEST_ITERATION", ownerRationale: "Revise rule two.", decidedAt: "t2", createdAt: "t1" };
  async function jgetRv(u) {
    if (u.includes("strategy/review")) {
      return {
        entity: v1ent, baseline: null, baselineConflict: false, diff: { baseline: "NONE", rows: [] },
        approvals: [iterAppr], eligibility: { canActivate: false, reason: "NO_APPROVED_AUTHORITY", approvalId: null },
        impact: { onActivate: ["Effective."], notOnActivate: ["No production authority is granted.", "No publication authority is granted."] },
        evidence: [],
      };
    }
    if (u.includes("strategy-entities")) return { entities: [v1ent, v2ent] };
    throw new Error("unexpected " + u);
  }
  const fn = new Function("document", "jget", "PROJ", "shell", "npAddRow", "reviewEntityId",
    lib + "\n" + viewSrc + "\nreturn strategyReview();");
  await fn(documentStub, jgetRv, "morroway", () => {}, () => {}, "e-c1");
  const rv = Object.values(elements).map((e) => e.html || "").join("\n");
  assert.match(rv, /Owner requested iteration\./);
  assert.match(rv, /Revise rule two\./);
  assert.match(rv, /Revised proposal available/);
  assert.match(rv, /openReview\('e-c2'\)/);
  assert.ok(!rv.includes("requestDecision()"), "unchanged version is not offered for resubmission");
});

test("content-v4-queue: governance v4 is the candidate, v3/v2/v1 stay History-visible", async () => {
  const rows = [
    ent("CONTENT_SYSTEM", "primary", 4, "PROPOSED"),
    ent("CONTENT_SYSTEM", "primary", 3, "PROPOSED"),
    ent("CONTENT_SYSTEM", "primary", 2, "PROPOSED"),
    ent("CONTENT_SYSTEM", "primary", 1, "PROPOSED"),
  ];
  const q = box.stratReviewQueue(rows);
  assert.deepEqual(q.candidates.map((x) => x.version), [4]);
  assert.deepEqual(q.older.map((x) => x.entity.version).sort(), [1, 2, 3]);
});

test("experiment-v2-queue: gates v2 is the candidate, v1 stays History-visible", async () => {
  const rows = [
    ent("EXPERIMENT", "pilot-gates", 2, "PROPOSED"),
    ent("EXPERIMENT", "pilot-gates", 1, "PROPOSED"),
  ];
  const q = box.stratReviewQueue(rows);
  assert.deepEqual(q.candidates.map((x) => x.version), [2]);
  assert.equal(q.older.length, 1);
  assert.match(q.older[0].reason, /current candidate is v2/);
});

test("currentness-1/2/3: older PROPOSED + newer ACTIVE => not candidate, lifecycle kept, history-visible", async () => {
  const rows = [
    ent("CONSTRAINTS", "primary", 1, "PROPOSED"),
    ent("CONSTRAINTS", "primary", 2, "ACTIVE"),
  ];
  const before = JSON.parse(JSON.stringify(rows));
  const q = box.stratReviewQueue(rows);
  assert.deepEqual(q.candidates, [], "newer ACTIVE demotes the older proposal");
  assert.equal(q.older.length, 1);
  assert.equal(q.older[0].entity.version, 1);
  assert.match(q.older[0].reason, /v2 ACTIVE is current/);
  assert.deepEqual(rows, before, "no historical mutation; lifecycle status untouched");
  assert.equal(rows[0].status, "PROPOSED", "canonical lifecycle truth preserved, not faked SUPERSEDED");
});

test("currentness-4: genuinely newer PROPOSED over ACTIVE still qualifies", async () => {
  const rows = [
    ent("STRATEGY", "primary", 4, "PROPOSED"),
    ent("STRATEGY", "primary", 3, "PROPOSED"),
    ent("STRATEGY", "primary", 2, "ACTIVE"),
    ent("STRATEGY", "primary", 1, "SUPERSEDED"),
  ];
  const q = box.stratReviewQueue(rows);
  assert.deepEqual(q.candidates.map((x) => x.version), [4]);
  assert.deepEqual(q.older.map((x) => x.entity.version).sort(), [3]);
});

test("currentness-5/6: currentness creates no actionability; Decision Center untouched", async () => {
  const q = box.stratReviewQueue(SEVEN);
  const dumped = JSON.stringify(q);
  assert.doesNotMatch(dumped, /actionable/i, "queue carries no actionability signal");
  assert.ok(q.candidates.every((x) => x.status === "PROPOSED" || x.status === "DRAFT"), "candidates are proposals, never tasks");
});

test("currentness-7/8: live Morroway shape resolves zero candidates, all history preserved", async () => {
  const rows = [
    ent("BRAND", "primary", 2, "ACTIVE"), ent("BRAND", "primary", 1, "SUPERSEDED"),
    ent("CONSTRAINTS", "primary", 2, "ACTIVE"), ent("CONSTRAINTS", "primary", 1, "PROPOSED"),
    ent("CONTENT_SYSTEM", "primary", 4, "ACTIVE"), ent("CONTENT_SYSTEM", "primary", 3, "PROPOSED"),
    ent("CONTENT_SYSTEM", "primary", 2, "PROPOSED"), ent("CONTENT_SYSTEM", "primary", 1, "PROPOSED"),
    ent("DECISION", "pilot-model", 1, "PROPOSED"),
    ent("EXPERIMENT", "pilot-gates", 2, "ACTIVE"), ent("EXPERIMENT", "pilot-gates", 1, "PROPOSED"),
    ent("STRATEGY", "primary", 4, "ACTIVE"), ent("STRATEGY", "primary", 3, "PROPOSED"),
    ent("STRATEGY", "primary", 2, "SUPERSEDED"), ent("STRATEGY", "primary", 1, "SUPERSEDED"),
  ];
  const q = box.stratReviewQueue(rows);
  assert.deepEqual(q.candidates, [], "Morroway current candidates = 0");
  const olderIds = q.older.map((x) => `${x.entity.entityType}@v${x.entity.version}`).sort();
  assert.deepEqual(olderIds, ["CONSTRAINTS@v1", "CONTENT_SYSTEM@v1", "CONTENT_SYSTEM@v2", "CONTENT_SYSTEM@v3", "EXPERIMENT@v1", "STRATEGY@v3"]);
  assert.equal(q.stale.length, 1, "decision stays stale-listed");
  // Purity: repeated + interleaved calls share no state (restart/reload stable).
  const again = box.stratReviewQueue([...rows].reverse());
  assert.deepEqual(again, q);
});

test("compaction-facts: deterministic domain summaries from active payloads only", async () => {
  const strategy = { entityType: "STRATEGY", version: 4, status: "ACTIVE", entityId: "e-s", payload: { pilot: { model: "adaptive" }, platforms: { primary: "Instagram Reels first (initial primary platform)" }, contentPillars: ["a", "b"] } };
  assert.equal(box.stratDomainFacts(strategy), "Adaptive pilot · Instagram Reels first · 2 content pillars");
  const brand = { entityType: "BRAND", version: 2, status: "ACTIVE", entityId: "e-b", payload: { brand: "Morroway", brandStatus: "APPROVED_MASTER_BRAND", identityDirection: { primary: "Threshold" } } };
  assert.equal(box.stratDomainFacts(brand), "Morroway · Approved master brand · Threshold identity");
  const content = { entityType: "CONTENT_SYSTEM", version: 4, status: "ACTIVE", entityId: "e-c", payload: { pilot: { model: "adaptive" }, learningBatch: { items: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }] }, governance: { qaRequired: true } } };
  assert.equal(box.stratDomainFacts(content), "Adaptive pilot · Initial 4-item learning batch · QA required");
  const constraints = { entityType: "CONSTRAINTS", version: 2, status: "ACTIVE", entityId: "e-k", payload: { rules: ["Validation success is not production approval", "Publication must follow policy", "No workstream may trap the brand in one pillar"] } };
  assert.equal(box.stratDomainFacts(constraints), "Governed publication · No authority from validation · Multi-pillar");
  const experiment = { entityType: "EXPERIMENT", version: 2, status: "ACTIVE", entityId: "e-e", payload: { status: "EXPERIMENTAL", rule: "hypotheses, NOT permanent KPIs", decisionModel: ["OWNER_GOVERNED"] } };
  assert.equal(box.stratDomainFacts(experiment), "Experimental signals · Non-KPI · Owner-governed decisions");
  assert.equal(box.stratDomainFacts(null), "");
  assert.equal(box.stratDomainFacts({ entityType: "UNKNOWN", payload: {} }), "");
  const head = box.stratDomainHead(strategy);
  assert.match(head, /<b>Strategy<\/b> · v4/);
  assert.match(head, /ACTIVE<\/span>/);
  assert.match(head, /openReview\('e-s'\)/);
  assert.match(head, /event\.preventDefault\(\)/);
});

test("J-4/5/6/7/8 + K-wording: rendered view separates proposals from Owner action", async () => {
  const viewSrc = takeBlock("async function strategyView");
  const captured = {};
  const el = () => ({ children: [], style: {}, appendChild() {}, set innerHTML(v) { this.html = (this.html || "") + v; } });
  const elements = {};
  const documentStub = {
    querySelector: (sel) => (elements[sel] ??= el()),
    createElement: () => el(),
  };
  const eff = {
    health: { status: "INCOMPLETE" }, conflicts: [],
    active: [
      { entityType: "STRATEGY", entityKey: "primary", version: 2, status: "ACTIVE", entityId: "e-s2", activatedAt: "2026-09-01", sourceArtifactIds: [], payload: { ownerDecision: "APPROVED_WITH_CHANGES", contentPillars: ["a", "b"] } },
      { entityType: "BRAND", entityKey: "primary", version: 1, status: "ACTIVE", entityId: "e-b1", activatedAt: "2026-09-01", sourceArtifactIds: [], payload: { brand: "Morroway" } },
    ],
  };
  const withPayload = SEVEN.map((x) => x.entityType === "CONTENT_SYSTEM" && x.version === 2
    ? { ...x, payload: { status: "READY", decisionModel: ["PERFORMANCE_LED", "AGENT_RECOMMENDED", "OWNER_GOVERNED"], pilot: { model: "adaptive", size: "ADAPTIVE", duration: "ADAPTIVE" }, learningBatch: { items: [{ id: "MW-HIS-001" }, { id: "MW-HIS-002" }, { id: "MW-FAN-001" }, { id: "MW-FAN-002" }] }, sourcing: { historicalPov: "h", fantasy: "f" }, gates: { note: "NOT permanent" } } }
    : x);
  async function jget(u) {
    if (u.includes("strategy-effective")) return eff;
    if (u.includes("strategy-entities")) return { entities: withPayload };
    if (u.includes("lifecycle")) return { lifecycles: [{ productionApproval: "NOT_GRANTED", publicationApproval: "NOT_GRANTED", publicStatus: "NOT_PUBLISHED" }] };
    if (u.includes("decision-queue")) return { needsDecision: [], counts: { needsDecision: 0 } };
    if (u.includes("learning-summary")) return { observations: [], learnings: [], recommendations: [], proposals: [] };
    throw new Error("unexpected " + u);
  }
  const fn = new Function("document", "jget", "PROJ", "shell", "npAddRow",
    lib + "\n" + viewSrc + "\nreturn strategyView();");
  await fn(documentStub, jget, "morroway", () => {}, () => {});
  const html = Object.values(elements).map((e) => e.html || "").join("\n");
  assert.match(html, /Strategic proposals available for review: <b>5<\/b>/);
  assert.match(html, /Owner action required: <b>0<\/b>/);
  assert.match(html, /Decision Center only/);
  assert.match(html, /Strategic coverage: INCOMPLETE — no ACTIVE Content system\./);
  assert.match(html, /Latest Content system proposal: v2 — available for review\./);
  assert.match(html, /baseline checklist: meets all \(advisory/);
  const attn = elements["#stAttn"].html;
  assert.ok(!attn.includes("content-system-primary-v1"), "older proposal not in default queue");
  assert.ok(attn.includes("content-system-primary-v2"), "current candidate queued");
  assert.ok(!attn.includes("pilot-model-v1"), "absorbed proposal not in default queue");
  const hist = elements["#stHist"].html;
  assert.match(hist, /older proposal/);
  assert.match(hist, /stale — absorbed/);
  assert.match(html, /Production[\s\S]*Not granted/);
});

test("zero-candidate render: N=0 wording, older history intact, action still Decision-Center-only", async () => {
  const viewSrc = takeBlock("async function strategyView");
  const el = () => ({ children: [], style: {}, appendChild() {}, set innerHTML(v) { this.html = (this.html || "") + v; } });
  const elements = {};
  const documentStub = {
    querySelector: (sel) => (elements[sel] ??= el()),
    createElement: () => el(),
  };
  const act = (type, key, version, payload) => ({
    entityType: type, entityKey: key, version, status: "ACTIVE",
    entityId: `e-${type}-${version}`.toLowerCase(), activatedAt: "2026-09-21",
    activatedByApprovalId: "approval-1", sourceArtifactIds: [], payload,
  });
  const eff = {
    health: { status: "READY" }, conflicts: [],
    active: [
      act("STRATEGY", "primary", 4, { ownerDecision: "APPROVED_WITH_CHANGES" }),
      act("BRAND", "primary", 2, { brand: "Morroway" }),
      act("CONTENT_SYSTEM", "primary", 4, { status: "READY" }),
    ],
  };
  const all = [
    ...eff.active,
    ent("BRAND", "primary", 1, "SUPERSEDED"),
    ent("CONSTRAINTS", "primary", 2, "ACTIVE"),
    ent("CONSTRAINTS", "primary", 1, "PROPOSED"),
    ent("CONTENT_SYSTEM", "primary", 3, "PROPOSED"),
    ent("DECISION", "pilot-model", 1, "PROPOSED"),
    ent("EXPERIMENT", "pilot-gates", 2, "ACTIVE"),
    ent("EXPERIMENT", "pilot-gates", 1, "PROPOSED"),
    ent("STRATEGY", "primary", 3, "PROPOSED"),
  ];
  async function jget(u) {
    if (u.includes("strategy-effective")) return eff;
    if (u.includes("strategy-entities")) return { entities: all };
    if (u.includes("lifecycle")) return { lifecycles: [{ productionApproval: "NOT_GRANTED", publicationApproval: "NOT_GRANTED", publicStatus: "NOT_PUBLISHED" }] };
    if (u.includes("decision-queue")) return { needsDecision: [], counts: { needsDecision: 0 } };
    if (u.includes("learning-summary")) return { observations: [], learnings: [], recommendations: [], proposals: [] };
    throw new Error("unexpected " + u);
  }
  const fn = new Function("document", "jget", "PROJ", "shell", "npAddRow",
    lib + "\n" + viewSrc + "\nreturn strategyView();");
  await fn(documentStub, jget, "morroway", () => {}, () => {});
  const html = Object.values(elements).map((e) => e.html || "").join("\n");
  assert.match(html, /Current strategic proposals for review: <b>0<\/b>/);
  assert.match(html, /No current proposals for review\. Older proposals remain available under History\./);
  assert.match(html, /Owner action required: <b>0<\/b>/);
  assert.ok(!html.includes("Awaiting Owner review"), "no task-implying copy");
  const hist = elements["#stHist"].html;
  assert.match(hist, /older proposal/);
  assert.match(hist, /stale — absorbed/);
  assert.match(hist, /SUPERSEDED/);
});

test("compaction-render: accordion defaults, native toggle, facts, counts, reachability", async () => {
  const viewSrc = takeBlock("async function strategyView");
  const el = () => ({ children: [], style: {}, appendChild() {}, set innerHTML(v) { this.html = (this.html || "") + v; } });
  const elements = {};
  const documentStub = {
    querySelector: (sel) => (elements[sel] ??= el()),
    createElement: () => el(),
  };
  const act = (type, key, version, payload) => ({
    entityType: type, entityKey: key, version, status: "ACTIVE",
    entityId: `e-${type}-${version}`.toLowerCase(), activatedAt: "2026-09-21",
    activatedByApprovalId: "approval-1", sourceArtifactIds: ["docs/x.md"], payload,
  });
  const eff = {
    health: { status: "READY" }, conflicts: [],
    active: [
      act("STRATEGY", "primary", 4, { pilot: { model: "adaptive" }, platforms: { primary: "Instagram Reels first (initial primary platform)" }, contentPillars: ["a", "b"] }),
      act("BRAND", "primary", 2, { brand: "Morroway", brandStatus: "APPROVED_MASTER_BRAND", identityDirection: { primary: "Threshold" } }),
      act("CONTENT_SYSTEM", "primary", 4, { pilot: { model: "adaptive" }, learningBatch: { items: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }] }, governance: { qaRequired: true } }),
      act("CONSTRAINTS", "primary", 2, { rules: ["Validation success is not production approval", "Publication must follow policy", "No workstream may trap the brand in one pillar"] }),
      act("EXPERIMENT", "pilot-gates", 2, { status: "EXPERIMENTAL", rule: "hypotheses, NOT permanent KPIs", decisionModel: ["OWNER_GOVERNED"] }),
    ],
  };
  async function jget(u) {
    if (u.includes("strategy-effective")) return eff;
    if (u.includes("strategy-entities")) return { entities: eff.active };
    if (u.includes("lifecycle")) return { lifecycles: [{ productionApproval: "NOT_GRANTED", publicationApproval: "NOT_GRANTED", publicStatus: "NOT_PUBLISHED" }] };
    if (u.includes("decision-queue")) return { needsDecision: [], counts: { needsDecision: 0 } };
    if (u.includes("learning-summary")) return { observations: [], learnings: [], recommendations: [], proposals: [] };
    throw new Error("unexpected " + u);
  }
  const fn = new Function("document", "jget", "PROJ", "shell", "npAddRow",
    lib + "\n" + viewSrc + "\nreturn strategyView();");
  let shellHtml = "";
  await fn(documentStub, jget, "morroway", (c) => { shellHtml = c; }, () => {});
  const html = shellHtml + "\n" + Object.values(elements).map((e) => e.html || "").join("\n");
  // Native accordion structure: 10 details (9 strategy + Learning loop), none open by default.
  assert.equal((html.match(/<details class="collapsible"/g) || []).length, 10);
  assert.ok(!html.includes("<details class=\"collapsible\" open"), "all collapsed by default");
  assert.ok(html.includes("<summary>"), "native summary affordance (keyboard + aria-expanded free)");
  // Overview + Effective stay open plain sections.
  assert.match(html, /Current strategy/);
  assert.match(html, /Operational authority/);
  // Domain headers: name + version + ACTIVE badge + deterministic facts + Review.
  assert.match(html, /Adaptive pilot · Instagram Reels first · 2 content pillars/);
  assert.match(html, /Morroway · Approved master brand · Threshold identity/);
  assert.match(html, /Adaptive pilot · Initial 4-item learning batch · QA required/);
  assert.match(html, /Governed publication · No authority from validation · Multi-pillar/);
  assert.match(html, /Experimental signals · Non-KPI · Owner-governed decisions/);
  assert.ok((html.match(/event\.preventDefault\(\);openReview/g) || []).length >= 5, "header Review actions do not toggle");
  // Counts.
  assert.match(html, /Review queue \(0\)/);
  assert.match(html, /Current strategic proposals for review: <b>0<\/b>/);
  assert.match(html, /Owner action required: <b>0<\/b>/);
  // All content reachable: every body div rendered with real content.
  for (const id of ["#stStrategy", "#stBrand", "#stContent", "#stConstraints", "#stExperiment", "#stAttn", "#stPreview", "#stHist", "#stProposal"]) {
    assert.ok((elements[id].html || "").length > 0, `${id} reachable`);
  }
  assert.match(elements["#stPreview"].html, /id="pvAgent"/, "preview controls intact");
  assert.match(elements["#stProposal"].html, /id="npType"/, "proposal controls intact");
  // Authority text unchanged.
  assert.match(html, /Strategic approval never grants production\/publication/);
});
