import type pg from "pg";

export const PROGRAM_04_PERFORMANCE_LINEAGE_MIGRATION_ID =
  "program-04-performance-observation-lineage-v1";

export const PROGRAM_04_PERFORMANCE_LINEAGE_COLUMNS = Object.freeze({
  content_id: "text",
  published_report_id: "text",
  final_media_sha256: "text",
  analytics_provider_id: "text",
} as const);

export interface Program04LineageMigrationPrecheck {
  readonly migrationId: typeof PROGRAM_04_PERFORMANCE_LINEAGE_MIGRATION_ID;
  readonly database: string;
  readonly schema: string;
  readonly tableExists: boolean;
  readonly existingColumns: Readonly<Record<string, { dataType: string; nullable: boolean }>>;
  readonly missingColumns: readonly string[];
  readonly compatible: boolean;
}

function safeSchema(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error("PROGRAM_04_MIGRATION_SCHEMA_INVALID");
  return value;
}

function quoted(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export async function precheckProgram04PerformanceLineageMigration(
  pool: pg.Pool | pg.PoolClient,
  schema = "public",
): Promise<Program04LineageMigrationPrecheck> {
  const targetSchema = safeSchema(schema);
  const db = await pool.query("SELECT current_database() AS database");
  const table = await pool.query(
    "SELECT to_regclass($1) IS NOT NULL AS present",
    [`${targetSchema}.performance_observations`],
  );
  const tableExists = table.rows[0]?.present === true;
  const columns = tableExists
    ? await pool.query(
      `SELECT column_name,data_type,is_nullable FROM information_schema.columns
         WHERE table_schema=$1 AND table_name='performance_observations'
           AND column_name=ANY($2::text[]) ORDER BY column_name`,
      [targetSchema, Object.keys(PROGRAM_04_PERFORMANCE_LINEAGE_COLUMNS)],
    )
    : { rows: [] };
  const existingColumns: Record<string, { dataType: string; nullable: boolean }> = {};
  for (const row of columns.rows) {
    existingColumns[String(row.column_name)] = {
      dataType: String(row.data_type),
      nullable: String(row.is_nullable) === "YES",
    };
  }
  const incompatible = Object.entries(existingColumns).filter(([, value]) =>
    value.dataType !== "text" || value.nullable !== true);
  if (incompatible.length > 0) {
    throw new Error(`PROGRAM_04_MIGRATION_COLUMN_CONFLICT:${incompatible.map(([name]) => name).join(",")}`);
  }
  return {
    migrationId: PROGRAM_04_PERFORMANCE_LINEAGE_MIGRATION_ID,
    database: String(db.rows[0]?.database ?? "unknown"),
    schema: targetSchema,
    tableExists,
    existingColumns,
    missingColumns: Object.keys(PROGRAM_04_PERFORMANCE_LINEAGE_COLUMNS)
      .filter((name) => existingColumns[name] === undefined),
    compatible: tableExists,
  };
}

export async function applyProgram04PerformanceLineageMigration(
  pool: pg.Pool,
  schema = "public",
): Promise<Program04LineageMigrationPrecheck> {
  const targetSchema = safeSchema(schema);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [404_202_609]);
    const before = await precheckProgram04PerformanceLineageMigration(client, targetSchema);
    if (!before.tableExists) throw new Error("PROGRAM_04_MIGRATION_TARGET_TABLE_MISSING");
    const table = `${quoted(targetSchema)}.${quoted("performance_observations")}`;
    for (const name of Object.keys(PROGRAM_04_PERFORMANCE_LINEAGE_COLUMNS)) {
      await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${quoted(name)} TEXT`);
    }
    const after = await precheckProgram04PerformanceLineageMigration(client, targetSchema);
    if (after.missingColumns.length > 0) {
      throw new Error(`PROGRAM_04_MIGRATION_POSTCHECK_FAILED:${after.missingColumns.join(",")}`);
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
