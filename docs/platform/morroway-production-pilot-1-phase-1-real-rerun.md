# Morroway Production Pilot 1 — Phase 1 Real Rerun

Date: 2026-09-25  
Result: `FAIL` (fail-closed during the first real model transport)  
Execution mode: `REAL`

## Scope and preserved history

This record is the authorized real rerun after
`MORROWAY_PRODUCTION_PILOT_1_PHASE_1_RUNTIME_REMEDIATION_V1 = PASS`.
It does not replace the earlier failed preflight or remediation proof. The run
used the bounded `produce-pre-media` path and retained the mandatory Owner gate
and all Phase-2 prohibitions.

## Canonical identities

- Project: `morroway`
- Content: `content-mug6d970-jrkufn`
- Workflow: `wf-1790293235186-1l4105j4`
- Routing version: `amf-balanced-production-routing-v1-morroway`
- Working title: `Morroway Pilot 1 — intelligence-selected factual Short`
- Requested topic: select the strongest evidence-grounded factual micro-story
  using Morroway strategy, governed retrieval, and executive reasoning.
- Format: YouTube vertical Short, English, 30-second target, four-scene target,
  no identity-critical recurring human.

The content item was created through the authenticated Owner API. Start
Production returned `QUEUED_PRE_MEDIA_PHASE`, with the correct project,
bounded phase, terminal gate, and routing version.

## Real execution result

The real worker claimed job `69` exactly once. The first stage resolved the
Orchestrator through active canonical Morroway routing to OpenRouter model
`openai/gpt-oss-20b`.

Atomic budget reservation succeeded before transport. The transport then
failed locally with `EACCES` while opening port 443. No provider HTTP response
was received. The execution is persisted as `PROVIDER_TRANSPORT_FAILED`, the
job and workflow are `FAILED`, and the budget reservation is
`FAILED_AFTER_SUBMISSION`. Automatic retries are zero, so no retry or
replacement run was attempted.

This is an execution-environment network-policy failure. It is not model
quality evidence and is not evidence that OpenRouter rejected the request.

## Counters and cost evidence

- Real LLM transport attempts: `1`
- Completed provider inferences: `0`
- Research provider calls: `0`
- Text-agent budget: one of ten calls consumed, zero reserved
- Research budget: zero of one call consumed, zero reserved
- Input/output tokens: `UNKNOWN` (no provider response)
- Calculable cost: `UNKNOWN`
- Provider-billed cost: `UNKNOWN`
- Recorded latency to failure: `187 ms`
- Artifacts produced: `0`

The reservation preserved the exact model but has a null price-snapshot
reference. That is a production cost-provenance gap. It did not weaken the
pre-transport call-count cap and did not cause proven spend, but it must be
corrected or explicitly resolved before a further real retry if price-based
exposure is expected.

## Safety and Owner-product result

- Image/video/voice generations and media provider calls: `0`
- Uploads and publication side effects: `0`
- Analytics and M4 calls: `0`
- Owner pre-media gate: `NOT_REACHED`
- Media, production, and publication authority: `NOT_GRANTED`

The content/workflow and structured failure are visible through the normal
Content detail API/UI, but no pre-media package exists because the first stage
failed. Owner reviewability is therefore `PARTIAL`.

## Required next decision

A further attempt requires an explicit, governed recovery decision because
the current call is terminal and the configured retry allowance is zero. The
recovery must run from an environment permitted to reach OpenRouter, preserve
this failed execution, and correct or verify price-snapshot propagation before
transport. No Phase 2 or publication authority follows from that decision.
