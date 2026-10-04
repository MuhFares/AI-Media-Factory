import type pg from "pg";

export const REVIEW_RESUME_IDEMPOTENCY_MIGRATION_ID =
  "review-resume-idempotency-identity-v1";

const TABLE = "review_resume_dispatches";
const COLUMN = "idempotency_identity";
const INDEX = "uq_review_resume_idempotency_identity";

export interface ReviewResumeIdempotencyPrecheck {
  readonly migrationId: typeof REVIEW_RESUME_IDEMPOTENCY_MIGRATION_ID;
  readonly database: string;
  readonly postgresVersion: string;
  readonly tablePresent: boolean;
  readonly columnPresent: boolean;
  readonly columnCompatible: boolean;
  readonly uniqueIndexPresent: boolean;
  readonly indexDefinition: string | null;
  readonly indexDefinitionValid: boolean;
  readonly duplicateNonNullIdentities: number;
  readonly rowCount: number;
}

function safeSchema(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error("REVIEW_RESUME_MIGRATION_SCHEMA_INVALID");
  return value;
}

function quoted(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function validIndexDefinition(value: string | null, schema: string): boolean {
  if (value === null) return false;
  const normalized = value.replaceAll('"', "").replace(/\s+/g, " ").toLowerCase();
  return normalized.includes(`create unique index ${INDEX}`)
    && normalized.includes(`on ${schema.toLowerCase()}.${TABLE} using btree (${COLUMN})`)
    && normalized.includes(`where (${COLUMN} is not null)`);
}

export async function precheckReviewResumeIdempotencyMigration(
  pool: pg.Pool | pg.PoolClient,
  schema = "public",
): Promise<ReviewResumeIdempotencyPrecheck> {
  const targetSchema = safeSchema(schema);
  const identity = await pool.query("SELECT current_database() AS database, version() AS version");
  const table = await pool.query(
    "SELECT to_regclass($1) IS NOT NULL AS present",
    [`${targetSchema}.${TABLE}`],
  );
  const tablePresent = table.rows[0]?.present === true;
  const column = tablePresent
    ? await pool.query(
      `SELECT data_type,is_nullable FROM information_schema.columns
       WHERE table_schema=$1 AND table_name=$2 AND column_name=$3`,
      [targetSchema, TABLE, COLUMN],
    )
    : { rows: [], rowCount: 0 };
  const columnPresent = Number(column.rowCount ?? column.rows.length) === 1;
  const columnCompatible = !columnPresent
    || (String(column.rows[0].data_type) === "text" && String(column.rows[0].is_nullable) === "YES");
  const index = tablePresent
    ? await pool.query(
      `SELECT pg_get_indexdef(i.indexrelid) AS definition
       FROM pg_index i
       JOIN pg_class idx ON idx.oid=i.indexrelid
       JOIN pg_class tbl ON tbl.oid=i.indrelid
       JOIN pg_namespace ns ON ns.oid=tbl.relnamespace
       WHERE ns.nspname=$1 AND tbl.relname=$2 AND idx.relname=$3`,
      [targetSchema, TABLE, INDEX],
    )
    : { rows: [], rowCount: 0 };
  const indexDefinition = Number(index.rowCount ?? index.rows.length) === 1
    ? String(index.rows[0].definition)
    : null;
  const counts = tablePresent
    ? await pool.query(`SELECT count(*)::int AS row_count FROM ${quoted(targetSchema)}.${quoted(TABLE)}`)
    : { rows: [{ row_count: 0 }] };
  const duplicates = tablePresent && columnPresent
    ? await pool.query(
      `SELECT count(*)::int AS duplicate_groups FROM (
         SELECT ${quoted(COLUMN)} FROM ${quoted(targetSchema)}.${quoted(TABLE)}
         WHERE ${quoted(COLUMN)} IS NOT NULL GROUP BY ${quoted(COLUMN)} HAVING count(*) > 1
       ) duplicate_identities`,
    )
    : { rows: [{ duplicate_groups: 0 }] };
  return {
    migrationId: REVIEW_RESUME_IDEMPOTENCY_MIGRATION_ID,
    database: String(identity.rows[0]?.database ?? "unknown"),
    postgresVersion: String(identity.rows[0]?.version ?? "unknown"),
    tablePresent,
    columnPresent,
    columnCompatible,
    uniqueIndexPresent: indexDefinition !== null,
    indexDefinition,
    indexDefinitionValid: validIndexDefinition(indexDefinition, targetSchema),
    duplicateNonNullIdentities: Number(duplicates.rows[0]?.duplicate_groups ?? 0),
    rowCount: Number(counts.rows[0]?.row_count ?? 0),
  };
}

export async function applyReviewResumeIdempotencyMigration(
  pool: pg.Pool,
  schema = "public",
): Promise<ReviewResumeIdempotencyPrecheck> {
  const targetSchema = safeSchema(schema);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [603_202_610]);
    const before = await precheckReviewResumeIdempotencyMigration(client, targetSchema);
    if (!before.tablePresent) throw new Error("REVIEW_RESUME_MIGRATION_TARGET_TABLE_MISSING");
    if (!before.columnCompatible) throw new Error("REVIEW_RESUME_MIGRATION_COLUMN_CONFLICT");
    if (before.duplicateNonNullIdentities !== 0) throw new Error("REVIEW_RESUME_MIGRATION_DUPLICATE_IDENTITIES_PRESENT");
    if (before.uniqueIndexPresent && !before.indexDefinitionValid) throw new Error("REVIEW_RESUME_MIGRATION_INDEX_CONFLICT");
    const table = `${quoted(targetSchema)}.${quoted(TABLE)}`;
    await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${quoted(COLUMN)} TEXT`);
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS ${quoted(INDEX)} ON ${table} (${quoted(COLUMN)}) WHERE ${quoted(COLUMN)} IS NOT NULL`,
    );
    const after = await precheckReviewResumeIdempotencyMigration(client, targetSchema);
    if (!after.columnPresent || !after.columnCompatible || !after.uniqueIndexPresent
      || !after.indexDefinitionValid || after.duplicateNonNullIdentities !== 0
      || after.rowCount !== before.rowCount) {
      throw new Error("REVIEW_RESUME_MIGRATION_POSTCHECK_FAILED");
    }
    await client.query("COMMIT");
    return after;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function probeReviewResumeIdempotencyConstraint(
  pool: pg.Pool,
  schema = "public",
): Promise<"DUPLICATE_REJECTED_ROLLED_BACK"> {
  const targetSchema = safeSchema(schema);
  const client = await pool.connect();
  const marker = `migration-probe-${Date.now()}-${process.pid}`;
  const table = `${quoted(targetSchema)}.${quoted(TABLE)}`;
  try {
    await client.query("BEGIN");
    const values = ["task", "workflow", 1, 1, "failed-review", "writer", "seo", "brand", "migration probe", "OWNER_APPROVED", marker, new Date().toISOString()];
    await client.query(
      `INSERT INTO ${table}
       (resume_id,task_id,workflow_id,revision_version,resume_attempt,failed_review_execution_id,
        frozen_writer_artifact_id,frozen_seo_artifact_id,frozen_brand_artifact_id,reason,
        authorization_status,idempotency_identity,created_at)
       VALUES ($1 || '-a',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [marker, ...values],
    );
    await client.query("SAVEPOINT duplicate_probe");
    try {
      await client.query(
        `INSERT INTO ${table}
         (resume_id,task_id,workflow_id,revision_version,resume_attempt,failed_review_execution_id,
          frozen_writer_artifact_id,frozen_seo_artifact_id,frozen_brand_artifact_id,reason,
          authorization_status,idempotency_identity,created_at)
         VALUES ($1 || '-b',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [marker, ...values],
      );
      throw new Error("REVIEW_RESUME_DUPLICATE_PROBE_WAS_NOT_REJECTED");
    } catch (error) {
      if ((error as { code?: string }).code !== "23505") throw error;
      await client.query("ROLLBACK TO SAVEPOINT duplicate_probe");
    }
    await client.query("ROLLBACK");
    return "DUPLICATE_REJECTED_ROLLED_BACK";
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
