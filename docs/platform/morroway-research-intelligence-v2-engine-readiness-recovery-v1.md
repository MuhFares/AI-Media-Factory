# Morroway Research Intelligence V2 Engine Readiness Recovery V1

Date: 2026-09-25

## Result

`PARTIAL`: the bounded engine and its isolated Postgres proof are ready, but
the validated worker build was not deployed because live job 68 is still
`running` and an ordinary worker startup would reclaim/mutate it. The Owner
explicitly excluded that job from this program.

## Diagnosed failure

The original first-scenario exit was a test-harness race. Top-level Node tests
shared mutable `global.fetch` and the canonical agent registry while the test
runner was allowed to execute them concurrently. The V1 scenario passed alone.
Serializing the top-level scratch-Postgres scenarios made the historical V1
path deterministic; no V2 contract leaked into V1.

The harness now records scenario, exception type/message/stack, submissions,
workflow and step state, bounded marker data, artifacts, reservations, and jobs
before rethrowing. Scratch cleanup terminates connections only for the exact
isolated database before dropping it.

## Minimal runtime corrections

- V2 research reserves six bounded retrieval slots and two text slots before
  transport. Unused retrieval reservations are released during reconciliation.
  V1 retains its existing one-retrieval/two-text behavior.
- An explicit V2 bounded Research run may complete honestly with
  `INSUFFICIENT_EVIDENCE` while retaining `ceoEligible=false`. This semantic is
  limited to an explicit stop at that Research step; V1 and unbounded flows
  remain fail-closed.
- The real queue → worker → workflow-engine proof now covers V1 usable and
  insufficient paths, V2 grounded direction/discovery/verification/synthesis,
  V2 insufficient evidence, unsupported social capability, durable pause,
  reload persistence, idempotent re-poll, and zero CEO executions.

## Provider-free proof

- Research Agent: 51/51 PASS.
- Scratch bounded-engine E2E: 5/5 PASS.
- Focused cross-package suite: 84/86 PASS. The two failures are configuration
  failures in `canonical-production-routing.test.js`: no `TEST_DATABASE_URL`
  is configured and the combined command deliberately did not inject the live
  database. All other 84 research, evidence, budget, runtime capability,
  workflow collaboration, and authority tests passed.
- Worker TypeScript build: PASS.
- `git diff --check`: PASS.
- External inference/research/social calls: 0; spend: USD 0.00.

## Live budget shape

Actual V2 transports are two text calls (Research Direction and Final
Synthesis) plus retrieval calls. Candidate formation and verification planning
are performed within the Research lifecycle rather than as additional LLM
transports.

- Minimum useful mission: 2 research calls (discovery + one verification) and
  2 text calls.
- Normal bounded mission: 4 research calls (discovery + three verifications)
  and 2 text calls.
- Maximum hard-capped mission: 6 research calls total and 2 text calls.

Current live limits remain unchanged at research 6/6 and text-agent 12/14.
Provider-billed and projected dollar cost remain `UNKNOWN` until a separately
authorized live mission resolves its exact providers, token use, and queries.

## Deployment boundary

The validated build ID is
`92b3def73291d8fb256f29062a15b42881a00fc5685949b2244bd6c1f5989fed`.
There is no live canonical worker. Supervisor/PID records are stale. Job 68 is
still `running`, with 18 attempts, and ordinary CLI startup reclaims stale
running jobs. Starting it would violate the instruction not to mutate job 68,
so deployment was intentionally withheld. Queue disposition for job 68 is the
remaining Owner decision.

