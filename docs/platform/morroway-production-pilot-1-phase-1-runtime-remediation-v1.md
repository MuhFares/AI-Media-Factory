# Morroway Production Pilot 1 — Phase 1 Runtime Remediation V1

Date: 2026-09-25  
Program result: **PASS (provider-free runtime remediation)**

## Preserved history

The first real Phase-1 pilot remains `FAIL-CLOSED BEFORE PROVIDER EXECUTION`.
That preflight correctly found legacy routing, media-coupled readiness, missing
project context, an unbounded workflow, deterministic Research/Planner bypass,
and no ordinary per-call spend reservation. It made zero provider calls and is
not rewritten by this program.

## Bounded phase contract

`produce-pre-media` is a canonical directive in the existing workflow engine.
Its finite sequence is:

`Orchestrator → Research retrieval/synthesis → CEO recommendation → Planner
brief → Hooks → Writer → Director scenes → Visual Director prompts → Review →
QA → owner-pre-media-gate`.

The terminal gate is `OWNER_PRE_MEDIA_REVIEW_REQUIRED`. Reaching it is a
successful Phase-1 boundary, not a failure. The definition contains no image,
video, voice, composition, upload, publication, analytics, or M4 stage.

## Runtime integration

- Content start persists `projectId`, `contentId`, `productionPhase`, the brief,
  Phase-1 authority, and explicit `mediaAuthority=NOT_GRANTED` and
  `publicationAuthority=NOT_GRANTED` in the durable submission context.
- Phase-1 preflight resolves all ten model-backed roles from active project
  routing. It does not consult legacy ControlPlane/environment routes for
  Morroway and does not inspect media readiness.
- The production executor resolves each role through
  `ProductionModelRoutingStore` before provider selection. Missing/invalid
  canonical routing fails closed.
- Governed Research keeps retrieval and synthesis separate. The Research Agent
  executes configured search through the capability boundary, persists source
  evidence, then uses the routed Research synthesis model.
- Planner and the other Phase-1 text roles no longer use deterministic legacy
  paths when a canonical route is present.

## Cost and resume contract

Two additive tables persist Phase-1 call budgets and reservations. Morroway is
configured for one Research retrieval and ten text-agent calls, zero retries.
Each billable call reserves atomically before transport using a stable
workflow/stage/call-kind idempotency key. Reservations reconcile to consumed,
failed-after-submission, or released-before-submission. Provider-billed cost is
`UNKNOWN` unless provider evidence supplies it; it is never fabricated as zero.

Successful workflow steps remain checkpointed by the existing engine. A later
failure therefore resumes after completed Research instead of repeating it.
Terminal/ambiguous call identities cannot silently execute twice.

## Owner product

Content detail now shows a compact Phase-1 preflight, canonical routes, hard
budgets, durable reservation/cost evidence, all persisted artifacts, and a
prominent `PRE-MEDIA REVIEW REQUIRED` state. The Owner gate creates one durable
Decision Center approval. Approval cannot start media because the bounded
definition has no downstream media step.

## Proof summary

- TypeScript builds passed for shared, database, orchestrator, worker, and API.
- Node syntax validation passed for the actual Owner `app.js` source.
- Provider-free real executor-boundary proof resolved exactly:
  Orchestrator/GPT-OSS, Research/GPT-6 Luna, CEO/GPT-6 Luna,
  Planner/GPT-OSS, Hooks/GLM-5.3 Flash, Writer/Ling 3.0 Flash,
  Director/Ling, Visual Director/Ling, Review/GPT-OSS, QA/GPT-OSS.
- The compiled workflow ends at `owner-pre-media-gate` and contains zero media
  or publication agents.
- Isolated Postgres concurrency proof passed: two simultaneous reservations
  against a one-call limit yielded exactly one reservation, reconciliation
  consumed exactly one call, and duplicate execution was blocked.
- Isolated Owner/API proof passed: the durable submission contains Morroway
  project context, Phase-1 authority, media denial, bounded definition, and
  idempotent content binding.
- Owner UI, bundle syntax, auth/session facade, and production-enablement facade
  focused regressions passed.

No real LLM, search, image, video, voice, upload, publication, analytics, or M4
call occurred. The real pilot remains not started and requires a new Owner
authorization to rerun Phase 1.

