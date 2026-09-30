# AMF Remediation Registry — First-Read Authority

> THIS DIRECTORY IS THE FIRST-READ ENGINEERING AUTHORITY
> FOR ACTIVE AMF REMEDIATION WORK.

Do NOT infer current remediation state from old chat transcripts,
old milestone docs, or historical audit/proof documents.
Historical audits and proofs are immutable evidence — they describe
the past, not the current program state.

## Read in this order

1. `AMF_REMEDIATION_STATUS.md` — current overall state, Research Pilot state, per-program status.
2. `AMF_PROGRAMS_01_TO_05_FINAL_HANDOFF.md` — authoritative Programs 1–5 closure snapshot and future-agent rules.
3. `AMF_KNOWN_RISKS.md` — failure map, resolved/partial state, and open operational debt.
4. `AMF_HYGIENE_REGISTRY.md` — retained, deferred, break-glass, historical, and future-cleanup disposition.
5. `AMF_AGENT_HANDOFF_PROTOCOL.md` — mandatory protocol every remediation agent must follow.
6. `AMF_REMEDIATION_MASTER_PLAN.md` — why remediation exists, operating model, five programs, critical path.
7. Relevant Program file in `programs/`:
   - `programs/01-foundation-contracts.md` — Program 1
   - `programs/02-routing-preflight.md` — Program 2
   - `programs/03-recovery-state-lineage.md` — Program 3
   - `programs/04-media-publication-analytics.md` — Program 4
   - `programs/05-owner-autonomy.md` — Program 5
8. `AMF_E2E_CERTIFICATION_MATRIX.md` — E2E-01..E2E-18 certification state and exit evidence.

## Rules

- Documentation in this directory is the only mutable remediation state.
  Historical audits/proofs elsewhere (e.g. `docs/platform/*-audit*.md`,
  `*-proof.md`, incident files) are append-only and must NOT be rewritten.
- This task creates/updates documentation ONLY under `docs/remediation/`.
  No runtime source, config, workflow, script, DB, budget, worker, artifact,
  routing, provider, or job changes are authorized by this registry bootstrap.
- Prior audit findings may already be fixed in source. Before treating a risk
  as an active blocker, inspect current source. Mark verified fixes as
  `RESOLVED_AFTER_AUDIT` — do not keep stale blockers alive.
- If unsure about current state, record `UNKNOWN`. Never mark E2E `PASS`
  without exit evidence. Never mark a Program complete without its defined
  provider-free (and where applicable, live) exit criteria.

## Canonical inputs (read-only evidence, not duplicated here)

- Latest architecture/system gap audit:
  `AMF_END_TO_END_SYSTEM_GAP_AND_FAILURE_PREDICTION_AUDIT_V1` (referenced audit;
  no file by that exact name exists in-repo at bootstrap — failure map is
  preserved in `AMF_KNOWN_RISKS.md` from the bootstrap specification).
- Latest hygiene audit:
  `AMF_REPOSITORY_HYGIENE_AND_LEGACY_CLASSIFICATION_V1` (referenced audit;
  classifications preserved in `AMF_HYGIENE_REGISTRY.md`).
- `docs/platform/current-platform-state.md`
- `docs/platform/amf-master-program-state.md`
- `docs/platform/amf-full-platform-product-architecture-audit-v1.md`
- Research V2 cycle + engine recovery proofs
  (`morroway-research-intelligence-direction-cycle-v2*.md`,
  `morroway-research-intelligence-v2-engine-readiness-recovery-v1.md`)
- Pilot Phase-1 preflight / remediation / rerun / governed-recovery /
  orchestrator-contract diagnostics docs.

## Bootstrap version

`AMF_REMEDIATION_MASTER_REGISTRY_BOOTSTRAP_V1` — 2026-09-27.
