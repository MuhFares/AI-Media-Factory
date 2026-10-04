# Slice 6 — Strategic Operating Layer V1 (2026-09-20, implementation record)

Slice 5 is CLOSED and untouched (no contract, Command Room, synthesis, or
historical changes; verified by file timestamps + full Slice 5 suite green).

## What existed

Full proposal→approval→activation→resolve→snapshot→lineage machinery
(`packages/database/src/strategic.ts`, `/control/strategy/*`,
Python facade, Strategy UI page, agent `_strategic` overlay) with Morroway
BRAND v1 + STRATEGY v2 ACTIVE. Gaps closed by this slice: Morroway
reconciliation into entities, structured `_strategicCurrent` agent context,
and a Project → Strategy surface answering the 12 Owner questions.

## Reconciliation (deterministic, `scripts/reconcile-strategy-morroway-v1.mjs`)

Dry-run first, then `--apply` persisted PROPOSED-only (zero effective-context
change; idempotent re-runs SKIP identical). No activations — Owner-only via
Strategy review UI. Per-claim sources recorded in specs and entity refs.

| Entity | Version | State | Resolves |
|---|---|---|---|
| BRAND/primary | v2 PROPOSED (supersedes v1) | naming CLOSED/Morroway; legal/handle/domain/trademark/tagline NOT_*; essence; Threshold/Cinematic Worlds; logo+palette+typography APPROVED | Owner activation pending |
| CONTENT_SYSTEM/primary | v2 PROPOSED (supersedes v1) | READY_FOR_INITIAL_LEARNING_BATCH; PERFORMANCE_LED+AGENT_RECOMMENDED+OWNER_GOVERNED; 4 batch IDs as initial batch only; sourcing + gate hypotheses | Owner activation pending |
| STRATEGY/primary | v3 PROPOSED (supersedes v2) | v2 + CLOSED/APPROVED_WITH_CHANGES + Reels-first phased platforms + 30s/modular | Owner activation pending |
| EXPERIMENT/pilot-gates | v1 PROPOSED | gates as hypotheses with triggers; promotion Owner-governed only | Owner activation pending |

Key conflict resolved without rewriting history: brand-architecture-v1.json
`PENDING_SELECTION` is SUPERSEDED for the selection question by the Owner
final decision (naming §26 + hierarchy §18: Morroway, Naming V1 CLOSED);
architecture layers remain approved history. No artifacts/commands mutated.

## §22 validation (post-apply, read-only)

Master brand APPROVED, Naming CLOSED, Council CLOSED/APPROVED_WITH_CHANGES,
pillars active, pilot adaptive + 4-as-batch, gates experimental, production
NOT_GRANTED, publication NOT_GRANTED, public NOT_PUBLISHED — all PASS from
canonical state. Operational authority stays out of strategic payloads.

## Other changes

- `resolve()` shaped entities carry status/authority/evidenceRefs/
  supersedesVersion; resolver `strat-resolver-v2` (snapshots immutable).
- Agent context gains `_strategicCurrent` per-domain index + staleness note;
  flat overlay preserved.
- Strategy UI: Overview (3 domain cards + operational authority +
  Decision-Center-only actionability note), Strategy/Brand/Content sections,
  history with supersedes/activation-approval columns.
- Tests: database 18/18, worker 62/62, api 7/7 (isolated TEST DB where DB
  is needed); UI render smoke 14/14; zero provider calls.
- Worker rebuilt with parity proven (expected == running, heartbeat fresh).
- Open (unchanged): UX-CMD-005, UX-AGENT-004, CEO free-text residual risk,
  DB-backed env gap for local runs.

## Final reconciliation — Owner-accepted corrections (2026-09-20, PROPOSED-only)

Owner accepted BRAND v2 / CONSTRAINTS v1 / CONTENT_SYSTEM v2 / EXPERIMENT
v1 / STRATEGY v3 business meaning with three findings. Resolved with two
new PROPOSED versions (no activation, no approval, no mutation):

- STRATEGY v4 (supersedes v3): identity-review marker resolved to
  component-level supersession (essence/direction/logo/palette/typography
  Owner-decided; tagline NOT_APPROVED kept as state, never a task; no
  decision ID manufactured; original text preserved); expansion timing
  rewritten as indicative hypotheses + never-automatic rule (originals
  preserved); format archetype note (ranges vs 30s/15s targets).
- CONTENT_SYSTEM v3 (supersedes v2): durationSemantics rule — item
  ranges describe experiment bounds and neither redefine nor override
  archetypes; batch items verbatim.

