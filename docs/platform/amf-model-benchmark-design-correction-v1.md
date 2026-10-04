# AMF Model Benchmark Design Correction V1

Status: PASS — provider-free design correction, 2026-09-24.

This program corrects `AMF-MRB-V1.0.0` without inference, spend, or routing activation. The new dataset is `AMF-MRB-V1.1.0`.

## Corrections

- Orchestrator is an explicit benchmark/runtime role layered over, not added to, the canonical 24-agent roster. Its hard catalog requirements are reasoning, tool calling, and structured output. `orchestrator-01` and adversarial consistency scenario `orchestrator-02` measure state retention, recovery, tool-result integrity, and authority compliance.
- `visual-qa-01` uses the controlled Morroway image fixture `MM-02-rejected-attempt0.png`, a source brief, scene and prompt contracts, semantic/technical requirements, intentional defects, and a structured verdict. OCR is not required.
- Structured/Utility is `BENCHMARK_DIMENSION_ONLY`, measured inside Orchestrator, Planner, QA, Analytics, and CEO; no agent was invented.
- Model family identity is separate from exact route. Batch is a route variant and is excluded from independent quality candidacy. Z.ai aliases/versions normalize before family diversity selection. Historical provider evidence remains untouched.
- Provider price is normalized to FREE/LOW_COST/STANDARD/HIGH_COST/UNKNOWN independently of BASELINE/CANDIDATE/FINALIST/REFERENCE benchmark tier.
- CEO adds `ceo-02` adversarial consistency evidence. All routing slots remain pending benchmark evidence.
- Selective Stage C repeats only critical-role finalists. Creative elimination still requires blind Owner review.

## Governed spend plan

The generated current-snapshot plan contains 154 maximum calls: A 51, B 51, C 18, D 34. Calculable token maximum is USD 0.0782548. Unknown provider-billed/request/platform fees and future price changes remain UNKNOWN. The generated recommended authorization cap is USD 0.32, under the Owner's unchanged USD 10 hard ceiling. Current authorization is USD 0.

No retry, substitution, price drift, malformed contract, invented tool result, authority violation, or cap exhaustion may continue automatically.
