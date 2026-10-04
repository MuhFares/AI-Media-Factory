# AMF Model Benchmark Real Execution V1

Status: PAUSED_FOR_OWNER_BLIND_REVIEW, 2026-09-24.

The Owner authorized real OpenRouter inference for `AMF-MRB-V1.1.1` only, with an immutable USD 0.32 hard cap and zero automatic retries. Run `amf-mrb-v1.1.1-real-20260924-r2` passed Preflight V2 against catalog snapshot `model-refresh-91d1c0915e33b800813e` and the canonical final candidate plan.

Stage A executed 60 baseline calls: 9 succeeded and 51 failed. Stage B executed 60 low-cost calls: 44 succeeded and 16 failed. Failures were preserved without retry. Provider evidence included route restrictions, shared free-tier rate limits, length termination, incomplete output, and contract/transport failures. The benchmark is paused before Stage C because 13 successful creative observations require blind Owner review.

Calculable spend is USD 0.003281528. Reserved exposure is USD 0. Provider-billed spend remains UNKNOWN. The cap was not breached. Production routing, Morroway production, automation, media generation, publication, YouTube, and analytics were not changed or invoked.

## Blind review gate

The 13 anonymized packets are stored in the benchmark artifact ledger and exposed by the Model Intelligence blind-review API without model, provider, price, tier, or latency identity. Tasks and packet identifiers:

- `hooks-01`: Candidate K, Candidate L
- `scenes-01`: Candidate A, Candidate M, Candidate N
- `script-01`: Candidate H, Candidate I, Candidate J
- `thumbnail-01`: Candidate R, Candidate S
- `visual-prompt-01`: Candidate O, Candidate P, Candidate Q

The Owner must score each packet from 0–5 for `creativeQuality`, `structuredOutput`, `productionUsability`, `constraintCompliance`, and `instructionAdherence`, optionally add notes, and finalize each review. Model identity must remain hidden until all applicable reviews are finalized. Stage C and Stage D remain not started.

