# Control Platform Owner Experience V1.1 — LIVING TRACKER

This file IS mutable. The frozen audit (`control-platform-owner-ux-audit-v1.md`) is NOT — never edit it to track fixes.

CONTROL_PLATFORM_OWNER_EXPERIENCE_V1_1 = CLOSED (Slices 1-10 CLOSED per acceptance; Slice 11 full Owner regression PASS 2026-09-22 with zero regressions; V1_1_OWNER_FINAL_ACCEPTANCE = PASS. Known intentionally unresolved: UX-CMD-005 DEFERRED, UX-AGENT-004 BLOCKED_EXTERNAL_DECISION. DB-backed suites were BLOCKED_BY_ENVIRONMENT, not substituted with production DB.)

## Slice 3 Owner manual acceptance — INITIAL (remediation pending, no mutations made)

SLICE_3_ENGINEERING_VERIFICATION = PASS (preserved).
SLICE_3_OWNER_MANUAL_ACCEPTANCE_INITIAL = CONDITIONAL / NOT_YET_PASS.
Rendered Approval Center exposed legacy/raw approval surface and presented the canonically SUPERSEDED PENDING gate as actionable. Backend actionability classification stands; the defect is in the rendered Owner surface, not the read model.

### UX-APPR-004 | Approval | P0 | VERIFIED (remediation 2026-09-19)
Observed: Owner-visible Approval Center could present raw approval rows including a SUPERSEDED PENDING gate with live decision controls (root causes proven: (1) decision-detail rendered mutation buttons for every non-DECIDED record — `?actionRow:actionRow` no-op branch; (2) served bundle lagged repo with no cache-busting, so stale JS could masquerade as current UI). Desired state achieved: Decision Center renders from actionability truth (Needs 0 / No-action superseded-with-reason / History); SUPERSEDED/HISTORICAL/CONFLICTED detail shows zero mutation buttons including via direct navigation; versioned bundle URL (`/static/app.js?v=<sha12>`) pinned by index. Governance: Morroway rows immutable (8 DECIDED + 1 PENDING verified unchanged); fail closed. Tests: decision-queue API 4/4; browser 24/24 (incl. direct-gate zero-button asserts, versioned-bundle asserts, isolated mutating journey); control 35/35 + strat 26/26 regressions; pytest 3/3. External calls: 0. Completed 2026-09-19.
OWNER_UX_AUDIT_CAPTURED = YES
IMPLEMENTATION_STARTED = YES (2026-09-19, Slice 1 Strategy Owner Review Journey: 4/4 P0 VERIFIED, 0 external calls)

Statuses: OPEN → IN_PROGRESS → IMPLEMENTED → VERIFIED (plus DEFERRED, WONT_FIX). IMPLEMENTED ≠ VERIFIED; VERIFIED requires tests + browser QA + regression. Never rewrite the frozen audit. For each VERIFIED item record: change scope, files, API/unit/integration tests, browser assertions, regression result, evidence, external-call count, governance-invariant result.

Priorities: P0 = core action impossible/ambiguous without technical knowledge (8). P1 = important operability (17). P2 = polish (2).

## Findings

### UX-HUB-001 | Hub | P1 | VERIFIED (Slice 8; Slice 11 walkthrough 2026-09-22)
Observed: QA fixtures (`strat-qa-…`) listed as normal Active Projects. Now: business project cards (name, workflow count, latest-state chip); fixture namespaces (`strat-qa-*`, `test-*`, `*-test`) filtered by default with audit toggle; no pending-approval counts on cards. Tests: hub-dashboard 6/6 incl. fixture filtering. Evidence: Slice 11 walkthrough 2026-09-22 (focused suites + live read-only checks, zero regressions); Owner final acceptance pending.

### UX-DASH-001 | Dashboard | P1 | VERIFIED (Slice 8; Slice 11 walkthrough 2026-09-22)
Observed: trustworthy data, not action-oriented; IDs primary. Now: Current state (strategy readiness, pipeline latest, operational authority), Owner attention from Decision Center truth with explicit zero state, current/recent work separated from history, recent outputs with business categories, deterministic next-step derivation (decision/monitor/inspect/workspace, never inferring authority), drill-down nav, Advanced identifiers. Backend: existing aggregates reused, no new endpoints. Tests: hub-dashboard 6/6. Evidence: Slice 11 walkthrough 2026-09-22 (focused suites + live read-only checks, zero regressions); Owner final acceptance pending.

### UX-PIPE-001 | Pipeline | P1 | VERIFIED (Slice 2, 2026-09-19)
Evidence: pipeline list rebuilt as Owner cards (business title, status chip, phase progress, attention, last milestone, production/publication badges; IDs secondary); workflow detail with Summary/Journey/Owner action/Outputs/Authority/Issues/Advanced hierarchy. Files: `static/app.js` (pipeline/detail views), `main.py` (`/api/lifecycle*`), `handler.ts` + `server.ts` (lifecycle routes/wiring), `database/src/lifecycle.ts` (new read model). Tests: 16 unit + 3 API + browser detail asserts. Regression: control 34/34, strat 26/26. External calls: 0. Completed 2026-09-19.
Observed: workflow DB viewer. Desired: lifecycle visualization (Idea→…→Published). Backend: workflow/step/artifact truth exists. Governance: no status falsification. Tests: browser. Evidence: pending.

### UX-PIPE-002 | Pipeline | P0 | VERIFIED (Slice 2, 2026-09-19)
Evidence: canonical lifecycle resolver (completed-artifact/approval precedence over stale rows; terminal-kind + all-required evidence rules; conflict fail-closed; secret redaction in blocker text). Morroway resolves NEEDS_OWNER_ATTENTION with 10/10 milestones, 22 superseded/0 unresolved, authorities separated — stale pending/failed rows no longer present as current truth, history immutable. Tests: matrix 1–20 unit + Morroway live read-only check. Completed 2026-09-19.
Observed: canonical path indistinguishable from failed/superseded/validation-only branches (video/WAN pending/failed alongside canonical final media). Desired: explicit canonical-vs-historical representation. Governance: historical statuses immutable. Tests: API + browser. Evidence: pending.

