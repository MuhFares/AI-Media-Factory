/** Persistent production-worker singleton launcher. Provider-free itself. */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { computeMediaBuildId } from "../apps/worker/dist/index.js";
import { createPersistentWorkerController } from "./persistent-worker-singleton.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadDotEnv() {
  const envFile = path.join(REPO, ".env");
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    if (key === "" || key in process.env) continue;
    let raw = line.slice(i + 1).trim();
    if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
    process.env[key] = raw;
  }
}

function productionConfig(useTestDb) {
  loadDotEnv();
  let databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory";
  if (useTestDb) {
    const derived = new URL(databaseUrl);
    derived.pathname = "/ai_media_factory_test";
    databaseUrl = derived.toString();
  }
  const runtimeDir = path.join(REPO, "work", useTestDb ? "amf-worker-test" : "amf-worker");
  return {
    repo: REPO,
    databaseUrl,
    runtimeDir,
    workerCwd: path.join(REPO, "apps", "worker"),
    workerEntry: path.join(REPO, "apps", "worker", "dist", "cli.js"),
    outLog: path.join(runtimeDir, "worker.out.log"),
    errLog: path.join(runtimeDir, "worker.err.log"),
    buildId: computeMediaBuildId().buildId,
  };
}

async function controller(useTestDb) {
  const config = productionConfig(useTestDb);
  return createPersistentWorkerController(config, {
    listPresence: async () => {
      const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1, connectionTimeoutMillis: 3_000 });
      try {
        const columns = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='amf_worker_presence'");
        const names = new Set(columns.rows.map((row) => row.column_name));
        const hasSingleton = names.has("singleton_key");
        const hasPid = names.has("process_id");
        const result = await pool.query(`SELECT worker_instance_id,build_id,runtime_mode,launcher,started_at,last_heartbeat_at,${hasSingleton ? "singleton_key" : "NULL::text AS singleton_key"},${hasPid ? "process_id" : "NULL::integer AS process_id"} FROM amf_worker_presence WHERE runtime_mode='PERSISTENT_PRODUCTION_WORKER' AND launcher='persistent-worker-script' ORDER BY last_heartbeat_at DESC LIMIT 20`);
        return result.rows;
      } finally { await pool.end(); }
    },
  });
}

const print = (result) => console.log(JSON.stringify(result, null, 2));
const [command, flag] = process.argv.slice(2);
const useTestDb = flag === "--test";
if (!["start", "status", "stop"].includes(command)) {
  console.error("usage: node scripts/persistent-worker.mjs start [--test] | status [--test] | stop [--test]");
  process.exitCode = 2;
} else {
  const singleton = await controller(useTestDb);
  if (command === "start") {
    const result = await singleton.start();
    print(result);
    if (!["STARTED", "ALREADY_RUNNING", "LOCKED"].includes(result.outcome)) process.exitCode = 1;
  } else if (command === "stop") {
    const result = await singleton.stop();
    print(result);
    if (!["STOPPED", "ALREADY_STOPPED", "STALE_STATE_CLEARED"].includes(result.outcome)) process.exitCode = 1;
  } else {
    const result = await singleton.inspect();
    print(result);
    if (!["HEALTHY_SINGLETON", "STOPPED", "STALE_PID", "STALE_PID_REUSED", "STALE_HEARTBEAT"].includes(result.state)) process.exitCode = 1;
  }
}
