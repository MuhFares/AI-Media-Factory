/**
 * AMF Postgres backup (Program 1 Workstream D).
 * pg_dump custom format of the PRODUCTION database to a timestamped file
 * outside destructive runtime paths (default: ../AMF-Backups, override
 * AMF_BACKUP_DIR). Read-only against the live DB; never drops or mutates.
 * Usage: node scripts/amf-backup.mjs [--dir <path>]
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
const DATABASE_URL = process.env.DATABASE_URL || "";
if (!DATABASE_URL) {
  console.log(JSON.stringify({ status: "FAIL", code: "NO_DATABASE_URL" }));
  process.exit(2);
}
const dirFlag = process.argv.indexOf("--dir");
const destDir = dirFlag >= 0 && process.argv[dirFlag + 1]
  ? path.resolve(process.cwd(), process.argv[dirFlag + 1])
  : path.resolve(process.env.AMF_BACKUP_DIR || path.join(REPO, "..", "AMF-Backups"));
fs.mkdirSync(destDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const file = path.join(destDir, `amf-production-${stamp}.dump`);
const pgBin = path.join("C:", "Program Files", "PostgreSQL", "18", "bin");
const env = { ...process.env, PGPASSWORD: new URL(DATABASE_URL).password || "" };
const sanitize = (s) => String(s || "").replace(/:\/\/[^/\s@]+@/g, "://[REDACTED]@").slice(0, 300);
try {
  execFileSync(path.join(pgBin, "pg_dump.exe"), ["--dbname=" + DATABASE_URL, "--format=custom", "--file=" + file, "--no-password"], { env, stdio: "pipe", timeout: 600000 });
} catch (e) {
  console.log(JSON.stringify({ status: "FAIL", code: "PG_DUMP_FAILED", error: sanitize(e && e.message) }));
  process.exit(1);
}
const stat = fs.statSync(file);
console.log(JSON.stringify({ status: "OK", file, bytes: stat.size, at: new Date().toISOString() }));
