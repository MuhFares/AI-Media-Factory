# Strategic Operating Layer V1 — Current-State Audit

Date: 2026-09-18. Evidence: live repo + prod DB + worker source. Baseline green (worker parity PASS, 1 canonical worker, both runtimes up, Control V1 25/25 browser PASS).

## Executive Summary

Strategy/brand/content-system state lives exclusively in files (docs + artifacts JSON); zero strategic tables, zero versioning, zero activation semantics in Postgres. Agents receive Morroway context from two hardcoded string literals in `apps/worker` (`project-context.ts` full strategy dict; `governed-agent-runtime.ts` suffix + grounding gates). `context-engine` / `prompt-compiler` / `memory-engine` are interface-only declarations, never constructed live. `control_approvals` has `supersedes` columns but no strategy/activation target types (grep STRATEGY|ACTIVATION = 0 hits). Strategy Council V2 output persists as unversioned free-`kind` artifacts with no approval binding. Owner-approved canonical sources exist for bootstrap (council V2 CLOSED/APPROVED_WITH_CHANGES; brand assets OWNER_APPROVED; architecture layers APPROVED with brand/legal pending; adaptive pilot READY without owner stamp → PROPOSED only).

STRATEGIC_LAYER_AUDIT = FAIL (no first-class layer; the hardcoded worker literals are the scaling problem stated in §3).

## Current Strategic State Architecture

Two live prompt paths, neither strategic: (A) production media chain (`production-executor.ts`) — generic `DEFAULT_*_SYSTEM_PROMPT`s, chain-linkage inputs only, `strategyMode=PRE_PUBLICATION_STRATEGY` flag with bounded evidence slice; (B) governed commands (`worker.ts processGovernedCommand` → `governed-agent-runtime.ts`) — `resolveApprovedProjectContext()` hardcoded morroway dict dumped as JSON into `system` + hardcoded Morroway suffix + output grounding gates. Non-morroway = passthrough. No DB/file/artifact fetch anywhere in either path.

## Artifact Inventory (canonical sources for bootstrap)

Owner-approved: `docs/strategy-council-v2-milestone.md` (CLOSED, APPROVED_WITH_CHANGES); `artifacts/brand-architecture-v1.json` + `docs/brand-architecture-and-naming-hierarchy-v1.md` (layers APPROVED; brand selection/legal/handles PENDING); `docs/morroway-brand-assets-v1.md` + `artifacts/brand/morroway/v1/brand-assets-manifest.json` + `artifacts/Brand identity/*` (OWNER_APPROVED); `docs/morroway-vector-supersession-reconciliation-v1.md` (PASS, technical). Draft/pending: palette/typography, brand-identity, visual-identity-production, logo explorations, naming (`OWNER_SHORTLIST_REVIEW_REQUIRED`), adaptive pilot content system (`READY_FOR_INITIAL_LEARNING_BATCH_PRODUCTION`, no owner stamp). Empty scaffolds: `knowledge/*`, `experiments/*`, `docs/decisions/*` (zero ADRs), `configs/*`. Pillars exist only in prose (Historical POV + AI Fantasy Storytelling) across council/architecture/pilot docs.

## DB/Persistence Inventory

Versioned/frozen today: workflow definition versions, revision/media/visual frozen packages, human-gate policy snapshots, production_policy decisions. Strategic: NOTHING — no entity/version/activation/decision-ledger/learning/experiment tables; `decisions.kind` has 3 dead kinds; `AgentArtifactKind` union has no strategy kinds (council output bypasses it as free TEXT); artifact single-parent provenance never carries strategy refs; `execution_provenance` has `prompt_version`/`configuration_fingerprint` but no strategic snapshot ref.

## Agent Context Flow / Prompt Context Flow

Command → `brandId` (=projectId) → `resolveCommandConfiguration` (provider/model only) + `resolveApprovedProjectContext` (hardcoded) → `system = contract + JSON(context) + hardcoded Morroway suffix`, `prompt` = owner message verbatim → provider. Media chain: generic system prompts + previous-artifact chaining. `memory/company/*.md` (26 AMF-generic files, zero Morroway) never wired. Entire Morroway specialization = string literals; any strategy change requires a code change — the exact future scaling failure §3 describes.

