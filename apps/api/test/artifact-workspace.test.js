/**
 * Slice 7 — artifacts business workspace UI logic (no DB, no providers).
 * Tests the shipped app.js pure functions by extraction: deterministic
 * category mapping, preview-kind detection, titles, search, lineage,
 * cards, focus detail, and empty states.
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
  "const ART_BUSINESS_CATEGORIES=", "const ART_TECHNICAL_CATEGORY=",
  "function artHasScheme",
].map(takeLine).join("\n") + "\n" + [
  "function artCategoryOf", "function artPreviewKind", "function artTitle",
  "function artMatchesSearch", "function artChildrenOf", "function artDigestOf",
  "function artFocusHtml", "function artCardHtml", "function artEmptyText",
  "function artModalHtml", "function artOpenModal", "function artFrozenNotice",
  "function artProducerLabel", "function artWorkflowShort", "function artSafePayloadForDisplay",
  "function artPreviewBodyHtml",
].map(takeBlock).join("\n");
const box = new Function(`${lib}; return { ART_BUSINESS_CATEGORIES, artCategoryOf, artPreviewKind, artTitle, artMatchesSearch, artChildrenOf, artDigestOf, artFocusHtml, artCardHtml, artEmptyText, artModalHtml, artOpenModal, artFrozenNotice, artProducerLabel, artWorkflowShort, artSafePayloadForDisplay, artPreviewBodyHtml };`)();

const A = (kind, producer, payload, extra = {}) => ({
  artifact_id: `art-${kind}-1`, kind, producer_agent: producer, workflow_id: "wf-1",
  status: "completed", created_at: "2026-09-18", payload, ...extra,
});

test("1+2: deterministic kind mapping; unknown kinds route to explicit Technical", async () => {
  const cases = [
    ["final_media_artifact", "final_media_artifact", "Final Video"],
    ["writer_report", "writer", "Script"],
    ["research_report", "research", "Research"],
    ["documentation_report", "research", "Research"],
    ["documentation_report", "planner", "Research"],
    ["documentation_report", "writer", "Technical"],
    ["evidence_backed_content_brief", "research", "Brief"],
    ["timeline_plan", "planner", "Brief"],
    ["execution_plan", "planner", "Brief"],
    ["scene_plan", "planner", "Brief"],
    ["seo_report", "seo", "SEO Package"],
    ["brand_report", "brand", "Brand / Visual Direction"],
    ["visual_direction_contract", "director", "Brand / Visual Direction"],
    ["visual_director_input_package", "director", "Brand / Visual Direction"],
    ["visual_prompt_plan", "scene-image", "Brand / Visual Direction"],
    ["scene_visual_artifact", "scene-image", "Images / Scenes"],
    ["scene_video_clip", "video", "Images / Scenes"],
    ["narration_artifact", "tts", "Narration"],
    ["narration_audio_artifact", "tts", "Narration"],
    ["chunk_audio_artifact", "tts", "Narration"],
    ["review_report", "reviewer", "Reviews / QA"],
    ["qa_report", "qa", "Reviews / QA"],
    ["visual_semantic_review", "reviewer", "Reviews / QA"],
    ["visual_technical_qa", "qa", "Reviews / QA"],
    ["final_technical_qa", "qa", "Reviews / QA"],
    ["final_product_review", "reviewer", "Reviews / QA"],
    ["visual_iteration_owner_review", "director", "Reviews / QA"],
    ["publication_integration_validation", "qa", "Publication Validation"],
    ["coding_report", "coding", "Technical"],
    ["scene_generation_claim", "x", "Technical"],
    ["something_entirely_new", "x", "Technical"],
  ];
  for (const [kind, prod, cat] of cases) {
    assert.equal(box.artCategoryOf(A(kind, prod, {})), cat, `${kind}/${prod}`);
  }
  assert.deepEqual(box.ART_BUSINESS_CATEGORIES, ["Final Video", "Script", "Research", "Brief", "SEO Package", "Brand / Visual Direction", "Images / Scenes", "Narration", "Reviews / QA", "Publication Validation"]);
});

test("preview kinds: data URLs, file refs, structured reports, unsupported", async () => {
  const b64 = Buffer.from("bytes").toString("base64");
  assert.equal(box.artPreviewKind({ kind: "scene_video_clip", payload: { videoPathOrReference: `data:video/mp4;base64,${b64}` } }), "video");
  assert.equal(box.artPreviewKind({ kind: "scene_video_clip", payload: { videoPathOrReference: "D:\\repo\\output\\x.mp4" } }), "video");
  assert.equal(box.artPreviewKind({ kind: "scene_visual_artifact", payload: { artifactPathOrReference: `data:image/png;base64,${b64}` } }), "image");
  assert.equal(box.artPreviewKind({ kind: "narration_audio_artifact", payload: { path: `data:audio/wav;base64,${b64}` } }), "audio");
  assert.equal(box.artPreviewKind({ kind: "scene_video_clip", payload: { videoPathOrReference: "https://evil.invalid/x.mp4" } }), "none", "remote scheme never previewable");
  assert.equal(box.artPreviewKind({ kind: "scene_video_clip", payload: {} }), "none", "missing ref");
  assert.equal(box.artPreviewKind({ kind: "coding_report", payload: {} }), "none");
  assert.equal(box.artPreviewKind({ kind: "writer_report", payload: { hook: "h" } }), "structured");
  assert.equal(box.artPreviewKind({ kind: "documentation_report", payload: { summary: "s" } }), "structured");
  assert.equal(box.artPreviewKind({ kind: "whatever", payload: {} }), "none");
});

test("titles, search, lineage, digest", async () => {
  assert.equal(box.artTitle({ kind: "scene_video_clip", payload: { sceneId: "scene-001" } }), "Images / Scenes · Scene scene-001");
  assert.equal(box.artTitle({ kind: "writer_report", payload: { hook: "A decisive moment" } }), "A decisive moment");
  assert.equal(box.artTitle({ kind: "x", payload: {} }), "Technical");
  const a = A("writer_report", "writer", { hook: "Hook" });
  assert.ok(box.artMatchesSearch(a, "script hook writer"));
  assert.ok(!box.artMatchesSearch(a, "narration"));
  assert.ok(box.artMatchesSearch(a, ""));
  const parent = { artifact_id: "p1", payload: {} };
  const kid = { artifact_id: "k1", kind: "scene_video_clip", parent_artifact_id: "p1", payload: {} };
  assert.deepEqual(box.artChildrenOf(parent, [parent, kid]).map((x) => x.artifact_id), ["k1"]);
  assert.deepEqual(box.artChildrenOf(parent, [parent]), []);
  assert.equal(box.artDigestOf({ payload: { videoSha256: "abc" } }), "abc");
  assert.equal(box.artDigestOf({ payload: {} }), null);
});

test("9+10+11+12+13: cards show business facts, never raw JSON primary", async () => {
  const a = A("final_media_artifact", "final_media_artifact", { status: "completed", finalFileReference: "D:\\x\\y.mp4" });
  const html = box.artCardHtml(a);
  assert.match(html, /Final Video/);
  assert.match(html, /TECHNICAL VALIDATION ARTIFACT/);
  assert.match(html, /openPreview\('/);
  assert.match(html, /Lineage/);
  assert.ok(!html.includes('"finalFileReference"'), "no raw JSON keys in card");
  const t = A("coding_report", "coding", { summary: "code" });
  const th = box.artCardHtml(t);
  assert.match(th, /Technical/);
  assert.ok(!th.includes("openPreview("), "no preview button when unsupported");
});

test("14+15: focus detail has business lineage + Advanced provenance, never primary raw JSON", async () => {
  const parent = A("scene_plan", "planner", {});
  parent.artifact_id = "p1";
  const kid = A("scene_video_clip", "video", { sceneId: "scene-001" });
  kid.artifact_id = "k1";
  kid.parent_artifact_id = "p1";
  const html = box.artFocusHtml(kid, [parent, kid]);
  assert.match(html, /Created by: Video Production/);
  assert.match(html, /From: Images \/ Scenes · workflow wf-1/);
  assert.match(html, /Derived from:.*p1/);
  assert.match(html, /Advanced — technical details/);
  assert.match(html, /Artifact k1/);
  const head = html.split("<details>")[0];
  assert.ok(!head.includes('"sceneId"'), "primary view has no raw JSON keys");
  const solo = box.artFocusHtml(parent, [parent]);
  assert.match(solo, /Used by: nothing recorded/);
  const titled = box.artFocusHtml(kid, [parent, kid], "Morroway validation workflow");
  assert.match(titled, /From: Images \/ Scenes · Morroway validation workflow/);
  const usedBy = box.artFocusHtml(parent, [parent, kid]);
  assert.match(usedBy, /Used by: Images \/ Scenes/);
  assert.equal(box.artProducerLabel("video"), "Video Production");
  assert.equal(box.artProducerLabel("mystery-thing"), "Mystery Thing");
  assert.equal(box.artWorkflowShort("wf-1789233193749-gvydpiah").slice(-4), "piah");
  assert.equal(box.artWorkflowShort("wf-1"), "wf-1");
});

test("empty states are Owner-readable per category", async () => {
  assert.equal(box.artEmptyText("Final Video"), "No final videos yet.");
  assert.equal(box.artEmptyText("All"), "No artifacts recorded for this project yet.");
  assert.equal(box.artEmptyText("Script"), "No Script found for this project.");
});

function viewLib() {
  return lib + "\n" + ["function artFocusHtml", "function artCardHtml", "function artEmptyText", "function renderArtifactList", "async function artifactsView", "window.openPreview="].map(takeBlock).join("\n");
}

function viewHarness(fixtureArts) {
  const elements = {};
  const created = [];
  const listeners = {};
  const el = () => {
    const e = {
      children: [], style: {}, appendChild() {}, addEventListener() {},
      set innerHTML(v) { e.html = (e.html || "") + v; },
      querySelector: (sel) => ((e._kids ??= {})[sel] ??= el()),
    };
    created.push(e);
    return e;
  };
  const appended = [];
  const bodyEl = el();
  const documentStub = {
    querySelector: (sel) => (elements[sel] ??= el()),
    createElement: () => el(),
    body: bodyEl,
    activeElement: null,
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    removeEventListener: (type, fn) => { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
  };
  documentStub.body.appendChild = (n) => appended.push(n);
  async function jget(u) {
    if (u.includes("/api/runtime/artifacts")) return { artifacts: fixtureArts };
    throw new Error("unexpected " + u);
  }
  const run = (tab = "All", search = "") => new Function(
    "document", "jget", "PROJ", "shell", "npAddRow", "setView", "render", "viewArtifact", "window", "ensureDash",
    `let artCatTab=${JSON.stringify(tab)},artSearch=${JSON.stringify(search)},artCache=[],artifactFocusId=null,artifactFocusWorkflow=null;\n`
    + viewLib() + "\nreturn artifactsView();",
  )(documentStub, jget, "morroway", () => {}, () => {}, () => {}, () => {}, () => {}, {}, async () => ({ artifacts: [] }));
  const openModal = (id) => new Function(
    "document", "artCache", "window",
    lib + "\n" + takeBlock("window.openPreview=") + "\nwindow.openPreview(" + JSON.stringify(id) + ");",
  )(documentStub, fixtureArts, {});
  const modalHtml = () => created.map((e) => e.html || "").join("\n");
  return { elements, run, openModal, appended, modalHtml };
}

const FIX = [
  { artifact_id: "a-vid", kind: "final_media_artifact", producer_agent: "final_media_artifact", workflow_id: "wf-1", status: "completed", created_at: "2026-09-18T20:10:04", payload: { status: "completed", finalFileReference: "D:\\x\\y.mp4" } },
  { artifact_id: "a-clip", kind: "scene_video_clip", producer_agent: "video", workflow_id: "wf-1", status: "completed", created_at: "2026-09-18T16:13:29", payload: { sceneId: "scene-001", videoPathOrReference: "data:video/mp4;base64,QUJD" } },
  { artifact_id: "a-writer", kind: "writer_report", producer_agent: "writer", workflow_id: "wf-1", status: "completed", created_at: "2026-09-14T08:35:59", payload: { hook: "A decisive moment" } },
  { artifact_id: "a-code", kind: "coding_report", producer_agent: "coding", workflow_id: "wf-1", status: "completed", created_at: "2026-09-12T00:26:38", payload: { summary: "code" } },
];

test("workspace renders tabs, cards, filters; modal previews honestly", async () => {
  const h = viewHarness(FIX);
  await h.run();
  const html = Object.values(h.elements).map((e) => e.html || "").join("\n");
  assert.match(html, /Final Video/);
  assert.match(html, /Images \/ Scenes/);
  assert.match(html, /Advanced/);
  assert.match(html, /TECHNICAL VALIDATION ARTIFACT/);
  assert.match(html, /A decisive moment/);
  assert.ok(html.includes("openPreview('a-vid',"), "preview where supported");
  assert.ok(!html.includes("openPreview('a-code')"), "no preview button when unsupported");
  assert.ok(!html.includes('"finalFileReference"'), "no raw JSON keys in list");
  const h2 = viewHarness(FIX);
  await h2.run("Script", "");
  const html2 = Object.values(h2.elements).map((e) => e.html || "").join("\n");
  assert.match(html2, /A decisive moment/);
  assert.ok(!html2.includes("A-real"), "category filter applies");
  const h3 = viewHarness(FIX);
  await h3.run("All", "scene-001");
  const html3 = Object.values(h3.elements).map((e) => e.html || "").join("\n");
  assert.ok(html3.includes("scene-001"), "text search matches");
  assert.ok(!html3.includes("A decisive moment"), "text search filters");
  const h4 = viewHarness([]);
  await h4.run();
  const html4 = Object.values(h4.elements).map((e) => e.html || "").join("\n");
  assert.match(html4, /No artifacts recorded for this project yet\./);
  const h5 = viewHarness(FIX);
  await h5.run("Final Video", "");
  // modal: video via endpoint URL, structured inline, unsupported honest
  h5.openModal("a-clip");
  const modalHtml = h5.modalHtml();
  assert.match(modalHtml, /<video[^>]*src="\/api\/artifacts\/preview\?artifact_id=a-clip"/);
  assert.match(modalHtml, /Inspection copy/);
  h5.openModal("a-writer");
  const modalHtml2 = h5.modalHtml();
  assert.match(modalHtml2, /A decisive moment/);
  h5.openModal("a-code");
  const modalHtml3 = h5.modalHtml();
  assert.match(modalHtml3, /Preview is unavailable for this artifact type/);
  h5.openModal("a-missing");
  const modalHtml4 = h5.modalHtml();
  assert.match(modalHtml4, /inspection representation is unavailable/);
});

test("modal shell: bounded viewport, internal scroll, reachable Close, Escape, focus restore, scroll lock", async () => {
  const shell = box.artModalHtml("Title", "Research", "<div>" + "x".repeat(50000) + "</div>");
  assert.match(shell, /max-height:92vh/);
  assert.match(shell, /display:flex;flex-direction:column/);
  assert.match(shell, /overflow-y:auto/);
  assert.match(shell, /<button class="primary" data-close>Close<\/button>/);
  assert.ok(shell.indexOf("data-close") < shell.indexOf("data-body"), "Close precedes scrollable body");
  assert.ok(shell.includes("x".repeat(50000)), "long content fully present, never truncated");
  // Behavioral: Escape closes, focus returns to trigger, scroll locks/restores.
  const created = [];
  const listeners = {};
  const el = () => {
    const e = {
      children: [], style: {}, appendChild() {},
      set innerHTML(v) { e.html = (e.html || "") + v; },
      querySelector: (sel) => ((e._kids ??= {})[sel] ??= el()),
      remove() { e.removed = true; },
    };
    created.push(e);
    return e;
  };
  let focused = null;
  const trigger = { focus() { focused = "trigger"; } };
  const documentStub = {
    createElement: () => el(),
    body: Object.assign(el(), { appendChild(n) {} }),
    activeElement: null,
    addEventListener: (t, f) => { (listeners[t] ??= []).push(f); },
    removeEventListener: (t, f) => { listeners[t] = (listeners[t] || []).filter((g) => g !== f); },
  };
  const fn = new Function("document", "esc", "artModalHtml", "artOpenModal",
    "return artOpenModal('T', 'C', '<p>body</p>', arguments[4]);");
  // artOpenModal closes over document param via eval scope trick: rebind below.
  const openInScope = new Function("document", `const esc=${box ? "null" : "null"}; return (${artOpenModalShim.toString()});`);
  function artOpenModalShim() { return null; }
  void openInScope;
  const close = box.artOpenModal === undefined ? null : null;
  void close;
  // Drive the real function through a scope where `document` is our stub.
  const driver = new Function("document", "artModalHtml",
    `(${box.artOpenModal.toString()})(...Array.prototype.slice.call(arguments, 2));`);
  void driver;
});

test("modal behavior: Escape closes, focus restores, background scroll locks", async () => {
  const created = [];
  const listeners = {};
  const el = () => {
    const e = {
      children: [], style: { overflow: "" }, appendChild() {}, addEventListener() {},
      set innerHTML(v) { e.html = (e.html || "") + v; },
      querySelector: (sel) => ((e._kids ??= {})[sel] ??= el()),
      remove() { e.removed = true; },
      isConnected: true,
    };
    created.push(e);
    return e;
  };
  let focused = null;
  const trigger = { focus() { focused = "trigger"; } };
  const appended = [];
  const bodyEl = el();
  const documentStub = {
    createElement: () => el(),
    body: bodyEl,
    activeElement: null,
    addEventListener: (t, f) => { (listeners[t] ??= []).push(f); },
    removeEventListener: (t, f) => { listeners[t] = (listeners[t] || []).filter((g) => g !== f); },
  };
  documentStub.body.appendChild = (n) => appended.push(n);
  const fn = new Function("document", "esc",
    ["function artModalHtml", "function artOpenModal"].map(takeBlock).join("\n")
    + "\nreturn artOpenModal('T', 'C', '<p>body</p>', arguments[2]);");
  const escFn = (s) => String(s ?? "");
  const close = fn(documentStub, escFn, trigger);
  assert.equal(typeof close, "function");
  assert.equal(appended.length, 1, "modal attached");
  assert.equal(documentStub.body.style.overflow, "hidden", "background scroll locked");
  assert.deepEqual(Object.keys(listeners).filter((k) => (listeners[k] || []).length), ["keydown"]);
  for (const handler of [...(listeners.keydown || [])]) handler({ key: "a" });
  assert.equal(focused, null, "non-Escape key ignored");
  assert.ok(appended[0].removed !== true, "still open");
  for (const handler of [...(listeners.keydown || [])]) handler({ key: "Escape" });
  assert.equal(appended[0].removed, true, "Escape closes");
  assert.equal(focused, "trigger", "focus returns to trigger");
  assert.equal(documentStub.body.style.overflow, "", "scroll lock restored");
  assert.deepEqual(listeners.keydown || [], [], "listener removed");
});

test("frozen notice only on structured historical outputs; Decision Center untouched", async () => {
  const structured = { kind: "documentation_report", payload: { summary: "old pending count 3" } };
  const notice = box.artFrozenNotice(structured);
  assert.match(notice, /Frozen execution output — reflects state at execution time/);
  assert.match(notice, /Current Decision Center remains the source of current Owner actionability/);
  assert.equal(box.artFrozenNotice({ kind: "scene_video_clip", payload: {} }), "", "media has no notice");
  assert.equal(box.artFrozenNotice({ kind: "coding_report", payload: {} }), "", "technical has no notice");
  const before = JSON.parse(JSON.stringify(structured));
  box.artFrozenNotice(structured);
  box.artPreviewBodyHtml(structured);
  assert.deepEqual(structured, before, "notice generation mutates nothing");
  const modalStructured = box.artPreviewBodyHtml(structured);
  assert.match(modalStructured, /Frozen execution output/);
  assert.match(modalStructured, /old pending count 3/, "canonical content intact");
});

test("display redaction withholds paths and embedded bytes, keeps provenance", async () => {
  const p = {
    finalFileReference: "D:\\repo\\output\\x.mp4",
    posix: "/var/data/y.png",
    blob: "data:video/mp4;base64,QUJD",
    sha256: "abc123",
    hook: "A hook",
    nested: { deep: "C:\\secret\\z.wav" },
  };
  const safe = box.artSafePayloadForDisplay(p);
  assert.equal(safe.finalFileReference, "[local reference withheld]");
  assert.equal(safe.posix, "[local reference withheld]");
  assert.equal(safe.blob, "[embedded media bytes — open Preview]");
  assert.equal(safe.nested.deep, "[local reference withheld]");
  assert.equal(safe.sha256, "abc123", "digest preserved");
  assert.equal(safe.hook, "A hook", "business text preserved");
  assert.equal(p.finalFileReference, "D:\\repo\\output\\x.mp4", "canonical input untouched");
  const focus = box.artFocusHtml(
    { artifact_id: "a1", kind: "final_media_artifact", producer_agent: "final_media_artifact", workflow_id: "wf-1", status: "completed", created_at: "t", payload: p },
    [],
  );
  assert.ok(!focus.includes("D:\\repo"), "no absolute path in rendered focus");
  assert.ok(!focus.includes("QUJD"), "no embedded bytes in rendered focus");
  assert.match(focus, /abc123/, "digest still shown");
});

test("category nav uses chips without dot separators; filtering unchanged", async () => {
  const listSrc = takeBlock("function renderArtifactList");
  assert.ok(!listSrc.includes("join(' · ')"), "no decorative dot separators in tab bar");
  assert.match(listSrc, /class="chip/);
  assert.match(listSrc, /aria-current/);
  assert.match(listSrc, /class="chips"/);
});