### UX-AGENT-001 | Agents | P0 | VERIFIED (Slice 4, 2026-09-19)
Evidence: rationale mandatory inline (no alert), double-confirm modals stating effects/non-effects/authority, empty-rationale and invalid-model paths fail closed with inline errors and zero mutation. Tests: API rejection + browser modal/validation asserts. External calls: 0. Completed 2026-09-19.
Observed: `alert("Rationale required")` on config override. Desired: inline validation + confirmation modal. Governance: rationale still mandatory. Tests: browser. Evidence: pending.

### UX-AGENT-002 | Agents | P1 | VERIFIED (Slice 4, 2026-09-19)
Evidence: team cards + agent detail with business names/roles, friendly providers, canonical model ids, inheritance explanations, human timestamps, owner-language runs; raw IDs/JSON/provenance confined to Advanced. Tests: API roster asserts + browser asserts. Completed 2026-09-19.
Observed: raw config JSON, dense tech repr. Desired: business-readable rendering; raw under Advanced. Tests: browser. Evidence: pending.

### UX-AGENT-003 | Agents | P0 | VERIFIED (Slice 4, 2026-09-19)
Evidence: canonical `/control/agents` read model (roster × telemetry × config × outputs; deterministic IDLE/NEEDS_ATTENTION, never fake WORKING); detail with current work (truthful empty), recent work, outputs with direct View, performance without scores, UNKNOWN costs, current-vs-history issues, config history, availability honesty. Tests: API 3/3 + browser 24/24. Completed 2026-09-19.
Observed: no business agent cards / safe editor. Desired: cards (provider, model, source, strategic context, runs, costs) + safe editor with rationale/confirm. Governance: canonical config persistence, no silent changes, no execution on config change. Tests: API + browser. Evidence: pending.

### UX-CMD-001 | Command | P1 | SUPERSEDED (canonical: VERIFIED Slice 5)
Observed: API-console UX (raw op names, multi-select, IDs primary). Desired: Owner-instruction-first flow. Governance: governed runtime untouched. Tests: browser. Evidence: pending.

### UX-CMD-002 | Command | P1 | SUPERSEDED (canonical: VERIFIED Slice 5)
Observed: no execution preview. Desired: human modes + preview (agents, provider/model, strategic context, authority/gates, side effects, cost semantics); readable recent-command titles. Tests: API + browser. Evidence: pending.

### UX-APPR-001 | Approval | P1 | SUPERSEDED (canonical: VERIFIED Slice 3)
Observed: IDs dominate; low-level rationale flow. Desired: readable subject (meaning, granted/not-granted authority, risk, affected entity) + confirmation modal + advanced details. Governance: Decision≠Authority preserved. Tests: browser. Evidence: pending.

### UX-APPR-002 | Approval | P0 | VERIFIED (Slice 3, 2026-09-19)
Evidence: deterministic impact classification (HIGH for publication/strategy/override, LOW for gates/iteration) with will/will-NOT/scope/target/do-nothing confirmation modals; rationale mandatory inline; OVERRIDE confined to Advanced with explicit bypass warning; no native dialogs. Tests: API override/high-impact + browser confirm asserts. External calls: 0. Completed 2026-09-19.

### UX-ART-001 | Artifacts | P1 | VERIFIED (Slice 7; Slice 11 walkthrough 2026-09-22)
Evidence: business workspace with categories/titles/state primary, technical IDs secondary, lineage inspectable, frozen artifacts immutable; live artifacts present with kind/producer/status. Tests: artifact-workspace 12/12. Prior observed/desired: forensic tool → business categories first, technical under Advanced/Lineage.

### UX-ART-002 | Artifacts | P2 | VERIFIED (Slice 7; Slice 11 walkthrough 2026-09-22)
Evidence: focused artifact viewer with safe preview/play; inspection-copy path never canonical identity (secret/path redaction asserted). Tests: artifact-workspace 12/12. Prior observed/desired: final media hard to preview → easy find + safe preview.

### UX-ART-003 | Artifacts | P1 | VERIFIED (Slice 7; Slice 11 walkthrough 2026-09-22)
Evidence: Owner-readable wording with technical detail retained under Advanced; no backfill. Tests: artifact-workspace 12/12. Prior observed/desired: engineer-worded pre-layer message → Owner-readable wording.

### UX-STRAT-001 | Strategy | P0 | VERIFIED (Slice 1, 2026-09-19)
Evidence: review surface (`strategyReview`) renders business summary, structured payload via generic renderer, evidence with readable names/existence, timestamps/sources; raw JSON only under Advanced. Read-only (review endpoint performs zero writes; API test asserts status unchanged + no activation rows). Files: `static/app.js`, `main.py` (`/api/strategy/review` + evidence stat), `handler.ts` (`/control/strategy/review`), `strategic.ts` (`reviewEntity`). Tests: API review-bundle 4/4; browser 26/26 strat asserts (incl. payload-readable + evidence-visible). Regression: control 25/25. External calls: 0. Governance: read-only inspection, no activation/execution. Completed 2026-09-19.
Observed: proposal payload/evidence not comfortably inspectable. Desired: business-readable proposal view (content, sources, metadata). Governance: read-only; no activation/execution. Tests: API + browser. Evidence: pending.

### UX-STRAT-002 | Strategy | P0 | VERIFIED (Slice 1, 2026-09-19)
Evidence: deterministic `strategicDiff` (UNCHANGED/ADDED/REMOVED/CHANGED, ordering-invariant, row-capped) in `strategic.ts`, surfaced in review Comparison section; no-baseline entities honestly report NONE/first-version. Tests: unit diff cases + API diff assertions + browser diff/no-baseline asserts. No LLM involved. Completed 2026-09-19.
Observed: no structured diff vs effective state. Desired: deterministic field-level diff in UI (no LLM). Tests: API + browser. Evidence: pending.

### UX-STRAT-003 | Strategy | P0 | VERIFIED (Slice 1, 2026-09-19)
Evidence: structured proposal form (type selector, key, key/value rows with JSON-or-text values, one-per-line evidence, inline validation, raw JSON only under Advanced toggle); browser proof created a proposal with zero JSON typed. Creation persists PROPOSED, never auto-activates (asserted). Completed 2026-09-19.
Observed: raw-JSON proposal creation; manual comma-separated sources. Desired: structured business forms (JSON as advanced path). Governance: source refs mandatory. Tests: API + browser. Evidence: pending.

