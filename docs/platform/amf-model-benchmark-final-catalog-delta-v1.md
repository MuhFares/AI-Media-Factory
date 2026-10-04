# AMF Model Benchmark Final Catalog Delta V1

Status: PASS — provider-metadata-only reconciliation, 2026-09-24.

The official OpenRouter `GET /api/v1/models` catalog was refreshed through the governed metadata-only mechanism. The exact AMF-MRB-V1.1.0 construction snapshot was `model-refresh-1b44347b6f98c235e252` at `2026-09-24T10:29:35.782Z`; the final canonical snapshot is `model-refresh-91d1c0915e33b800813e` at `2026-09-24T14:21:39.363Z`. Both contain 458 models. The delta is 0 new, 0 removed, 5 price changes, 0 capability changes, and 0 description changes.

The five price changes (raw USD/token, old → new) are:

- `~deepseek/deepseek-pro-latest`: prompt 0.00000039 → 0.0000003894; completion 0.0000029 → 0.0000011682.
- `~z-ai/glm-latest`: prompt 0.0000005625 → 0.0000005614; completion 0.0000025 → 0.0000017644.
- `deepseek/deepseek-v4-flash`: prompt 0.000000088606 → 0.00000008554; completion 0.000000177212 → 0.00000017108.
- `deepseek/deepseek-v4-pro`: prompt 0.0000009396 → 0.000000924462; completion 0.0000018792 → 0.000001848924.
- `z-ai/glm-5.3`: prompt 0.00000084 → 0.0000014; completion 0.00000264 → 0.0000044.

## GPT-6 Luna evidence and policy

`openai/gpt-6-luna` and `openai/gpt-6-luna-pro` are available pinned interactive routes. Both expose 1,050,000 context, file/image/text input and text output, and declare reasoning, vision, tools/tool choice, and structured output. Current base prices are $0.10 input and $0.50 output per 1M tokens. The Pro description says it is the same underlying model with `reasoning.mode=pro`; this is provider positioning, not empirical AMF quality evidence.

Their `:batch` routes expose the same family/capability surface at $0.05/$0.25 per 1M tokens. They remain route variants and are excluded from independent quality candidacy. Pro is normalized to the same Luna family with `PRO_MODE`/`BATCH_PRO` route identity because the provider explicitly identifies it as the same underlying model. `~openai/gpt-luna-latest` currently targets GPT-6 Luna but is a floating, non-reproducible alias and is excluded unless pinned resolution evidence is stored. GPT-5.6 Luna and Pro remain available at $0.20/$1.20 per 1M with the same declared modality/capability shape; they were not added because the bounded pool already contains the newer pinned Luna reference and provider metadata alone does not justify duplicate family observations.

GPT-6 Luna is metadata-compatible with every listed text role and Visual QA. It is deliberately selected only as a reproducible reference for Research, Strategy, Planner/Brief, Brand, Critic, QA, Visual QA, Analytics, Finance, CEO, and Orchestrator. It is not automatically inserted into Writer, Hooks, Scene Planning, Visual Prompt, Thumbnail, or SEO pools; their existing bounded creative/specialist comparisons remain intact. GPT-6 Luna Pro is eligible but not separately selected because its catalog evidence describes the same underlying family/mode and no empirical evidence yet warrants a duplicate quality candidate.

## Research architecture

Production Research is not LLM-only: Research Request → governed retrieval/search → evidence collection/provenance → Research LLM synthesis → cited research artifact. The web registry implements Tavily, Serper, Exa, and Brave with explicit `SEARCH_PROVIDER` selection and fail-closed configuration; web search is implementation- and controlled-proof-backed. Social research is provider-neutral: Apify is configured and has proven Instagram direct-reference metadata and the maintained popular-Reels keyword path; hashtag/free-text modes are not universally proven. Bright Data is proven only for supported Instagram direct-reference metadata and is a policy-controlled fallback after known terminal failure. Transcript, unrestricted Instagram research, and multimodal semantic understanding remain unproven. Benchmark `research-01` uses identical stored evidence so retrieval variance cannot bias the model comparison.

## Final execution design

Catalog reconciliation exposed three model-backed roles without executable tasks. Dataset `AMF-MRB-V1.1.1` adds `brand-01`, `finance-01`, and `thumbnail-01`; all 15 canonical model-backed agent roles plus Orchestrator now have tasks. Production routing remains unchanged and every slot remains `PENDING_BENCHMARK_EVIDENCE`.

The provider-free execution plan is A 60 calls/$0, B 60/$0.0168803, C 18/$0.0071811, and D 40/$0.23735: 178 maximum calls and $0.2614114 calculable token maximum. Provider billed cost, unlisted request/platform fees, and price drift remain UNKNOWN. The existing $0.32 hard cap covers the current calculable worst case; no reauthorization is required. Early stop remains fail-closed for capability/contract/authority/tool-result failures, repeated material failure, domination after sufficient evidence, price drift, or cap exhaustion. Creative outputs remain blind Owner review.

No inference, benchmark call, routing activation, production, publication, analytics, or M4 action occurred.
