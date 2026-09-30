import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const r = await pool.query("SELECT workflow_id, executed_at, payload FROM capability_executions WHERE capability_id='image.generate' ORDER BY executed_at ASC");
for (const row of r.rows) {
  const p = row.payload;
  const prompt = p.output?.parameters?.prompt ?? p.evidence?.requestedPath ?? "";
  const title = p.output?.title ?? "";
  const url = p.output?.url ?? "";
  console.log(row.workflow_id, "|", String(row.executed_at));
  console.log("  prompt:", prompt.slice(0, 150));
  console.log("  title:", title.slice(0, 80));
  console.log("  url:", url.slice(0, 60) + (url.length>60 ? "..." : ""));
}
await pool.end();