### UX-STRAT-004 | Strategy | P0 | VERIFIED (Slice 1, 2026-09-19)
Evidence: guided journey Proposal→Inspect→Evidence→Diff→Decision→Authority→Activate→Effective→Preview with zero manual IDs (platform-resolved approval; `?project=` override enables isolated proof). Request-decision creates PENDING scoped approval (no authority); decide requires inline rationale + modal stating decision/authority/NOTs; activation gated by eligibility + modal, fail-closed (pending/rejected/wrong-scope/target-mismatch all 409; verified API + browser). Activation idempotent; supersession + snapshot stability + preview-after-activation proven. Decision≠Authority preserved end to end. No native alert/confirm in journey. Completed 2026-09-19.
Observed: manual entity/approval ID copying for activation. Desired: guided Proposal→Inspect→Evidence→Diff→Decision→Authority→Activate→Effective→Preview journey; exact governed authority underneath. Governance: STRATEGY_ACTIVATION exact-match preserved. Tests: API + browser. Evidence: pending.

### UX-COST-001 | Costs | P1 | VERIFIED (Slice 9; Slice 11 walkthrough 2026-09-22)
Evidence: priced spend UNKNOWN with knownCount 0 (never $0), FREE 24 and UNKNOWN 123 distinguished; Advanced raw collapsed. Live: knownCount 0, free 24, unknown 123. Tests: costs-health-slice9 5/5.

### UX-HEALTH-001 | Health | P1 | VERIFIED (Slice 9; Slice 11 walkthrough 2026-09-22)
Evidence: current DB ok / 1 live worker / queue q0 r0 separated from historical succeeded 17 / failed 50; failures never degrade current health; Advanced collapsed. Tests: costs-health-slice9 5/5.

### UX-SET-001 | Settings | P1 | VERIFIED (Slice 10; Slice 11 walkthrough 2026-09-22)
Observed: gate toggles lack confirmation UX. Now: business gate label primary with explicit ON/OFF state, per-action confirmModal (target gate, requested state, rationale, future-impact + will-NOT statement, no auto-release), inline rationale validation and inline success/error result, canonical refresh from existing human-gates endpoints, business-readable history with raw keys/detail under Advanced. Gate semantics unchanged. Tests: settings-crosscutting-slice10 9/9. Evidence: Slice 11 walkthrough 2026-09-22 (focused suites + live read-only checks, zero regressions); Owner final acceptance pending.
Prior status: gate toggles used native alert()/confirm() with a bare rationale field and raw gate keys primary.

### UX-GLOB-001 | Global | P1 | VERIFIED (Slice 9; Slice 11 walkthrough 2026-09-22)
Evidence: Mission Control with platform status, DB, workers, current queue, 1 canonical registered project (Morroway), provider summary, no-auth warning, build hashes Advanced-only. Live registry count 1. Tests: costs-health-slice9 5/5.

### UX-X-001 | Cross | P1 | VERIFIED (Slice 10; Slice 11 walkthrough 2026-09-22)
Now: business labels primary on all Owner surfaces incl. Settings gates/history (raw gate keys Advanced-only); per-surface application from Slices 1–9 retained. Tests: settings-crosscutting-slice10 9/9. Evidence: Slice 11 walkthrough 2026-09-22 (focused suites + live read-only checks, zero regressions); Owner final acceptance pending.
Prior status: OPEN — technical IDs primary labels.

### UX-X-002 | Cross | P1 | VERIFIED (Slice 10; Slice 11 walkthrough 2026-09-22)
Now: rendered views primary with raw under Advanced on all Owner surfaces incl. Settings gate keys + raw event detail; per-surface application from Slices 1–9 retained. Tests: settings-crosscutting-slice10 9/9. Evidence: Slice 11 walkthrough 2026-09-22 (focused suites + live read-only checks, zero regressions); Owner final acceptance pending.
Prior status: OPEN — raw JSON in Owner surfaces.

### UX-X-003 | Cross | P1 | VERIFIED (Slice 10; Slice 11 walkthrough 2026-09-22)
Now: zero native alert()/confirm() in shipped Owner bundle (setGate/resetGate → confirmModal + fieldErr; viewSnapshot → info modal). Per-surface modals from Slices 1–9 retained. Tests: settings-crosscutting-slice10 9/9. Evidence: Slice 11 walkthrough 2026-09-22 (focused suites + live read-only checks, zero regressions); Owner final acceptance pending.
Prior status: OPEN — `alert()` validation.

### UX-X-004 | Cross | P1 | VERIFIED (Slice 10; Slice 11 walkthrough 2026-09-22)
Now: business-first copy with future-impact + will-NOT statements on gate actions; per-surface copy from Slices 1–9 retained. Tests: settings-crosscutting-slice10 9/9. Evidence: Slice 11 walkthrough 2026-09-22 (focused suites + live read-only checks, zero regressions); Owner final acceptance pending.
Prior status: OPEN — engineering terminology dominates.

### UX-X-005 | Cross | P2 | VERIFIED (Slice 10; Slice 11 walkthrough 2026-09-22)
Now: L1 business → L2 operational → L3 Advanced hierarchy consistent incl. Settings (state chips, explicit current state, Advanced raw keys/events); no aesthetic churn to accepted Slice 1–9 pages. Tests: settings-crosscutting-slice10 9/9. Evidence: Slice 11 walkthrough 2026-09-22 (focused suites + live read-only checks, zero regressions); Owner final acceptance pending.
Prior status: OPEN — flat information hierarchy in dark shell.

## Slice 1 manual Owner acceptance (2026-09-19, recorded without mutating anything)

SLICE_1_OWNER_MANUAL_ACCEPTANCE = PASS. The Owner reviewed Constraints v1, Content System v1, Decision pilot-model v1 through the Slice 1 journey: review → decision request → decision → activation → authority correctly separated and understandable.

Strategic content/data quality findings (NOT Slice 1 UX defects; all three entities remain PROPOSED, unmutated):

