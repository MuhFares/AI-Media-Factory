/** PostgreSQL connection helpers + schema bootstrap for the persistence adapter. */

import pg from "pg";
import { SCHEMA_DDL } from "./schema.js";
import { WAN_SUPERVISED_EXECUTION_DDL } from "./wan-supervised-execution-migration.js";

const { Pool } = pg;

export interface PostgresConfig {
  connectionString: string;
  max?: number;
}

/**
 * Historical scripts under work/ are evidence and diagnostics, not supported
 * production entry points.  Fail closed before they can open a production DB;
 * an explicit override is accepted only for an unmistakably test-scoped DB.
 */
export function assertLegacyWorkRunnerDatabaseTarget(
  entrypoint: string | undefined,
  connectionString: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!entrypoint || !/(?:^|[\\/])work[\\/]/i.test(entrypoint)) return;
  if (env.AMF_ALLOW_LEGACY_UNSAFE_RUNNER !== "YES") {
    throw new Error("LEGACY_WORK_RUNNER_QUARANTINED:USE_CANONICAL_RUNTIME");
  }
  let database: string;
  try { database = new URL(connectionString).pathname.replace(/^\//, ""); }
  catch { throw new Error("LEGACY_WORK_RUNNER_DATABASE_INVALID"); }
  if (!/(^|[_-])test($|[_-])/i.test(database)) {
    throw new Error("LEGACY_WORK_RUNNER_PRODUCTION_DATABASE_FORBIDDEN");
  }
}

/** Create a connection pool. Call `close()` when done. */
export function createPool(config: PostgresConfig): pg.Pool {
  assertLegacyWorkRunnerDatabaseTarget(process.argv[1], config.connectionString);
  return new Pool({
    connectionString: config.connectionString,
    max: config.max ?? 10,
  });
}

/** Cross-session advisory lock id serializing concurrent schema migrations. */
const SCHEMA_MIGRATION_LOCK_ID = 4187321042;

/**
 * Apply the Phase 0 schema (idempotent CREATE TABLE IF NOT EXISTS).
 *
 * The DDL is serialized with a session-scoped advisory lock: concurrent
 * migrations (e.g. parallel test files, or the API and worker starting
 * together) otherwise race on catalog locks during CREATE TABLE IF NOT
 * EXISTS / ALTER TABLE IF NOT EXISTS and can deadlock.
 */
export async function migrate(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_MIGRATION_LOCK_ID]);
    try {
      // A freshly-created isolated database must contain every table touched by
      // the canonical worker idle loop. The Wan ledger was originally shipped
      // as an explicitly applied production migration, but leaving it out of
      // the idempotent bootstrap made clean worker test/runtime databases fail
      // before they could process any workflow. Both DDL blocks are additive
      // and idempotent; production installations that already applied the
      // narrow migration remain no-ops here.
      await client.query(`${SCHEMA_DDL}\n${WAN_SUPERVISED_EXECUTION_DDL}`);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_MIGRATION_LOCK_ID]);
    }
  } finally {
    client.release();
  }
}
