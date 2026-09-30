# AMF Hygiene Registry

Bootstrap: `AMF_REMEDIATION_MASTER_REGISTRY_BOOTSTRAP_V1` (2026-09-27)

Policy: hygiene is NOT an uncontrolled cleanup project. Every action links to
an owner remediation program. Canonical rule:

> NO LEGACY DELETE BEFORE REPLACEMENT CERTIFIED.

Safe deletion sequence: (1) GENERATED/ignored outputs → (2) placeholder
pointer/docs cleanup → (3) migration → (4) replacement certification →
(5) archive → (6) delete only with explicit evidence.

Classifications: `KEEP_CANONICAL` | `KEEP_TEMPORARILY` | `LEGACY_STILL_REFERENCED` |
`DUPLICATE` | `DEAD_CODE` | `PLACEHOLDER` | `GENERATED` | `TEST_ONLY` |
`MIGRATION_REQUIRED` | `SAFE_TO_DELETE` | `UNKNOWN_DO_NOT_TOUCH`.

`UNKNOWN_DO_NOT_TOUCH` items must NEVER be marked for deletion.
Evidence/proof/audit/incident files are append-only and never hygiene targets.

Columns: PATH | CLASSIFICATION | CURRENT_OWNER_PROGRAM |
ACTION | PRECONDITION | DELETE_ALLOWED | STATUS | NOTES.

`STATUS`: `REGISTERED` | `IN_PROGRESS` | `MIGRATED` | `CERTIFIED` |
`ARCHIVED` | `DELETED` | `DEFERRED`. All items start `REGISTERED` at bootstrap.

---

## Program 1 — Foundation (before/inside P1)

| PATH | CLASSIFICATION | CURRENT_OWNER_PROGRAM | ACTION | PRECONDITION | DELETE_ALLOWED | STATUS | NOTES |
|---|---|---|---|---|---|---|---|
| Hooks stage references (orchestrator templates/contracts; no canonical agent/runtime) | LEGACY_STILL_REFERENCED | P1 | Responsibility migrated to Brief→Writer; legacy artifact read-only | P1 Hooks decision + E2E-04 | NO | CERTIFIED | No canonical Hooks stage or new `hook_concepts` writes |
| Visual Director runtime gap (spec declares `visual_direction_contract`; templates emit `visual_direction_plan`) | KEEP_CANONICAL | P1 | Canonical new-write kind is `visual_direction_contract` | P1 F-02 resolution + E2E-04 | NO | CERTIFIED | `visual_direction_plan` retained only as `LEGACY_READ_ONLY` |
| Artifact kind duplication (`AgentArtifactKind` in `packages/shared/src/collaboration.ts` vs `VISUAL_DIRECTOR_OUTPUT_KIND` vs `KIND_BY_AGENT`/`KIND_BY_STEP` in `apps/worker/src/*executor*.ts`) | KEEP_CANONICAL | P1 | Shared catalog/registry validates every operational template and critical runtime boundary | P1 contract authority | NO | CERTIFIED | CEO=`ceo_recommendation`; Visual=`visual_direction_contract`; Strategy Council remains distinct |
| Unsupported directives (orchestrator directives beyond governed produce path) | KEEP_TEMPORARILY | P1 | Retained for read/decision compatibility; blocked before executable definition/submission | P1 validator | NO | CERTIFIED | `plan`/`research` retired; `implement`/`verify`/`ship` unsupported; produce variants operational |
| `docs/brand-architecture-and-naming-hierarchy-v1.md` + brand naming docs disposition | KEEP_TEMPORARILY | P1 | Confirm canonical brand architecture JSON owner; archive duplicates | Later explicit hygiene authorization | NO | DEFERRED | Runtime contract work did not justify document archival |
| Pointer/STATUS docs where safe (stale pointers superseded by this registry) | PLACEHOLDER | P1 | Cleanup pass only for safe pointer docs | Later explicit hygiene authorization | YES (docs only, non-evidence) | DEFERRED | No broad cleanup performed; evidence/audit files untouched |

## Program 2 — Routing/Preflight (before/inside P2)

