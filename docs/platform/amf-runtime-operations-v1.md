# AMF Runtime Operations V1 (Program 1: workstreams C, D, F, G, I)

Single-operator runbook for the controlled local runtime. No Kubernetes,
no cloud CI/CD, no microservices. Secrets are never printed by any
procedure below; commands that would emit credentials are marked.

## 1. Bring-up, supervision, shutdown (C)

- Bring everything up supervised: `node scripts/amf-supervise.mjs`
  (add `--no-ui` to skip the Owner facade). Order: api → worker → ui,
  each gated on its health check. Restart from the repository root.
- Status (supervisor state + live health): `node scripts/amf-status.mjs`.
  An obvious runtime failure (dead process, stale worker heartbeat,
  backed-up queue) is visible here and on Global System / Costs & Health.
- Stop everything: `node scripts/amf-down.mjs`.
- Logs: `logs/<api|worker|ui>.log` (predictable, retained on disk).
  Supervisor state: `logs/amf-supervisor-status.json` (pids, restarts,
  crash-loop trips).
- Restart policy: always restart with 5s backoff; 5 exits within 120s
  trips the crash-loop guard (service marked failed, no further restarts).
- Environment: services inherit `.env` (DATABASE_URL, provider keys,
  AMF_OWNER_TOKEN). Never commit `.env`; never print it.

## 2. Controlled change procedure / currency (F)

code change → targeted tests → `tsc` builds → TEST DB migrate + suites →
production boot migration (automatic, additive only) → supervised restart
(`amf-down.mjs`, then `amf-supervise.mjs`) → verify `/control/health`,
decision-queue counts, served-bundle hash (`/` HTML `?v=` equals the
source file sha) → `amf-status.mjs` green.

Rollback: `git restore` the changed files, rebuild, restart the same way.
Migrations are additive `IF NOT EXISTS`; no destructive migration exists,
so rollback never needs a down-migration. A stale running process can no
longer masquerade as current code: the `?v=` bundle hash plus
`/control/health` build presence prove currency.

## 3. Backup and restore (D)

- Backup: `node scripts/amf-backup.mjs [--dir <path>]` (default
  `../AMF-Backups`, outside the repository). Read-only `pg_dump` custom
  format of production. Verified 2026-09-23: 37MB dump.
- Restore (never into production): `node scripts/amf-restore.mjs --file
  <dump> --target <name>` refuses production database names; `--clean`
  allowed only on non-production targets.
- Verification: restore into `ai_media_factory_restore_verify`, compare
  table counts (projects/approvals/artifacts/publications/strategy),
  then drop the scratch database. Verified 2026-09-23.
- Retention recommendation: keep the last 7 daily dumps plus pre-change
  dumps; prune older ones manually until automation is scheduled.

## 4. Secrets and OAuth operations (G)

- OAuth client JSON and token files live OUTSIDE the repository
  (Owner profile area, e.g. `D:\AMF-Secrets`); gitignored patterns cover
  `client_secret*.json`, `*-oauth-token.json`, `.youtube-oauth/`.
- Access tokens are ephemeral (process memory / explicit Owner export
  only); never written to `.env` automatically; never returned by API/UI;
  never logged (redaction guards in transport + scripts).
- Refresh: `node scripts/youtube-oauth.mjs refresh --credential <file>`;
  rotation = re-run `bootstrap`, then `verify-channel`.
- Runtime bridge: the M4 publisher path resolves token → channel guard →
  private guard in code; no stored token is reused across runs.
- Re-consent: repeat bootstrap; verify `status` shows all required scopes
  before any governed use.

## 5. Observability minimum (I)

API health (`/control/health`: db, queue, workers, heartbeat, recent
failures) + Python `/health` + supervisor status file + `amf-status.mjs`
summary + Costs & Health / Global System Owner surfaces. No metrics,
tracing, or alerting yet — that is Program 7 (Scale) scope.

## 6. Test database (E, summarized)

`node scripts/amf-testdb.mjs --migrate` derives `ai_media_factory_test`
from DATABASE_URL (path swap only), guards against production identity,
creates and migrates. `--reset` drops/recreates (test DB only).
`--print-export` emits shell export lines for the caller's own terminal.
DB suites run with `TEST_DATABASE_URL` set and `--test-concurrency=1`.
