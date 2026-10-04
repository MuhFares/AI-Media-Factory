# Strategic Operating Layer V1 — Operational Proof

Date: 2026-09-18/19. Zero provider/LLM/media/publication calls throughout (resolution, hashing, bootstrap, previews, grounding checks all deterministic and provider-free).

## Checkpoint ledger

| Checkpoint | Change | Unit | Integration | Browser/Smoke | Control regression | Worker parity | External calls |
|---|---|---|---|---|---|---|---|
| Slice 1 persistence+store | strategic.ts, schema DDL, index exports | 6/6 PASS (B/C/D/E/G) | — | — | — | unaffected | 0 |
| Slice 5 runtime | provenance column, governed passthrough, project-context resolver, worker wiring | — | 3/3 PASS + governed 9/9 PASS | — | — | drift expected | 0 |
| Slice 4 APIs | 8 Node routes, STRATEGY_ACTIVATION authority, server wiring, telemetry column | — | API 3/3 PASS | — | — | drift expected | 0 |
| Facade+UI | proxies, preview endpoint, Strategy surface, agent/artifact/command visibility | — | py 3/3 PASS | strat-qa 9/9 | qa 25/25 PASS | drift expected | 0 |
| Grounding correction | STRATEGY v2 (REAL-WORLD token) via governed propose→approve→activate | — | grounding 5/5 roles OK | — | — | — | 0 |
| Restart | controlled stop/start via pid-file mechanism | — | — | — | — | PASS, 1 worker | 0 |
| Final | — | — | — | strat 10/10, qa 25/25, 0 console errs, 0 failed reqs | PASS | PASS | 0 |

## Checkpoints B–H

- B (resolver): determinism (repeat resolves identical hash), relevance differs per role (visual-director excludes STRATEGY; ceo gets PRINCIPLES), ordering-invariant hash. Live previews: research [STRATEGY], writer/seo [BRAND,STRATEGY], director [BRAND], ceo [BRAND,STRATEGY].
- C (versioning): V1 ACTIVE → V2 proposal ineffective → V2 activation supersedes; old snapshots keep V1 refs; future resolves V2. Proven at store level AND on prod (STRATEGY v1 SUPERSEDED, v2 ACTIVE, previousActiveVersion recorded).
- D (governance): pending/rejected/wrong-scope/target-mismatch/project-mismatch all fail closed; duplicate activation idempotent; SUPERSEDED re-activation refused.
- E (lineage): snapshot reload keeps V1 refs post-supersession; execution→snapshot and artifact→snapshots endpoints; provenance column with first-write-wins (COALESCE) semantics.
- F (Control UI): Strategy surface + agent snapshot view + artifact lineage + command preview, all browser-proven.
- G (write path): isolated TEST-DB proposal→approval→activation→effective→reload (store 6/6, API 3/3, browser 10/10 on isolated namespace).
- H (bootstrap): plan-first execution, 5 entities (STRATEGY v2 + BRAND v1 ACTIVE with labeled fresh approvals citing existing Owner-approved evidence; CONTENT_SYSTEM/CONSTRAINTS/DECISION PROPOSED — no authority invented). No conflicts found. Old file artifacts untouched.

## Morroway active state

- STRATEGY primary v2 (pillars, formats, territory, essence w/ pending-review flag, adaptive pilot w/ basis flags).
- BRAND primary v1 (assets/architecture refs, prohibitions, pillars, voice rule).
- Health: INCOMPLETE (active: BRAND,STRATEGY) — honest; CONTENT_SYSTEM awaits Owner review.
- Pending historical visual gate untouched (lifecycle debt recorded, §71).

## Worker

Restarted controlled (stop pid 24216 → start pid 11192). Before: 1 live, queue 0/0. After: instance `e5b14891-…`, build `958b3b63…` == expected, 1 canonical worker, heartbeat fresh, queue unchanged (14/32). No provider task submitted for testing.

## Regression

Control V1 browser suite 25/25 PASS (one timing-only fix in QA harness, plus two minimal app repairs: pipeline loading state, artifacts full-list fetch — both justified under repair rule). No P0/P1 app defects remain. `apps/web` untouched (NON_CANONICAL_STUB).

## Decision

All 18 DoD items satisfied. No autonomy/analytics/benchmarking/publication touched. E2E_OPERATING_LOOP_PROOF remains NOT_YET by design.
