# Morroway Production Pilot 1 — Phase 1 live preflight

Date: 2026-09-25  
Result: **FAIL-CLOSED / NO PROVIDER EXECUTION**

## Authorization examined

The Owner authorized one real Morroway Phase-1 package: governed retrieval and
routed text agents through research, strategy/recommendation, brief, script,
scenes, visual direction, and textual review/QA. The authorization explicitly
excludes media generation, composition, publication, analytics, M4 reads, and
automation escalation.

## Evidence examined

- Active Morroway routing is `amf-balanced-production-routing-v1-morroway`,
  profile `BALANCED`, sourced from benchmark run
  `amf-mrb-v1.1.1-real-20260924-r2` / dataset `AMF-MRB-V1.1.1`.
- The active project has hard, unused budgets: research `1`, text-agent `5`,
  image `3`, video `3`, voice `1`, private upload `1`; all retry limits are
  zero.
- The live Node API preflight at
  `GET http://127.0.0.1:8080/control/content/content-muf41ju0-vuxvme`
  returned `ready=false`, with no provider call and no budget consumption.

## Blocking runtime contradictions

1. `apps/api/src/handler.ts` `pilotPreflight()` resolves text roles through
   historical ControlPlane/environment configuration (`PILOT_TEXT_MODELS`) and
   treats media routes as mandatory. It does not resolve the active canonical
   Morroway routing version. The live result showed legacy Nex/Dots routes and
   nine unresolved routes, instead of the approved Balanced routes.
2. `contentStartProduction()` creates the full `produce` definition behind an
   initial all-provider authority gate. Its command context does not carry the
   project id required by the worker's canonical-routing resolver.
3. The full `produce` definition is not a Phase-1 definition: it continues
   through TTS, image, video, composition, publishing and analytics after the
   existing review gate. It does not contain the authorized Phase-1 strategy,
   CEO, hooks, or pre-media visual-prompt sequence.
4. In the worker, ordinary production Research is deliberately routed to a
   deterministic executor after governed retrieval, while the approved
   Morroway synthesis route is GPT-6 Luna. Planner is also deterministic
   outside the strategy-council mode. Thus releasing the old gate would not
   prove the approved routed Research/Planner text path.
5. The hard pilot call budgets are checked at preflight but are not consumed
   atomically for ordinary Research/text-model provider submissions. A live
   run would not meet the requested per-call budget evidence requirement.

## Decision

No content item was created or reused for this pilot. The existing
`content-muf41ju0-vuxvme` item is a prior provider-free readiness walkthrough,
not a real-topic selection, and was used only for a read-only preflight.

No real retrieval, LLM inference, media call, upload, publication, analytics,
or M4 call occurred. This prevents the current runtime from spending against
the wrong route or crossing into unauthorized media work.

## Required correction before a live Phase-1 rerun

Implement and provider-free prove a canonical Phase-1 execution boundary that:

1. carries `projectId`, the active routing version, and explicit Phase-1
   authority into the durable workflow;
2. resolves all model-backed Phase-1 roles from the active project routing;
3. separates retrieval from canonically routed Research synthesis;
4. has a finite text/research-only sequence and a durable Owner stop before
   any media-stage capability;
5. enforces and records each Research/text call budget before provider
   transport; and
6. persists route, price snapshot, token/cost, artifact, and workflow lineage.

This is a runtime remediation prerequisite, not an authorization for media or
publication.
