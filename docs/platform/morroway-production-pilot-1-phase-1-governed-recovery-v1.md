# Morroway Production Pilot 1 Phase 1 — Governed Recovery V1

Date: 2026-09-25  
Result: `PARTIAL`

## Scope

This recovery applied only to project `morroway`, content
`content-mug6d970-jrkufn`, and workflow `wf-1790293235186-1l4105j4`.
No replacement content or workflow was created. The previous EACCES failure
and its execution/reservation remain historical evidence.

## EACCES diagnosis

The original failure occurred inside the managed command sandbox before a
provider HTTP response. A Node DNS/HTTPS probe in that sandbox reproduced
`fetch failed` with nested `EACCES`. The same Node environment outside the
sandbox resolved `openrouter.ai` and returned HTTP 200. The production
worker's new read-only authenticated `auth/key` probe also returned HTTP 200
in 483 ms, and the Python facade environment returned HTTP 200 in 335 ms.
Credentials were tested only for presence/validity and were never printed.

Root cause confidence is HIGH: the denied connection was imposed by the
command sandbox/network policy, not AMF routing, OpenRouter authentication,
the GPT-OSS model, or a provider rejection.

## Price snapshot remediation

`withCanonicalModelRouting` stores the provider override outside and its
immutable route evidence inside `canonicalRouting`. Production reservation
code read the outer object, so the exact model survived but routing version
and `priceSnapshotId` did not. The worker now reads the nested canonical
record and fails closed with `PRODUCTION_PRICE_SNAPSHOT_REQUIRED` before any
transport when the snapshot is absent.

The historical reservation was linked to
`model-price-6bc5046cf8d39d6cd292` only after three persisted facts matched:
the failed execution's canonical route, the active routing record, and the
catalog snapshot. An append-only remediation provenance object records that
link. No benchmark history was modified.

## One authorized retry

Recovery dispatch `fd00eb6b-99e1-4d6f-9923-c6d2384d0144` rewound the same
workflow to `orchestrator`, recorded Owner approval, increased the scoped
text-agent retry allowance from zero to exactly one, and enqueued job `70`.
Recovery identity is part of the reservation idempotency key, so the original
terminal reservation was neither overwritten nor reused.

Canonical routing again resolved `openai/gpt-oss-20b`. The new reservation
contained routing version and price snapshot before transport. OpenRouter
returned HTTP 200 from upstream provider CoreWeave. Recorded usage was 722
input, 169 output, 891 total, and 172 reasoning tokens. Calculable cost is
USD 0.00004363; provider-billed cost remains `UNKNOWN`.

The response then failed local agent contract validation after parsing and
before artifact persistence. It is classified `LOCAL_EXECUTION_FAILED`, not a
transport, authentication, provider, or model-availability failure. The
sanitized lifecycle proves response receipt and validation entry but the
current runtime did not persist the exact validation message or raw visible
response. No second retry or fallback was used.

## Result and safety

- Worker OpenRouter transport: `PASS`
- Price-snapshot propagation: `PASS`
- Atomic reservation: `PASS`
- Same workflow resumed: `YES`
- Workflow completion: `FAIL`
- Owner pre-media gate: `NOT_REACHED`
- Research calls: `0`
- Recovery production inference calls: `1`
- Image/video/voice generation, uploads, publication, analytics, M4: `0`

The next bounded recovery, if authorized, should preserve this evidence and
address the Orchestrator response-contract/diagnostic-persistence failure. It
must not silently retry, switch models, or broaden into Phase 2.
