import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

export const HEARTBEAT_LIVE_MS = 120_000;
const MODE = "PERSISTENT_PRODUCTION_WORKER";
const LAUNCHER = "persistent-worker-script";
const ROLE = "canonical-production-queue-worker";

function normalizedTarget(databaseUrl) {
  const url = new URL(databaseUrl);
  const port = url.port || (url.protocol === "postgresql:" || url.protocol === "postgres:" ? "5432" : "");
  return `${url.protocol}//${url.hostname.toLowerCase()}:${port}${url.pathname}`;
}

export function canonicalSingletonIdentity({ repo, databaseUrl, mode = MODE, role = ROLE }) {
  const canonical = JSON.stringify({
    repository: path.resolve(repo).toLocaleLowerCase("en-US"),
    database: normalizedTarget(databaseUrl),
    mode,
    role,
  });
  return {
    key: createHash("sha256").update(canonical).digest("hex"),
    databaseTarget: normalizedTarget(databaseUrl),
    mode,
    role,
  };
}

export function processExists(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "EPERM") return true;
    if (process.platform !== "win32" || error?.code === "ESRCH") return false;
    const result = spawnSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($null -eq $p){exit 3}else{exit 0}`,
    ], { windowsHide: true, stdio: "ignore" });
    return result.status === 0;
  }
}

export function terminateExactProcess(pid) {
  if (process.platform !== "win32") return process.kill(pid, "SIGTERM");
  // Node's process.kill commonly returns EPERM for an Owner-launched Windows
  // process even after identity has been proven.  Stop-Process is the canonical
  // narrow Windows primitive; the caller supplies only a previously correlated
  // PID and still verifies exit before clearing launcher state.
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    `Stop-Process -Id ${pid} -ErrorAction Stop`,
  ], { windowsHide: true, encoding: "utf8" });
  if (result.status !== 0) {
    const error = new Error(`WINDOWS_PROCESS_TERMINATION_FAILED:${pid}`);
    error.cause = String(result.stderr ?? result.stdout ?? "").trim();
    throw error;
  }
}

/**
 * Windows may allow Get-Process while denying both CIM command-line access and
 * the executable Path property.  In that case the process start time, together
 * with the database-backed worker identity/heartbeat checked by the caller, is
 * the remaining non-PID identity proof.  A reported path is still required to
 * resolve to node.exe; an unavailable path must not turn a healthy canonical
 * worker into a false stale-PID result.
 */
export function windowsProcessProofMatches(proof, expectedStartedAt) {
  const expectedStart = Date.parse(String(expectedStartedAt ?? ""));
  const actualStart = Date.parse(String(proof?.startedAt ?? ""));
  const processName = String(proof?.name ?? "").toLocaleLowerCase("en-US");
  const reportedPath = String(proof?.path ?? "").trim();
  const pathMatches = reportedPath === ""
    || path.basename(reportedPath).toLocaleLowerCase("en-US") === "node.exe";
  return proof?.kind === "process" && processName === "node" && pathMatches
    && Number.isFinite(expectedStart) && Number.isFinite(actualStart)
    && Math.abs(expectedStart - actualStart) <= 10_000;
}

/**
 * A PID is not an identity. Windows can reuse a terminated worker's PID for an
 * unrelated process, so launcher decisions must also prove that the process
 * command still points at the configured worker entrypoint.
 */
export function processCommandMatches(pid, workerEntry, expectedStartedAt = null) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  const expected = path.resolve(workerEntry).toLocaleLowerCase("en-US");
  if (process.platform === "win32") {
    const result = spawnSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      `$c=$null; try{$c=Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\" -ErrorAction Stop}catch{}; if($null -ne $c -and -not [string]::IsNullOrWhiteSpace([string]$c.CommandLine)){@{kind='command';commandLine=[string]$c.CommandLine}|ConvertTo-Json -Compress;exit 0}; $p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($null -eq $p){exit 3}; @{kind='process';name=[string]$p.ProcessName;path=[string]$p.Path;startedAt=$p.StartTime.ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress`,
    ], { windowsHide: true, encoding: "utf8" });
    if (result.status !== 0) return false;
    try {
      const proof = JSON.parse(String(result.stdout ?? "").trim());
      if (proof.kind === "command") return String(proof.commandLine ?? "").toLocaleLowerCase("en-US").includes(expected);
      return windowsProcessProofMatches(proof, expectedStartedAt);
    } catch { return false; }
  }
  try {
    const command = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
    return command.toLocaleLowerCase("en-US").includes(expected);
  } catch { return false; }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function readPid(file) {
  try {
    const pid = Number(fs.readFileSync(file, "utf8").trim());
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  } catch { return null; }
}

function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  fs.renameSync(temporary, file);
}

