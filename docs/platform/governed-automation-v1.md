# Program 6 — Governed Automation V1 (canonical)

**Status:** CLOSED / PASS (2026-09-24; isolated TEST DB; zero provider calls).
**Target:** L2 GOVERNED AUTOMATION. L3/L4 deferred and rejected in code.
**Principle:** Automation != Authority. The system may detect, queue, prepare,
route, execute already-authorized reversible work, observe, measure, evaluate,
recommend, and resume. It may NOT infer authority, convert readiness into
approval, publish, spend, or start governed work without explicit policy +
Owner authorization.

## 1. Domain audit (Workstream A) — what existed vs what was built

| Capability | Pre-Program 6 state | Program 6 disposition |
|---|---|---|
| Workflow engine (branches, retry, DLQ, audit) | IMPLEMENTED (workflow-engine) | REUSED, not duplicated |
| Durable queue + worker + idempotency | IMPLEMENTED (PostgresQueue, media claims) | REUSED; automation never writes workflow_jobs |
| Approvals / Decision Center | PROVEN_LIVE (control_approvals) | REUSED as sole decision truth |
| Human gates (pre_production, visual) | IMPLEMENTED (human_gate_settings) | REUSED; automation parks + resumes around them |
| Learning loop (observation→proposal) | IMPLEMENTED to Owner boundary, no auto-start | REUSED; automation progresses internal chain steps only |
| Channel registry + credential bindings | IMPLEMENTED (Program 5) | REUSED for isolation checks |
| Project registry | IMPLEMENTED | REUSED for scope enforcement |
| Cost summaries (UNKNOWN-preserving) | IMPLEMENTED, no budgets | EXTENDED with count-based hard budgets |
| Scheduler / triggers / policies / starter | MISSING (audit: SCAFFOLD_ONLY / DEFERRED) | BUILT (this program, additive tables only) |
| Automation UI / attention / dry-run | MISSING | BUILT (Automation view + BFF proxies) |

No parallel workflow/approval/artifact/learning/analytics/queue/audit system
was created. New canonical entities: `automation_policies`,
`automation_call_budgets`, `automation_jobs`, `automation_events`,
`automation_attention` (see §3).

## 2. Automation policy model (Workstream B)

One row per project in `automation_policies` (`packages/database/src/automation.ts`:
`AutomationStore.getPolicy/setPolicy`, `normalizePolicyInput`):

- `enabled` (default false), `level` L0_MANUAL / L1_ASSISTED / L2_GOVERNED
  (L3/L4 throw `AUTOMATION_LEVEL_DEFERRED`).
- `allowedOps` / `humanGatedOps` (operation classes, §4).
- `providerPolicy` DENY_ALL / ALLOW_INTERNAL_ONLY / ALLOW_LISTED.
- `publicationPolicy` PREPARE_ONLY / OWNER_APPROVAL_REQUIRED /
  PREAUTHORIZED_PRIVATE_VALIDATION / PREAUTHORIZED_DESTINATION_SCOPE
  (execution still never automatic — §8).
- `nextCyclePolicy` OWNER_START_ONLY (default) /
  AUTO_START_AFTER_OWNER_APPROVAL / L2_PREAUTHORIZED_INTERNAL_CYCLE.
- Fail-closed: no policy row == DISABLED. Migration creates no rows, so no
  existing project (including Morroway) becomes automated.

## 3. Schema (additive only)

`packages/database/src/schema.ts` (Program 6 block): the five tables above.
`UNIQUE(automation_jobs.idempotency_key)` is the concurrency boundary;
`automation_events` is append-only; `automation_attention` resolves only
explicitly (plus resume-driven resolution of its own gate items, audited).

## 4. Eligibility engine (Workstream C)

`evaluateActionEligibility(policy, operation, evidence)` — deterministic, no
LLM, no I/O. Accumulates every applicable reason; verdict priority: scope
violations (BLOCKED) > BLOCKED > REQUIRES_OWNER_DECISION > WAITING >
NOT_APPLICABLE (disabled / L0) > ELIGIBLE. Operation classes:
`internal.prepare/plan`, `workflow.start.internal/resume/retry.bounded`,
`analytics.schedule/measure`, `learning.evaluate/recommend/propose`,
`provider.*` (7 kinds), `publication.prepare/execute`, `nextcycle.evaluate/
start.internal`. Publication execution is always BLOCKED
(`AUTOMATIC_PUBLICATION_NOT_ENABLED`); readiness is never authority.

## 5. Governed starter (Workstream D)

`AutomationStore.evaluateNextCycleProposal/startNextCycle` consume canonical
`next_cycle_proposals`. Pre-start checks: known proposal, same-project
approval, no conflicting active run (idempotency `nextcycle-<proposalId>`),
policy level/gates, next-cycle approval state, inputs. Non-eligible proposals
record `nextcycle.evaluated` and raise `READY_FOR_OWNER_START` instead of
starting. Eligible starts schedule + complete a provider-free internal cycle
record — never a provider call, never a publication.

