# AMF E2E Completion Plan V1 — From Visual Human Gate to Operating Loop Proof

**Date:** 2026-09-18.  
**Workflow context:** `wf-1789233193749-gvydpiah` — PLATFORM_VALIDATION_MODE, Morroway as REFERENCE_PROJECT.  
**Current boundary:** visual-human gate `visual-human-gate-vi1-flux` PENDING.

## 1. Authority

Owner strategic direction: prove an end-to-end governed operating loop with Morroway as the validation project, not a publication-quality artifact.

## 2. Definitions

- **Visual stage disposition (current visuals):** ACCEPTED_FOR_PLATFORM_VALIDATION_ONLY.
- **Validation vs production:** platform invariants (idempotency, provenance, budgets, persistence, approvals) are mandatory in both modes; production-quality thresholds are not.

## 3. Proposed visual gate recording (audit, no implementation here)

Candidate human-disposition vocabulary for the current PENDING gate:
- `DECIDED / APPROVE / validation_acceptance` — meaning: accepted for platform validation only; production-approval remains NO.
- This is a proposed disposition string, not a claim that the current schema already supports it. A schema migration adding columns such as `production_approved: boolean` and `validation_accepted: boolean` (with a hard default of NO/false) is a separate, future artifact-producing change. No DB mutation or schema change is performed by this document.

## 4. Remaining E2E chain from the current boundary (source: `packages/orchestrator/src/definition.ts` `directiveToWorkflowDefinition` for `produce` with ordered stages and inserted gates)

Current deterministic stage order (engine-visible IDs), with implementation classes at end:

```
planner-initial → research → planner-synthesis → writer → seo → brand
→ review → [pre-production-owner-gate]        ← GOVERNED GATE (already passed via R8 media resume path)
→ director → tts → timeline → scene-image → visual-semantic-review → visual-technical-qa
→ [visual-human-gate-vi1-flux]                ← CURRENT BOUNDARY (PENDING, FLUX 5 visuals present)
→ wan-authorization                           ← Wan prompt/neg-prompt authorization per scene (fail-closed pre-Wan gate)
→ video                                       ← RunPod/Wan still-video per authorized scene (wan_video_generate)
→ composer                                    ← FFmpeg shortest-strategy multi-scene composition (scene clips + narration)
→ qa                                          ← QA gate stage (implemented, not the same as final-product-review)
→ final-product-review                        ← Final editorial review gate (stage BEFORE the final human gate)
→ [final-human-gate]                          ← Publication-bound human gate
→ publisher-authorization                     ← Per-asset publish readiness gate
→ publisher                                   ← YouTube Data API v3 publish + idempotencyKey
→ analytics                                   ← YouTube Analytics v2 fetch
→ (learning loop is not a step in this definition; it is a separate platform concern)
```

Relevant sources: orchestrator definition line `visual-technical-qa → visual-human-gate` and `final-product-review → final-human-gate`; engine `packages/workflow-engine/src/**` (DefaultWorkflowEngine); capability executors and provider abstractions.

## 5. Per-stage implementation assessment

| Stage | Status | Source / Notes |
|---|:---:|---|
| visual-human-gate (current) | IMPLEMENTED | `packages/workflow-engine/src/model/step.ts` kind=gate; handler exposes `PENDING` via API; production worker awaits `APPROVE` |
| wan-authorization | IMPLEMENTED | `packages/capabilities/src/capabilities.ts:WanCapabilityExecutor` + `packages/tool-framework/src/tools/wan.ts` `preWanGovernanceGate` |
| video | IMPLEMENTED | `packages/capabilities/src/capabilities.ts:VideoCapabilityExecutor` → `packages/provider-adapters/src/adapters/runpod-video.ts` (self-hosted-wan) |
| composer | IMPLEMENTED | `packages/provider-adapters/src/media-compose/...` FFmpeg shortest strategy; `packages/tool-framework/src/tools/compose.ts` |
| qa | IMPLEMENTED | `packages/qa-agent/src/qa-agent.ts` shape validators |
| final-product-review | IMPLEMENTED | `packages/reviewer-agent/src/**` reviewer gate (also QA-adjacent) |
| final-human-gate | IMPLEMENTED | engine gate step; handler `final-human-gate` case |
| publisher-authorization | IMPLEMENTED | `packages/capabilities/src/capabilities.ts:PublishingAuthorizationCapabilityExecutor` |
| publisher | IMPLEMENTED | `packages/provider-adapters/src/adapters/youtube.ts` publish w/ idempotencyKey + `packages/sessions/youtube-sessions.ts` resumable |
| analytics | IMPLEMENTED | `packages/capabilities/src/capabilities.ts:AnalyticsCapabilityExecutor` → `packages/analytics/src/youtube-analytics.ts` |
| learning / operating loop | PARTIAL | memory packages + `memory/decisions` logs exist; closed-loop scheduling / next-cycle starter is not a deterministic workflow step |

