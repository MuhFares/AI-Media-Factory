# AMF Platform Validation Mode V1 — Approved Strategic Direction

**Authority:** Owner strategic direction — record only (audit posture).  
**Date:** 2026-09-18.  
**Workflow context when approved:** `wf-1789233193749-gvydpiah` at `visual-human-gate-vi1-flux` PENDING.

## 1. Primary objective

```
AMF_CURRENT_PRIMARY_OBJECTIVE = PROVE_PLATFORM_END_TO_END_OPERATION
```

AMF is an autonomous/semi-autonomous media operating platform. The current goal is to prove an end-to-end governed workflow operating loop through the real platform architecture. Morroway is the reference validation project. Temporary validation components (self-hosted image, Dots/nex free-tier LLMs, early TTS) are expected to be imperfect.

## 2. Project posture

```
CURRENT_MORROWAY_ROLE = REFERENCE_PROJECT_FOR_PLATFORM_VALIDATION
CURRENT_OBJECTIVE_IS_NOT = PRODUCTION_QUALITY_OPTIMIZATION
```

We do not spend additional cycles optimizing visual aesthetics, voice selection, or creative quality unless required to unblock a platform transition.

## 3. Two modes

### PLATFORM_VALIDATION_MODE

Prove orchestration, governance, persistence, provider abstraction, agent execution, artifacts, approvals, budgets, QA, observability, learning, and lifecycle transitions. Known quality imperfections may be accepted as validation findings when they do not misrepresent platform mechanics.

### PRODUCTION_MODE

Produce publication-quality assets. May later require stronger models/providers, stricter semantic QA, brand gates that reject validation-grade aesthetics, continuity systems, and production-grade voices/video capabilities. Do not silently treat validation acceptance as production approval.

## 4. Stage disposition

The five current FLUX images are:

```
ACCEPTED_FOR_PLATFORM_VALIDATION_ONLY
NOT CREATIVE_APPROVED_FOR_PRODUCTION
```

Candidate human-disposition vocabulary for the current visual gate:
- Valid PENDING outcome → `DECIDED / APPROVE / validation_acceptance` (accepted for platform validation only; production-approval bit must remain NO so the schema can distinguish the two states).
- Production approval requires a separate future disposition (new implementation).

## 5. Non-goals of this direction

Creating Visual Iteration #2, regenerating scenes, invoking Z-Image, or changing the creative contract is explicitly deferred.

## 6. Operational implication

A validation-accepted branch must still pass all platform invariants (idempotency, provenance, budget, claims, persistence, approvals). It may not be treated as a production-approved branch for publication or higher-order orchestration.

## References

- This direction: owner statement establishing Morroway as reference validation project (this file).
- Previous visual-human gates: see `produced/v1/e2e-v1-closure`-era visual gates (separate approval lineage; not conflated).
- Remaining E2E chain definition: `docs/platform/e2e-completion-plan-v1.md` (next document).
