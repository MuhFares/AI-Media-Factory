/**
 * Slice 6 content-governance v4 — pure transform tests (no DB, no providers).
 * v3 must be exactly as reviewed; v4 replaces permanent booleans with
 * policy semantics while preserving everything else byte-identically.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildContentV4, v3PreconditionMet } from "../../../scripts/reconcile-content-governance-v4.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const V3 = {
  status: "READY_FOR_INITIAL_LEARNING_BATCH",
  decisionModel: ["PERFORMANCE_LED", "AGENT_RECOMMENDED", "OWNER_GOVERNED"],
  pilot: { model: "adaptive", size: "ADAPTIVE", duration: "ADAPTIVE", state: "planning" },
  learningBatch: {
    note: "initial learning batch only, NOT permanent pilot size",
    items: [
      { id: "MW-HIS-001", pillar: "Historical", focus: "Sensory-first, source-supported POV", duration: "35-50s" },
      { id: "MW-HIS-002", pillar: "Historical", focus: "Curiosity hook with delayed factual reveal", duration: "40-55s" },
      { id: "MW-FAN-001", pillar: "Fantasy", focus: "Immediate impossible visual reveal", duration: "25-40s" },
      { id: "MW-FAN-002", pillar: "Fantasy", focus: "Character-led emotional premise", duration: "35-50s" },
    ],
  },
  sourcing: { historicalPov: "must use real-world/source-supported history; research sign-off before scripting", fantasy: "original AI-generated storytelling" },
  governance: { qaRequired: true, ownerApprovalBeforePublication: true },
  gates: { note: "Experimental performance gates are hypotheses, NOT permanent KPIs", promotion: "evidence-based and owner-governed", scaleDecisions: ["Scale", "Continue", "Iterate", "Retest", "Pause", "Retire"] },
  operatingLoop: ["IDEA", "RESEARCH", "CONTENT BRIEF", "SCRIPT", "VISUAL PLAN", "PRODUCTION", "QA", "OWNER APPROVAL", "PUBLISH", "MEASURE", "PERFORMANCE ANALYSIS", "AGENT REVIEW", "OWNER REVIEW / OPTIONAL OVERRIDE", "NEXT ACTION"],
  productionNote: "No content produced or published in this phase; no social account created. Production/publication authority is operational truth, never granted by this entity.",
  durationSemantics: { rule: "item ranges neither redefine nor override archetypes", archetypes: "30s Reel / 15s AI visual", itemDurations: "per-item bounds" },
  pillars: ["HIST", "FAN"],
};

test("precondition gates creation on the exact reviewed shape", async () => {
  assert.equal(v3PreconditionMet(V3), true);
  assert.equal(v3PreconditionMet({ ...V3, governance: { qaRequired: true } }), false, "already-migrated payload refused");
  assert.equal(v3PreconditionMet({ ...V3, operatingLoop: ["IDEA"] }), false, "unexpected loop refused");
  assert.equal(v3PreconditionMet(null), false);
});

test("1+preserve: v3 untouched; everything unrelated byte-identical in v4", async () => {
  const frozen = JSON.parse(JSON.stringify(V3));
  const v4 = buildContentV4(V3);
  assert.deepEqual(V3, frozen, "v3 immutable in memory");
  for (const k of ["status", "decisionModel", "pilot", "learningBatch", "sourcing", "gates", "productionNote", "durationSemantics", "pillars"]) {
    assert.deepEqual(v4[k], frozen[k], `${k} preserved exactly`);
  }
  assert.deepEqual(buildContentV4(v4).governance, v4.governance, "fixed point on re-application");
});

test("4+5+6+7: QA stays required; policy mode exact; auto-publish prohibited now, delegation representable", async () => {
  const v4 = buildContentV4(V3);
  assert.equal(v4.governance.qaRequired, true, "QA remains mandatory");
  assert.ok(!("ownerApprovalBeforePublication" in v4.governance), "permanent boolean replaced");
  assert.equal(v4.governance.publicationPolicy.rule, "Publication must follow the active governed publication policy.");
  assert.equal(v4.governance.publicationPolicy.currentMode, "OWNER_APPROVAL_REQUIRED");
  assert.match(v4.governance.publicationPolicy.autonomousPublication, /only when explicitly enabled by Owner-approved autonomy/);
});

test("8+9+10+11: loop uses PUBLICATION AUTHORIZATION with never-infer rules", async () => {
  const v4 = buildContentV4(V3);
  assert.ok(!v4.operatingLoop.includes("OWNER APPROVAL"), "hard-coded step gone");
  assert.equal(v4.operatingLoop[v4.operatingLoop.indexOf("PUBLISH") - 1], "PUBLICATION AUTHORIZATION", "authorization precedes publish in order");
  assert.equal(v4.publicationAuthorization.resolvedFrom, "active governed publication policy");
  assert.match(v4.publicationAuthorization.currentPolicy, /requires Owner approval/);
  assert.match(v4.publicationAuthorization.futureDelegated, /explicit delegated publication authority/);
  assert.deepEqual(v4.publicationAuthorization.neverInferredFrom, ["content readiness", "QA success", "strategy activation", "elapsed time", "agent recommendation", "production completion"]);
});

test("grants nothing; script performs no approvals/activations/workflows/providers", async () => {
  const v4 = buildContentV4(V3);
  assert.doesNotMatch(JSON.stringify(v4), /"GRANTED"/);
  const source = fs.readFileSync(path.join(REPO, "scripts/reconcile-content-governance-v4.mjs"), "utf8");
  assert.doesNotMatch(source, /decideApproval|\.activate\(|createApproval/);
  assert.doesNotMatch(source, /\bfetch\s*\(|openrouter|agentrouter|[^a-z]llm[^a-z]/i);
  assert.ok(source.includes("status, payload") || source.includes("PROPOSED"), "propose path only");
});
