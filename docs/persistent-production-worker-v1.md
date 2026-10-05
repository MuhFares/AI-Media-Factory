# Persistent Production Worker v1 (Windows local deployment)

## Canonical path (only supported operational runtime)

```
AMF Control → durable queue → persistent production worker/service
  → createProductionWorker (apps/worker/src/production-worker.ts)
  → buildProviderBoundary (apps/worker/src/production-executor.ts)
  → shared provider boundary → provider
```

The worker entrypoint is `apps/worker/dist/cli.js` (`node dist/cli.js` from
`apps/worker`). No second worker implementation exists; the CLI and every
operator path construct through `createProductionWorker`.

## Process ownership (the R3 gap, closed)

The coding/engineering agent may develop, inspect, configure, and authorize
through governed interfaces. It must NOT own the long-lived provider worker
process or be the parent runtime for provider traffic.

`scripts/persistent-worker.mjs` is the smallest repository-consistent
mechanism (no third-party process manager):

- `start [--test]` spawns ONE detached `node dist/cli.js` with
  `AMF_WORKER_RUNTIME_MODE=persistent-production-worker` and
  `AMF_WORKER_LAUNCHER=persistent-worker-script`, stdio to
  `work/amf-worker/*.log`, PID in `work/amf-worker/worker.pid`, then exits —
  the worker survives independently of the engineering session.
- `status` / `stop` manage the PID file (SIGTERM, 15s grace).
- `--test` points the worker at the isolated `ai_media_factory_test`
  database (path-swap derivation only; credentials untouched). Without it the
  worker uses the configured `DATABASE_URL`.
- Only safe values (pid, host/db target, mode, log paths) are ever printed.

## Worker identity (safe metadata only)

`createWorkerRuntimeIdentity()` records per process: `workerInstanceId`
(random), `runtimeMode` (`PERSISTENT_PRODUCTION_WORKER` vs
`OPERATOR_WORKER`), `launcherClassification`, `nodeVersion`,
`executionEnvironment` (`SUPPORTED`/`UNSUPPORTED`), `startedAt`. No secrets,
no environment dumps, no command lines.

The identity is (a) logged once at startup (`[amf-worker] …`), (b) carried
on the shared provider boundary as `workerRuntime`, and (c) reported by the
zero-network media capability preflight as `workerRuntimeMode`. Future live
evidence answers WHICH WORKER EXECUTED THIS PROVIDER SUBMISSION by joining
the startup instance id with queue/claim timestamps — no inference.

## Environment guard (unchanged, narrow)

`CODEX_SANDBOX_NETWORK_DISABLED` → `UNSUPPORTED` /
`MEDIA_LIVE_EXECUTION_ALLOWED = FALSE`. Marker-absent environments report
`SUPPORTED`. Unknown environments are NOT denied (no broadening without
evidence). The check is zero-network and never claims provider reachability.

The marker is an execution-ownership boundary, not an egress observation. A
successful safe connectivity probe therefore does not override an
`UNSUPPORTED` startup classification. The canonical Owner launch must start
from a normal Owner PowerShell environment without the engineering sandbox
denial marker; the launcher intentionally does not strip or reinterpret an
inherited denial marker.

Worker presence records the bounded classification diagnostics required for
operations: status, reason-code list, failed check names, and a non-sensitive
runtime fingerprint (`platform`, `arch`, `nodeMajor`). The startup log carries
the same reason/check summary. No environment dump, provider response, URL,
credential, or authorization value is persisted. Startup trust is immutable
for the process lifetime; correcting a stale launch context requires a fresh
canonical handover.

Authorization (`PostgresMediaResumeDispatcher.authorizeAndDispatch`) runs the
preflight inside the advisory-lock critical section BEFORE any resume row,
job, rewind, or budget mutation. Already-queued media work throws
`MEDIA_LIVE_EXECUTION_ENVIRONMENT_UNSUPPORTED` before budget consumption,
provider invocation, or artifact creation.

## R4 execution rule (binding on the NEXT task)

R4 authorization may be initiated through governed owner controls, BUT the
queued R4 job must be consumed by the independently running persistent
production worker started via `scripts/persistent-worker.mjs` (or an
equivalent persistent service using `createProductionWorker` with
`PERSISTENT_PRODUCTION_WORKER` mode). The coding agent must NOT spawn an
operator worker to execute R4. Verifiable from: the `[amf-worker]`
startup line (instance id + `mode=PERSISTENT_PRODUCTION_WORKER` +
`launcher=persistent-worker-script`) and `workerRuntimeMode` in preflight
evidence.
