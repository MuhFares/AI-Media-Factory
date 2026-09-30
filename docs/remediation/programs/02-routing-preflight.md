# Program 2 — Routing + Preflight

- PROGRAM_ID: `PROGRAM_02_ROUTING_PREFLIGHT`
- PROGRAM_NAME: Routing + Preflight
- PURPOSE: Create one authoritative model/provider routing system and prevent
  invalid provider requests before transport/budget consumption.
- STATUS: `PROVIDER_FREE_PASS`

## SCOPE_IN

- ROUTING: DB production routing authoritative for branded projects; remove
  Morroway-only routing enforcement; remove/demote ambient production model
  literals; special modes through canonical resolver; Strategy Council
  specialists canonically routed; canonical route provenance persisted;
  benchmark route ↔ worker route parity enforced.
- PREFLIGHT: LLM model existence; provider availability; protocol/endpoint
  compatibility; context-fit; structured-output/schema support; retrieval
  query/capability constraints; publish token liveness; analytics route
  validity. Fail before reservation/transport when possible.
- Regression coverage for the already-remediated Targeted Verification
  reevaluation routing (canonical Morroway research routing + model preflight).

## SCOPE_OUT

- Contract authority changes (P1), generic recovery framework (P3), media
  chain/publication/analytics product behavior (P4), owner autonomy (P5).
- New providers/models; benchmark inference; live production execution.
- Rewriting historical routing/benchmark evidence.

## DEPENDENCIES

- Requires P1 provider-free pass (stable contracts/stages before routing cutover).
- Blocks P3–P5 certification (recovery/media/autonomy assume canonical routes).

## AUDIT_FINDINGS_ADDRESSED

- Routing fragmentation + bypass; stale/invalid specialist models; missing text
  preflight; sandbox-vs-provider failure ambiguity (EACCES post-hoc diagnosis).

## RISKS_ADDRESSED

F-04, F-05, F-06, F-16, R-2, R-3 (+ F-07 shared with P3).
See `../AMF_KNOWN_RISKS.md`.

## HYGIENE_BEFORE

- Dist-pinned test risk (`canonical-production-routing.test.js` TEST DB provisioning).
- Env vs DB routing duplication (ControlPlane/env vs DB vs ambient literals).

## HYGIENE_DURING

- `configs/` agents/models placeholders (resolve/remove via canonical resolver).
- Benchmark harness sprawl (consolidate; enforce parity).

## HYGIENE_AFTER

- Archive superseded routing docs/configs only after parity proven; no deletes before.

## ENGINEERING_WORKSTREAMS

1. WS1-Authority: DB routing canonical for branded projects; remove Morroway-only
   enforcement; demote/remove ambient literals; provenance persisted.
2. WS2-Resolver: special modes + Strategy Council specialists through canonical
   resolver; parity benchmark↔worker.
3. WS3-Preflight: full matrix (model, provider, protocol/endpoint, context-fit,
   structured-output, retrieval, publish token, analytics route); fail-closed
   before reservation/transport.
4. WS4-Regressions: targeted reevaluation recovery routing regression tests
   (preserve the completed pre-program fix).

## PROVIDER_FREE_EXIT_CRITERIA

- **E2E-11** (provider/model unavailable before transport) passes provider-free.
- **E2E-16** (routing drift) passes provider-free.
- Targeted reevaluation recovery routing regression tests pass provider-free.
- Zero provider calls.

## LIVE_EXIT_CRITERIA

- NOT_APPLICABLE. No live execution required to close P2.

## REQUIRED_E2E_SCENARIOS

E2E-11, E2E-16 (exit); E2E-14 and E2E-17 exercised as invariants.

## BLOCKERS

- None recorded at bootstrap.

## COMPLETED_TASKS

- (Pre-program, preserved) Targeted Verification reevaluation routing remediated
  to canonical Morroway research routing with model preflight
  (`TargetedVerificationReevaluationRecoveryDispatcher`). Do NOT mark Program 2
  complete because this one mode was fixed.
- `AMF_REMEDIATION_PROGRAM_02_ROUTING_PREFLIGHT_V1`: DB project routing is the
  sole branded-production authority; universal LLM/retrieval and bounded
  publication/analytics preflight contracts are implemented; Command Room,
  Strategy Council, targeted reevaluation recovery, project isolation,
  explicit fallback, provenance, drift, and budget-ordering regressions pass.
- E2E-11 and E2E-16 pass provider-free against isolated PostgreSQL. No live
  provider, workflow, production DB, budget, Research Pilot, or Job 68 mutation.

## CURRENT_TASK

- None; provider-free exit certified.

## NEXT_TASK

- `PROGRAM_03_KICKOFF` (not started by this task).

## CHANGELOG

- 2026-09-27: Program file created by `AMF_REMEDIATION_MASTER_REGISTRY_BOOTSTRAP_V1`. Status `NOT_STARTED`; pre-program reevaluation fix preserved as completed task.
- 2026-09-27: Program activated by
  `AMF_REMEDIATION_PROGRAM_02_ROUTING_PREFLIGHT_V1`. Pre-kickoff risk mapping
  reconciled against canonical definitions: P1 `R-1` resolution is valid;
  Program 2 owns `R-2` and `R-3`.
- 2026-09-27: Provider-free exit certified. F-04/F-05/F-06 and R-2/R-3
  resolved; F-16 preventive environment preflight completed while post-start
  failure classification remains Program 3; F-12 remains Program 4 because
  provider-free token liveness is intentionally `UNKNOWN_REQUIRES_REFRESH`.
