/**
 * AMF Postgres restore (Program 1 Workstream D).
 * Restores a backup file into an EXPLICIT target database only.
 * Refuses production database names; intended verification target is the
 * isolated TEST database. Never touches the live production database.
 * Usage: node scripts/amf-restore.mjs --file <dump> --target <db-url-or-name> [--clean]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const line of fs.readFileSync(path.join(REPO, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const sanitize = (s) => String(s || "").replace(/:\/\/[^/\s@]+@/g, "://[REDACTED]@").slice(0, 300);
const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const PROD_NAMES = new Set(["ai_media_factory", "postgres"]);

async function main() {
  const file = flag("--file");
  const target = flag("--target");
  if (!file || !target || !fs.existsSync(file)) {
    console.log(JSON.stringify({ status: "FAIL", code: "FILE_AND_TARGET_REQUIRED" }));
    process.exit(2);
  }
  const targetUrl = target.includes("://")
    ? target
    : (() => {
      const u = new URL(process.env.DATABASE_URL || "");
      u.pathname = `/${target}`;
      return u.toString();
    })();
  const targetName = new URL(targetUrl).pathname.replace(/^\//, "");
  if (PROD_NAMES.has(targetName)) {
    console.log(JSON.stringify({ status: "REFUSED_PRODUCTION_TARGET", target: targetName }));
    process.exit(2);
  }
  if (new URL(targetUrl).toString() === new URL(process.env.DATABASE_URL || "invalid:").toString()) {
    console.log(JSON.stringify({ status: "REFUSED_PRODUCTION_TARGET" }));
    process.exit(2);
  }
  const pgBin = path.join("C:", "Program Files", "PostgreSQL", "18", "bin");
  const env = { ...process.env, PGPASSWORD: new URL(targetUrl).password || "" };
  const { createRequire } = await import("node:module");
  const require = createRequire(path.join(REPO, "packages", "database", "test", "helpers.js"));
  const pg = require("pg");
  const adminUrl = (() => { const u = new URL(targetUrl); u.pathname = "/postgres"; return u.toString(); })();
  const admin = new pg.Pool({ connectionString: adminUrl });
  try {
    await admin.query(`CREATE DATABASE ${targetName}`);
  } catch (e) {
    if (!/already exists/i.test(String((e && e.message) || e))) throw e;
  } finally {
    await admin.end().catch(() => {});
  }
  const args = ["--dbname=" + targetUrl, "--no-password"];
  if (process.argv.includes("--clean")) args.push("--clean", "--if-exists");
  args.push(file);
  try {
    execFileSync(path.join(pgBin, "pg_restore.exe"), args, { env, stdio: "pipe", timeout: 600000 });
  } catch (e) {
    console.log(JSON.stringify({ status: "FAIL", code: "PG_RESTORE_FAILED", error: sanitize(e && e.message) }));
    process.exit(1);
  }
  console.log(JSON.stringify({ status: "OK", target: targetName, file, at: new Date().toISOString() }));
}

await main();