- CONTENT_SYSTEM v1 is materially thinner than the approved content-system concept in canonical sources. Visible: `adaptive = true` + initial batch MW-HIS-001/002, MW-FAN-001/002 — not a sufficiently rich first-class representation of the full approved content operating system.
- DECISION pilot-model v1 correctly states the adaptive/learning-batch-only model but is thinner than the approved governance model (adaptive size + duration, performance-led, agent-recommended, Owner-governed, learning-batch-only four, evidence-driven continuation/scaling, no permanent winner threshold from four items). Future payload requirements must be verified against canonical sources before recording; nothing enriched from memory.
- CONSTRAINTS v1 is useful but minimal relative to broader canonical governance/brand/content constraints.

OWNER DECISION: do NOT activate Constraints v1, Content System v1, or Decision pilot-model v1. All three stay PROPOSED. Future remediation creates NEW versions from canonical evidence (historical immutability preserved).

## Slice 2 manual Owner acceptance (2026-09-19, recorded without mutating anything)

SLICE_2_ENGINEERING_VERIFICATION = PASS (preserved; the mechanism works).
SLICE_2_OWNER_MANUAL_ACCEPTANCE = CONDITIONAL — the lifecycle mechanism is sound, but Owner-truth review surfaced P0 findings below. Nothing was approved, rejected, activated, or mutated to reach this conclusion.

FINDING A — OWNER ATTENTION TRUTH (P0): Pipeline/Approval Center surface PENDING `visual-human-gate-vi1-flux` (created 2026-09-17) as needing decision, yet later governed continuation exists (media-resume r8 parked 09-16, validation acceptance 09-18, final media/QA/review + validation + DECIDED validation approval 09-18 evening). A PENDING row must prove current actionability before appearing in Owner attention.Tracked as UX-APPR-003 (new, P0).

FINDING B — LIFECYCLE NARRATIVE CONSISTENCY (P0): "Media production waiting approval" coexists with "Publication validation completed" + production/publication not granted. Coherent derived narrative required. Tracked as UX-PIPE-003 (new, P0).

FINDING C — BUSINESS LABELS (P1): internal gate/workflow/enum names dominate. Tracked as new acceptance criteria under UX-X-001/UX-X-004 (no new ID; covered).

FINDING D — PUBLICATION TERMINOLOGY (P1): "Publication validation completed" must never read as "Publication completed". Tracked as UX-PIPE-004 (new, P1).

FINDING E — WORKFLOW BUSINESS IDENTITY (P1): suffix-IDs as primary identity. Tracked as UX-PIPE-005 (new, P1).

FINDING F — OUTPUT DIRECTNESS (P1): outputs reachable directly, not only via Artifacts explorer. Tracked as UX-ART-004 (new, P1).

### UX-APPR-003 | Approval | P0 | SUPERSEDED (canonical: VERIFIED Slice 3)
Observed: PENDING approval rows surface as Owner attention without proving they can still materially change state (Morroway vi1-flux gate vs later governed continuation). Desired: deterministic actionability (ACTION_REQUIRED vs SUPERSEDED/HISTORICAL/CONFLICTED); attention counts only actionable items; Pipeline and Decision Center share one truth. Governance: rows immutable; fail closed. Tests: unit + API + browser. Evidence: pending.

### UX-PIPE-003 | Pipeline | P0 | SUPERSEDED (canonical: VERIFIED Slice 3)
Observed: phase/milestone/authority statements can read contradictorily ("waiting approval" + "validation completed"). Desired: one coherent derived narrative (phase, milestone, blocker, next action, authorities, visibility). Tests: unit + browser. Evidence: pending.

### UX-PIPE-004 | Pipeline | P1 | SUPERSEDED (canonical: VERIFIED Slice 3)
Observed: "Publication completed"-style ambiguity risk around validation. Desired: validation/readiness/approval/publishing/published always distinct. Tests: unit + browser. Evidence: pending.

### UX-PIPE-005 | Pipeline | P1 | SUPERSEDED (canonical: VERIFIED Slice 3)
Observed: workflow suffix IDs as primary identity. Desired: deterministic business title fallback (no invented topics), ID in Advanced. Tests: browser. Evidence: pending.

### UX-ART-004 | Artifacts | P1 | SUPERSEDED (canonical: VERIFIED Slice 3)
Observed: outputs only reachable via explorer. Desired: direct View actions per output category over canonical artifacts. Tests: browser. Evidence: pending.

## Slice 3 Owner Decision Center (2026-09-19) — VERIFIED

SLICE_3_APPROVAL_CENTER_OWNER_DECISION_EXPERIENCE = PASS. Morroway visual gate classified SUPERSEDED (later milestones + validation acceptance; row immutable; attention 1→0 actionable). Decision Center: Needs decision / No action / History from one canonical actionability truth shared with Pipeline (parity proven). Business labels, will/will-NOT effects, high-impact confirms, rationale inline, OVERRIDE gated, IDs in Advanced only. Publication phase reads "Publication validation" until real publish. Outputs get direct View + focused viewer. Findings VERIFIED: UX-APPR-001, UX-APPR-002, UX-APPR-003, UX-PIPE-003, UX-PIPE-004, UX-PIPE-005, UX-ART-004. Morroway read-only (0 mutations). Worker restarted controlled (queue 0/0), parity PASS, 1 worker. External calls: 0.

### UX-APPR-001 | Approval | P1 | VERIFIED (Slice 3, 2026-09-19)
Evidence: decision cards (title, why, approve/non-effects, risk) + detail view (reviewing, effects, do-nothing, next steps, Advanced IDs/scopes/recommendation); Decision≠Authority preserved. Tests: API business-label asserts + browser detail asserts. Completed 2026-09-19.

### UX-APPR-003 | Approval | P0 | VERIFIED (Slice 3, 2026-09-19)
Evidence: classifier (ACTION_REQUIRED/SUPERSEDED/HISTORICAL/DECIDED/CONFLICTED) + decision-queue + enriched approvals + actionable hub/dashboard/pipeline counts; Morroway gate SUPERSEDED with cited evidence; fail-closed duplicates/conflicts. Tests: 9 unit/store + 4 API + browser parity asserts. Completed 2026-09-19.

### UX-PIPE-003 | Pipeline | P0 | VERIFIED (Slice 3, 2026-09-19)
Evidence: lifecycle derives one coherent narrative (overall + phase + milestone + attention + next/do-nothing + authorities) from same actionability truth; Morroway reads VALIDATION_COMPLETED with zero attention. Tests: unit + browser narrative asserts. Completed 2026-09-19.