Marker classification: REVIEW_REQUIRED text is STALE (substance settled by
later Owner direct decisions; no identity-review decision pending in
Decision Center). Idempotency bug caught by verification (expansion
re-derivation drifted) and fixed — transforms are now fixed points;
re-runs SKIP. Derived queue now resolves 5 candidates (brand-v2,
constraints-v1, content-v3, experiment-v1, strategy-v4); content
v3/v2/v1-chain older + decision stale stay History-visible.
Tests: +9 corrections (incl. isolated TEST-DB apply: PROPOSED-only, zero
approvals) +1 queue-chain case; full suites green; zero provider calls.

## Request-iteration continuation (general mechanism + Constraints v2)

Owner REQUEST_ITERATION on Constraints v1 (approval-1789939530189-x5wdi0u3,
rationale persisted on the exact target) had no governed continuation:
no enqueue, no revision op, and the review page re-offered a decision on
the unchanged v1. Implemented `StrategicStore.iterate()` (+
strategic_iterations audit table): DECIDED REQUEST_ITERATION on the exact
prior entity authorizes ONE revised PROPOSED next version with
supersedesVersion, decision/rationale provenance, and zero other
authority; fail-closed on kind/pending/target/project/source-status
mismatch and occupied slots; idempotent. Constraints v2 created with the
Owner's exact wording (rules 1+3 byte-identical); v1 immutable; no
approval auto-created; Decision Center untouched. Review UI now routes
post-iteration v1 to revision state (rationale + revised-proposal link or
revision-required) instead of resubmission. Tests: 6 store + 3 UI (state,
queue, render); Slice 5 suites green; zero provider calls.

## Content governance v4 (policy-based publication semantics)

Content System v3 encoded manual Owner approval as a permanent invariant
(governance.ownerApprovalBeforePublication=true; OWNER APPROVAL →
PUBLISH), conflicting with approved Constraints v2 direction. Created
CONTENT_SYSTEM v4 PROPOSED (supersedes v3) via deterministic transform:
publicationPolicy{rule, currentMode OWNER_APPROVAL_REQUIRED,
autonomousPublication Owner-authorized-only}; loop step PUBLICATION
AUTHORIZATION with never-infer rules; QA stays required; batch IDs,
pillars, sourcing, gates, durationSemantics, archetypes byte-identical.
v3 immutable; no approval/activation; effective state, Decision Center,
and operational authority unchanged. Tests: 5 pure + queue-chain case;
full suites green; zero provider calls.

## Experiment gates v2 (evaluation signals, never triggers)

Experiment v1's observedTriggers naming implied observed results or
automatic triggers. Created EXPERIMENT v2 PROPOSED (supersedes v1) via
deterministic transform: experimentalEvaluationSignals with the four
values verbatim, explicit NOT-observed/NOT-KPI/NOT-trigger/NOT-threshold
semantics, decisionUse governed-evaluation-only, decisionModel
PERFORMANCE_LED+AGENT_RECOMMENDED+OWNER_GOVERNED, automaticDecisionRule
naming all six scale decisions, historical "threshold" wording flagged
as provenance-only. Status stays EXPERIMENTAL; rule and valid decisions
preserved. v1 immutable; no approval/activation; authority unchanged.
Tests: 5 pure + queue-chain case; full suites green; zero provider
calls.

## Slice 8 Owner UX remediation — Hub fixture default, authority parity

Owner review found live fixture namespaces (cmd-ui-*, strat-ui-*) leaking
into the default Hub, dashboard authority degraded to readiness YES/NO
vocabulary with missing keys, raw pipeline stage/status copy, and
engineering telemetry dominating Hub. Fixed presentation-only from
durable evidence (namespace enumeration): broadened deterministic
fixture patterns + null-project filter, opt-in audit toggle moved under
Advanced, lifecycle-sourced authority display (NOT_GRANTED/NOT_PUBLISHED
vocabulary, UNKNOWN only when genuinely unavailable), humanized stage
labels with an explicit stage-vs-authority separation cue, telemetry
moved under Advanced. No state, resolver, authority, or Decision Center
change. Tests: +9 hub-dashboard suites; full suites green; zero
providers. Owner processes found stopped mid-turn and were restored
(node API + worker relaunched, Python facade relaunched; parity and
health verified).

## Slice 7 Owner UX remediation (presentation only, no state change)

- Preview modal: bounded 92vh flex shell, sticky header with always-
  visible Close, internal scroll body, Escape closes, background scroll
  locks/restores, focus returns to trigger; full content never truncated;
  video/audio controls native.
- Business lineage primary view: deterministic producer/workflow
  labels, Used-by categories, validation-artifact status line; raw IDs,
  digests, lineage edges under Advanced; display layer withholds local
  paths and embedded media bytes (canonical record/API unchanged).
- Frozen-output notice on structured historical previews only
  (Decision Center stays authoritative); never on media/technical.