| PATH | CLASSIFICATION | CURRENT_OWNER_PROGRAM | ACTION | PRECONDITION | DELETE_ALLOWED | STATUS | NOTES |
|---|---|---|---|---|---|---|---|
| Dist-pinned test risk (`canonical-production-routing.test.js` fails without `TEST_DATABASE_URL`; combined command avoids live DB) | TEST_ONLY | P2 | Build first; isolated TEST DB only | P2 test plan | NO | CERTIFIED | Tests import current dist; legacy routing test no longer reads production `DATABASE_URL` |
| Env vs DB routing duplication (ControlPlane/env routes vs DB production routing vs ambient literals) | DUPLICATE | P2 | DB production routing authoritative for branded execution | P2 routing cutover + E2E-16 | NO | CERTIFIED | Ambient/file defaults limited to explicit unbranded bootstrap/development contexts |
| `configs/` agents/models placeholders | PLACEHOLDER | P2 | Mark non-authoritative/documentation-only | P2 resolver | NO | CERTIFIED | READMEs explicitly defer stage/routing/catalog truth to canonical runtime/DB |
| Benchmark harness sprawl (benchmark drivers, packets, shortlists) | KEEP_TEMPORARILY | P2 | Consolidate later; route parity now enforced at worker preflight | P2 parity check | NO | DEFERRED | No broad cleanup; immutable benchmark evidence untouched |

## Program 3 — Recovery/State/Lineage (before/inside P3)

| PATH | CLASSIFICATION | CURRENT_OWNER_PROGRAM | ACTION | PRECONDITION | DELETE_ALLOWED | STATUS | NOTES |
|---|---|---|---|---|---|---|---|
| Root `run-council*.mjs` / `run-recovery*.mjs` runners (~20 root `run-*.mjs`) | LEGACY_STILL_REFERENCED | P3 | Quarantined behind explicit legacy override + test-DB-only guard; archive later | P3 framework + E2E-12/E2E-18 | NO | CERTIFIED | Production invocation fails closed; archival is non-dangerous deferred cleanup |
| `work/` direct writers (scratch duplication) | LEGACY_STILL_REFERENCED | P3 | Canonical `createPool` rejects `work/` entry points unless explicitly allowed against a test DB; direct-`pg` scripts carry the same guard | P3 lineage rules | NO | CERTIFIED | Production DB execution fails closed; archival and historical evidence classification remain deferred |
| v6/v7 launchers | LEGACY_STILL_REFERENCED | P3 | Dispatch and worker launchers quarantined by test-DB-only legacy guard | P3 framework | NO | CERTIFIED | `v6/v7-dispatch` and `v6/v7-run-worker` fail closed for production targets |
| Lifecycle script duplication | DUPLICATE | P3 | Canonical runtime lifecycle resolver certified; historical script consolidation deferred | P3 state invariants | NO | DEFERRED | Non-dangerous archival cleanup is not an exit requirement |
| Old worker launchers (pre-`scripts/persistent-worker.mjs`) | LEGACY_STILL_REFERENCED | P3 | Persistent worker is canonical; historical media worker launchers quarantined | Singleton enforcement (F-14) | NO | CERTIFIED | `media-resume-r1-worker` and `media-proof-worker` use test-DB-only guard; Job 68 untouched |
| Singleton behavior (stale PID/supervisor records) | KEEP_TEMPORARILY | P3 | DB advisory singleton + worker/job leases + sweeper implemented; retain launcher guard as defense-in-depth | P3 E2E-12/E2E-18 | NO | CERTIFIED | Isolated PostgreSQL proves first/second/crash and healthy long-running behavior |

## Program 4 — Media/Publication/Analytics (before/inside P4)

| PATH | CLASSIFICATION | CURRENT_OWNER_PROGRAM | ACTION | PRECONDITION | DELETE_ALLOWED | STATUS | NOTES |
|---|---|---|---|---|---|---|---|
| `packages/tts-agent` | LEGACY_STILL_REFERENCED | P4 | Worker dependency removed; package retained read-only for historical tests/evidence | P4 canonical media chain certified (E2E-05) | NO | CERTIFIED | No current worker source import; physical archival deferred |
| `packages/timeline-executor` | LEGACY_STILL_REFERENCED | P4 | Worker dependency removed; package retained read-only for historical tests/evidence | Same as above | NO | CERTIFIED | No current worker source import; historical runner remains quarantined |
| Legacy thumbnail/video kinds (legacy `thumbnail_report`/`video_report` chain, FLUX-derived scene files marked INVALID-LINEAGE) | MIGRATION_REQUIRED | P4 | Canonical new-production guard rejects legacy writes; historical readers/tests retained | P4 migration + certification | NO | CERTIFIED | Canonical E2E emits only scene/final-media kinds |
| Media proof scripts (one-off media runners) | KEEP_TEMPORARILY | P4 | Archive after canonical chain proven | P4 provider-free pass | NO | DEFERRED | Non-dangerous cleanup; proof outputs immutable |
| Generated outputs (`output/`, `artifacts/`, repo-local files) separation | GENERATED | P4 | Object-storage/lifecycle policy; keep serving confined endpoint | P4 artifact policy | YES (only ignored/regenerable outputs, with evidence) | DEFERRED | Live object-storage/retention choice follows bounded canary; no deletion performed |

