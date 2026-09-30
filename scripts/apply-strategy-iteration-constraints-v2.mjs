/**
 * Slice 6 request-iteration continuation — Constraints v2 (deterministic).
 *
 * Applies the Owner's exact REQUEST_ITERATION wording
 * (approval-1789939530189-x5wdi0u3) as Constraints/primary v2 via the
 * general StrategicStore.iterate() operation. No LLM, no invention.
 *
 *   node scripts/apply-strategy-iteration-constraints-v2.mjs           # dry-run
 *   node scripts/apply-strategy-iteration-constraints-v2.mjs --apply   # create PROPOSED v2
 *
 * Idempotent (re-runs return the existing v2). Grants nothing: v2 is
 * PROPOSED and still needs a fresh scoped Owner decision + activation.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pg = require("pg");
const { StrategicStore, canonicalJson } = require("@ai-media-factory/database");

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");
const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const PRIOR_ENTITY_ID = "strat-morroway-constraints-primary-v1";
const SOURCE_DECISION_ID = "approval-1789939530189-x5wdi0u3";

const REVISED_RULES = [
  "Validation success is not production approval.",
  "Publication must follow the active governed publication policy. Automatic publication is prohibited unless explicitly enabled by Owner-approved autonomy and publication authority.",
  "No workstream may trap the brand in one pillar.",
];

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = path.join(REPO, ".env");
  if (!fs.existsSync(envFile)) throw new Error("iteration apply: DATABASE_URL unavailable");
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && line.slice(0, i).trim() === "DATABASE_URL") {
      let raw = line.slice(i + 1).trim();
      if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
      return raw;
    }
  }
  throw new Error("iteration apply: DATABASE_URL unavailable");
}

async function main() {
  const pool = new pg.Pool({ connectionString: loadDatabaseUrl() });
  const strategic = new StrategicStore(pool);
  try {
    const prior = await strategic.getEntity(PRIOR_ENTITY_ID);
    if (!prior) throw new Error("prior entity missing");
    const revisedPayload = { rules: REVISED_RULES };
    console.log(`prior | ${prior.entityType}/${prior.entityKey} v${prior.version} ${prior.status}`);
    console.log(`revised rules | ${JSON.stringify(REVISED_RULES)}`);
    console.log(`payload preserved otherwise | ${canonicalJson(Object.keys(revisedPayload).sort())} vs prior keys ${canonicalJson(Object.keys(prior.payload).sort())}`);
    if (!APPLY) {
      console.log("dry-run | no writes performed (pass --apply to create PROPOSED v2)");
      return;
    }
    const res = await strategic.iterate({
      priorEntityId: PRIOR_ENTITY_ID, sourceDecisionId: SOURCE_DECISION_ID,
      revisedPayload, createdBy: "slice6-iteration-constraints-v2",
    });
    console.log(`${res.created ? "PROPOSED" : "EXISTS"} | ${res.entity.entityId} v${res.entity.version} ${res.entity.status} | supersedes v${res.entity.supersedesVersion} | iteration ${res.iteration.iterationId} from ${res.iteration.sourceDecisionId}`);
  } finally {
    await pool.end();
  }
}

if (isMain) {
  main().catch((error) => { console.error(`iteration apply FAILED: ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
}
