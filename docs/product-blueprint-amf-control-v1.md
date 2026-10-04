# AMF Control Platform — Product Blueprint V1

## Purpose

AMF Control is the business operating surface for AI Media Factory. It lets the
owner see projects, agent work, evidence, approvals, cost and blockers without
exposing engineering runtimes such as OpenCode, Codex, or workers.

## Product model

Two levels are deliberately separate:

1. **AMF level** — project portfolio, global provider/model policy, platform
   health and cost visibility.
2. **Project level** — a consumer brand's workflow, artifacts, approvals,
   agents, reports and assets. Project theming is restrained and never changes
   the platform's operational language.

## Primary owner flow

`Project Hub → select project → Dashboard → inspect work / decide → approval
or iteration → reports and provenance`.

The Command Room is a governed intake surface. It selects an audience, captures
the owner request and available project context, then returns a structured
proposal or real orchestrator result. It never presents generated text as an
agent response unless a bound orchestrator run supplied it.

## V1 information architecture

### AMF level

- Project Hub (first launch)
- Global System: provider/model policy, health and costs

### Project level

- Dashboard
- Content Pipeline and Content Workspace
- Agents (status, recent evidence, provider/model inheritance and governed
  override request)
- Command Room
- Approval Center
- Reports & Intelligence
- Analytics shell
- Assets
- Project Settings

## Core governance rules

- Source data is labelled as recorded, inferred, unavailable or pending.
- Provider/model precedence is **Global Default → Project Override → Agent
  Override**. V1 only creates a reviewable change request; it cannot alter a
  runtime default.
- Owner actions retain both the original recommendation and the later owner
  decision with a timestamp and rationale.
- Confidence, evidence, cost and blockers remain visible. Technical provenance
  is available on demand, not in the default operational view.
- No publishing, account creation, domain registration or paid action is
  available from this surface.

## MVP implementation phases

1. **Foundation**: read-only AMF API projection from repository artifacts;
   Project Hub and project shell.
2. **Operating visibility**: dashboard, pipeline/workspace, agents, reports,
   assets, analytics and settings views.
3. **Governed actions**: command intake, approval decisions and override
   requests, all explicitly non-dispatching until an orchestrator binding is
   configured.
4. **Verification**: API tests, web build/type checks, browser QA and owner
   review report.

## Operational integration V1

The control UI is a read/write operating surface over the existing Node API,
Postgres queue and worker. The Python UI API proxies business requests to the
runtime API configured by `AMF_RUNTIME_API_URL` (default
`http://127.0.0.1:8080`). It never calls model providers directly and never
returns provider credentials.

The runtime API owns durable `control_approvals` and `control_commands` records
alongside the existing workflow tables. A Command Room submission writes its
owner-visible request and context, then queues a canonical governed workflow;
the worker receives the sanitized context as the workflow trigger.

To run the three local processes, set a valid `DATABASE_URL` for the Node API
and worker (and use `TEST_DATABASE_URL` for integration tests), then start:

```powershell
# terminal 1, repository root
npm run build --workspace @ai-media-factory/database
npm run build --workspace @ai-media-factory/api
npm run build --workspace @ai-media-factory/worker
node apps/api/dist/server.js

# terminal 2, repository root
node apps/worker/dist/cli.js

# terminal 3, repository root
apps/api/apps/api/.venv/Scripts/python.exe -m uvicorn ai_media_factory.main:app --app-dir apps/api/src --reload
```

The current canonical workflow templates support governed `plan`, `research`,
`implement`, `verify`, `ship` and `produce` directives. Target selection is
persisted with a command but is not yet a runtime stage filter; the template
remains the authority for eligible execution stages.

## Visual direction

Dark, calm and high-density: graphite surfaces, sharp editorial typography,
thin cobalt signal lines for AMF and a muted wine accent for Morroway. The
screen should feel like an operations room, not developer tooling.
