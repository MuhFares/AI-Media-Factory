/**
 * AMF isolated test-database provisioning (Program 1 Workstream E).
 *
 * Derives TEST_DATABASE_URL from DATABASE_URL by changing ONLY the database
 * path (credentials and options untouched), refuses to ever target the
 * production database, creates the test database if missing, and migrates it.
 *
 * Usage:
 *   node scripts/amf-testdb.mjs            # verify derivation + guards (no secrets printed)
 *   node scripts/amf-testdb.mjs --migrate  # create + migrate the isolated TEST DB
 *   node scripts/amf-testdb.mjs --reset    # DROP + recreate + migrate (test DB only)
 *   node scripts/amf-testdb.mjs --print-export  # also print shell export lines
 *
 * The connection string is printed ONLY with --print-export, for the
 * caller's own terminal session. Never commit, log, or paste it elsewhere.
 * Exits non-zero on any guard failure.
 */
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(path.join(process.cwd(), "packages", "database", "test", "helpers.js"));
const pg = require("pg");
const REPO = process.cwd();
const dbDist = pathToFileURL(path.join(REPO, "packages", "database", "dist", "pg.js")).href;

const PROD_NAMES = new Set(["ai_media_factory", "postgres"]);

function loadDatabaseUrl() {
  const direct = (process.env.DATABASE_URL || "").trim();
  if (direct) return direct;
  const fs = require("fs");
  for (const candidate of [path.join(REPO, ".env")]) {
    try {
      const text = fs.readFileSync(candidate, "utf8");
      const line = text.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
      if (line) return line.slice("DATABASE_URL=".length).trim();
    } catch { /* no .env — fall through */ }
  }
  return "";
}

function deriveTestUrl(prodUrl) {
  const u = new URL(prodUrl);
  u.pathname = "/ai_media_factory_test";
  return u.toString();
}

async function main() {
  const prodUrl = loadDatabaseUrl();
  if (!prodUrl) {
    console.log(JSON.stringify({ status: "FAIL", code: "NO_DATABASE_URL" }));
    process.exit(2);
  }
  const testUrl = deriveTestUrl(prodUrl);
  if (testUrl === prodUrl) {
    console.log(JSON.stringify({ status: "FAIL", code: "DERIVATION_FAILED" }));
    process.exit(2);
  }
  const testName = new URL(testUrl).pathname.replace(/^\//, "");
  if (PROD_NAMES.has(testName)) {
    console.log(JSON.stringify({ status: "FAIL", code: "NOT_A_TEST_DATABASE" }));
    process.exit(2);
  }
  const mode = process.argv[2] || "";
  const adminUrl = (() => { const u = new URL(prodUrl); u.pathname = "/postgres"; return u.toString(); })();
  const { createPool, migrate } = await import(dbDist);
  if (mode === "--reset") {
    const admin = new pg.Pool({ connectionString: adminUrl });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${testName}`);
    } finally {
      await admin.end().catch(() => {});
    }
  }
  if (mode === "--migrate" || mode === "--reset") {
    const admin = new pg.Pool({ connectionString: adminUrl });
    try {
      await admin.query(`CREATE DATABASE ${testName}`);
    } catch (e) {
      if (!/already exists/i.test(String((e && e.message) || e))) throw e;
    } finally {
      await admin.end().catch(() => {});
    }
    const pool = createPool({ connectionString: testUrl });
    try {
      await migrate(pool);
      await pool.query("SELECT 1");
    } finally {
      await pool.end().catch(() => {});
    }
    console.log(JSON.stringify({ status: "OK", database: testName, migrated: true }));
  }
  if (process.argv.includes("--print-export")) {
    console.log(`$env:TEST_DATABASE_URL = '${testUrl}'`);
    console.log(`export TEST_DATABASE_URL='${testUrl}'`);
  } else {
    console.log(JSON.stringify({ status: "OK", database: testName, hint: "re-run with --print-export to emit shell export lines" }));
  }
}

await main();
