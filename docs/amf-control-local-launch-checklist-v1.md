# AMF Control local launch and validation checklist V1

This is the repository-grounded owner procedure for Windows PowerShell. It starts the AMF Control Python UI/API, the Node runtime API, and the durable worker. The worker is the only component that invokes a configured text provider.

## Services and dependencies

| Service | Purpose | Required | Dependency | Port / health |
| --- | --- | --- | --- | --- |
| PostgreSQL | Workflow, queue, artifacts, provenance, approvals, Command Room records | Yes | None | Connection in `DATABASE_URL`; no HTTP health endpoint |
| Node runtime API (`apps/api`) | `/workflows` and `/control/*`; applies migrations on start | Yes | PostgreSQL | `HOST` / `PORT`, defaults `0.0.0.0:8080`; no `/health` endpoint |
| Worker (`apps/worker`) | Claims Postgres queue jobs and runs governed agents | Yes | PostgreSQL; provider for live agent commands | No port; logs `worker: polling ...` |
| Python AMF Control API/UI (`apps/api/src/ai_media_factory`) | Owner-facing UI/API; proxies business requests to Node runtime API | Yes for Command Room UI | Node runtime API | `API_HOST` / `API_PORT`, defaults `0.0.0.0:8000`; `GET /health` |
| Web TypeScript package (`apps/web`) | Package only; its `dev` script is TypeScript watch, not an HTTP server | No | None | No defined serving port or health endpoint |

There is no separate Redis/RabbitMQ service: `workflow_jobs` in PostgreSQL is the queue.

## Environment variables actually used

### Database, API, and worker

| Name | Required | Used by | Secret | Default / meaning |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | Yes for Node runtime API and worker | `apps/api/src/server.ts`, `apps/worker/src/cli.ts` | Yes (may include password) | `postgresql://postgres@127.0.0.1:5432/ai_media_factory` |
| `TEST_DATABASE_URL` | Required for PostgreSQL integration tests | `packages/database/test/*`, worker/API test helpers | Yes | `postgresql://postgres@127.0.0.1:5432/ai_media_factory_test`; must differ from `DATABASE_URL` |
| `HOST` | Optional | Node runtime API | No | `0.0.0.0` |
| `PORT` | Optional | Node runtime API | No | `8080` |
| `API_HOST` | Optional | Python AMF Control API | No | `0.0.0.0` |
| `API_PORT` | Optional | Python AMF Control API | No | `8000` |
| `AMF_RUNTIME_API_URL` | Optional | Python AMF Control API proxy | No | `http://127.0.0.1:8080` |
| `APP_ENV`, `LOG_LEVEL`, `MEDIA_OUTPUT_DIR` | Optional | Python settings | No | `development`, `info`, `./output` |

**Naming inconsistency:** `.env.example` documents `API_HOST` / `API_PORT` for `apps/api`, but the Node runtime server reads `HOST` / `PORT`. `API_HOST` / `API_PORT` are read by the Python AMF Control API.

### Governed text providers

| Name | Required | Used by | Secret | Default / meaning |
| --- | --- | --- | --- | --- |
| `TEXT_AGENT_PROVIDER` | Required for a live Command Room route unless a scoped override supplies provider | Worker runtime | No | No default. Supported values: `agentrouter`, `openrouter` |
| `AGENT_ROUTER_DEFAULT_MODEL` | Optional | Command runtime model fallback | No | `gpt-5.6-sol` in command worker resolution |
| `OPENROUTER_API_KEY` | Required for OpenRouter | Worker + provider discovery | Yes | None |
| `OPENROUTER_DEFAULT_MODEL` | Required for an explicit OpenRouter route unless supplied by override | Worker | No | `openai/gpt-oss-20b:free` in production executor; command runtime itself requires a resolved model |
| `OPENROUTER_FALLBACK_MODEL` | Optional configuration listing only | Node control configuration validation | No | None |
| `OPENROUTER_BASE_URL`, `OPENROUTER_REFERER`, `OPENROUTER_TITLE`, `OPENROUTER_TIMEOUT_MS` | Optional | OpenRouter transport | `BASE_URL` no; others no | API base `https://openrouter.ai/api/v1`; timeout `180000` ms |
| `OPENAI_API_KEY` | Required for AgentRouter OpenAI-compatible route | AgentRouter transport and control route availability | Yes | None |
| `ANTHROPIC_AUTH_TOKEN` | Required for AgentRouter control route availability | AgentRouter transport and control route availability | Yes | None |
| `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL` | Optional | AgentRouter transport | No | `https://api.openai.com/v1`, `https://api.anthropic.com` |
| `AGENT_ROUTER_TIMEOUT_MS`, `AGENTROUTER_CANARY_PROTOCOL` | Optional | AgentRouter transport | No | timeout `180000` ms |

