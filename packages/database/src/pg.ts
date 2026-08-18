/** PostgreSQL connection helpers + schema bootstrap for the persistence adapter. */

import pg from "pg";
import { SCHEMA_DDL } from "./schema.js";

const { Pool } = pg;

export interface PostgresConfig {
  connectionString: string;
  max?: number;
}

/** Create a connection pool. Call `close()` when done. */
export function createPool(config: PostgresConfig): pg.Pool {
  return new Pool({
    connectionString: config.connectionString,
    max: config.max ?? 10,
  });
}

/** Apply the Phase 0 schema (idempotent CREATE TABLE IF NOT EXISTS). */
export async function migrate(pool: pg.Pool): Promise<void> {
  await pool.query(SCHEMA_DDL);
}