### UX-PIPE-004 | Pipeline | P1 | VERIFIED (Slice 3, 2026-09-19)
Evidence: publication phase relabeled "Publication validation" with explicit not-published detail until real publish; milestone stays "Publication validation completed"; browser asserts forbid "Publication completed". Tests: unit + browser. Completed 2026-09-19.

### UX-PIPE-005 | Pipeline | P1 | VERIFIED (Slice 3, 2026-09-19)
Evidence: deterministic titles ("Morroway · Produce · Sep 12, 2026"); suffix IDs only in Advanced. Tests: browser. Completed 2026-09-19.

### UX-ART-004 | Artifacts | P1 | VERIFIED (Slice 3, 2026-09-19)
Evidence: per-output View buttons navigate to focused artifact viewer (structured payload + lineage actions); explorer unchanged as audit surface. Tests: browser. Completed 2026-09-19.

## Slice 4 remediation (2026-09-19) — VERIFIED
Root causes proven: 26 = 24 canonical registered agents (`agent-bootstrap.ts` AGENTS array) + 2 unregistered telemetry ids (`media`, failed 09-12 on dead workflow; `tts-chunk-coordinator`, runtime-internal tts-submit id). Attention now derives from canonical workflow lifecycle truth per latest run: OWNER_ACTION_REQUIRED (workflow NEEDS_OWNER_ATTENTION), SYSTEM_ATTENTION (live work/conflict/unavailable state — no Owner decision implied), HISTORICAL_FAILURE (terminal, no live work), HEALTHY_IDLE. Workflow stopped-without-decision narrative fixed (SYSTEM attention entry; "Stopped — system issue"; no "Owner decision required" language). Team (24) vs Runtime components (2) split; presentation groups (Leadership, Research & Strategy, Content & Creative, Media Production, Growth & Analytics); modal close-contract + unique IDs; render-epoch race guards; snake/camel focus fix. Morroway: 0 owner-action, 0 system, all idle/historical. Real Morroway mutations: 0. Worker restarted controlled, parity PASS. External calls: 0.

### UX-AGENT-005 | Agents | P0 | VERIFIED (remediation 2026-09-19)
Team count equals canonical registered roster (24); runtime components separated and inspectable, never counted as members. Tests: API roster/team assertions + browser counts. Completed 2026-09-19.

### UX-AGENT-006 | Agents | P0 | VERIFIED (remediation 2026-09-19)
Historical failure alone never creates Owner attention; OWNER_ACTION_REQUIRED only with a live actionable decision on the run's workflow; SYSTEM_ATTENTION otherwise distinct; superseded stays historical. Tests: unit taxonomy + API owner-action/historical + browser asserts. Completed 2026-09-19.

### UX-AGENT-007 | Agents/Runtime | P1 | VERIFIED (remediation 2026-09-19)
Team vs Runtime components IA with honest descriptions; history/health retained. Tests: API + browser. Completed 2026-09-19.

### UX-AGENT-008 | Agents | P1 | VERIFIED (remediation 2026-09-19)
Deterministic presentation grouping (5 groups, exact-once membership); identities/counts unchanged. Tests: API grouping asserts + browser. Completed 2026-09-19.

### UX-PIPE-006 | Pipeline | P0 | VERIFIED (remediation 2026-09-19)
Stopped-without-decision narrative contradiction fixed: SYSTEM attention entry, honest stopped language, no Owner-decision claims, Command Room/history links. Tests: lifecycle unit + browser. Completed 2026-09-19.

## Slice 4 Owner manual acceptance (2026-09-19) — PASS
Owner inspected Agents: 24-member team truthful, runtime components separate, historical failures calm, empty allowlist honestly stated, no mutations. SLICE_4_OWNER_MANUAL_ACCEPTANCE_FINAL = PASS. UX-AGENT-004 remains OPEN (deployment allowlist decision).

## Slice 5 audit — Command Room current truth (2026-09-19, repo+runtime evidence)
Path proven: UI submit → `POST /control/commands` (durable command + queued workflow) → worker `processGovernedCommand` → `GovernedAgentRuntime` → provider → artifacts + provenance → command COMPLETED + UI reload. ASK_AGENT (1 agent) and MULTI_AGENT_REVIEW (≥2 + synthesis) execute via governed runtime; START_GOVERNED_TASK enqueues canonical workflow (directive currently always `research` from UI — Owner cannot choose task type). Gaps: selectors hardcoded in app.js (8 agents incl. stale `reviewer` alias — fixed pre-slice to canonical `review`); unknown agent ids accepted by API (no registry validation); no pre-submit review; no command authority explanation; history shows raw IDs; no detail view; cost unshown; partial failure invisible; runtime components selectable in theory. Roster source of truth: `agent-bootstrap.ts` (24) mirrored in `agent-catalog.ts`.

### UX-CMD-001 | Command | P1 | VERIFIED (Slice 5, 2026-09-19)
Evidence: launcher with 3 business modes, canonical 24-roster selectors (runtime excluded, alias fixed), pre-submit review modal, human-titled history, detail view, no native dialogs. Tests: API roster/write-path + browser 20/20. External calls: 0. Completed 2026-09-19.
### UX-CMD-002 | Command | P1 | VERIFIED (Slice 5, 2026-09-19)
Evidence: review modal (who/config/authority/cost-UNKNOWN/effects), server-side authority classes, per-participant results + separate synthesis + partial-failure honesty, cost UNKNOWN/mixed rules, lifecycle-linked attention with Decision Center navigation, outputs via focused viewer. Tests: API + browser. Completed 2026-09-19.

## Slice 5 remediation — live ASK_AGENT incomplete-response RCA (2026-09-19, zero retries, zero provider calls)