The control configuration API accepts `provider` values `agentrouter` and `openrouter`. Project/agent configuration can override provider and model; resolution is global → project (`*`) → agent. An explicit unavailable route fails closed.

## Database checklist

Use distinct databases, for example:

```powershell
$env:DATABASE_URL = 'postgresql://postgres@127.0.0.1:5432/ai_media_factory'
$env:TEST_DATABASE_URL = 'postgresql://postgres@127.0.0.1:5432/ai_media_factory_test'
```

Do not set the two values equal. PostgreSQL test helpers reject that condition before their destructive cleanup.

The Node API and worker run `migrate(pool)` automatically. The schema includes workflow state, artifacts, capability evidence, `execution_provenance`, `workflow_submissions`, `workflow_jobs`, `control_commands`, `control_approvals`, and `control_configuration_events`.

Safe read-only checks:

```powershell
psql "$env:DATABASE_URL" -c 'SELECT 1;'
psql "$env:DATABASE_URL" -c "SELECT to_regclass('public.control_commands'), to_regclass('public.workflow_jobs'), to_regclass('public.execution_provenance');"
```

Run any `TEST_DATABASE_URL` tests only after confirming its database name and isolation. Do not run test suites against the local production/owner database.

## Recommended first provider

`RECOMMENDED_TEST_PROVIDER = AgentRouter`

Why: the worker has direct governed AgentRouter transport, visible-output extraction, bounded timeout, and existing AgentRouter route tests. It does not alter global routing if set only in the PowerShell session.

Required environment: `TEXT_AGENT_PROVIDER=agentrouter`, `OPENAI_API_KEY`, `ANTHROPIC_AUTH_TOKEN`; set `AGENT_ROUTER_DEFAULT_MODEL` if the owner wants a model other than the runtime fallback. The repository fallback is `gpt-5.6-sol`; the owner must verify it is authorized for their route before testing. Do not infer account availability from this checklist.

## Build and startup (three terminals)

From repository root `D:\AIWorkspace\AI-Media-Factory`:

```powershell
# First-time dependency install only when node_modules is absent or incomplete.
npm install

# Type checks; safe and does not write dist.
npm run lint --workspace=apps/api --if-present
npm run lint --workspace=apps/worker --if-present
npm run lint --workspace=packages/database --if-present

# Build commands write each package's dist directory.
npm run build --workspace=packages/database
npm run build --workspace=apps/api
npm run build --workspace=apps/worker
```

Terminal 1 — Node runtime API:

```powershell
node apps/api/dist/server.js
```

Terminal 2 — worker:

```powershell
node apps/worker/dist/cli.js
```

Terminal 3 — AMF Control Python API/UI (use the project virtual environment if present):

```powershell
apps/api/apps/api/.venv/Scripts/python.exe -m uvicorn ai_media_factory.main:app --app-dir apps/api/src --reload
```

Python tests use the package definition in `apps/api/pyproject.toml`; when its virtual environment is active, run `python -m pytest apps/api/tests`. Node package tests are `npm test --workspace=apps/api`, `npm test --workspace=apps/worker`, and `npm test --workspace=packages/database`. The worker E2E commands are `npm run e2e --workspace=apps/worker` and `npm run e2e:failures --workspace=apps/worker`; they require explicitly isolated test infrastructure and should not be the first owner validation.

## Startup and health order

1. Start PostgreSQL and set `DATABASE_URL` in each required PowerShell session.
2. Confirm the read-only PostgreSQL checks above. Set a distinct `TEST_DATABASE_URL` only for tests.
3. Build Node packages, then start the Node runtime API. Its startup runs idempotent migrations.
4. Check runtime API without submitting work: `Invoke-RestMethod http://127.0.0.1:8080/control/providers`.
5. Start the worker. Confirm its `worker: polling ...` log.
6. Start the Python AMF Control API/UI. Check `Invoke-RestMethod http://127.0.0.1:8000/health` and open `http://127.0.0.1:8000/`.
7. Configure a provider only in the active PowerShell session, then perform the two owner tests below.