### Program-4 closure carry-forward (2026-09-29)

No cleanup or deletion was performed during Owner closure. The following debt
is carried forward for deliberate, reference-checked archival or lifecycle
policy work: physical archival of legacy `packages/tts-agent`; physical
archival of legacy `packages/timeline-executor`; historical media-proof and
one-off canary scripts; generated-output retention/object-storage policy; and
historical one-off canary artifacts. Live-canary evidence remains immutable.

## Program 5 — Owner Autonomy (before/inside P5)

| PATH | CLASSIFICATION | CURRENT_OWNER_PROGRAM | ACTION | PRECONDITION | DELETE_ALLOWED | STATUS | NOTES |
|---|---|---|---|---|---|---|---|
| `apps/web` stub | PLACEHOLDER | P5 | Do not recreate; AMF Control static UI is canonical | P5 UI decision | NO | COMPLETED | Current executable tree has no `apps/web`; absence is intentional, not an unresolved authority |
| Python facade duplicated read-models (`apps/api/src/ai_media_factory/`) | DUPLICATE | P5 | Keep serve/auth/CSRF/proxy only; move domain truth to Node | P5 owner-plane design | NO | COMPLETED | Credential health and all state-changing Owner actions are Node-authoritative; Python only serves/authenticates/CSRF-checks/proxies. Further read-model thinning is non-blocking cleanup |
| Node/Python owner-plane overlap | DUPLICATE | P5 | Node mutates; Python is compatibility edge | P5 UI decision | NO | COMPLETED | Architecture decision recorded and provider-free tested |
| UI documentation drift (V1.1 tracker vs audit vs implementation) | PLACEHOLDER | P5 | Remediation registry now records canonical decision | P5 UI decision | NO (docs archive only) | PARTIAL | Historical walkthroughs remain immutable; broader product docs can be reconciled later |
| Scripts-only owner operations (one-off ops scripts, including guarded Program-4 narrow migration and opaque credential binding) | MIGRATION_REQUIRED | P5 | Productize normal actions; retain engineering tools as break glass | P5 autonomy exits | NO | COMPLETED | All normal operations, including credential health/refresh, have UI/API paths with zero script/direct-DB requirement. Legacy credential tooling is explicit guarded `BREAK_GLASS_ONLY`; historical evidence is preserved |

Program-5 dead-code deletion was intentionally not performed. Historical proof
and break-glass tooling remain preserved; no file was archived or deleted.

## Programs 1–5 final closure classification (2026-09-30)

This reconciliation changes no files outside the remediation registry and
authorizes no cleanup. It groups the existing entries for safe future handoff:

- COMPLETED: canonical stage/artifact contracts; DB routing authority;
  provider-free recovery/state/lineage framework; legacy media new-write
  guards; single Node mutation authority; AMF Control Owner paths; script-zero
  and direct-DB-zero normal operation.
- DEFERRED: Google OAuth productionization; Wan deployment/receipt storage;
  backup/restore; durable object storage and generated-output retention;
  scaling; final voice/visual standards; public-publication lifecycle.
- BREAK_GLASS_ONLY: guarded credential bootstrap/recovery tools, narrow
  production migration operators, and explicitly guarded engineering recovery
  scripts. They are not normal Owner instructions.
- HISTORICAL: Program-4 proof scripts and one-off canary artifacts, legacy
  benchmark/proof outputs, superseded readiness incidents, and closed Research
  Pilot evidence. Historical evidence is immutable.
- DO_NOT_TOUCH: Job 68 and workflow `wf-1790228899612-hyfzmb2k`; the closed
  Research Pilot records; Program-4 live artifacts/audits; credential failure
  history; and Owner decisions. Reopening or mutation requires explicit Owner
  authority.
- SAFE_FUTURE_CLEANUP: physical archival of `packages/tts-agent` and
  `packages/timeline-executor`; media-proof/old-runner archival after reference
  checks; Python read-model thinning; broader dead-code sweep; and lifecycle
  handling for generated outputs. No deletion is implied.

## Explicitly out of hygiene scope (never targets)

Historical audits, proofs, incident files (e.g. `docs/platform/*-proof.md`,
`*-audit*.md`, `docs/incidents/*`), benchmark price snapshots/catalog
evidence, private validation publication record (`AfbPyQ-UFwM`), blind-review
packets. Append-only forever.