Owner ASK (Research Agent, Morroway state analysis) failed honestly: HTTP 200, finish `length`, 500/500 completion tokens with 672 reasoning tokens and 0 visible bytes. Boundary: response completion/validation (never reached JSON parse; 0 artifacts; fail-closed held). Classification: B (reasoning consumed completion budget) + C (500-token cap arithmetically below research-contract worst case ~700 tokens). Systemic: 3 length-failures on nex-n2.5-pro out of 21 runs. Fix (general, bounded): research budget 500→1000 (worst-case-derived, capped) + reasoning effort:none on governed research (repo-certified pattern); planner/ceo untouched (no failure evidence). Architecture finding: governed ASK_AGENT research is LLM-only (no tools, no lifecycle/approvals/artifacts beyond static dict) — Owner request was INTERNAL_PROJECT_ANALYSIS needing live state; now resolved via `_operational` snapshot (lifecycle + actionability truth, ≤2000B cap). Evidence layer (serper/tavily/brave/exa + apify/brightdata adapters) exists but unwired to governed path — recorded below, not built here. Retry = explicit new command with lineage link (no auto-retry, original immutable). Live re-validation awaits Owner-authorized retry (no provider call made).

### UX-CMD-003 | Command | P0 | SUPERSEDED (canonical: VERIFIED with live Owner proof)
Observed: live research ASK failed fail-closed on length exhaustion. Fixed generally (budget + reasoning control + operational evidence). Tests: worst-case-fit unit, reasoning-param capture, truncated-JSON rejection, retry lineage, authority/cost/secrets invariants. External calls: 0. Live retry NOT executed.

### UX-CMD-004 | Command | P1 | VERIFIED (remediation 2026-09-19)
Observed: raw "OpenRouter … incomplete response (length)" in primary participants view. Now: business failure message primary, raw error under Technical-error details, cost UNKNOWN, retry entry explicit. Tests: browser 11/11 on the real failed command (read-only + prefill-without-submit). Completed 2026-09-19.

### UX-CMD-005 | Command/Research | P1 | OPEN (integration gap, deferred)
Governed ASK_AGENT research bypasses the existing evidence-acquisition layer (web/social routers exist and serve ordinary production research conditionally). Internal-analysis requests now get platform truth via `_operational` snapshot; external-evidence tool routing in governed runtime is future work. No silent redesign undertaken.

### UX-CMD-010 | Command/Multi-agent | P0 | VERIFIED (remediation + live-validation fix + V3 semantic consistency 2026-09-19)
V3: planner INTERNAL_ANALYSIS_V1 now carries contract-aware budget (ceiling-derived) + effort:none reasoning + field-ceiling validation + text-level actionability guard; synthesis grounded against actionability truth; raw participant JSON collapsed under details. Tests green with zero provider calls; no live retry executed — next Ask-a-Team run belongs to the Owner.
Update: Owner live validation exposed a split-brain — planner received the internal-analysis contract with legacy planner execution settings (budget 500 path, reasoning uncontrolled) and failed length (1375 reasoning tokens, 0 visible) while research (effort:none) completed on the identical contract. Fixed: contract-aware execution policy (budget + reasoning derive from effective contract; INTERNAL_ANALYSIS_V1 ceiling-exact field caps + derived budgets); verified by 24-item matrix with zero provider calls; no live retry executed — next Ask-a-Team run belongs to the Owner. Completed 2026-09-19.
Observed: live team review failed because Planner validated a project-state question against the fixed 6-key planning schema (COMMAND_ROLE_CONTRACT_REQUIRED_FIELD_INVALID:planner) while Research completed under the internal-analysis contract. Root cause: agent identity alone selected contracts. Fixed: shared-intent participant routing (research/planner + INTERNAL → compatible analysis contract with distinct role perspectives; planning tasks keep canonical schema byte-identical). Lineage preserved: research artifact kept, planner absent, synthesis absent, command FAILED. Tests: 24-item matrix (routing, perspectives, independence, synthesis eligibility, partial failure, authority, cost, secrets, registry guards) green with zero provider calls. Live Owner team command + research artifact preserved immutable. Completed 2026-09-19.
V5 structural-actionability hardening 2026-09-20 (same defect family, no new finding): live command-1789910217663 failed BOTH participants with all structured flags correctly false — V1 regex scanned recommendedNextStep/ownerImplication prose as the primary authority signal ("instructs an Owner decision", zero actionable truth). Fixed generally: INTERNAL_ANALYSIS_V2 declares authority structurally (recommendedNextStep {action, actor, actionType, requiresOwnerDecision, targetDecisionId} + finding.ownerDecisionId; ownerImplication/action explanatory only, never scanned); grounding by canonical actionable IDs from `_operational.approvals.actionableIds`; top flag equals (next.requires OR any finding claim); synthesis keeps conservative prose backstop (free-text CEO contract unchanged); multi-agent worker budget now per-participant contract-derived (flat 1000 bypassed V2 worst case); UI renders V2 authority deterministically with V1 backward compat; V1 validator retained for historical readability. Tests: 31-item matrix + focused suites 32/32 + governed-runtime 9/9 green, zero provider calls; worker rebuilt 1c61978f with build parity proven; no live retry executed — next Ask-a-team run belongs to the Owner.
V6 finalization RCA 2026-09-20 (same defect family, no new finding): first live V2 Ask-a-Team (command-1789912080235) returned Research COMPLETED + Planner COMPLETED + visible synthesis yet command FAILED. Persisted truth: all three executions succeeded with artifacts; synthesis failed only its post-hoc gate — false positive on NEGATED safety language ("without ... authorizing publication"). Fixed generally: negation-aware authority matcher (affirmative instructions still fail) + canonical synthesis persisted iff COMPLETED (failed transient output can no longer render as success). Tests: 6-case finalization suite + 47/47 regression green, zero provider calls; worker rebuilt 56896083 with parity proven; historical command immutable; no live retry executed.
LATEST synthesis RCA 2026-09-20 (same family, no new finding): command-1789913111377 failed with both participants V2-COMPLETED and no Synthesis section. Persisted truth: synthesis ATTEMPTED and failed length — reasoning model burned 1356 reasoning tokens inside the flat 1000-token synthesis cap (finish length, 0 visible bytes); V6 no-canonical-on-failure held (synthesis column NULL). Same failure class as the V3 planner incident, migrated to the synthesis path. Fixed generally: CEO synthesis contract-aware policy (ceiling-derived budget 1100 + effort:none default, explicit override wins). Tests: +4 finalization cases, 51/51 regression green, zero provider calls; worker rebuilt 6aa36975 with parity proven; historical command immutable; no live retry executed. Phase E note: planner "brand selection/legal/handles PENDING" quotes the Owner-referenced approved brand-architecture artifact; name selection is canonically closed (Naming V1), legal/handles are separate — descriptive only, zero authority impact, artifact immutable, no precedence code change.
Reliability review 2026-09-20 (same family, no new finding): command-1789914560953 failed on Planner findings[1] with the generic V2 message; rejected payload unpersisted by design. Remediation: precise per-field V2 error paths (findings[i].field + length/value + limit; V1 pinned), SSOT prompt appendix generated from INTERNAL_ANALYSIS_LIMITS + authority enums (incl. decisionId limit + _operational precedence labeling), ceilings audited as KEEP across all fields, budget proof at 3.0 for all three paths, 12-variant wording suite proving structured semantics, CEO free-text residual risk documented (no redesign — no general defect demonstrated). Harness: real-orchestration runOnce path now asserts exact-path failures end-to-end + independent perspectives. Tests 59/59 green, zero provider calls; worker rebuilt 3da3a63f with parity proven; historical command immutable; no live retry executed.