## 6. Continuous loop, triggers, scheduler (Workstreams E/F/G)

`tick(projectId, {maxActions})`: bounded (≤25, default 5), non-recursive —
resume-after-decision scan → claim due jobs (atomic `FOR UPDATE SKIP LOCKED`)
→ decision-aware execution (internal only; provider-bound parked) → proposal
availability scan. Every step audited (`tick.started/completed`,
`job.succeeded/awaiting_owner/retry_scheduled/dead_letter/parked`,
`gate.resumed/settled_rejected`, `nextcycle.evaluated/started`).
Triggers (`recordTrigger`): state_transition, decision_resolved,
scheduled_due, analytics_available, workflow_completed,
failure_recovery_eligible, proposal_available — recorded as events, consumed
by ticks; no blind table polling. Scheduler job types: eligible_work_
evaluation, scheduled_analytics_measurement, content_planning_checkpoint,
workflow_resume, learning_evaluation, health_recovery_check,
next_cycle_evaluation, next_cycle_execution — internal platform jobs only.

## 7. Content pipeline, gates, publication (Workstreams H/I/J)

Internal prep/checkpoint/resume jobs progress automatically under L2 where
allowed; Owner approval gates stay gates (parked jobs raise
`DECISION_REQUIRED`; post-APPROVE ticks resume without Owner
reconstruction; REJECT settles without continuation). Publication:
`publication.prepare` may progress; `publication.execute` is always BLOCKED
in Program 6. General public publishing NOT_GRANTED, unchanged.

## 8. Budgets, retry, dead-letter, recovery, concurrency (Workstreams K–P)

- Count-based hard budgets per project+kind (`automation_call_budgets`);
  monetary price stays UNKNOWN. `checkCallBudget` before, atomic
  `consumeCallBudget` after (concurrent double-spend fails closed, 0 rows).
  Missing/exhausted budget BLOCKS provider actions.
- Failure classes RETRYABLE / NON_RETRYABLE / REQUIRES_OWNER /
  REQUIRES_CONFIGURATION / REQUIRES_CREDENTIAL / PERMANENT
  (`classifyFailure`); only RETRYABLE retries, bounded by per-job
  maxAttempts with deterministic backoff (60s·2^attempt, ≤1h). Terminal
  failures enter DEAD_LETTER + deterministic attention (no LLM sentiment).
- Restart recovery (`recoverAfterRestart`): CLAIMED/RUNNING → schedulable
  pool; SUCCEEDED/DEAD_LETTER/CANCELLED untouched (proven, NEG M).
- Concurrency: idempotent schedule/starter (`ON CONFLICT DO NOTHING` +
  cross-project idempotency denial), atomic claim, terminal rows never
  re-transitioned.

## 9. Isolation, agents, analytics, learning, next-cycle (Workstreams Q–V)

- Project isolation: every method scopes by project_id; cross-project
  proposal/channel/observation/starter use fails closed (proven NEG D/E,
  API isolation test). Channel destination must be explicit, known,
  same-project, verified (schedule requires known+same-project).
- Agent contract (`validateAgentAutomationContract`): recommendation is
  advisory; execution needs ELIGIBLE + structured DECIDED/APPROVE for
  authority-bearing claims; output text alone → BLOCKED
  (`AGENT_OUTPUT_CANNOT_GRANT_AUTHORITY`).
- Analytics scheduling: `scheduleAnalyticsMeasurement` validates channel
  scope, creates the job, raises MEASUREMENT_PENDING. Live reads are
  deferred in Program 6 — due measurement jobs park with
  `LIVE_MEASUREMENT_DEFERRED` (M4 untouched, 0 calls consumed).
- Learning automation: `progressLearningChain` walks
  observation→learning→recommendation→proposal through canonical
  `LearningLoopStore` (deterministic IDs → idempotent re-runs), each step
  gated by its operation class; proposal still awaits the governed starter.
- Next-cycle default OWNER_START_ONLY; higher modes opt-in per project,
  never enabled for Morroway by this program.

## 10. Observability, controls, attention, audit, dry-run (Workstreams W–Z)

- Node endpoints `/control/automation/*` (policy, status, overview, jobs,
  events, attention, budgets, explain, tick, triggers, proposals,
  analytics/measurements, learning/chain, recover) —
  `apps/api/src/automation-api.ts`, wired in `handler.ts`/`server.ts`
  (Owner-gated POSTs via existing `requireOwner`).
- Python BFF `/api/automation/*` + runtime resources `automation-*`
  (`ai_media_factory/main.py`).
