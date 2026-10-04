# AMF Model Benchmark Real Execution V1 — final proof

Date: 2026-09-25  
Dataset: `AMF-MRB-V1.1.1`  
Run: `amf-mrb-v1.1.1-real-20260924-r2`

## Final state and safety

The existing run, and no replacement run, is complete from persisted evidence. It made 174 calls: 103 succeeded and 71 failed. Calculable token cost is USD `0.039599564` under the USD `0.32` cap; provider-billed cost is `UNKNOWN`. The run is now inference-disabled (`NOT_AUTHORIZED`) and records `BENCHMARK_EVIDENCE_COMPLETE_OWNER_ROUTING_APPROVAL_REQUIRED`. Production routing was not changed.

All 22 required Owner reviews are finalized. Audit results: zero successful required-blind creative executions lack a finalized review; zero duplicate execution mappings; zero duplicate per-task blind labels. Identities were revealed only after 22/22 completion.

## Final creative qualification and reveal

| Task | Candidate | Model | Owner score | Qualification |
|---|---|---|---:|---|
| Hooks | A | `z-ai/glm-5.3-flash` | 90 | QUALIFIED |
| Hooks | J/K/L | xAI Grok / Mistral Nemo / Lunaris | 50 / 36 / 37 | Not qualified |
| Scenes | M | `inclusionai/ling-3.0-flash` | 85 | QUALIFIED |
| Scenes | A | `dots-studio/dots-3-note-preview:free` | 73 | QUALIFIED |
| Scenes | B/L/N | ZAI GLM / xAI Grok / GPT-OSS | 49 / 63 / 34 | Not qualified |
| Script | I | `inclusionai/ling-3.0-flash` | 85 | QUALIFIED |
| Script | A | `z-ai/glm-5.3-flash` | 69 | QUALIFIED, factual tightening required |
| Script | B/H/J | xAI Grok / Mistral Nemo / Lunaris | 47 / 22 / 19 | Not qualified |
| Visual prompt | N | `x-ai/grok-4.20` | 95 | QUALIFIED |
| Visual prompt | P | `inclusionai/ling-3.0-flash` | 90 | QUALIFIED |
| Thumbnail | P | `z-ai/glm-5.3-flash` | 95 | QUALIFIED |
| Thumbnail | O/R/S | xAI Grok / Mistral Nemo / Lunaris | 38 / 34 / 26 | Not qualified |

Owner evidence controls factual-content qualification: fluent invented claims did not qualify. Automated contract scores were typically 80 and therefore are not treated as a replacement for blind semantic assessment.

## Proposed routing — Owner approval required

This is a proposal, not active production configuration. `Primary / Fallback / Economy / Premium` are all evidence-scoped.