function acquireLock(lockDir, exists) {
  try {
    fs.mkdirSync(lockDir);
    writeJsonAtomic(path.join(lockDir, "owner.json"), { pid: process.pid, acquiredAt: new Date().toISOString() });
    return { acquired: true };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const owner = readJson(path.join(lockDir, "owner.json"));
    if (Number.isSafeInteger(owner?.pid) && exists(owner.pid)) return { acquired: false, ownerPid: owner.pid };
    const stale = `${lockDir}.stale.${process.pid}.${Date.now()}`;
    try { fs.renameSync(lockDir, stale); } catch { return { acquired: false, ownerPid: null }; }
    fs.rmSync(stale, { recursive: true, force: true });
    fs.mkdirSync(lockDir);
    writeJsonAtomic(path.join(lockDir, "owner.json"), { pid: process.pid, acquiredAt: new Date().toISOString() });
    return { acquired: true, recoveredStale: true };
  }
}

function releaseLock(lockDir) {
  fs.rmSync(lockDir, { recursive: true, force: true });
}

function matchingPresence(rows, identity, now, exists, commandMatches) {
  return rows.filter((row) => {
    if (row.runtime_mode !== identity.mode || row.launcher !== LAUNCHER) return false;
    if (row.singleton_key && row.singleton_key !== identity.key) return false;
    const heartbeat = Date.parse(String(row.last_heartbeat_at));
    if (!Number.isFinite(heartbeat) || now - heartbeat > HEARTBEAT_LIVE_MS) return false;
    const pid = Number(row.process_id);
    return Number.isSafeInteger(pid) && pid > 0 ? exists(pid) && commandMatches(pid, row.started_at) : false;
  });
}