### UX-CMD-011 | Command | P2 | VERIFIED (Slice 11 walkthrough 2026-09-22)
Evidence: live served bundle renders business findings primary (agent status + failureMeaning + renderFindings) with raw output inside collapsed `<details><summary>Raw output</summary>` plus collapsed technical-error details; live COMPLETED team review shows 2 independent participant results + separate synthesis. Original observed/desired retained below for audit.
Observed: full raw participant JSON renders inline in command detail. Desired: collapsed-by-default raw payload with rendered business output primary (Artifact Workspace progressive disclosure). Not a Slice 5 blocker.
Slice 10 re-verification observation (2026-09-22, no code change): current shipped command detail renders business findings primary with raw output inside collapsed `<details><summary>Raw output</summary>` plus collapsed technical-error details — appears aligned with the desired state; formal re-verification belongs to Slice 5 scope, NOT pulled into Slice 10.
Governed ASK_AGENT research bypasses the existing evidence-acquisition layer (web/social routers exist and serve ordinary production research conditionally). Internal-analysis requests now get platform truth via `_operational` snapshot; external-evidence tool routing in governed runtime is future work. No silent redesign undertaken.

### UX-CMD-003 | Command | P0 | VERIFIED (remediation + live Owner proof 2026-09-19)
Observed: live research ASK failed fail-closed on length exhaustion (672 reasoning tokens inside a 500 cap). Fixed generally (research budget 1000 + effort:none + operational evidence). PROVEN LIVE: Owner re-ran the repaired flow from real UI — COMPLETED with created reloadable artifact. Tests: worst-case-fit unit, reasoning-param capture, truncated-JSON rejection, retry lineage, authority/cost/secrets invariants. External calls during remediation: 0 (live validation was Owner-executed). Completed 2026-09-19.

### UX-CMD-006 | Command | P0 | VERIFIED (remediation V2 2026-09-19)
Observed: successful result used content-research schema (risks/concept/sourceability) for an internal project-state question because contract selection used agent identity alone. Fixed: deterministic intent classification (INTERNAL_PROJECT_ANALYSIS vs CONTENT_RESEARCH) + per-intent contracts + requested cardinality (1–5, default 3) + budget derived from schema ceiling. Content contract byte-identical for all other tasks. Tests: 20-item matrix green. Completed 2026-09-19.

### UX-CMD-007 | Command | P0 | VERIFIED (remediation V2 2026-09-19)
Observed: result simultaneously recommended completing a review while reporting no actionable approvals. Fixed: `_operational` snapshot now carries actionable/non-actionable distinction + validator rejects Owner-action claims against zero actionable decisions. Tests: matrix items 7–10 green. Completed 2026-09-19.

### UX-CMD-008 | Command/Artifacts | P1 | VERIFIED (remediation V2 2026-09-19)
Observed: artifact showed empty Sections while content hid in raw JSON. Fixed: internal-analysis artifacts persist findings-derived sections + summary; command detail renders findings natively; raw stays under Advanced. Tests: sections unit + shipped-renderer eval + browser regression. Completed 2026-09-19.
Governed ASK_AGENT research bypasses the existing evidence-acquisition layer (web/social routers exist and serve ordinary production research conditionally). Internal-analysis requests now get platform truth via `_operational` snapshot; external-evidence tool routing in governed runtime is future work. No silent redesign undertaken.

### UX-CMD-006 | Command/Pipeline | P0 | VERIFIED (remediation 2026-09-19)
Observed: the Owner's live ASK_AGENT submission became the project's "latest workflow", hijacking dashboard/readiness/pipeline truth (readiness flipped to NOT_RECORDED). Fix: ASK/MULTI executions excluded from content-workflow selection (latest, lists, readiness, lifecycles); they live in Command Room history. START_GOVERNED_TASK rows stay. Tests: API hijack test + all browser suites. Real Morroway mutations: 0. Completed 2026-09-19.
Governed ASK_AGENT research bypasses the existing evidence-acquisition layer (web/social routers exist and serve ordinary production research conditionally). Internal-analysis requests now get platform truth via `_operational`; external-evidence tool routing in governed runtime is future work. No silent redesign undertaken.

Research capability matrix (repo truth 2026-09-19): internal project research — code PASS / governed-wired MISSING (now PARTIAL via `_operational` snapshot); general web search (tavily/serper/brave/exa adapters + registry) — PASS / governed-wired NO; page acquisition — adapter-level PARTIAL / governed NO; instagram/tiktok/social (apify/brightdata adapters, parsers, policy) — EXISTS / governed-wired NO (credential-gated + needs explicit researchRequest); AMF artifact research — PASS via lineage endpoints / governed PARTIAL (refs only, no bodies).

## Slice 4 gap audit (2026-09-19, repo+runtime evidence)

Roster truth: 24 canonical registered agents (`bootstrapCanonicalAgentRegistry`); executions reference 20 ids incl. non-registry `tts-chunk-coordinator` (runtime-internal). Live work: 0 queued/running → no agent is currently WORKING (must not be faked). Costs: LLM runs UNKNOWN, local/deterministic FREE. Provider health: presence-only, `health:unknown` hardcoded — availability NOT verifiable; only configured vs last-used is honest. Config truth: PROJECT→AGENT (+UNCONFIGURED) durable events; ambient fallback `TEXT_AGENT_PROVIDER=agentrouter`; GLOBAL scope dead for provider/model (UI must not claim Global Default). SET/RESET/history/audit all real and tested. Current Agents UI: telemetry-keyed (registry agents without runs invisible), alert/prompt/confirm, raw JSON, morroway-hardcoded.

