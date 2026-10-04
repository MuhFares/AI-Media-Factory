# AMF OpenRouter Model Intelligence V1

Status: COMPLETE — provider metadata only; no model inference or benchmark execution.

The canonical source is OpenRouter's machine-readable `GET /api/v1/models` catalog. A governed refresh uses `node scripts/refresh-openrouter-model-catalog.mjs`, stores a retrieval timestamp and source URL, and emits new-model, removal/unavailability, price, capability, and description changes. It never sends a completion request or an API key to the catalog endpoint.

AMF separates provider catalog current state (`provider_model_catalog`) from immutable provider price evidence (`provider_model_price_snapshots`), AMF evaluation (`amf_model_evaluations`), agent assignment, and execution evidence. Provider text is provider description only, never an AMF quality judgment. The current catalog entry is mutable; snapshots and historical execution rows are not overwritten.

OpenRouter native pricing strings are preserved in `pricing_raw`. Where a numeric per-token value is supplied, AMF displays the mathematically derived USD per 1M-token value. Other units remain raw/provider-native. `FREE` requires all provider-declared pricing values to be explicit numeric zero; absent or nonnumeric pricing is `UNKNOWN`, never zero.

The planned benchmark uses identical provider-free fixtures for research synthesis, planning, briefs, scripts, hooks, scenes, visual prompts, metadata, critic/QA, structured extraction, and tool adherence. It records per-dimension quality, grounding, instruction adherence, structure validity, creativity, usefulness, tool reliability, latency, usage, estimated cost, actual calculable cost, and failure rate. It is not a universal score and has not executed.

Shortlists are eligibility inventories only: up to five current FREE models, five PAID price-compatible models, and four provider-declared reasoning-capable reference candidates. They are exposed read-only in Owner UI and remain `NOT_EVALUATED` until an Owner-authorized benchmark. Existing production routing is unchanged.

Execution evidence now has nullable fields for a provider price snapshot, estimated cost, actual calculable cost, provider-billed cost, and cost evidence. They remain distinct and nullable; unknown usage/pricing/billing is never fabricated.
