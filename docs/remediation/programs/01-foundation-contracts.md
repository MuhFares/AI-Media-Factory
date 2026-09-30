# Program 1 — Foundation Contracts

- PROGRAM_ID: `PROGRAM_01_FOUNDATION_CONTRACTS`
- PROGRAM_NAME: Foundation Contracts
- PURPOSE: Eliminate contract drift and stage-definition ambiguity before
  further live downstream execution.
- STATUS: `PROVIDER_FREE_PASS`

## SCOPE_IN

- Hooks stage decision: implement canonical agent/runtime OR remove/migrate stage explicitly.
- Visual Director stage decision: canonical runtime implementation + artifact contract
  (resolve `visual_direction_plan` vs `visual_direction_contract`).
- Canonical CEO artifact/output model: resolve `ceo_report` vs `ceo_recommendation`
  vs Strategy Council V2 output relationships.
- Canonical `AgentArtifactKind` / artifact schema authority (single source; derive the rest).
- Single canonical stage catalog.
- Derive or reconcile: `KIND_BY_AGENT`, `KIND_BY_STEP`, execution modes,
  production agent registry, governed provider agent registry.
- Producer→consumer contract validators.
- Gate unsupported directives before submission.
- Clarify legacy vs current media artifact kinds.
- Source verification pass: `packages/shared/src/collaboration.ts`,
  `packages/tool-framework/src/visual-direction/visual-director-spec.ts`,
  `packages/orchestrator/src/definition.ts` + `templates.ts`,
  `apps/worker/src/executor.ts` + `production-executor.ts`,
  `packages/database/src/lifecycle.ts`, CEO/strategy contracts.

## SCOPE_OUT

- Routing/preflight changes (P2), recovery framework (P3), media/publication/analytics (P4),
  owner UI/autonomy (P5).
- Live provider execution, media generation, publication, benchmark runs.
- Deleting legacy chains (registered for P4; read-only until then).
- Rewriting historical audits/proofs.

## DEPENDENCIES

- Entry program after Research Pilot close (pilot evidence is input).
- Blocks P2–P5 live downstream execution: no downstream provider-free
  certification is valid on drifting contracts.

## AUDIT_FINDINGS_ADDRESSED

- Contract drift / stage-definition ambiguity (system gap audit).
- Visual direction kind mismatch; CEO output ambiguity; artifact-kind duplication;
  unsupported directives; brand architecture JSON disposition (hygiene audit inputs).

## RISKS_ADDRESSED

F-01, F-02, F-03, R-1. See `../AMF_KNOWN_RISKS.md`.

## HYGIENE_BEFORE

- Hooks missing runtime (UNKNOWN_DO_NOT_TOUCH until decision).
- Visual-director missing runtime (MIGRATION_REQUIRED).
- Artifact kind duplication (DUPLICATE).
- Unsupported directives (UNKNOWN_DO_NOT_TOUCH; gate, don't drop).
- Brand architecture JSON disposition (KEEP_TEMPORARILY).
- Pointer/STATUS docs where safe (PLACEHOLDER cleanup, evidence excluded).

## HYGIENE_DURING

- Establish schema authority; mark superseded derivations as DUPLICATE with derivation links.

## HYGIENE_AFTER

- Archive superseded pointer docs only; no runtime deletes in P1.

## ENGINEERING_WORKSTREAMS

1. WS1-Hooks: inventory all Hooks references; Owner decision (implement vs
   remove/migrate); implement or migrate; regression tests.
2. WS2-VisualDirector: unify artifact kind; canonical runtime + contract;
   migrate template/lifecycle/collaboration references; fixtures.
3. WS3-CEO: canonical CEO artifact/output model + Strategy Council V2
   relationship; sufficiency/partial-mode semantics aligned with E2E-02.
4. WS4-Authority: single `AgentArtifactKind`/schema authority + stage catalog;
   reconcile `KIND_BY_AGENT`/`KIND_BY_STEP`/modes/registries; validators;
   unsupported-directive gate; legacy-vs-current media kind table.

## PROVIDER_FREE_EXIT_CRITERIA

- **E2E-01** Owner→Research→CEO passes provider-free.
- **E2E-04** CEO→Brief→Script→Scenes→Visual Direction passes provider-free.
- Zero provider calls; real DB + real worker; artifacts/state/budget per matrix.

## LIVE_EXIT_CRITERIA

- NOT_APPLICABLE. No live execution required to close P1.

## REQUIRED_E2E_SCENARIOS

E2E-01, E2E-04 (exit); E2E-02 exercised as invariant (insufficient-evidence path must not stall).

## BLOCKERS

- None recorded at bootstrap. Verify F-01/F-02/F-03 against current source first.

## COMPLETED_TASKS

- Established `CANONICAL_STAGE_CATALOG` and runtime artifact contract registry
  in `@ai-media-factory/shared`.
- Removed Hooks from new production templates and runtime registries because
  its output had no Writer consumer; `hook_concepts` is `LEGACY_READ_ONLY` and
  hook responsibility is carried by `evidence_backed_content_brief.hookDirection`.
- Canonicalized Visual Direction new writes to `visual_direction_contract`;
  `visual_direction_plan` is `LEGACY_READ_ONLY`.
- Canonicalized the production CEO output to `ceo_recommendation`. Raw
  specialist reports and `STRATEGY_COUNCIL_SYNTHESIS_V2` remain distinct
  contracts; they are not aliases of the CEO production decision.
- Added deterministic CEO Research modes: `ADVANCE`, `HOLD`,
  `RETURN_TO_OWNER`, `NO_PRODUCTION_CANDIDATE`. Non-advance modes create a
  bounded Owner stop and cannot fabricate a Brief.
- Gated retired/unsupported directives before executable definition creation.
  Only `produce` and `produce-pre-media` have operational definitions certified
  provider-free; this does not claim live-production readiness.
- Certified producer→consumer contracts, E2E-01 eligible/insufficient, and
  E2E-04 with the real isolated PostgreSQL queue, worker, and workflow engine.

## CURRENT_TASK

- None; provider-free exit achieved.

## NEXT_TASK

- Program 02 kickoff. No Program-1 live canary is required.

## CHANGELOG

- 2026-09-27: Program file created by `AMF_REMEDIATION_MASTER_REGISTRY_BOOTSTRAP_V1`. Status `NOT_STARTED`.
- 2026-09-27: `AMF_REMEDIATION_PROGRAM_01_FOUNDATION_CONTRACTS_V1` passed all
  provider-free exit criteria. Zero external provider calls and zero production
  database/workflow/budget mutations.
- 2026-09-27: Program-2 pre-kickoff reconciliation verified that Program 1
  correctly resolved contract authority risk `R-1`; routing authority is `R-2`
  and recovery/state risks are `R-4`/`R-5`. Production wording was narrowed to
  `OPERATIONAL_DEFINITION_PROVIDER_FREE` rather than live-ready.
