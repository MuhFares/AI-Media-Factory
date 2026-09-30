import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const r = await pool.query("SELECT workflow_id, executed_at, payload FROM capability_executions WHERE capability_id='image.generate' ORDER BY executed_at ASC");
for (const row of r.rows) {
  const p = row.payload;
  const evidence = p.evidence;
  const output = p.output;
  const utc = new Date(row.executed_at);
  // Egypt is UTC+3 in summer (DST)
  const egypt = new Date(utc.getTime() + 3*60*60*1000);
  const egyptStr = egypt.toISOString().replace("T", " ").replace("Z", "") + " (UTC+3 Cairo)";
  const utcStr = utc.toISOString();
  console.log("\nworkflow:", row.workflow_id);
  console.log("  executed_at UTC   :", utcStr);
  console.log("  executed_at Egypt :", egyptStr);
  console.log("  providerId:", evidence.providerId, "| imageId:", output.imageId);
  console.log("  providerInvoked:", evidence.providerInvoked, "succeeded:", evidence.succeeded);
  console.log("  durationMs:", evidence.durationMs);
  console.log("  jobId (RunPod):", output.imageId.replace("runpod-",""));
  console.log("  workflow ckpt:", "flux1-dev-fp8.safetensors (from packages/provider-adapters/src/adapters/runpod-image.ts:79)");
  console.log("  url type:", output.url?.startsWith("data:image/png") ? "data:image/png;base64 (FLUX PNG via RunPod)" : output.url?.slice(0,30));
}
await pool.end();
