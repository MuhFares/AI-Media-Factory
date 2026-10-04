# AMF Model Benchmark Final Catalog Delta V1 — Proof

## Exact role execution map

Legend: B = baseline, C = low-cost candidate, R = reference. Each model is called once per listed task before early stop; critical tasks add two dynamically selected finalist observations in Stage C.

| Role | Tasks | B | C | R | Base calls |
|---|---|---|---|---|---:|
| Research | research-01 | space-bunny; inkling; inkling-small | ling-3.0-flash; gpt-oss-20b; qwen3.7-flash | gpt-6-luna; grok-4.20 | 8 |
| Strategy | strategy-01 | space-bunny; dots-3; gemma-4 | ling-3.0-flash; gpt-oss-20b; qwen3.7-flash | gpt-6-luna; grok-4.20 | 8 |
| Planner / Brief | plan-01; brief-01 | space-bunny; dots-3; gemma-4 | ling-3.0-flash; gpt-oss-20b; qwen3.7-flash | gpt-6-luna; grok-4.20 | 16 |
| Writer / Hooks | script-01; hooks-01 | space-bunny; inkling; inkling-small | mistral-nemo; ling-3.0-flash; l3-lunaris-8b | grok-4.20; glm-5.3-flash | 16 |
| Scene planning | scenes-01 | space-bunny; dots-3; gemma-4 | ling-3.0-flash; gpt-oss-20b; qwen3.7-flash | grok-4.20; glm-5.3-flash | 8 |
| Visual prompts | visual-prompt-01 | space-bunny; dots-3; gemma-4 | mistral-nemo; ling-3.0-flash; l3-lunaris-8b | grok-4.20; glm-5.3-flash | 8 |
| Thumbnail | thumbnail-01 | space-bunny; dots-3; gemma-4 | mistral-nemo; ling-3.0-flash; l3-lunaris-8b | grok-4.20; glm-5.3-flash | 8 |
| SEO / Metadata | metadata-01 | space-bunny; dots-3; gemma-4 | mistral-nemo; ling-3.0-flash; l3-lunaris-8b | grok-4.20; glm-5.3-flash | 8 |
| Brand | brand-01 | space-bunny; dots-3; gemma-4 | ling-3.0-flash; gpt-oss-20b; qwen3.7-flash | gpt-6-luna; grok-4.20 | 8 |
| Critic | critic-01 | space-bunny; dots-3; gemma-4 | ling-3.0-flash; gpt-oss-20b; qwen3.7-flash | gpt-6-luna; grok-4.20 | 8 |
| QA | qa-01 | space-bunny; dots-3; gemma-4 | ling-3.0-flash; gpt-oss-20b; qwen3.7-flash | gpt-6-luna; grok-4.20 | 8 |
| Visual QA | visual-qa-01 | space-bunny; dots-3; gemma-4 | qwen3.7-flash; reka-edge; ling-3.0-flash-vl | gpt-6-luna; grok-4.20 | 8 |
| Analytics / Learning | analytics-01 | space-bunny; dots-3; gemma-4 | ling-3.0-flash; gpt-oss-20b; qwen3.7-flash | gpt-6-luna; grok-4.20 | 8 |
| Finance | finance-01 | space-bunny; dots-3; gemma-4 | ling-3.0-flash; gpt-oss-20b; qwen3.7-flash | gpt-6-luna; grok-4.20 | 8 |
| CEO / Company Brain | ceo-01; ceo-02 | space-bunny; dots-3; gemma-4 | ling-3.0-flash; gpt-oss-20b; qwen3.7-flash | gpt-6-luna; grok-4.20 | 16 |
| Orchestrator | orchestrator-01; orchestrator-02 | space-bunny; dots-3; gemma-4 | ling-3.0-flash; gpt-oss-20b; qwen3.7-flash | gpt-6-luna; grok-4.20 | 16 |

Exact IDs expand as: `stealth/space-bunny-alpha`, `thinkingmachines/inkling:free`, `thinkingmachines/inkling-small:free`, `dots-studio/dots-3-note-preview:free`, `google/gemma-4-26b-a4b-it:free`, `inclusionai/ling-3.0-flash`, `inclusionai/ling-3.0-flash-vl`, `openai/gpt-oss-20b`, `qwen/qwen3.7-flash`, `mistralai/mistral-nemo`, `sao10k/l3-lunaris-8b`, `rekaai/reka-edge`, `openai/gpt-6-luna`, `x-ai/grok-4.20`, and `z-ai/glm-5.3-flash`.

## Model execution totals

| Exact model ID | Calls | Max calculable cost |
|---|---:|---:|
| stealth/space-bunny-alpha | 20 | $0 |
| thinkingmachines/inkling:free | 3 | $0 |
| thinkingmachines/inkling-small:free | 3 | $0 |
| dots-studio/dots-3-note-preview:free | 17 | $0 |
| google/gemma-4-26b-a4b-it:free | 17 | $0 |
| inclusionai/ling-3.0-flash | 19 | $0.004038 |
| openai/gpt-oss-20b | 14 | $0.003915 |
| qwen/qwen3.7-flash | 15 | $0.006349 |
| mistralai/mistral-nemo | 5 | $0.000434 |
| sao10k/l3-lunaris-8b | 5 | $0.000840 |
| rekaai/reka-edge | 1 | $0.000680 |
| inclusionai/ling-3.0-flash-vl | 1 | $0.000624 |
| openai/gpt-6-luna | 14 | $0.022000 |
| x-ai/grok-4.20 | 20 | $0.209125 |
| z-ai/glm-5.3-flash | 6 | $0.006225 |
| dynamic top-two finalists | 18 | $0.0071811 |

Verification: database and API TypeScript builds passed; focused model intelligence/routing tests passed 11/11. The served API returned dataset `AMF-MRB-V1.1.1`, all 16 roles, stage counts 60/60/18/40, 178 calls, and $0.2614114. No batch or floating alias is selected. The Node API was reloaded; Python Owner facade remained available. No inference or spend occurred.
