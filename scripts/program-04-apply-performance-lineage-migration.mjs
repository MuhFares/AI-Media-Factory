import { createHash } from "node:crypto";
import pg from "pg";
import {
  PROGRAM_04_PERFORMANCE_LINEAGE_MIGRATION_ID,
  applyProgram04PerformanceLineageMigration,
  precheckProgram04PerformanceLineageMigration,
} from "../packages/database/dist/index.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
const parsed = new URL(databaseUrl);
const database = parsed.pathname.replace(/^\//, "");
const production = !/(^|[_-])test($|[_-])/i.test(database);
const targetFingerprint = createHash("sha256")
  .update(`${parsed.protocol}//${parsed.hostname}:${parsed.port || "default"}/${database}`)
  .digest("hex");
const apply = process.argv.includes("--apply");
const confirmation = process.argv.find((arg) => arg.startsWith("--confirm-production="))?.split("=")[1];
if (apply && production && confirmation !== PROGRAM_04_PERFORMANCE_LINEAGE_MIGRATION_ID) {
  throw new Error(`PRODUCTION_CONFIRMATION_REQUIRED:--confirm-production=${PROGRAM_04_PERFORMANCE_LINEAGE_MIGRATION_ID}`);
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
try {
  const before = await precheckProgram04PerformanceLineageMigration(pool);
  console.log(JSON.stringify({
    migrationId: PROGRAM_04_PERFORMANCE_LINEAGE_MIGRATION_ID,
    targetFingerprint,
    production,
    mode: apply ? "APPLY" : "PREFLIGHT_ONLY",
    precheck: before,
  }, null, 2));
  if (!before.tableExists) throw new Error("PROGRAM_04_MIGRATION_TARGET_TABLE_MISSING");
  if (apply) {
    const after = await applyProgram04PerformanceLineageMigration(pool);
    console.log(JSON.stringify({ migrationId: PROGRAM_04_PERFORMANCE_LINEAGE_MIGRATION_ID, outcome: "APPLIED_OR_ALREADY_CURRENT", postcheck: after }, null, 2));
  }
} finally {
  await pool.end();
}