export function createPersistentWorkerController(config, injected = {}) {
  const runtimeDir = config.runtimeDir;
  const pidFile = path.join(runtimeDir, "worker.pid");
  const stateFile = path.join(runtimeDir, "worker.state.json");
  const lockDir = path.join(runtimeDir, "start-stop.lock");
  const identity = canonicalSingletonIdentity(config);
  const exists = injected.processExists ?? processExists;
  const commandMatches = injected.processCommandMatches ?? ((pid, startedAt) => processCommandMatches(pid, config.workerEntry, startedAt));
  const now = injected.now ?? (() => Date.now());
  const listPresence = injected.listPresence ?? (async () => []);
  const terminate = injected.terminate ?? terminateExactProcess;
  const wait = injected.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const spawnWorker = injected.spawnWorker ?? (() => {
    fs.mkdirSync(runtimeDir, { recursive: true });
    const out = fs.openSync(config.outLog, "a");
    const err = fs.openSync(config.errLog, "a");
    try {
      const child = spawn(process.execPath, [config.workerEntry], {
        cwd: config.workerCwd,
        detached: true,
        stdio: ["ignore", out, err],
        env: {
          ...process.env,
          DATABASE_URL: config.databaseUrl,
          AMF_WORKER_RUNTIME_MODE: "persistent-production-worker",
          AMF_WORKER_LAUNCHER: LAUNCHER,
          AMF_WORKER_SINGLETON_KEY: identity.key,
          AMF_WORKER_ROLE: identity.role,
        },
      });
      child.unref();
      return child.pid;
    } finally {
      fs.closeSync(out);
      fs.closeSync(err);
    }
  });

  async function inspect() {
    fs.mkdirSync(runtimeDir, { recursive: true });
    const trackedPid = readPid(pidFile);
    const state = readJson(stateFile);
    const trackedIdentityMatches = state?.singletonKey === identity.key;
    const trackedAlive = trackedPid !== null && exists(trackedPid);
    const trackedCommandMatches = trackedAlive && trackedIdentityMatches
      && commandMatches(trackedPid, state?.startedAt);
    const trackedBuildMatches = state?.buildId === config.buildId;
    let presenceRows;
    try { presenceRows = await listPresence(); }
    catch (error) {
      return { state: "HEARTBEAT_UNAVAILABLE", error: error instanceof Error ? error.message : String(error), trackedPid, trackedAlive, stateRecord: state, activePids: trackedAlive && trackedIdentityMatches ? [trackedPid] : [] };
    }
    const canonicalPresence = matchingPresence(presenceRows, identity, now(), exists, commandMatches);
    const livePresence = canonicalPresence.filter((row) => row.build_id === config.buildId);
    const active = new Set();
    for (const row of canonicalPresence) {
      const pid = Number(row.process_id);
      if (Number.isSafeInteger(pid) && pid > 0) active.add(pid);
    }
    const activePids = [...active].sort((a, b) => a - b);
    let status = "STOPPED";
    if (activePids.length > 1 || canonicalPresence.length > 1) status = "DUPLICATE";
    else if (activePids.length === 1 && livePresence.length === 1) status = "HEALTHY_SINGLETON";
    else if (activePids.length === 1 && canonicalPresence.length === 1) status = "STALE_BUILD";
    else if (trackedAlive && !trackedCommandMatches) status = "STALE_PID_REUSED";
    else if (trackedCommandMatches) status = "STALE_HEARTBEAT";
    else if (trackedPid !== null && !trackedAlive) status = "STALE_PID";
    return { state: status, trackedPid, trackedAlive, trackedCommandMatches, trackedBuildMatches, stateRecord: state, livePresence, canonicalPresence, activePids, identity };
  }

  async function start() {
    fs.mkdirSync(runtimeDir, { recursive: true });
    const lock = acquireLock(lockDir, exists);
    if (!lock.acquired) return { outcome: "LOCKED", ownerPid: lock.ownerPid ?? null };
    try {
      const before = await inspect();
      if (before.state === "HEARTBEAT_UNAVAILABLE") return { outcome: "REFUSED_HEARTBEAT_UNAVAILABLE", detail: before };
      if (before.state === "DUPLICATE") return { outcome: "REFUSED_DUPLICATE", detail: before };
      if (before.state === "HEALTHY_SINGLETON") {
        const observed = before.activePids[0] ?? Number(before.livePresence?.[0]?.process_id);
        return { outcome: "ALREADY_RUNNING", pid: Number.isSafeInteger(observed) ? observed : null, detail: before };
      }
      if (before.state === "STALE_BUILD") return { outcome: "REFUSED_STALE_BUILD_REQUIRES_HANDOVER", detail: before };
      if (["STALE_PID", "STALE_PID_REUSED"].includes(before.state)) {
        fs.rmSync(pidFile, { force: true });
        fs.rmSync(stateFile, { force: true });
      } else if (before.state === "STALE_HEARTBEAT") {
        return { outcome: "REFUSED_STALE_HEARTBEAT", detail: before };
      } else if (before.trackedPid === null && before.stateRecord !== null) {
        fs.rmSync(stateFile, { force: true });
      }
      if (!fs.existsSync(config.workerEntry)) return { outcome: "WORKER_BUILD_MISSING" };
      const pid = await spawnWorker();
      if (!Number.isSafeInteger(pid) || pid <= 0) return { outcome: "SPAWN_FAILED" };
      try {
        fs.writeFileSync(pidFile, `${pid}\n`);
        writeJsonAtomic(stateFile, {
          pid, singletonKey: identity.key, databaseTarget: identity.databaseTarget,
          mode: identity.mode, launcher: LAUNCHER, role: identity.role,
          buildId: config.buildId, startedAt: new Date(now()).toISOString(),
        });
      } catch (error) {
        try { terminate(pid); } catch { /* preserve the original persistence failure */ }
        fs.rmSync(pidFile, { force: true });
        fs.rmSync(stateFile, { force: true });
        throw error;
      }
      return { outcome: "STARTED", pid, identity };
    } finally { releaseLock(lockDir); }
  }

  async function stop() {
    fs.mkdirSync(runtimeDir, { recursive: true });
    const lock = acquireLock(lockDir, exists);
    if (!lock.acquired) return { outcome: "LOCKED", ownerPid: lock.ownerPid ?? null };
    try {
      const before = await inspect();
      if (before.state === "HEARTBEAT_UNAVAILABLE" && before.activePids.length === 0) return { outcome: "REFUSED_HEARTBEAT_UNAVAILABLE", detail: before };
      const targets = [...new Set([
        ...before.activePids,
        ...(before.trackedCommandMatches && before.trackedPid !== null ? [before.trackedPid] : []),
      ])];
      if (targets.length === 0) {
        if ((before.livePresence?.length ?? 0) > 0) {
          return { outcome: "REFUSED_CANONICAL_PID_UNKNOWN", detail: before };
        }
        if (before.trackedPid !== null && ["STALE_PID", "STALE_PID_REUSED"].includes(before.state)) {
          fs.rmSync(pidFile, { force: true });
          fs.rmSync(stateFile, { force: true });
          return { outcome: "STALE_STATE_CLEARED" };
        }
        return { outcome: "ALREADY_STOPPED" };
      }
      for (const pid of targets) terminate(pid);
      const deadline = now() + (config.stopTimeoutMs ?? 15_000);
      while (targets.some((pid) => exists(pid)) && now() < deadline) await wait(100);
      const survivors = targets.filter((pid) => exists(pid));
      if (survivors.length > 0) return { outcome: "STOP_FAILED", survivors };
      fs.rmSync(pidFile, { force: true });
      fs.rmSync(stateFile, { force: true });
      return { outcome: "STOPPED", pids: targets };
    } finally { releaseLock(lockDir); }
  }

  return { identity, inspect, start, stop, paths: { pidFile, stateFile, lockDir } };
}