The Node runtime has no dedicated health endpoint. Its safe health check is `GET /control/providers`; queue observation is `GET /workflows/{workflowId}` after a submitted command.

## Owner live validation

### Test 1 — direct ask

In Command Room select project `Morroway`, mode `ASK_AGENT`, and agent `Research`. Submit:

> Give one concise historical POV content idea for Morroway and explain why it is worth testing.

Record the returned `commandId` and `workflowId`. Verify command history using `GET /control/commands?projectId=morroway`, report artifacts with `GET /control/reports?projectId=morroway`, and telemetry with `GET /control/telemetry?projectId=morroway`. Expected evidence: command status, visible result, artifact reference, execution ID/provenance, provider, requested/actual model, timestamps, and cost metadata (`UNKNOWN` is valid where provider cost is not reported).

### Test 2 — multi-agent review

Select `MULTI_AGENT_REVIEW`, `Research` and `Planner`, then submit:

> Propose one Historical POV idea for Morroway and evaluate why it is worth testing.

Verify two independently persisted visible outputs, then the CEO synthesis. The persisted synthesis must include `agreements`, `disagreements`, `evidence`, `recommendation`, `confidence`, `missingEvidence`, and `nextAction`; it must have its own artifact/provenance record. Check the same commands, reports, and telemetry endpoints as Test 1.

## Bounded override test

Use `POST /control/configuration` with the existing UI/API governance path. Use a configured provider/model only. Each request requires `projectId`, `scope` (`PROJECT` or `AGENT`), `action` (`SET` or `RESET`), and `rationale`; `AGENT` also requires `agentId`. `SET` requires `provider` and `model`.

1. Inspect `GET /control/configuration?projectId=morroway`: expected source `GLOBAL` / inherited state.
2. Set an allowed project model; inspect again: expected source `PROJECT`.
3. Set an allowed Research-agent model; inspect with `agentId=research`: expected source `AGENT`.
4. Reset the agent setting; expected inherited project effective provider/model/source.
5. Reset the project setting; expected global/inherited effective provider/model/source.

Use a non-production project/test record if available. Do not submit a provider call merely to validate a reset; the configuration response itself exposes effective configuration. If two authorized provider routes exist, repeat with a scoped provider override. Reset all test overrides afterward.

## Windows notes and concise troubleshooting

- Set session-only variables with `$env:NAME = 'value'`; do not add keys to source or commit `.env`.
- Check port conflicts with `Get-NetTCPConnection -LocalPort 8000,8080 -ErrorAction SilentlyContinue`.
- If Node build reports `EPERM` for `apps/worker/dist`, inspect safely: `Get-Item apps/worker/dist | Format-List FullName,Attributes,Mode` and `Get-Acl apps/worker/dist`. Confirm no worker/API process is holding generated files, then build from a normal local checkout where the owner has Modify permission. Do not change ACLs recursively or delete `dist` as a workaround.
- Database failure: confirm `DATABASE_URL`, PostgreSQL service, and `psql "$env:DATABASE_URL" -c 'SELECT 1;'`.
- Worker stuck / Command Room queued: confirm worker log, `GET /workflows/{workflowId}`, and rows in `workflow_jobs`; do not manually alter queue rows.
- Provider unavailable/invalid model: check only presence of required variables and `GET /control/providers`; use a configured model accepted by the control configuration endpoint.
- Synthesis failure: inspect command `visibleResult`, synthesis status, reports, and telemetry. It intentionally refuses synthesis without validated visible outputs.

## Manual pass checklist

- [ ] PostgreSQL reachable
- [ ] Test DB isolated
- [ ] Node runtime API started
- [ ] Worker started
- [ ] AMF Control loads
- [ ] Provider configured
- [ ] Single-agent ASK passes
- [ ] Command persisted
- [ ] Agent telemetry visible
- [ ] Multi-agent execution passes
- [ ] Synthesis persists
- [ ] Config override verified and reset
- [ ] No secret exposed
- [ ] No OpenCode required for operational execution