- Category nav as chip group (no dot separators), same filtering.
- Final-video warning and inspection-copy warning preserved verbatim
  in meaning. Tests: +5 UI suites; full suites green; zero providers.

## Slice 7 — Artifacts Business Workspace (implementation record)

Category-first Artifacts & Lineage over canonical artifact truth (no
state/design changes elsewhere):
- Deterministic kind/producer→business-category projection (10
  categories + explicit Technical; unknown kinds never mislabeled) and
  preview-kind detection, pure in app.js and unit-tested.
- Safe preview delivery: GET /control/artifacts/preview resolves a
  canonical artifact ID to bytes from confined roots (output/,
  artifacts/) or embedded data: URLs with digest verification; ranges,
  content types, 404/403/413/416 fail-closed, no path leaks; Python
  streams it through unchanged. UI previews video/audio/image inline
  and structured reports readably; raw JSON only under Advanced.
- Workspace UI: category tabs + text search + chronological cards with
  lineage/focus detail, final-media technical-validation badge,
  Owner-readable lineage wording, per-category empty states.
- Verification: endpoint matrix 5/5, UI logic+render 7/7, Python proxy
  5/5, full api/database/worker suites green; live byte-identical
  delivery (final mp4 sha-matched) via node and facade; pre-existing
  command-write-path extraction fixed. Zero providers; authority
  NOT_GRANTED ×3; Decision Center and strategy baseline unchanged.

## Strategy surface UX compaction (presentation only)

Strategy page restructured into native <details>/<summary> accordions:
Overview + Effective Strategy open by default; Strategy/Brand/Content/
Constraints/Experiment details (new Constraints + Experiment sections),
Review Queue, Context Preview, Version History, New Proposal collapsed.
Collapsed headers show domain, version, ACTIVE badge, deterministic
payload-derived facts, and a Review action that does not toggle.
Session-only open-state persistence; focus-visible styling added.
No state/resolver/authority/Decision-Center change; all content
reachable; served bundle verified byte-identical to source with fresh
cache-busting digest. Tests: +2 render/facts suites; full suites green.

## Review queue currentness remediation (derived, no lifecycle mutation)

Owner review found older PROPOSED entities (constraints v1, content v3,
experiment v1, strategy v3) listed as current review candidates despite
newer ACTIVE versions in the same lineages. Fixed deterministically in
the single shared classifier: a proposal is CURRENT only when no newer
version of any status heads its lineage; otherwise it is labeled older
(with authoritative version) or stays stale/absorbed. Lifecycle,
actionability (Decision Center only), and currentness remain three
separate concepts; N=0 renders "Current strategic proposals for review:
0" with no task-implying copy. Live Morroway resolves 0 candidates, 6
older correctly labeled, decision stale, 0 actionable, zero mutations.
Tests: +5 queue/currentness/render; full suites green; zero provider
calls.

## Strategic context budget remediation (task-aware projection)

Whole-state reconciliation found all five entities correctly ACTIVE but
writer/planner/ceo/default resolution threw STRATEGIC_CONTEXT_OVERSIZED
(~10–12.4KB vs the 8000B fail-closed cap; research fit at 4503B),
blocking governed execution before any provider call. Remediation (no cap
raise, no summarization, no entity mutation): deterministic
buildStrategicProjection — per-domain compact fact extraction (explicit
allowlists) + per-task-class domain selection + required-semantic
validation + 8000B enforcement on the projected context + full
provenance. Planner is now its own task class (was ceo). Canonical truth
unchanged; snapshots carry projection audit metadata outside the hash.
Live Morroway: research 4503→2367B, planner →4044B, writer →4033B, ceo
→4084B, default →3423B, all RESOLVED. Worker injects projected facts
per participant (research lacks brand by design); synthesis gets ceo
projection; projection failure fails closed with zero provider calls.
Tests: 15 projection (pure+DB) + 3 command-path integration; suites
green; zero provider calls. Worker rebuilt with parity proven. API
process restart not performed (no API source change; additive shape
flows on its next routine restart).

## Slice 8 domain remediation � canonical Project Registry

Owner review proved Hub membership derived from operational rows (UNION over submissions/approvals/commands) let any project_id � cmd-ui-*, strat-ui-*, fixtures � appear as a business project, with only a name-blacklist standing in the way.
Remediation: control_projects registry (project_id PK, display name, status, provenance) + Morroway seed + registerProject/getProject; listProjects returns registered rows with joined stats; Hub renders registry rows with display names and no client-side filtering code remains.
No records deleted, no history rewritten, no authority/strategy/artifact changes. Tests: 6 registry (idempotent seed/register, ghost-namespace exclusion, second-project appearance, restart stability) + rewritten Hub UI suites; full suites green; live /control/projects returns Morroway alone; zero providers.