## Existing Governance Reuse

`control_approvals` (immutable recommendation, PENDING→DECIDED, evidence-freeze, rationale-required decide) + derived `authorityScope` display (VALIDATION/GATE/PRODUCTION/PUBLISH) + human-gate audit pattern + idempotent dispatch conventions. Reuse: new `STRATEGY_ACTIVATION` (+`*_ACTIVATION`) target types through the SAME engine; activation verifies DECIDED + exact scope + exact entity/project/version match, else fail closed.

## Versioning / Activation / Lineage / Control-Platform Gaps

No entity versioning (P0); no ACTIVE determinism or singleton/conflict rule (P0); no proposal-vs-active separation (P0 — proposals can't even exist); no resolver, relevance map, bound, hash (P0); no snapshot immutability (P0); no strategic lineage on executions/artifacts (P0); no Strategy UI surface (P0); no preview endpoint (P1); no structured diff (P1); no GLOBAL strategy (correctly deferred — `STRATEGY_NOT_CONFIGURED` per project). Pending visual gate has no SUPERSEDED/CANCELLED lifecycle — recorded lifecycle debt, NOT expanded in this phase (§71).

## P0 / P1 / P2

P0: strategic tables + store; lifecycle machine; activation governance on existing approvals; deterministic resolver + relevance + bound + hash; immutable snapshots; provenance snapshot ref; runtime integration at governed boundary (legacy fallback preserved); Strategy UI (overview/history/proposals/preview); agent/artifact/command visibility; Morroway bootstrap from evidence with plan-first + no fake approvals.
P1: structured version diff; strategic health READY/INCOMPLETE/CONFLICTED/NOT_CONFIGURED; audit-event ledger beyond activation rows; conflict surfacing UI.
P2: experiments auto-evaluation, learning loop, autonomy — all deferred per §6.

## Recommended V1 Domain Model

`strategic_entities(entity_id PK, project_id, entity_type, key, version, status DRAFT|PROPOSED|ACTIVE|SUPERSEDED|RETIRED, payload JSONB, schema_version, source_artifact_ids JSONB, supersedes_version, created_by/at, activated_at, activated_by_approval_id)` + unique(project,type,key,version). Types: STRATEGY, BRAND, CONTENT_SYSTEM, OBJECTIVES, PRINCIPLES, CONSTRAINTS, EXPERIMENT, DECISION, LEARNING_MEMORY. Singleton (one ACTIVE per project/type/key) except EXPERIMENT/DECISION (multi-active allowed). `strategic_activations` append-only audit. `strategic_context_snapshots(snapshot_id, project, task_class, entity_refs, context, hash, resolver_version)` immutable. `execution_provenance.strategic_snapshot_id` nullable additive column (old rows unaffected → history immutable).

## Migration Requirement

Additive idempotent DDL only (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS` via existing `migrate()`); TEST isolation proven before test runs; no destructive migration; old file artifacts retained as source evidence (referenced, never deleted).

## Implementation Sequence

1. persistence+store+unit tests → 2. resolver/relevance/hash/snapshot + determinism tests → 3. proposal/activate governance + checkpoint-D tests → 4. governed-runtime integration (legacy fallback) + lineage → 5. Node+facade APIs + UI surface + visibility → 6. bootstrap PLAN → isolated checkpoint-E/G → 7. Morroway bootstrap (no LLMs) → 8. context previews (4 roles) → 9. full browser + regression proof.

## Acceptance Criteria

DoD §74 (18 items); determinism (same inputs+state → same hash); V1→V2 supersession with V1 snapshot stability; proposal-without-approval cannot activate; wrong-scope/different-version/different-project/rejected/legacy-ambiguous all fail closed; duplicate activation idempotent; Control V1 regression green; worker parity PASS; zero provider/media/publication calls.