Single-workflow definition contains no deeper nested sub-workflow or RL loop — it runs once per directive, reporting final state and artifacts. The loop is a platform-level concern (scheduling + memory), not a workflow-engine step.

## 6. Gate decision vocabulary (audit)

The current approval handler validatesOwnerDecision against the closed set
`{APPROVE, MODIFY, REJECT, REQUEST_ITERATION, OVERRIDE}` (`apps/api/src/handler.ts:decideApproval`). "Accept for platform validation only" is not an alias for `APPROVE` in this audit — it requires either (a) a distinguishing payload bit on the APPROVE decision (e.g., `validation_acceptance` flag) or (b) the smallest governed schema extension that separates validation acceptance from production approval. No schema change is performed here; a future migration would add e.g. `production_approved boolean` plus severing `ORDER BY`-style policy implications.

## 7. Comforting vs. discomforting (projection, not an E2E self-report)

- Comforting: workflow engine linear execution (100+ suites passing), governed media chain (TTS/Timeline/Image/QA), media-resume budget/claims, worker parity, provider abstractions, YouTube publish idempotency + resumable upload store (`packages/sessions`), and stable FLUX validated 5/5 are real.
- Discomforting (projection): this definition has not yet run end-to-end under a single directive in the post-media-resume branch with owner approvals live; Wan/video/composer/publisher-analytics remain unproven as a chain in the current FLUX-validated config (provider cost and Wan parent-gate validations are pre-existing).

## 8. Two-completion taxonomy

### E2E_TECHNICAL_PROOF
Orchestration, governance, persistence, provider abstraction, agent execution, artifacts, approvals, budgets, QA, and publication-integrated preparation all execute/persist correctly.

### E2E_OPERATING_LOOP_PROOF
All of the above plus publishing integration, analytics ingestion, performance measurement, learning persistence, next-cycle recommendation, and the system's ability to start the next governed cycle.

The second is the autonomy proof; this current FLUX visual package is not expected to be production-approved as part of it.

## 9. Next execution

The smallest next governed step that advances the thesis is exactly one authorized video-stage preflight/execution under the current validated visuals → Wan authorization → video → composer → QA → final-product-review → final-human-gate, with no Visual Iteration #2 and no creative rewrites. Do not mutate the approved 5-visual package. A separate authorization is required for that execution; this document produces no provider calls and no worker restart.

## 10. Provisional validation disposition

Pending schema migration for the validation-vs-production split, this validation-only acceptance is best provisional as:

```
validation_accepted_for_e2e = true
production_approved = false
```

on the visual-human gate (the approved FLUX visuals are accepted for platform validation only; production approval remains NO). This is a proposed recording shape. Do not conflate it with a production APPROVE.

## References

- Orchestrator: `packages/orchestrator/src/definition.ts`, `packages/orchestrator/src/templates.ts`.
- API handler gates: `apps/api/src/handler.ts`.
- Capabilities: `packages/capabilities/src/capabilities.ts`, `packages/tool-framework/src/tools/wan.ts`, `packages/tool-framework/src/tools/compose.ts`.
- Provider adapters: `packages/provider-adapters/src/adapters/{runpod-image,runpod-video,youtube}.ts` and capability wrappers.
- Memory/decisions: `memory/decisions/`.
