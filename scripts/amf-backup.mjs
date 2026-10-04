/**
 * Create an auditable AMF production backup set.
 * Read-only against DATABASE_URL; raw credentials are never copied.
 * Usage: node scripts/amf-backup.mjs [--dir <outside-repository-directory>]
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PG_BIN = process.env.AMF_POSTGRES_BIN || path.join("C:", "Program Files", "PostgreSQL", "18", "bin");
const CRITICAL_IDS = Object.freeze({
  finalMediaArtifactId: "art-final-media-canary-e46409193d5f74e14829258c",
  publishedReportArtifactId: "art-published-report-b71671ebda5049b64b3b7c82",
  analyticsObservationId: "obs-ea5b7d61d0a7",
  learningRecordId: "learn-01ecc33b989b",
  recommendationId: "rec-a1b07efbdc83",
  nextCycleProposalId: "ncp-294f1942f013",
  credentialBindingId: "binding-morroway-youtube-fe06cec2832354a9",
  job68WorkflowId: "wf-1790228899612-hyfzmb2k",
  researchPilotWorkflowId: "wf-1790293235186-1l4105j4",
});

function loadDotEnv() {
  const file = path.join(REPO, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}
function flag(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
function sha256File(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function safeDatabaseIdentity(url) {
  const parsed = new URL(url);
  const identity = { host: parsed.hostname, port: Number(parsed.port || 5432), database: decodeURIComponent(parsed.pathname.replace(/^\//, "")) };
  const canonical = `${parsed.protocol}//${identity.host}:${identity.port}/${identity.database}`;
  return { ...identity, fingerprint: crypto.createHash("sha256").update(canonical).digest("hex") };
}
function pgArgs(url, database) {
  const parsed = new URL(url);
  return { args: ["--host", parsed.hostname, "--port", parsed.port || "5432", "--username", decodeURIComponent(parsed.username), "--dbname", database], env: { ...process.env, PGPASSWORD: decodeURIComponent(parsed.password) } };
}
function assertOutsideRepository(destination) {
  const relative = path.relative(REPO, destination);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) throw new Error("BACKUP_DESTINATION_MUST_BE_OUTSIDE_REPOSITORY");
}
function knownSecretValues() {
  return Object.entries(process.env).filter(([k, v]) => /(?:SECRET|TOKEN|PASSWORD|API_KEY|AUTHORIZATION|DATABASE_URL)/i.test(k) && String(v || "").length >= 12).map(([key, value]) => ({ key, value: String(value) }));
}
function scanKnownSecrets(files) {
  const findings = [];
  for (const file of files) for (const secret of knownSecretValues()) if (fs.readFileSync(file).includes(Buffer.from(secret.value, "utf8"))) findings.push({ file: path.basename(file), category: secret.key });
  return findings;
}

async function main() {
  loadDotEnv();
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl) throw new Error("NO_DATABASE_URL");
  const identity = safeDatabaseIdentity(databaseUrl);
  const destination = path.resolve(flag("--dir") || process.env.AMF_BACKUP_DIR || path.join(REPO, "..", "AMF-Backups"));
  assertOutsideRepository(destination);
  fs.mkdirSync(destination, { recursive: true });
  const started = Date.now();
  const createdAt = new Date().toISOString();
  const backupId = `amf-backup-${createdAt.replace(/[:.]/g, "-")}`;
  const dumpFile = path.join(destination, `${backupId}.dump`);
  const filesDir = path.join(destination, `${backupId}.files`);
  const manifestFile = path.join(destination, `${backupId}.manifest.json`);
  fs.mkdirSync(filesDir, { recursive: false });

  const pool = new Pool({ connectionString: databaseUrl, application_name: "amf-backup-read-only" });
  let snapshot;
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const server = await client.query("SHOW server_version");
      const schema = await client.query("SELECT table_name,column_name,data_type,is_nullable,ordinal_position FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position");
      const counts = await client.query("SELECT (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') AS tables,(SELECT count(*)::int FROM pg_indexes WHERE schemaname='public') AS indexes,(SELECT count(*)::int FROM information_schema.table_constraints WHERE table_schema='public') AS constraints");
      const critical = await client.query(`SELECT
        (SELECT count(*)::int FROM control_projects WHERE project_id='morroway') AS morroway_project,
        (SELECT count(*)::int FROM artifacts WHERE artifact_id=$1 AND kind='final_media_artifact' AND status='completed') AS final_media,
        (SELECT count(*)::int FROM artifacts WHERE artifact_id=$2 AND kind='published_report' AND status='completed') AS published_report,
        (SELECT count(*)::int FROM performance_observations WHERE observation_id=$3) AS observation,
        (SELECT count(*)::int FROM learning_records WHERE learning_id=$4) AS learning,
        (SELECT count(*)::int FROM next_cycle_recommendations WHERE recommendation_id=$5) AS recommendation,
        (SELECT count(*)::int FROM next_cycle_proposals WHERE proposal_id=$6 AND status='OWNER_DEFERRED') AS proposal,
        (SELECT count(*)::int FROM credential_bindings WHERE binding_id=$7) AS credential_binding,
        (SELECT count(*)::int FROM owner_control_audit_events WHERE project_id='morroway') AS owner_audits`,
        [CRITICAL_IDS.finalMediaArtifactId, CRITICAL_IDS.publishedReportArtifactId, CRITICAL_IDS.analyticsObservationId, CRITICAL_IDS.learningRecordId, CRITICAL_IDS.recommendationId, CRITICAL_IDS.nextCycleProposalId, CRITICAL_IDS.credentialBindingId]);
      const finalMedia = await client.query("SELECT payload FROM artifacts WHERE artifact_id=$1", [CRITICAL_IDS.finalMediaArtifactId]);
      const automation = await client.query("SELECT enabled,level FROM automation_policies WHERE project_id='morroway'");
      snapshot = { postgresVersion: String(server.rows[0]?.server_version || "UNKNOWN"), schemaFingerprint: crypto.createHash("sha256").update(JSON.stringify(schema.rows)).digest("hex"), schemaObjectCounts: counts.rows[0], criticalRecordCounts: critical.rows[0], finalMediaPayload: finalMedia.rows[0]?.payload || null, automation: automation.rows[0] || { enabled: false, level: "L0_MANUAL" } };
      const exportedSnapshot = String((await client.query("SELECT pg_export_snapshot() AS snapshot_id")).rows[0].snapshot_id);
      const pgConnection = pgArgs(databaseUrl, identity.database);
      execFileSync(path.join(PG_BIN, "pg_dump.exe"), [...pgConnection.args, "--format=custom", "--snapshot", exportedSnapshot, "--file", dumpFile, "--no-password"], { env: pgConnection.env, stdio: "pipe", timeout: 900_000 });
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }

  const localFiles = [];
  const finalMediaPath = snapshot.finalMediaPayload?.finalFileReference || snapshot.finalMediaPayload?.storageReference;
  if (!finalMediaPath || !fs.existsSync(finalMediaPath)) throw new Error("CRITICAL_FINAL_MEDIA_FILE_MISSING");
  const actualHash = sha256File(finalMediaPath);
  if (!snapshot.finalMediaPayload?.sha256 || actualHash !== snapshot.finalMediaPayload.sha256) throw new Error("CRITICAL_FINAL_MEDIA_HASH_MISMATCH");
  const finalMediaCopy = path.join(filesDir, "program-04-final-media.mp4");
  fs.copyFileSync(finalMediaPath, finalMediaCopy, fs.constants.COPYFILE_EXCL);
  localFiles.push({ role: "PROGRAM_04_FINAL_MEDIA", relativePath: path.relative(destination, finalMediaCopy), bytes: fs.statSync(finalMediaCopy).size, sha256: actualHash });
  const captionPath = snapshot.finalMediaPayload?.captionEvidence?.sidecarPath;
  if (captionPath && fs.existsSync(captionPath)) {
    const captionCopy = path.join(filesDir, "program-04-captions-ar-EG.ass");
    fs.copyFileSync(captionPath, captionCopy, fs.constants.COPYFILE_EXCL);
    localFiles.push({ role: "PROGRAM_04_CAPTION_SIDECAR", relativePath: path.relative(destination, captionCopy), bytes: fs.statSync(captionCopy).size, sha256: sha256File(captionCopy) });
  }

  const gitHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
  const dumpBytes = fs.statSync(dumpFile).size;
  const dumpSha256 = sha256File(dumpFile);
  const manifest = {
    manifestVersion: 1, backupId, createdAt,
    sourceDatabase: { fingerprint: identity.fingerprint, host: identity.host, port: identity.port, database: identity.database, postgresVersion: snapshot.postgresVersion },
    gitHead, schemaFingerprint: snapshot.schemaFingerprint, schemaObjectCounts: snapshot.schemaObjectCounts,
    dump: { format: "postgres-custom", file: path.basename(dumpFile), bytes: dumpBytes, sha256: dumpSha256 },
    criticalRecordCounts: snapshot.criticalRecordCounts, criticalIds: CRITICAL_IDS, localFiles,
    programStates: { program01: "PROVIDER_FREE_PASS", program02: "PROVIDER_FREE_PASS", program03: "PROVIDER_FREE_PASS", program04: "LIVE_CANARY_PASS/CLOSED", program05: "LIVE_OWNER_PASS/CLOSED" },
    governance: { morrowayAutomation: snapshot.automation.enabled === true ? snapshot.automation.level : "OFF/L0_MANUAL/DISABLED", futureWanSubmissionsAllowed: false, wanDeploymentCertification: "DEFERRED_BY_OWNER", googleOauthMode: "EXTERNAL_TESTING" },
    secretPolicy: { rawSecretsIncluded: false, policy: "EXTERNAL_OWNER_MANAGED", ordinaryArchiveExcludes: [".env", "AMF-Secrets", "OAuth credential files", "API keys", "database password"] },
    durationMs: Date.now() - started,
  };
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  const findings = scanKnownSecrets([dumpFile, manifestFile, ...localFiles.map((entry) => path.join(destination, entry.relativePath))]);
  if (findings.length) throw new Error(`KNOWN_SECRET_VALUE_FOUND:${findings.map((item) => item.category).join(",")}`);
  console.log(JSON.stringify({ status: "OK", backupId, dumpFile, manifestFile, filesDir, bytes: dumpBytes, sha256: dumpSha256, durationMs: manifest.durationMs, sourceDbFingerprint: identity.fingerprint, secretScan: "PASS_KNOWN_SECRET_VALUES_NOT_PRESENT" }));
}

main().catch((error) => { console.log(JSON.stringify({ status: "FAIL", code: String(error?.message || error).replace(/:\/\/[^/@\s]+@/g, "://[REDACTED]@").slice(0, 300) })); process.exit(1); });
