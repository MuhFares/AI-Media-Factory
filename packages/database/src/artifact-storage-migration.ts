import type { Pool } from "pg";

export const ARTIFACT_STORAGE_MIGRATION_ID = "artifact-storage-records-v1";

function schemaName(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error("ARTIFACT_STORAGE_SCHEMA_INVALID");
  return `"${value}"`;
}

export async function applyArtifactStorageMigration(pool: Pool, schema = "public"): Promise<void> {
  const s = schemaName(schema);
  await pool.query("BEGIN");
  try {
    const artifacts = await pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name='artifacts'",
      [schema],
    );
    if (artifacts.rowCount !== 1) throw new Error("ARTIFACT_STORAGE_ARTIFACTS_TABLE_REQUIRED");
    await pool.query(`CREATE TABLE IF NOT EXISTS ${s}.artifact_storage_records (
      storage_record_id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL REFERENCES ${s}.artifacts(artifact_id),
      sha256 TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
      byte_count BIGINT NOT NULL CHECK (byte_count > 0),
      mime_type TEXT NOT NULL,
      storage_class TEXT NOT NULL CHECK (storage_class IN ('EPHEMERAL_WORK','CANONICAL_DURABLE','HISTORICAL_EVIDENCE','PUBLISHED_MEDIA','REGENERABLE_CACHE')),
      storage_provider TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      local_cache_path TEXT,
      source_execution_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      content_id TEXT,
      created_at TEXT NOT NULL,
      retention_class TEXT NOT NULL,
      durability_status TEXT NOT NULL CHECK (durability_status IN ('PENDING','VERIFIED','CORRUPT','MISSING')),
      verified_at TEXT,
      is_current BOOLEAN NOT NULL DEFAULT TRUE,
      receipt JSONB NOT NULL DEFAULT '{}'::jsonb
    )`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_artifact_storage_current ON ${s}.artifact_storage_records (artifact_id) WHERE is_current`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_artifact_storage_project ON ${s}.artifact_storage_records (project_id, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_artifact_storage_sha256 ON ${s}.artifact_storage_records (sha256)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_artifact_storage_location ON ${s}.artifact_storage_records (storage_provider, storage_key)`);
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}
