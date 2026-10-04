# AMF Current Platform State (concise, canonical entry point)

Updated: 2026-09-19. This is the first file a new agent reads. Historical evidence lives in sibling docs; this file states where the platform stands NOW.

## What AMF is

Autonomous Media Operating Platform (Owner → Control Platform → Strategy/Governance → Orchestrator → Agents → Providers → Artifacts → Analytics/Learning). Coding agents are engineering tools, not the operating interface.

## Milestones

CONTROL_PLATFORM_V1_CLOSURE / OPERATIONALIZATION_V1 / OPERATIONAL_PROOF = PASS. STRATEGIC_OPERATING_LAYER_V1 / STRATEGIC_OPERATING_PROOF = PASS. E2E_TECHNICAL_PROOF = PASS. E2E_OPERATING_LOOP_PROOF = NOT_YET.

## Owner-facing UI

Python FastAPI facade + static UI in `apps/api/src/ai_media_factory/` served at `http://127.0.0.1:8000` (Node API `:8080`, one persistent worker with build parity). `apps/web` = NON_CANONICAL_STUB / DEFERRED.

## Project

Morroway = REFERENCE_PROJECT, PLATFORM_VALIDATION_MODE. No creative optimization, publication, benchmarking, media generation, or next-cycle work.

## Strategic state

BRAND primary v1 ACTIVE. STRATEGY primary v2 ACTIVE (v1 SUPERSEDED). CONTENT_SYSTEM / CONSTRAINTS / DECISION-pilot-model v1 PROPOSED — do NOT activate without Owner authority. Pre-layer executions carry no strategic snapshot (correct; never backfill).

## Worker/platform expectations

Exactly one canonical persistent worker, fresh heartbeat, expected/running build parity (restart via `scripts/persistent-worker.mjs` when queue has 0 running). TEST_DATABASE_URL != DATABASE_URL always; test mutations on TEST DB only.

## Primary objective

AMF_PLATFORM_PHASE = POST_STRATEGIC_OPERATING_PROOF. CURRENT_PRIMARY_OBJECTIVE = CONTROL_PLATFORM_OWNER_EXPERIENCE_V1_1 (Slice 1 Strategy Review = PASS; Slice 1 manual acceptance = PASS, three proposals remain PROPOSED; Slice 2 Pipeline Lifecycle = PASS; Slice 2 manual acceptance = CONDITIONAL with findings A–F recorded; Slice 3 Owner Decision Center = PASS 2026-09-19: Morroway visual gate classified SUPERSEDED with evidence (row immutable, attention 1→0 actionable), Decision Center + Pipeline share one actionability truth, Decision≠Authority preserved, Morroway read-only with 0 mutations). NEXT_SLICE = SLICE_6_ARTIFACT_WORKSPACE (not started). Slice 6 Strategic Operating Layer V1 = IMPLEMENTED 2026-09-20 (see slice-6-strategic-operating-layer-v1.md; Owner acceptance pending). Slice 5 remediation = IMPLEMENTED 2026-09-19 (live length-failure RCA: reasoning consumed 500-token budget on governed research; general fix research budget 1000 + effort:none + operational evidence snapshot; sanitized failure UX; explicit retry-as-new; NO live retry executed — awaiting Owner authorization; 0 provider calls). Slice 5 Command Room = PASS 2026-09-19 (canonical roster selectors, 3 Owner modes, pre-submit review, server-side authority, durable history/detail, ASK+MULTI write proofs with stubbed transport and zero provider calls; 2 fixture commands settled honestly with zero cost; Morroway read-only, 0 mutations; allowlist UX-AGENT-004 still OPEN). Slice 4 remediation = PASS 2026-09-19; Slice 4 count hotfix = PASS (stale API process replaced, no-store cache policy, versioned assets; served UI shows 24 registered + 2 runtime; UX-AGENT-009 VERIFIED; allowlist UX-AGENT-004 still OPEN). Slice 3 Owner manual acceptance = PASS after remediation. Slice 4 Agents team experience = PASS 2026-09-19 (24-agent roster read model, honest IDLE/attention statuses, UNKNOWN costs, safe modal config journey, empty deployment allowlist recorded as UX-AGENT-004 OPEN; Morroway read-only, 0 mutations). NEXT_PHASE_AFTER_V1_1 = ANALYTICS_AND_LEARNING_CLOSED_LOOP_SCOPING (not started; no L3/L4 autonomy).

## Open items

V1.1 tracker (`control-platform-owner-experience-v1.1.md`): Slices 1–3 done — UX-STRAT-001..004, UX-PIPE-001..005, UX-APPR-001..004, UX-ART-004 VERIFIED (Slice 3 manual acceptance PASS after UX-APPR-004 remediation). Remaining OPEN: 1 P0 (agent config UX-AGENT-001/003), 11 P1, 2 P2. Frozen walkthrough evidence: `control-platform-owner-ux-audit-v1.md` (unchanged).

## Deferred phases

Analytics/learning loop, L3/L4 autonomy, provider benchmarking, publication, production content.

## Hard governance invariants

Decision != Authority. UNKNOWN cost != zero. No silent activation/approval/publish. No secrets to frontend. No history rewriting. No destructive migrations for convenience.

## Next engineering task

NEXT_ENGINEERING_TASK = CONTROL_PLATFORM_OWNER_EXPERIENCE_V1_1 Slice 4 (SLICE_4_AGENTS) — only after Owner manual acceptance of Slice 3 (Owner opens Decision Center and Pipeline as a non-technical Owner and confirms attention truth).

## Files to read first

1. `docs/platform/current-platform-state.md` (this file)
2. `docs/platform/control-platform-owner-ux-audit-v1.md`
3. `docs/platform/control-platform-owner-experience-v1.1.md`
4. `docs/platform/control-platform-operational-proof-v1.md`
5. `docs/platform/strategic-operating-layer-v1-proof.md`
6. Relevant architecture/contracts (Node handler, database stores, worker runtime).