| Capability | Backend | Persisted | API | UI | Owner-readable | Action | Audit | Source of truth | Gap | Action |
|---|---|---|---|---|---|---|---|---|---|---|
| A registry | yes | code | no | no | no | no | n/a | agent-bootstrap.ts | P1 | canonical roster read model |
| B identity | yes | code | no | partial (keys) | no | no | n/a | registry + telemetry | P1 | business names |
| C role | yes | prompts | no | no | no | no | n/a | DEFAULT_* prompts | P1 | role descriptions |
| D responsibilities | yes | prompts | no | no | no | no | n/a | prompts | P1 | plain-language duties |
| E availability | partial | no | presence-only | partial | no | no | no | providers endpoint | P1 | honest configured/last-used |
| F current activity | no live per-agent signal | n/a | no | no | no | no | n/a | queue (workflow-level) | P0 | truthful empty, never fake WORKING |
| G last activity | yes | provenance | via telemetry | partial | no | no | yes | execution_provenance | P1 | human timestamps |
| H recent executions | yes | provenance | via telemetry | partial | no | inspect | yes | provenance | P0 | owner-language run list |
| I recent outputs | yes | artifacts | via reports | no | no | view | yes | artifacts.producer_agent | P0 | direct View actions |
| J/K provider/model | yes | provenance | via telemetry | partial | no | no | yes | provenance + config | P0 | friendly names |
| L/M/N inheritance | yes | config events | map/history | partial | no | partial | yes | control_configuration_events | P0 | source explanation |
| O cost | yes | provenance | via telemetry | partial | no | no | yes | cost/cost_kind | P0 | Unknown stays Unknown |
| P/Q success state | yes | provenance | via telemetry | partial | no | no | yes | status | P1 | honest rates, no scores |
| R workflow participation | yes | provenance | via telemetry | no | no | no | yes | workflow_id | P1 | recent workflows |
| S/T lineage | yes | provenance/artifacts | lineage endpoints | partial | no | no | yes | existing endpoints | P1 | reuse, no second viewer |
| U safe config change | yes | config events | SET/RESET | partial (alerts) | no | yes | yes | canonical routes | P0 | modal journey |
| V history | yes | config events | history | no | no | reset | yes | history endpoint | P0 | reset-to-inherited |
| W authority | guards exist | n/a | n/a | no | no | no | n/a | gates/approvals | P0 | model≠authority copy |
| X audit trail | yes | events | history | no | no | no | yes | history endpoint | P1 | show old/new/source |

### UX-AGENT-004 | Agents | P0 | OPEN (found in Slice 4, still OPEN after hotfix — Owner/deployment allowlist decision genuinely required; fail-closed preserved, UI states empty honestly, no silent fix applied)

### UX-AGENT-009 | Agents | P0 | VERIFIED (hotfix 2026-09-19)
Observed: served Owner UI showed "AI team 26 registered members" while canonical roster is 24 + 2 runtime components. Root causes proven: (1) the running API process predated the team/runtime split build (dist contained the fix; PID 1688 served pre-split code) — replaced via controlled restart; (2) no Cache-Control on shell/API responses, so heuristic browser caching could serve stale truth — fixed with `no-store` on Node JSON + facade shell/API middleware; (3) single `reviewer` Command Room option key corrected to canonical `review`. Verify: served bundle hash == pinned `?v=` hash; API returns teamTotal 24 + runtimeComponents 2; UI renders 24/2 in fresh AND cache-primed profiles. Tests: roster separation API + browser count asserts (fresh + primed) + direct navigation. Real Morroway mutations: 0. Worker untouched (no hashed source changed). External calls: 0. Completed 2026-09-19.
Observed: Owner model changes are currently impossible deployment-wide: the SET allowlist (`configuredModels()`) reads `OPENROUTER_DEFAULT_MODEL` (empty), `OPENROUTER_FALLBACK_MODEL` (unset), `AGENT_ROUTER_DEFAULT_MODEL` (unset) — while `.env` sets `AGENTROUTER_DEFAULT_MODEL` (no underscore), which no code reads. Every SET is therefore rejected fail-closed. Desired: Owner/deployment decision on the canonical model allowlist (and the env-name mismatch); UI must state honestly when nothing is selectable. NOT an engineering silent fix (cost/authority implications). Backend fail-closed behavior is correct and must be preserved. Tests: API rejection path + browser honest-empty asserts. Evidence: pending.

## Proposed implementation order (slices; DO NOT start in capture task)

1. Strategy Owner Review Journey (UX-STRAT-001..004)
2. Pipeline canonical lifecycle vs historical attempts (UX-PIPE-001/002)
3. Approval Center + high-impact confirmation (UX-APPR-001/002)
4. Agents configuration UX (UX-AGENT-001..003)
5. Command Room translation + preview (UX-CMD-001/002)
6. Artifacts business workspace (UX-ART-001..003)
7. Hub + Dashboard action orientation (UX-HUB-001, UX-DASH-001)
8. Costs / Health / Global Mission Control (UX-COST-001, UX-HEALTH-001, UX-GLOB-001)
9. Settings confirmation + cross-cutting cleanup (UX-SET-001, UX-X-001..005)
10. Full Owner regression walkthrough

## Testing policy (binding for V1.1)

Per slice: focused unit/API tests, integration tests, browser QA on the real Owner surface, control-platform regression, strategic/governance regression where relevant. Continuous — never deferred to the end. Isolated TEST DB for mutating proof; read-only live Morroway fixture for read-side/browser verification. No provider/LLM calls unless separately authorized. No media generation, publication, or public visibility change. Every future slice updates this tracker through OPEN→IN_PROGRESS→IMPLEMENTED→VERIFIED with evidence.

## Product rules (non-negotiable)

Progressive disclosure L1 business → L2 operational → L3 technical/audit; never remove L3. Never: UNKNOWN→zero; relabel failures; fabricate snapshots; rewrite executions; auto-activate; collapse validation/publication or gate/publication authority; trigger execution from config; expose secrets; destructive migrations for UX convenience.
