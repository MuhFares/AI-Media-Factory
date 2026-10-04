# AMF Model Benchmark Execution Runtime Remediation V1

Status: PASS — provider-free implementation, 2026-09-24.

This program resolves every blocker in `amf-model-benchmark-execution-v1-preflight.md` without inference. The benchmark design remains `AMF-MRB-V1.1.1`; candidate pools, routes, prices, hard cap, production routing, and authority are unchanged.

## Runtime domain

Eight additive PostgreSQL tables isolate benchmark state from production workflows: runs, immutable fixtures, per-inference executions, artifacts, evaluation evidence, private blind mappings, Owner reviews, and finalist/elimination decisions. Runs distinguish CREATED, PREFLIGHT, READY, RUNNING, PAUSED, COMPLETED, FAILED, HARD_CAP_STOP, and CANCELLED. The ledger carries exact model/family/route, fixture/prompt/input hashes, price snapshot, idempotency, reservation, estimated/calculable/billed costs, usage, timing, failures, artifacts, evaluation and provenance. Historical rows are append-safe; UNKNOWN billed cost remains NULL.

Spend reservation locks the run row in one database transaction, combines committed and reserved exposure, rejects projected exposure above USD 0.32 before transport eligibility, and reserves only after passing. Reconciliation releases the reservation and records calculable/provider evidence. Concurrent proof allowed exactly one of two USD 0.007 reservations under a USD 0.01 cap; the other stopped at the cap. Duplicate idempotency was blocked.

## Fixtures and evaluation

All 20 tasks have immutable V1 fixtures containing system instructions, task prompt, structured inputs, constraints, output contract, evaluator contract, token assumptions, hashes, timestamp and provenance. Research uses `MORROWAY-RESEARCH-EVIDENCE-V1`, four fixed evidence items with stable IDs, differing confidence, an explicit conflict, and an unsupported exact-date claim. No live retrieval is part of comparison.

Twenty contextual evaluators use deterministic 100-point weights, explicit hard fails, checks, threshold, tie handling, and human/judge requirements. CEO authority violations and Orchestrator invented tool results/unauthorized execution hard-fail independently of prose quality. Creative tasks require blind Owner review. There is no universal model-quality score.

The finalist resolver excludes hard failures and missing coverage/evidence, enforces thresholds, then deterministically combines contextual task score, reliability, bounded cost and latency contributions with stable tie-breaking. It persists advancement and elimination reasons. Price never implies quality.

## Blind review, artifacts, and resume

Blind packets expose Candidate A/B/C labels and normalized output only. Model, provider, price, tier, family, latency and routing remain private. Owner dimension scores, notes and finalization are persisted immutably. Benchmark artifacts are database-backed and linked to run, execution, task, model and dataset.

Successful/reconciled idempotency keys cannot execute again. Resume reads exact persisted status, reservations, artifacts, evaluations, blind mappings and price snapshots. Failed calls do not silently retry.

## Preflight V2

The read-only Owner endpoint `/api/model-intelligence/benchmark-runtime` reports credential presence without value, dataset/fixture completeness, Research evidence, route/price/ledger/artifact readiness, atomic reservation, cap, evaluators/weights, blind review, finalist determinism, routing isolation and explicit authorization. Runtime readiness is true; inference readiness remains false because the canonical readiness run is `NOT_AUTHORIZED`.

No production-routing mutation was introduced. `scripts/run-model-benchmark.mjs`
is the governed stage runner: it refuses a missing/non-authorized run before it
imports the provider adapter, requires the exact USD 0.32 cap, reserves before
transport, uses stored fixtures, persists artifacts/evaluations, reconciles
usage/cost, pauses for missing blind/finalist evidence, and resumes by
idempotency. Its `--preflight-only` proof returned runtime ready, inference
unauthorized, and zero provider calls. Owner blind scores are accepted only by
the authenticated POST facade/control route and never reveal model identity.
