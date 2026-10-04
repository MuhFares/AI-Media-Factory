# AMF Model Benchmark Real Execution V1 — Continuation Proof

Status: PARTIAL / PAUSED_FOR_STAGE_D_OWNER_BLIND_REVIEW, 2026-09-24.

## Canonical run

- Dataset: `AMF-MRB-V1.1.1`
- Run: `amf-mrb-v1.1.1-real-20260924-r2` (the existing run; no replacement run)
- Catalog snapshot: `model-refresh-91d1c0915e33b800813e`
- Hard cap: USD 0.32
- Automatic retries: 0
- Production routing changed: NO

The Owner's first 13 blind reviews were persisted and finalized. Their weighted score is the canonical creative weighting divided over the Owner's 0–5 scale; 65 is the production qualification floor. Historical deterministic evidence was not rewritten.

## Execution

- Stage A: COMPLETE, 60 calls, 9 success, 51 failure.
- Stage B: COMPLETE, 60 calls, 44 success, 16 failure.
- Stage C: COMPLETE_WITH_EARLY_STOP, 14 calls, 13 success, 1 failure; four of the maximum 18 calls were not created because two critical tasks lacked two eligible finalists.
- Stage D: INFERENCE_COMPLETE, 40 calls, 37 success, 3 failure.
- Total: 174 calls, 103 success, 71 failure.
- Calculable token spend: USD 0.039599564.
- Provider-billed spend: UNKNOWN.
- Hard-cap breach: NO.

The runner created five additional required blind-review packets from successful Stage D creative/reference observations. The run is therefore durably `PAUSED` at D with `OWNER_BLIND_REVIEW_REQUIRED_FOR_FINALIST_AND_REFERENCE_OUTPUTS`; 18 reviews are required in total and 13 are complete. No identity for the five pending packets has been revealed.

## Initial blind reveal and qualification

| Task | Candidate | Model | Owner weighted score | Qualification |
|---|---|---|---:|---|
| hooks-01 | K | mistralai/mistral-nemo | 36 | NO_QUALIFIED_MODEL |
| hooks-01 | L | sao10k/l3-lunaris-8b | 37 | NO_QUALIFIED_MODEL |
| scenes-01 | A | dots-studio/dots-3-note-preview:free | 73 | QUALIFIED_FOR_PRODUCTION |
| scenes-01 | M | inclusionai/ling-3.0-flash | 85 | QUALIFIED_FOR_PRODUCTION |
| scenes-01 | N | openai/gpt-oss-20b | 34 | NO_QUALIFIED_MODEL |
| script-01 | H | mistralai/mistral-nemo | 22 | NO_QUALIFIED_MODEL |
| script-01 | I | inclusionai/ling-3.0-flash | 85 | QUALIFIED_FOR_PRODUCTION |
| script-01 | J | sao10k/l3-lunaris-8b | 19 | NO_QUALIFIED_MODEL |
| thumbnail-01 | R | mistralai/mistral-nemo | 34 | NO_QUALIFIED_MODEL |
| thumbnail-01 | S | sao10k/l3-lunaris-8b | 26 | NO_QUALIFIED_MODEL |
| visual-prompt-01 | O | mistralai/mistral-nemo | 46 | NO_QUALIFIED_MODEL |
| visual-prompt-01 | P | inclusionai/ling-3.0-flash | 90 | QUALIFIED_FOR_PRODUCTION |
| visual-prompt-01 | Q | sao10k/l3-lunaris-8b | 26 | NO_QUALIFIED_MODEL |

Hooks and Thumbnail have no qualified model among the first reviewed pool. Final task qualification remains open until the five Stage D packets are scored.

## Failure forensics

All 71 terminal inference failures were classified from persisted provider/runtime evidence:

- EMPTY_RESPONSE: 39
- RATE_LIMIT: 17
- MALFORMED_INCOMPLETE_RESPONSE: 9
- HTTP_PROVIDER_REJECTION: 6
- Authentication failure: 0
- Timeout: 0
- Proven AMF runtime/fixture failure: 0
- Unknown: 0

Stage A's 51/60 failure pattern is explained by 17 shared-free-pool 429 responses from `google/gemma-4-26b-a4b-it:free`, six 403 route restrictions from the two Thinking Machines free routes, and 28 empty/incomplete responses concentrated in `stealth/space-bunny-alpha` and `dots-studio/dots-3-note-preview:free`. Stage B's 16/60 failures were 11 empty and five incomplete outputs, principally Qwen/Ling response completion behavior. These are provider/route/output reliability failures, not proven AMF runtime failures and not automatically model-quality failures.

Two successful transports produced evaluator hard failures: `rekaai/reka-edge` failed the Visual-QA output contract; `openai/gpt-oss-20b` failed CEO-02 with malformed contract plus authority violation. These are contextual quality/safety evidence and are not counted as transport failures.

## GPT-6 Luna

Pinned route `openai/gpt-6-luna` executed 14 calls across Analytics, Brand, Brief/Planning, CEO, Critic, Finance, Orchestrator, QA, Research, Strategy, and Visual QA. It succeeded 13 and failed one (`brief-01`, incomplete response). Average latency was 7,941 ms; successful usage was 3,930 input and 8,674 output tokens; calculable cost was USD 0.00473; reasoning tokens and provider-billed cost remain UNKNOWN. It passed both CEO and both Orchestrator contracts without hard failure. Role quality differentiation remains bounded by the canonical evaluator, which assigns contextual pass scores rather than a universal semantic rank.

## Integrity proof

- Ledger rows: 174; distinct idempotency keys: 174.
- Non-terminal executions: 0.
- Fixture/prompt/input lineage gaps: 0.
- Successful execution artifact/evaluation gaps: 0.
- Reserved exposure after reconciliation: USD 0.
- Database runtime test: PASS.
- Benchmark contract/routing/auth focused tests: 14/14 PASS.

Final creative qualification, complete 24-agent routing proposal, and operating-profile cost estimates remain pending the five Stage D blind reviews in `amf-model-benchmark-real-execution-v1-stage-d-blind-review-packets.md`.

## Append-only continuation — Owner Stage-D scores and integrity pause (2026-09-25)

The Owner's five supplied Stage-D reviews were persisted unchanged through the canonical review store. The canonical weighted outcomes are: hooks Candidate J = 50 / `NO_QUALIFIED_MODEL`; scenes Candidate L = 63 / `NO_QUALIFIED_MODEL`; thumbnail Candidate O = 38 / `NO_QUALIFIED_MODEL`; thumbnail Candidate P = 95 / `QUALIFIED_FOR_PRODUCTION`; visual-prompt Candidate N = 95 / `QUALIFIED_FOR_PRODUCTION`. At that point the intended first set was complete: `18/18`.

Before the reveal/final-routing step, a ledger-to-blind-mapping integrity audit found four successful creative Stage-D executions with no blind candidate mapping. This was a historic blind-label collision in packet generation, not a new inference and not a change to any existing Owner review. All four have now been assigned unique per-task anonymous labels and written as packets in `amf-model-benchmark-real-execution-v1-backfilled-blind-review-packets.md`. The canonical status is now `22 required / 18 completed`; the run is durably `PAUSED` at Stage D with `OWNER_BLIND_REVIEW_REQUIRED_FOR_BACKFILLED_CREATIVE_OUTPUTS`.

The four model identities remain unrevealed. Final creative qualification and the complete proposed routing matrix are intentionally withheld until these four Owner scores are recorded. No inference, spend, retry, routing activation, Morroway production, media generation, publication, analytics, or M4 action occurred during this continuation.
