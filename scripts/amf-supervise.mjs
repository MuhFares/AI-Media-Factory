/**
 * AMF controlled runtime supervisor (Program 1 Workstream C).
 *
 * Starts PostgreSQL-dependent services in order (api -> worker -> ui),
 * restarts crashed services with backoff, enforces a crash-loop guard,
 * retains logs under logs/, and maintains logs/amf-supervisor-status.json.
 *
 * Usage: node scripts/amf-supervise.mjs [--no-ui]
 * Environment is loaded from .env (process-local only, never printed).
 * Stop with Ctrl+C or: node scripts/amf-down.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG_DIR = path.join(REPO, "logs");
const STATUS_FILE = path.join(LOG_DIR, "amf-supervisor-status.json");
const NO_UI = process.argv.includes("--no-ui");

for (const line of fs.readFileSync(path.join(REPO, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
fs.mkdirSync(LOG_DIR, { recursive: true });

const SERVICES = [
  {
    name: "api", command: process.execPath, args: ["apps/api/dist/server.js"],
    cwd: REPO, waitHealthy: async () => {
      for (let i = 0; i < 30; i++) {
        try {
          const r = await fetch("http://127.0.0.1:8080/control/health");
          if (r.ok) return true;
        } catch {}
        await new Promise((r) => setTimeout(r, 2000));
      }
      return false;
    },
  },
  {
    name: "worker", command: process.execPath, args: ["apps/worker/dist/cli.js"],
    cwd: REPO,
    // Production presence (platformHealth counts PERSISTENT_PRODUCTION_WORKER only;
    // the marker uses dashes: persistent-production-worker).
    env: { AMF_WORKER_RUNTIME_MODE: "persistent-production-worker", AMF_WORKER_LAUNCHER: "amf-supervise" },
    waitHealthy: async () => true,
  },
  ...(NO_UI ? [] : [{
    name: "ui",
    command: path.join(REPO, "apps", "api", "apps", "api", ".venv", "Scripts", "python.exe"),
    args: ["-m", "uvicorn", "ai_media_factory.main:app", "--app-dir", "src", "--host", "127.0.0.1", "--port", "8000"],
    cwd: path.join(REPO, "apps", "api"),
    waitHealthy: async () => {
      for (let i = 0; i < 30; i++) {
        try {
          const r = await fetch("http://127.0.0.1:8000/health");
          if (r.ok) return true;
        } catch {}
        await new Promise((r) => setTimeout(r, 2000));
      }
      return false;
    },
  }]),
];

const state = { startedAt: new Date().toISOString(), services: {} };
function writeStatus() {
  fs.writeFileSync(STATUS_FILE, JSON.stringify(state, null, 2));
}
function log(name, line) {
  fs.appendFileSync(path.join(LOG_DIR, `${name}.log`), `[${new Date().toISOString()}] ${line}\n`);
}

const children = new Map();
let stopping = false;

async function supervise(svc) {
  const st = (state.services[svc.name] = { pid: null, restarts: 0, failures: [], status: "starting" });
  writeStatus();
  for (;;) {
    if (stopping) return;
    const child = spawn(svc.command, svc.args, {
      cwd: svc.cwd, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(svc.env || {}) },
    });
    children.set(svc.name, child);
    st.pid = child.pid;
    st.status = "running";
    st.startedAt = new Date().toISOString();
    writeStatus();
    log(svc.name, `started pid=${child.pid}`);
    child.stdout.on("data", (d) => log(svc.name, `OUT ${String(d).trimEnd().slice(0, 500)}`));
    child.stderr.on("data", (d) => log(svc.name, `ERR ${String(d).trimEnd().slice(0, 500)}`));
    const code = await new Promise((r) => child.on("exit", r));
    children.delete(svc.name);
    if (stopping) return;
    st.restarts += 1;
    st.failures.push({ at: new Date().toISOString(), code });
    st.failures = st.failures.filter((f) => Date.now() - Date.parse(f.at) < 120000);
    if (st.failures.length >= 5) {
      st.status = "failed-crash-loop";
      writeStatus();
      log(svc.name, "crash-loop guard tripped; not restarting");
      return;
    }
    st.status = "restarting";
    writeStatus();
    log(svc.name, `exited code=${code}; restarting in 5s (restart #${st.restarts})`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}

async function main() {
  fs.writeFileSync(path.join(REPO, "logs", "amf-supervisor.pid"), String(process.pid));
  for (const svc of SERVICES) {
    void supervise(svc);
    if (svc.waitHealthy) {
      const ok = await svc.waitHealthy();
      const st = state.services[svc.name];
      if (!ok && st) {
        st.status = "failed-health-check";
        writeStatus();
        log(svc.name, "health check failed after start; stopping supervisor");
        process.exitCode = 1;
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(JSON.stringify({ status: "SUPERVISED", services: Object.keys(state.services) }));
  const shutdown = () => {
    stopping = true;
    for (const [, child] of children) {
      try { child.kill("SIGTERM"); } catch {}
    }
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await new Promise(() => {});
}

await main();
