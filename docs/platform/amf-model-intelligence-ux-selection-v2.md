# AMF Model Intelligence UX and Selection V2

Status: CLOSED / PASS — 2026-09-24.

V2 extends, and does not replace, the V1 OpenRouter evidence domain. Raw provider metadata, current catalog state, immutable price snapshots, evaluation records, refresh provenance, and UNKNOWN semantics remain canonical.

## Owner workspace

Model Intelligence is now a six-tab decision workspace: Overview, Shortlist, All Models, Benchmarks, Routing, and Price History. Overview answers catalog size, price distribution, evaluation state, current routing visibility, refresh time, recommended evaluation candidates, catalog changes, and the next decision without rendering the catalog or raw JSON.

All Models uses database-backed search across name/ID/provider, price/capability/evaluation/provider filters, seven sort modes, and 25/50/100 pagination. The initial DOM contains 25 model rows. Details show normalized and raw pricing, capabilities, modalities, provider description, AMF evaluation state, shortlist membership, roles, and focused snapshot history. Raw provider evidence is collapsed.

## Selection semantics

Shortlisting is deterministic benchmark eligibility, not quality scoring. FREE candidates favor explicit zero pricing plus provider-declared AMF-compatible coverage. Cost-efficient candidates require multiple relevant capabilities and sort by current input/output price. Reference candidates require broad capability coverage, large context, a diverse provider family, and an explicit documented preference for established reference-provider families when available. Main groups are model-distinct and family-diverse. Specialist reuse is allowed only when the declared evidence satisfies each displayed role.

Reason codes are deterministic: FREE, LOW_COST, LARGE_CONTEXT, REASONING, TOOL_CALLING, STRUCTURED_OUTPUT, VISION, MULTIMODAL, CREATIVE_WRITING_POSITIONING, AGENTIC_POSITIONING, REFERENCE_FAMILY, and HIGH_CAPABILITY_METADATA. Positioning reasons come only from provider descriptions and remain provider evidence.

## Authority boundary

Benchmark status is `NOT_EXECUTED`. No inference endpoint is present in this workspace. Production routing is read-only and unchanged. Provider metadata, benchmark eligibility, AMF evaluation, and production routing remain separate concepts.

## Current catalog decision set

At verification the canonical catalog contained 458 available models: 24 FREE, 353 PAID, and 81 UNKNOWN. The V2 main benchmark proposal contains five free, five cost-efficient paid, and four distinct high-capability/reference candidates, plus evidence-driven specialists. Counts are queried from the database, never hardcoded in the product.

## Remaining limitations

Most production catalog models have one price snapshot, so the truthful state is `NO_HISTORY_AVAILABLE` until a price changes. Provider descriptions may be promotional or incomplete. Candidate quality, latency, reliability, and task fit remain unproven until a separately authorized benchmark.
