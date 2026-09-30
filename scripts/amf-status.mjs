/**
 * AMF status probe (Program 1 Workstream C/I).
 * Reads supervisor status plus live health; prints a JSON summary.
 * Usage: node scripts/amf-status.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = { at: new Date().toISOString(), supervisor: null, api: null, ui: null, worker: null };
try {
  out.supervisor = JSON.parse(fs.readFileSync(path.join(REPO, "logs", "amf-supervisor-status.json"), "utf8"));
} catch {
  out.supervisor = { status: "NO_SUPERVISOR_STATUS_FILE" };
}
async function get(url) {
  try {
    const r = await fetch(url);
    return { reachable: true, status: r.status, body: r.ok ? await r.json().catch(() => null) : null };
  } catch (e) {
    return { reachable: false, error: String((e && e.message) || e).slice(0, 120) };
  }
}
const health = await get("http://127.0.0.1:8080/control/health");
out.api = health.reachable && health.body && health.body.health
  ? {
      reachable: true,
      db: health.body.health.db,
      queue: health.body.health.queue,
      workers: {
        liveCount: health.body.health.workers.liveCount,
        stale: health.body.health.workers.stale,
        latestHeartbeatAt: health.body.health.workers.latestHeartbeatAt,
      },
    }
  : health;
out.ui = await get("http://127.0.0.1:8000/health");
out.worker = out.api && out.api.workers
  ? { live: out.api.workers.liveCount > 0 && !out.api.workers.stale }
  : { live: "unknown" };
console.log(JSON.stringify(out, null, 2));
