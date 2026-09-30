/**
 * AMF supervised-runtime stop (Program 1 Workstream C).
 * Stops the supervisor (which stops children) via the recorded PID file.
 * Usage: node scripts/amf-down.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pidFile = path.join(REPO, "logs", "amf-supervisor.pid");
let pid = null;
try {
  pid = Number(fs.readFileSync(pidFile, "utf8").trim());
} catch {}
if (!Number.isInteger(pid)) {
  console.log(JSON.stringify({ status: "NO_SUPERVISOR_PID_FILE" }));
  process.exit(0);
}
try {
  if (process.platform === "win32") {
    execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
  } else {
    process.kill(pid, "SIGTERM");
  }
  console.log(JSON.stringify({ status: "STOP_REQUESTED", pid }));
} catch (e) {
  console.log(JSON.stringify({ status: "STOP_FAILED", pid, error: String((e && e.message) || e).slice(0, 200) }));
  process.exit(1);
}
