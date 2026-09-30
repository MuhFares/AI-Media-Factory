/**
 * Slice 6 content-system governance reconciliation — v4 (deterministic).
 *
 * Replaces the permanent `ownerApprovalBeforePublication` boolean with
 * policy-based publication semantics compatible with the approved
 * Constraints v2 direction, and the hard-coded OWNER APPROVAL loop step
 * with PUBLICATION AUTHORIZATION resolved from governed policy.
 * Fail-closed posture preserved; no authority granted.
 *
 *   node scripts/reconcile-content-governance-v4.mjs           # dry-run
 *   node scripts/reconcile-content-governance-v4.mjs --apply   # propose PROPOSED v4
 *
 * Idempotent (SKIP when latest already carries v4 semantics). PROPOSED-only.
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
const CREATED_BY = "slice6-content-governance-v4";
const APPLY = process.argv.includes("--apply");
const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = path.join(REPO, ".env");
  if (!fs.existsSync(envFile)) throw new Error("v4 reconcile: DATABASE_URL unavailable");
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && line.slice(0, i).trim() === "DATABASE_URL") {
      let raw = line.slice(i + 1).trim();
      if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
      return raw;
    }
  }
  throw new Error("v4 reconcile: DATABASE_URL unavailable");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Pure v3 → v4 transform. Precondition (verified before apply): v3 carries
 * governance.{qaRequired:true, ownerApprovalBeforePublication:true} and an
 * operatingLoop containing "OWNER APPROVAL" followed by "PUBLISH".
 * Postcondition: boolean replaced by publicationPolicy; loop step replaced
 * by PUBLICATION AUTHORIZATION with never-infer rules; everything else
 * byte-identical. Fixed point: build(build(p)) deep-equals build(p).
 */
export function buildContentV4(v3) {
  const next = clone(v3);
  delete next.governance.ownerApprovalBeforePublication;
  next.governance.publicationPolicy = {
    rule: "Publication must follow the active governed publication policy.",
    currentMode: "OWNER_APPROVAL_REQUIRED",
    autonomousPublication: "Permitted only when explicitly enabled by Owner-approved autonomy and publication authority.",
  };
  const loop = Array.isArray(next.operatingLoop) ? [...next.operatingLoop] : [];
  const at = loop.indexOf("OWNER APPROVAL");
  if (at >= 0) loop[at] = "PUBLICATION AUTHORIZATION";
  next.operatingLoop = loop;
  next.publicationAuthorization = {
    resolvedFrom: "active governed publication policy",
    currentPolicy: "requires Owner approval",
    futureDelegated: "may be satisfied by explicit delegated publication authority under a future Owner-approved autonomy policy",
    neverInferredFrom: ["content readiness", "QA success", "strategy activation", "elapsed time", "agent recommendation", "production completion"],
  };
  next.governanceRevision = "v4 replaces the permanent ownerApprovalBeforePublication boolean and hard-coded OWNER APPROVAL loop step with policy-based publication semantics (currentMode OWNER_APPROVAL_REQUIRED), preserving fail-closed posture and future Owner-approved autonomy compatibility. No authority granted.";
  return next;
}

export function v3PreconditionMet(v3) {
  return v3 !== null && typeof v3 === "object" && !Array.isArray(v3)
    && v3.governance?.qaRequired === true
    && v3.governance?.ownerApprovalBeforePublication === true
    && Array.isArray(v3.operatingLoop)
    && v3.operatingLoop.includes("OWNER APPROVAL")
    && v3.operatingLoop.includes("PUBLISH");
}

async function main() {
  const pool = new pg.Pool({ connectionString: loadDatabaseUrl() });
  const strategic = new StrategicStore(pool);
  try {
    const history = await strategic.history(PROJECT, "CONTENT_SYSTEM", "primary", 10);
    const latest = history[0] ?? null;
    if (!latest) {
      console.log("NO_BASELINE | CONTENT_SYSTEM/primary has no versions; refusing to invent one");
      return;
    }
    if (latest.version >= 4 && latest.payload?.governance?.publicationPolicy) {
      const rebuilt = buildContentV4(latest.payload);
      if (canonicalJson(rebuilt) === canonicalJson(latest.payload)) {
        console.log(`SKIP identical | CONTENT_SYSTEM/primary v${latest.version} ${latest.status} | already carries v4 semantics`);
        return;
      }
    }
    if (!v3PreconditionMet(latest.payload)) {
      console.log(`REFUSE | CONTENT_SYSTEM/primary v${latest.version} payload is not exactly as reviewed; no version created`);
      process.exitCode = 1;
      return;
    }
    const nextPayload = buildContentV4(latest.payload);
    if (canonicalJson(nextPayload) === canonicalJson(latest.payload)) {
      console.log(`SKIP identical | CONTENT_SYSTEM/primary v${latest.version} ${latest.status}`);
      return;
    }
    console.log(`source | CONTENT_SYSTEM/primary v${latest.version} ${latest.status} (immutable)`);
    console.log(`change | governance.ownerApprovalBeforePublication:true → publicationPolicy{currentMode:OWNER_APPROVAL_REQUIRED,...}; operatingLoop OWNER APPROVAL → PUBLICATION AUTHORIZATION`);
    if (!APPLY) {
      console.log(`WOULD_PROPOSE | CONTENT_SYSTEM/primary v${latest.version + 1} PROPOSED | from v${latest.version}`);
      return;
    }
    const created = await strategic.propose({
      projectId: PROJECT, entityType: "CONTENT_SYSTEM", entityKey: "primary",
      payload: nextPayload, sourceArtifactIds: latest.sourceArtifactIds, createdBy: CREATED_BY,
    });
    console.log(`PROPOSED | ${created.entityId} v${created.version} ${created.status} | supersedes v${created.supersedesVersion ?? "-"} | authority: Owner activation required (not effective)`);
  } finally {
    await pool.end();
  }
}

if (isMain) {
  main().catch((error) => { console.error(`v4 reconcile FAILED: ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
}
