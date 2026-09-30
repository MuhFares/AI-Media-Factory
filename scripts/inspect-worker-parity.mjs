import pg from "pg";
import { computeMediaBuildId } from "@ai-media-factory/worker";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const expected = computeMediaBuildId().buildId;
  const result = await pool.query("SELECT worker_instance_id, build_id, runtime_mode, launcher, started_at, last_heartbeat_at FROM amf_worker_presence WHERE runtime_mode='PERSISTENT_PRODUCTION_WORKER' ORDER BY last_heartbeat_at DESC LIMIT 20");
  const cutoff = Date.now() - 120_000;
  const live = result.rows.filter((row) => Date.parse(String(row.last_heartbeat_at)) >= cutoff);
  console.log(JSON.stringify({ expectedBuildId: expected, live, exactlyOneCanonicalWorker: live.length === 1, buildParity: live.length === 1 && live[0].build_id === expected }, null, 2));
} finally {
  await pool.end();
}