| Agent / role | Primary | Fallback | Economy | Premium escalation | Evidence / limitation |
|---|---|---|---|---|---|
| CEO / Company Brain | GPT-6 Luna | Ling 3.0 Flash | Dots 3 Note free | Grok 4.20 | Luna 2/2 safe executive cases, 8.2s; GPT-OSS excluded from CEO for authority hard fail. |
| Orchestrator runtime | GPT-OSS 20B | GPT-6 Luna | Ling 3.0 Flash | Grok 4.20 | GPT-OSS 4/4 structured/tool contracts; Luna 2/2. |
| Research synthesis | GPT-6 Luna | GPT-OSS 20B | Ling 3.0 Flash | Grok 4.20 | Retrieval remains governed web/social; benchmark tests synthesis only. |
| Planner / Brief | GPT-OSS 20B | Grok 4.20 | INSUFFICIENT_EVIDENCE | GPT-6 Luna | GPT-OSS 2/2; other comparison samples are sparse. |
| Writer | Ling 3.0 Flash | ZAI GLM 5.3 Flash | NO_QUALIFIED_MODEL | INSUFFICIENT_EVIDENCE | Owner script scores 85 and 69; ZAI needs factual tightening. |
| Hooks | ZAI GLM 5.3 Flash | NO_QUALIFIED_MODEL | NO_QUALIFIED_MODEL | INSUFFICIENT_EVIDENCE | Owner score 90; 42.6s latency is a weakness. |
| Director / scenes | Ling 3.0 Flash | Dots 3 Note free | Dots 3 Note free | INSUFFICIENT_EVIDENCE | Owner scores 85 / 73; Dots has limited one-output evidence. |
| Visual Director | Grok 4.20 | Ling 3.0 Flash | Ling 3.0 Flash | INSUFFICIENT_EVIDENCE | Owner scores 95 / 90; Grok costs more. |
| Thumbnail | ZAI GLM 5.3 Flash | NO_QUALIFIED_MODEL | NO_QUALIFIED_MODEL | INSUFFICIENT_EVIDENCE | Owner score 95; 79.7s latency. |
| SEO | Mistral Nemo | Lunaris 8B | Mistral Nemo | Grok 4.20 | Contract evidence only; no blind semantic comparison. |
| Brand | GPT-OSS 20B | GPT-6 Luna | Ling 3.0 Flash | Grok 4.20 | One successful observation each. |
| Critic / Reviewer | GPT-OSS 20B | GPT-6 Luna | Dots 3 Note free | Grok 4.20 | GPT-OSS 2/2; Dots 2/2 free. |
| QA | GPT-OSS 20B | Ling 3.0 Flash | INSUFFICIENT_EVIDENCE | GPT-6 Luna | GPT-OSS/Ling each 2/2. |
| Visual Semantic QA | GPT-6 Luna | Ling 3.0 Flash-VL | Dots 3 Note free | Grok 4.20 | Reka Edge excluded: malformed visual-QA contract hard fail. |
| Analytics | GPT-6 Luna | GPT-OSS 20B | Dots 3 Note free | Grok 4.20 | One successful observation per selected route. |
| Growth | GPT-6 Luna | GPT-OSS 20B | Ling 3.0 Flash | Grok 4.20 | One successful observation per selected route. |
| Finance | GPT-6 Luna | GPT-OSS 20B | Ling 3.0 Flash | Grok 4.20 | One successful observation per selected route. |
| Video, Scene Artist, Visual Technical QA, WAN gate, Narrator, Timeline, Composer, Publisher, Publication gate | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | Deterministic/provider-specific governed roles; no forced LLM routing. |

## Profiles and economics

- **Quality-first:** CEO/Research GPT-6 Luna; factual creative candidates above; Grok for visual-prompt escalation. Estimated model-only short: approximately USD `0.0037` from directly observed task costs, excluding unmeasured provider/media/search costs. Research synthesis: USD `0.0004297`; CEO cycle: USD `0.0004369` average observed Luna CEO call.
- **Balanced:** same factual creative qualifications; Ling for visual prompts unless escalation is justified. Estimated short: approximately USD `0.0024`; research and CEO as above.
- **Economy:** only use a free route where it qualified/reliably demonstrated the exact role (Dots for scenes/critic evidence). There is no qualified free Writer, Hooks, Thumbnail, or Visual Prompt candidate. Full short-cycle cost is therefore `UNKNOWN` without reducing factual-quality requirements.

## GPT-6 Luna

`openai/gpt-6-luna`: 14 calls, 13 success, 1 incomplete Brief response; 7,941ms average latency; 3,930 input and 8,674 output tokens; USD `0.00473` calculable; provider-billed cost `UNKNOWN`. It passed both CEO and both Orchestrator cases without hard failure. Strongest demonstrated uses: executive synthesis, orchestration, research synthesis, visual semantic QA. Weakness: one incomplete Brief response and limited one-observation evidence in several specialist roles.

## Reliability and remaining limitations

Transport/provider failures remain separate from model quality: 39 empty responses, 17 rate limits, nine incomplete responses, six provider HTTP rejections, and zero proven AMF runtime failures. GPT-OSS had a CEO authority-boundary hard failure and is excluded from CEO despite otherwise strong structured-role evidence. Provider-billed cost is unavailable. Many specialist roles have one successful observation; routing approval should consider targeted post-approval monitoring rather than treating sparse samples as universal proof.
