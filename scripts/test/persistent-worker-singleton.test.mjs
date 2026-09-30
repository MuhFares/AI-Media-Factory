import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPersistentWorkerController } from "../persistent-worker-singleton.mjs";

const roots = [];
afterEach(() => { while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true }); });

function fixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "amf-worker-singleton-"));
  roots.push(root);
  const entry = path.join(root, "worker.js");
  fs.writeFileSync(entry, "// fixture\n");
  const processes = overrides.processes ?? new Set();
  const workerProcesses = overrides.workerProcesses ?? new Set();
  processes.add(process.pid);
  const presence = overrides.presence ?? [];
  let nextPid = overrides.nextPid ?? 41000;
  let spawnCount = 0;
  const config = {
    repo: overrides.repo ?? root,
    databaseUrl: overrides.databaseUrl ?? "postgresql://user:secret@127.0.0.1:5432/amf_fixture",
    runtimeDir: path.join(root, "runtime"), workerCwd: root, workerEntry: entry,
    outLog: path.join(root, "out.log"), errLog: path.join(root, "err.log"),
    buildId: "fixture-build", stopTimeoutMs: 100,
  };
  const deps = {
    processExists: (pid) => processes.has(pid),
    listPresence: async () => presence,
    spawnWorker: overrides.spawnWorker ?? (async () => { const pid = nextPid++; processes.add(pid); workerProcesses.add(pid); spawnCount++; return pid; }),
    terminate: (pid) => processes.delete(pid),
    processCommandMatches: overrides.processCommandMatches ?? ((pid) => workerProcesses.has(pid)),
    wait: async () => {},
    now: () => Date.parse("2026-09-26T14:00:00.000Z"),
  };
  const controller = createPersistentWorkerController(config, deps);
  return { root, config, controller, processes, workerProcesses, presence, get spawnCount() { return spawnCount; } };
}

const liveRow = (controller, pid, extra = {}) => ({
  worker_instance_id: `worker-${pid}`, build_id: "fixture-build",
  runtime_mode: "PERSISTENT_PRODUCTION_WORKER", launcher: "persistent-worker-script",
  last_heartbeat_at: "2026-09-26T13:59:30.000Z", process_id: pid,
  singleton_key: controller.identity.key, ...extra,
});

test("A/B/G: one start creates one worker; repeat is ALREADY_RUNNING; status is healthy", async () => {
  const f = fixture();
  const first = await f.controller.start();
  assert.equal(first.outcome, "STARTED");
  f.presence.push(liveRow(f.controller, first.pid));
  const second = await f.controller.start();
  assert.equal(second.outcome, "ALREADY_RUNNING");
  assert.equal(f.spawnCount, 1);
  assert.equal((await f.controller.inspect()).state, "HEALTHY_SINGLETON");
});

test("C: stale dead PID is cleaned before exactly one new start", async () => {
  const f = fixture();
  fs.mkdirSync(f.config.runtimeDir, { recursive: true });
  fs.writeFileSync(f.controller.paths.pidFile, "39999\n");
  fs.writeFileSync(f.controller.paths.stateFile, JSON.stringify({ pid: 39999, singletonKey: f.controller.identity.key }));
  const result = await f.controller.start();
  assert.equal(result.outcome, "STARTED");
  assert.equal(f.spawnCount, 1);
  assert.notEqual(Number(fs.readFileSync(f.controller.paths.pidFile, "utf8")), 39999);
});

test("D: live canonical heartbeat with no PID file refuses an orphan duplicate", async () => {
  const f = fixture();
  f.processes.add(42001);
  f.workerProcesses.add(42001);
  f.presence.push(liveRow(f.controller, 42001));
  const result = await f.controller.start();
  assert.equal(result.outcome, "ALREADY_RUNNING");
  assert.equal(result.pid, 42001);
  assert.equal(f.spawnCount, 0);
});

test("E: simultaneous starts are serialized and spawn exactly one worker", async () => {
  const processes = new Set();
  let releases;
  const gate = new Promise((resolve) => { releases = resolve; });
  let calls = 0;
  const f = fixture({ processes, spawnWorker: async () => { calls++; await gate; processes.add(43001); return 43001; } });
  const first = f.controller.start();
  await new Promise((resolve) => setImmediate(resolve));
  const second = await f.controller.start();
  assert.equal(second.outcome, "LOCKED");
  releases();
  assert.equal((await first).outcome, "STARTED");
  assert.equal(calls, 1);
});

test("F: stop terminates the exact tracked canonical process and confirms exit", async () => {
  const f = fixture();
  const started = await f.controller.start();
  assert.equal(f.processes.has(started.pid), true);
  const stopped = await f.controller.stop();
  assert.equal(stopped.outcome, "STOPPED");
  assert.equal(f.processes.has(started.pid), false);
  assert.equal(fs.existsSync(f.controller.paths.pidFile), false);
});

test("K: a reused tracked PID is stale and is never terminated", async () => {
  const reusedPid = 47000;
  const processes = new Set([reusedPid]);
  const f = fixture({ processes });
  fs.mkdirSync(f.config.runtimeDir, { recursive: true });
  fs.writeFileSync(f.controller.paths.pidFile, `${reusedPid}\n`);
  fs.writeFileSync(f.controller.paths.stateFile, JSON.stringify({
    pid: reusedPid, singletonKey: f.controller.identity.key,
    buildId: f.config.buildId, startedAt: "2026-09-26T13:00:00.000Z",
  }));
  const status = await f.controller.inspect();
  assert.equal(status.state, "STALE_PID_REUSED");
  assert.equal(status.trackedCommandMatches, false);
  const stopped = await f.controller.stop();
  assert.equal(stopped.outcome, "STALE_STATE_CLEARED");
  assert.equal(processes.has(reusedPid), true, "unrelated reused process must survive");
});

test("H: status reports a synthetic duplicate as degraded", async () => {
  const f = fixture();
  f.processes.add(44001); f.processes.add(44002);
  f.workerProcesses.add(44001); f.workerProcesses.add(44002);
  f.presence.push(liveRow(f.controller, 44001), liveRow(f.controller, 44002));
  const status = await f.controller.inspect();
  assert.equal(status.state, "DUPLICATE");
  assert.deepEqual(status.activePids, [44001, 44002]);
});

test("I: unrelated Node process is untouched", async () => {
  const f = fixture();
  f.processes.add(45000);
  const started = await f.controller.start();
  await f.controller.stop();
  assert.equal(f.processes.has(45000), true);
  assert.equal(f.processes.has(started.pid), false);
});

test("J: a non-equivalent singleton identity is not treated as this worker", async () => {
  const f = fixture();
  f.processes.add(46000);
  f.presence.push(liveRow(f.controller, 46000, { singleton_key: "different-repo-database-mode-role" }));
  const result = await f.controller.start();
  assert.equal(result.outcome, "STARTED");
  assert.equal(f.spawnCount, 1);
  assert.equal(f.processes.has(46000), true);
});