- Owner UI Automation view (`static/app.js`): status, needs-me, scheduled/
  waiting, dry-run preview + bounded step, budgets, controls
  (OFF/ON, Manual/Assisted/Governed, next-cycle + publication behavior,
  advanced op-class/budget editors), platform overview, history — business
  language; queue IDs/cron/worker internals never primary.
- Attention kinds: DECISION_REQUIRED, CREDENTIAL_REQUIRED,
  CONFIGURATION_REQUIRED, BUDGET_BLOCKED, FAILED, MEASUREMENT_PENDING,
  READY_FOR_OWNER_START. Automation state machine:
  DISABLED/IDLE/EVALUATING/RUNNING/WAITING/WAITING_FOR_OWNER/SCHEDULED/
  BLOCKED/FAILED/COMPLETED (derived summary; workflow lifecycle untouched).
- Audit: every automatic action records WHAT/WHY/policy/authority/budget/
  result in `automation_events`. Dry-run `explain()` returns ordered
  eligible/waiting/requires-owner/blocked lists and executes nothing.

## 11. Proof (isolated TEST DB, provider-free)

- `packages/database/test/automation-governed.test.js` — 34/34 PASS:
  negative matrix A–T, positive matrix A–L, agent separation, L3/L4
  rejection, dry-run purity, full L2 loop on fixture project
  `AMF Automation Test Studio` (policy→work→gate→stop→canonical Owner
  decision→resume→completion→STUBBED observation→learning→recommendation→
  proposal→starter→Owner boundary), Morroway-still-manual.
- `apps/api/test/automation-api.test.js` — 7/7 PASS (contract, starter
  boundary, budget/channel guards, isolation, auth, control-plane parity).
- `apps/api/test/automation-ui.test.js` — 4/4 PASS; `apps/api/tests/
  test_automation_facade.py` — syntax/AST-verified (no Python runtime with
  fastapi/pytest in this environment; follows the mocked pattern of
  `test_project_registry.py`).
- Full `packages/database` suite 214/214 PASS; `apps/api` suite 153/157
  (4 PRE_EXISTING failures in `hub-dashboard.test.js`: the dashboard eval
  harness predates Program 5's `loadDashboardChannels` — `ReferenceError`,
  untouched by Program 6); workflow-engine 7/7; provider-adapters
  analytics-freeze + boundary spot checks PASS.
- Budgets: REAL_PROVIDER_CALLS=0, YOUTUBE=0, LIVE_ANALYTICS=0 (M4 untouched,
  0 consumed), LLM=0, IMAGE=0, VIDEO=0, UPLOADS=0, PUBLICATION_SIDE_EFFECTS=0.
- Authority unchanged: PRODUCTION NOT_GRANTED, GENERAL_PUBLICATION
  NOT_GRANTED, PUBLIC_STATUS NOT_PUBLISHED. Morroway: no policy row,
  ACTIVE/pinned behavior untouched, automation OFF.

## 12. Result ledger

IMPLEMENTED+PROVEN: policy model, levels, eligibility, starter, loop, triggers,
scheduler foundation, pipeline automation (internal), gate pause+resume,
publication boundary, budgets + enforcement, retry, dead-letter/attention,
recovery, concurrency, project/channel isolation, agent separation, analytics
scheduling (fixture-only), learning automation, next-cycle policy+starter,
observability, Owner controls, platform overview, attention, audit, dry-run,
provider-free L2 proof, Morroway compatibility, docs.
UNPROVEN (env): Python facade tests (no fastapi/pytest runtime here).
DEFERRED_BY_DESIGN: L3/L4, automatic (public) publishing, live analytics
measurement execution, provider-capable auto-dispatch via workflow_jobs,
tool-framework build-hygiene fix, hub-dashboard harness update.

## 13. Post-acceptance remediation (append-only, 2026-09-24)

Program 6 remains CLOSED / PASS. After acceptance, an Owner UI parse-time
regression was found and fixed; after that remediation passed, live Owner
verification found the supervised Node listener predated the Program 6 route
build, causing all Automation reads to return 404. The controlled runtime was
rebuilt/restarted, the registered-project default OFF/L0 overview gap was
fixed, and every read/mutation/auth boundary was re-proven. The previously
deferred `loadDashboardChannels` harness debt is resolved. Current proof:
API 158/158, database 222/222, Python auth/facade 10/10, live served bundle
equals source, Morroway OFF/L0, zero provider/M4 calls. Full record:
`amf-owner-access-automation-remediation-v1.md`.
BLOCKING: none. NON_BLOCKING: hub-dashboard harness (pre-existing),
tool-framework `dist`-in-`src` TS5055 build hygiene (pre-existing).
TECHNICAL_DEBT: none new (automation tables intentionally separate from
workflow_jobs to avoid provider-capable side effects).
