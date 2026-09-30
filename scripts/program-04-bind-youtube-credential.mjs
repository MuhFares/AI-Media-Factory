import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const PROJECT_ID = "morroway";
const CHANNEL_ID = "channel-morroway-youtube";
const EXTERNAL_CHANNEL_ID = "UCA5ECzcK_96akfUT5fQUT3A";
const PROVIDER = "youtube";
const CONFIRMATION = "program-04-morroway-youtube-credential-binding-v1";

function option(name) {
  return process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
const rawReference = option("--credential-ref");
if (!rawReference) throw new Error("CREDENTIAL_REFERENCE_REQUIRED");
const credentialPath = path.resolve(rawReference.replace(/^file:\/\//i, ""));
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const relativeToRepo = path.relative(repoRoot, credentialPath);
if (relativeToRepo === "" || (!relativeToRepo.startsWith("..") && !path.isAbsolute(relativeToRepo))) {
  throw new Error("CREDENTIAL_REFERENCE_MUST_BE_OUTSIDE_REPOSITORY");
}
if (credentialPath.length > 200) throw new Error("CREDENTIAL_REFERENCE_TOO_LONG");
if (!existsSync(credentialPath) || !statSync(credentialPath).isFile()) {
  throw new Error("CREDENTIAL_REFERENCE_NOT_FOUND");
}
const parsed = new URL(databaseUrl);
const database = parsed.pathname.replace(/^\//, "");
const production = !/(^|[_-])test($|[_-])/i.test(database);
const apply = process.argv.includes("--apply");
if (apply && production && option("--confirm-production") !== CONFIRMATION) {
  throw new Error(`PRODUCTION_CONFIRMATION_REQUIRED:--confirm-production=${CONFIRMATION}`);
}
const referenceFingerprint = createHash("sha256").update(credentialPath).digest("hex");
const bindingId = `binding-morroway-youtube-${referenceFingerprint.slice(0, 16)}`;
const targetFingerprint = createHash("sha256")
  .update(`${parsed.protocol}//${parsed.hostname}:${parsed.port || "default"}/${database}`)
  .digest("hex");
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
try {
  const channel = await pool.query(
    "SELECT channel_id,project_id,platform,external_channel_id,status FROM channels WHERE channel_id=$1",
    [CHANNEL_ID],
  );
  const row = channel.rows[0];
  if (!row || row.project_id !== PROJECT_ID || row.platform !== "youtube" || row.external_channel_id !== EXTERNAL_CHANNEL_ID) {
    throw new Error("CREDENTIAL_BINDING_CHANNEL_IDENTITY_MISMATCH");
  }
  if (row.status !== "VERIFIED") throw new Error("CREDENTIAL_BINDING_CHANNEL_NOT_VERIFIED");
  const existing = await pool.query(
    "SELECT binding_id,status FROM credential_bindings WHERE project_id=$1 AND channel_id=$2 AND provider=$3 AND credential_ref=$4",
    [PROJECT_ID, CHANNEL_ID, PROVIDER, credentialPath],
  );
  console.log(JSON.stringify({
    targetFingerprint,
    production,
    mode: apply ? "APPLY" : "PREFLIGHT_ONLY",
    channel: { projectId: PROJECT_ID, channelId: CHANNEL_ID, externalChannelId: EXTERNAL_CHANNEL_ID, status: row.status },
    bindingId,
    provider: PROVIDER,
    credentialReferenceFingerprint: referenceFingerprint,
    credentialResourceExists: true,
    secretRead: false,
    scopeClass: "YOUTUBE_PRIVATE_UPLOAD_AND_ANALYTICS_REQUIRED",
    tokenLivenessState: "UNKNOWN_REQUIRES_REFRESH",
    existing: existing.rows[0] ?? null,
  }, null, 2));
  if (apply && existing.rowCount === 0) {
    const now = new Date().toISOString();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [404_202_610]);
      const duplicate = await client.query(
        "SELECT binding_id,status FROM credential_bindings WHERE project_id=$1 AND channel_id=$2 AND provider=$3 AND credential_ref=$4",
        [PROJECT_ID, CHANNEL_ID, PROVIDER, credentialPath],
      );
      if (duplicate.rowCount === 0) {
        await client.query(
          `INSERT INTO credential_bindings
            (binding_id,project_id,channel_id,provider,credential_ref,status,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6,$6)`,
          [bindingId, PROJECT_ID, CHANNEL_ID, PROVIDER, credentialPath, now],
        );
      }
      await client.query("COMMIT");
      console.log(JSON.stringify({
        outcome: duplicate.rowCount === 0 ? "BOUND" : "ALREADY_BOUND",
        bindingId: duplicate.rows[0]?.binding_id ?? bindingId,
        tokenLivenessState: "UNKNOWN_REQUIRES_REFRESH",
      }));
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } else if (apply) {
    console.log(JSON.stringify({ outcome: "ALREADY_BOUND", bindingId: existing.rows[0].binding_id, tokenLivenessState: "UNKNOWN_REQUIRES_REFRESH" }));
  }
} finally {
  await pool.end();
}
