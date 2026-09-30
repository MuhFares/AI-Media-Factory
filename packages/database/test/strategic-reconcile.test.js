/**
 * Slice 6 reconciliation unit tests (no DB, no providers).
 * Spec validity (claims+provenance, no authority grants, sources exist),
 * idempotency planner, and §22 source coverage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SPECS, planSpec } from "../../../scripts/reconcile-strategy-morroway-v1.mjs";
import { canonicalJson } from "../dist/index.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("specs carry claims, provenance, and no authority grants", async () => {
  assert.ok(SPECS.length >= 4, "strategy+brand+content-system+experiment specs");
  const types = SPECS.map((s) => `${s.entityType}/${s.entityKey}`).sort();
  assert.ok(types.includes("STRATEGY/primary"));
  assert.ok(types.includes("BRAND/primary"));
  assert.ok(types.includes("CONTENT_SYSTEM/primary"));
  assert.ok(types.includes("EXPERIMENT/pilot-gates"));
  for (const spec of SPECS) {
    assert.ok(spec.claims.length > 0, `${spec.entityType} has claims`);
    assert.ok(spec.sourceArtifactIds.length > 0, `${spec.entityType} has source refs`);
    for (const [claim, source] of spec.claims) {
      assert.ok(claim && source, `${spec.entityType} claim+source non-empty`);
    }
    const dumped = JSON.stringify(spec.payload);
    assert.doesNotMatch(dumped, /"GRANTED"/, `${spec.entityType} grants nothing`);
    assert.doesNotMatch(dumped, /publication authorized|production approval granted/i);
  }
});

test("spec sources exist as repo files", async () => {
  const missing = [];
  for (const spec of SPECS) {
    for (const ref of spec.sourceArtifactIds) {
      if (!fs.existsSync(path.join(REPO, ref))) missing.push(ref);
    }
  }
  assert.deepEqual(missing, [], "every file source must exist");
});

test("planSpec is idempotent: identical skips, new proposes next version", async () => {
  const spec = SPECS[0];
  assert.deepEqual(planSpec(null, spec), { action: "PROPOSE", version: 1 });
  assert.deepEqual(planSpec({ version: 2, payload: { other: true } }, spec), { action: "PROPOSE", version: 3 });
  assert.deepEqual(planSpec({ version: 2, payload: JSON.parse(canonicalJson(spec.payload)) }, spec), { action: "SKIP" });
});

test("§22 claims resolve from spec payloads (read-only validation set)", async () => {
  const byType = Object.fromEntries(SPECS.map((s) => [`${s.entityType}/${s.entityKey}`, s.payload]));
  assert.equal(byType["BRAND/primary"].brand, "Morroway");
  assert.equal(byType["BRAND/primary"].naming.status, "CLOSED");
  assert.equal(byType["BRAND/primary"].naming.winner, "Morroway");
  assert.ok(byType["BRAND/primary"].selectionSupersession.includes("SUPERSEDED"));
  assert.equal(byType["STRATEGY/primary"].councilStatus, "CLOSED");
  assert.equal(byType["STRATEGY/primary"].ownerDecision, "APPROVED_WITH_CHANGES");
  assert.ok(byType["STRATEGY/primary"].contentPillars.length >= 2);
  assert.equal(byType["STRATEGY/primary"].pilot.model, "adaptive");
  assert.ok(byType["STRATEGY/primary"].pilot.learningBatchNote.includes("NOT permanent"));
  assert.ok(byType["STRATEGY/primary"].pilot.gatesNote.includes("NOT permanent"));
  const batch = byType["CONTENT_SYSTEM/primary"].learningBatch.items;
  assert.deepEqual(batch.map((i) => i.id), ["MW-HIS-001", "MW-HIS-002", "MW-FAN-001", "MW-FAN-002"]);
  assert.equal(byType["CONTENT_SYSTEM/primary"].decisionModel.join("+"), "PERFORMANCE_LED+AGENT_RECOMMENDED+OWNER_GOVERNED");
  assert.equal(byType["EXPERIMENT/pilot-gates"].status, "EXPERIMENTAL");
});
