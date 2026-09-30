/**
 * Slice 6 experiment pilot-gates reconciliation — v2 (deterministic).
 *
 * Renames observedTriggers semantics to experimentalEvaluationSignals:
 * hypotheses for governed evaluation — never observed results, KPIs,
 * triggers, thresholds, or automatic scale/stop rules.
 *
 *   node scripts/reconcile-experiment-gates-v2.mjs           # dry-run
 *   node scripts/reconcile-experiment-gates-v2.mjs --apply   # propose PROPOSED v2
 *
 * Idempotent (SKIP when latest already carries v2 semantics). PROPOSED-only.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pg = require("pg");
const { StrategicStore, canonicalJson } = require("@ai-media-factory/database");

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = "morroway";
const CREATED_BY = "slice6-experiment-gates-v2";
const APPLY = process.argv.includes("--apply");
const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = path.join(REPO, ".env");
  if (!fs.existsSync(envFile)) throw new Error("gates v2 reconcile: DATABASE_URL unavailable");
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && line.slice(0, i).trim() === "DATABASE_URL") {
      let raw = line.slice(i + 1).trim();
      if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
      return raw;
    }
  }
  throw new Error("gates v2 reconcile: DATABASE_URL unavailable");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Pure v1 → v2 transform. Precondition: status EXPERIMENTAL with an
 * observedTriggers string array. Preserves hypothesis/rule/decisions and
 * the four signal strings verbatim; adds explicit non-automatic semantics.
 * Fixed point: build(build(p)) deep-equals build(p).
 */
export function buildExperimentV2(v1) {
  const next = clone(v1);
  const signals = Array.isArray(next.observedTriggers)
    ? next.observedTriggers.map(String)
    : (Array.isArray(next.experimentalEvaluationSignals) ? next.experimentalEvaluationSignals.map(String) : []);
  delete next.observedTriggers;
  next.experimentalEvaluationSignals = signals;
  next.signalSemantics = "experimental hypotheses / evaluation signals; NOT observed pilot results; NOT permanent KPIs; NOT automatic triggers; NOT automatic thresholds; NOT automatic scale/stop rules";
  next.sourceWordingNote = "historical source wording (e.g. 'threshold') is retained verbatim for provenance and carries no automatic authority semantics";
  next.decisionUse = "Performance against these signals informs governed evaluation only.";
  next.decisionModel = ["PERFORMANCE_LED", "AGENT_RECOMMENDED", "OWNER_GOVERNED"];
  next.automaticDecisionRule = "No signal crossing automatically selects Scale, Continue, Iterate, Retest, Pause, or Retire.";
  next.governanceRevision = "v2 renames observedTriggers semantics to experimentalEvaluationSignals; hypotheses stay non-KPI and non-authorizing. No authority granted.";
  return next;
}

export function v1PreconditionMet(v1) {
  return v1 !== null && typeof v1 === "object" && !Array.isArray(v1)
    && v1.status === "EXPERIMENTAL"
    && Array.isArray(v1.observedTriggers)
    && v1.observedTriggers.length > 0
    && v1.observedTriggers.every((s) => typeof s === "string");
}

async function main() {
  const pool = new pg.Pool({ connectionString: loadDatabaseUrl() });
  const strategic = new StrategicStore(pool);
  try {
    const history = await strategic.history(PROJECT, "EXPERIMENT", "pilot-gates", 10);
    const latest = history[0] ?? null;
    if (!latest) {
      console.log("NO_BASELINE | EXPERIMENT/pilot-gates has no versions; refusing to invent one");
      return;
    }
    const nextPayload = buildExperimentV2(latest.payload);
    if (canonicalJson(nextPayload) === canonicalJson(latest.payload)) {
      console.log(`SKIP identical | EXPERIMENT/pilot-gates v${latest.version} ${latest.status} | already carries v2 semantics`);
      return;
    }
    if (!v1PreconditionMet(latest.payload)) {
      console.log(`REFUSE | EXPERIMENT/pilot-gates v${latest.version} payload is not exactly as reviewed; no version created`);
      process.exitCode = 1;
      return;
    }
    console.log(`source | EXPERIMENT/pilot-gates v${latest.version} ${latest.status} (immutable)`);
    console.log(`change | observedTriggers → experimentalEvaluationSignals + decisionUse/decisionModel/automaticDecisionRule; values verbatim`);
    if (!APPLY) {
      console.log(`WOULD_PROPOSE | EXPERIMENT/pilot-gates v${latest.version + 1} PROPOSED | from v${latest.version}`);
      return;
    }
    const created = await strategic.propose({
      projectId: PROJECT, entityType: "EXPERIMENT", entityKey: "pilot-gates",
      payload: nextPayload, sourceArtifactIds: latest.sourceArtifactIds, createdBy: CREATED_BY,
    });
    console.log(`PROPOSED | ${created.entityId} v${created.version} ${created.status} | supersedes v${created.supersedesVersion ?? "-"} | authority: Owner activation required (not effective)`);
  } finally {
    await pool.end();
  }
}

if (isMain) {
  main().catch((error) => { console.error(`gates v2 reconcile FAILED: ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
}
