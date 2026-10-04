# Morroway Strategic Bootstrap Plan V1

Date: 2026-09-18. Method: deterministic transcription from cited sources only (no LLM, no inference). Binaries/vectors stay in place; entities reference them.

## Authority basis (existing Owner-approved evidence)

- A1: `docs/strategy-council-v2-milestone.md` — CLOSED, Owner `APPROVED_WITH_CHANGES` (pillars, territory, formats, pilot-only gates, naming deferred).
- A2: `artifacts/brand-architecture-v1.json` (`APPROVED`, sha256 `56a34ee035498b24`, 2026-09-09) + `docs/brand-architecture-and-naming-hierarchy-v1.md` (APPROVED layers; brand/legal/handles PENDING).
- A3: `artifacts/brand/morroway/v1/brand-assets-manifest.json` + `docs/morroway-brand-assets-v1.md` (OWNER_APPROVED) + `artifacts/Brand identity/*` sources.
- A4: `docs/morroway-adaptive-pilot-content-system-v1.md` — READY, no Owner stamp (supporting evidence only; never sole ACTIVE authority).
- A5: `docs/morroway-brand-identity-v1.md` — essence + positioning, `OWNER_BRAND_IDENTITY_REVIEW_REQUIRED` (supporting only; essence recorded with pending-review flag, no conflict exists).

Conflicts found: NONE (no two sources contradict on pillars, essence, adaptivity, or asset identity). Open items (brand selection, legal entity, handles, palette) are explicitly PENDING in sources and are OMITTED from ACTIVE payloads, never defaulted.

## Entities

| # | Type/Key v1 | Status | Sources | Payload summary |
|---|-------------|--------|---------|-----------------|
| 1 | STRATEGY/primary v1 | ACTIVE | A1, A4(support), A5(support) | pillars [Historical POV, AI Fantasy], deferred [Long-form, Documentary], formats [30s Reel, 15s AI visual], territory short-form historical POV + AI fantasy, essence (pending-review flagged), pilot {model adaptive, learningBatch 4, gates-as-hypotheses, basis flags} |
| 2 | BRAND/primary v1 | ACTIVE | A2, A3, A1 | brand Morroway, operatingParent AMF, positioning audience-facing storytelling brand, assetsManifest ref, architectureArtifact ref, prohibitions [not Morrowind, not Elder Scrolls, not a game/franchise, no invented lore for Historical POV], contentPillars (same canonical pair) |
| 3 | CONTENT_SYSTEM/primary v1 | PROPOSED | A4 | learning batch MW-HIS-001/002 + MW-FAN-001/002 with angles/durations, adaptive rules, hypothesis-gates |
| 4 | CONSTRAINTS/primary v1 | PROPOSED | A1, visual-identity-production (pillar-trap rule), platform E2E record | validation≠production, no auto-publish, pillar-trap prohibition |
| 5 | DECISION/pilot-model v1 | PROPOSED | A4 | "pilot is adaptive learning system, not fixed campaign; 4 items = initial batch, not permanent size" |

Activation approvals (new rows, created now, rationale cites this plan + A1/A2/A3; decided APPROVE under STRATEGIC_OPERATING_LAYER_V1 phase authorization; never backdated): `STRATEGY_ACTIVATION` for #1, `BRAND_ACTIVATION` for #2. #3–#5 remain PROPOSED awaiting Owner review (no authority claimed).

## Grounding safety

BRAND payload preserves all `assertMorrowayHistoricalContext` keys (morroway, real-world, historical, morrowind, elder scrolls, game, fantasy) via pillars + prohibitions; legacy defaults remain as fallback for any absent field.

## Side effects

Zero provider/LLM/media/publication calls. No workflow started. Old file artifacts untouched. Pre-layer provenance rows keep null snapshot (immutable history).
