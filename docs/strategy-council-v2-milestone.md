# Strategy Council V2 — Canonical Milestone

**Workflow:** `workflow-council-v2-c84ea3d0-f02d-467a-b105-40b09f5f697d`  
**Correlation:** `corr-council-v2-68bdb2ae-fbd6-4527-b472-d8e6df3acf53`  
**Status:** `CLOSED` — 8 specialist artifacts canonical via `governed-openrouter-llm` / `governed-agentrouter-llm`  
**CEO:** `COMPLETED` — `AWAITING_OWNER_APPROVAL` → `APPROVED_WITH_CHANGES` (final owner closure, CEO artifact immutable)  
**Owner Final Decision:** `APPROVED_WITH_CHANGES` (experimental gates pilot-only, stronger Pilot Testing Framework required before pillar/format selection, naming deferred)  
**Strategy Council V2 Phase:** `CLOSED`  
**Date:** 2026-09-08 (closure finalized)  
**No commit / No push — documentation only**

## 1. Why Strategy Council V2

Strategy Council V2 was created to produce a **single coherent business strategy** for a new global short-form content business **before** naming, channel creation, production, or publishing. V1 had proven orchestration but left the content-business direction fragmented across Writer/SEO/Brand/Growth/Finance without a shared evidence contract, lineage, or durable strategy artifact. V2 introduces:

- a single `workflow_id` / `correlation_id` governing all 8 specialists,
- `PRE_PUBLICATION_STRATEGY` mode with `strategyCouncilArtifactIds` lineage,
- strict `STRATEGY_COUNCIL_*_V2` schemas with `additionalProperties:false` and semantic validators (guarantee, naming, fabricated metrics),
- artifact envelope + `listArtifacts` reload + `stableFingerprint` deep equality (JSONB-safe),
- governed provider lifecycle (`STARTED → PROVIDER_SUBMISSION_INTENT → FETCH_INVOCATION_STARTED → HTTP_RESPONSE_HEADERS_RECEIVED → PROVIDER_RESPONSE_RECEIVED → VALIDATING → COMPLETED`) before any `COMPLETED`.

## 2. V1 Historical Lost-State Incident

On `2026-09-05` the live `workflow-council-v2` database was truncated by a test harness (see `docs/incidents/2026-09-05-live-database-truncated-by-test.md`). All V1-linked `workflow-council-v2` artifacts/executions were lost. Recovery required:

- forensic `SELECT` on `artifacts` / `execution_provenance` to identify orphan `V1` vs `V2` lineage,
- re-anchoring to the two surviving canonical inputs (Research `7a37fd46` and Planner `85e5d793`) that were re-established under fresh executions,
- a new `V2` workflow identity `c84ea3d0` with `TEST_DATABASE_URL` isolation for destructive tests, and explicit `DATABASE_URL` guards to prevent future truncation.

No V1 artifact is reused as canonical V2 evidence.

## 3. Database / Test Isolation Remediation

- Introduced `TEST_DATABASE_URL` vs `DATABASE_URL` separation; destructive `TRUNCATE` tests now target the test DB only.
- Added `verify-production-and-prepare-test-db.mjs` and `forensic-postgres-council-state.mjs` guards that abort if `DATABASE_URL` points at the live V2 workflow.
- All `Strategy Council V2` executions now assert `workflow_id` / `correlation_id` lineage on every `saveArtifact` / `listArtifacts` reload.
- Historical failed executions (`1bd7f588`, `7ee86921`, `65e41764`, `0624e03a`, `c13cfa97`, `81690af4`, `2b6eeb9c`, `8a93ee13`, `f540fa92`) remain `failed` as forensic evidence; they are never promoted or deleted.

## 4. Provider Evolution — AgentRouter → OpenRouter First-Class

- **AgentRouter** remains the `Research` / `Planner` provider (`agentrouter-openai` / `gpt-5.6-sol` for `7a37fd46` and `85e5d793`).
- **OpenRouter** was promoted to a **first-class provider** (`provider openrouter`, `protocol OPENAI_COMPATIBLE`, `runtime governed-openrouter-llm`) without duplicating the production executor.
- Routing is explicit per specialist via `openRouterModelOverride` / `agentRouterModelOverride` and `TEXT_AGENT_PROVIDER` scoping; global defaults unchanged (`ROUTE_MUTATIONS 0`).
- Writer/SEO/Brand/Growth/Finance/CEO now all have a proven OpenRouter path via `https://openrouter.ai/api/v1/chat/completions` `stream true`.

## 5. OpenRouter Hardening (Production)

All hardening is proven locally with `node --test` and with live `HTTP 200` streams:

- **Streaming SSE:** `fetch(…/chat/completions, {stream:true})` → `TextDecoder` → `buffer.split("\n")` with leftover, `trim` handles `CRLF`, skips `:` comment/keepalive, requires `data: [DONE]`.
- **Visible delta.content only:** `choices[].delta.content` concatenated into `visibleText`; `delta.reasoning` / `delta.reasoning_content` / `delta.reasoning_details` observed only as `reasoningFieldPresent` / `reasoningDetailsPresent` / `reasoningDetailCount`, never persisted.
- **Reasoning token metadata:** `usage.completion_tokens_details.reasoning_tokens` captured as `reasoningTokens` (e.g., Writer `5530`, SEO `2728`, Brand `4233`, Growth `6559`, Finance `6445`, CEO `7655`).
- **[DONE] handling:** `seenDone` required; missing `[DONE]` throws `OpenRouter … missing [DONE]` with `incomplete:true`.
- **Generation ID capture:** SSE `id: gen-*` (e.g., `gen-1788864640-5FZisrwbHIdJSAV6BYd4`) captured as `generationId` / `effectiveProviderRequestId` when header `x-request-id` absent.
- **Actual-model guard:** `actualModel` from SSE `model` must equal `requestedModel`; mismatch → `MODEL_MISMATCH` no artifact.
- **Incomplete classification:** `finish_reason length` or `missing [DONE]` → `PROVIDER_RESPONSE_INCOMPLETE` (`incomplete:true` checked before `/semantic|missing/` regex), never `SEMANTIC_VALIDATION_FAILED`.
- **Truthful provenance:** `provider openrouter` `runtime governed-openrouter-llm` `protocol OPENAI_COMPATIBLE` persisted via `governedRouteForLifecycle()` checking `openRouterModelOverride` (not via `agentRouterRoute`); `usage` `cost 0` `is_byok false` preserved.
- **stableFingerprint JSONB equality:** `stableFingerprint(revalidated) === stableFingerprint(frozen)` replaces `JSON.stringify` order-sensitive check for Postgres JSONB reordering.
- **Artifact boundary:** strict business payload contains only `STRATEGY_COUNCIL_*_V2` fields; `provider`/`runtime`/`usage`/`reasoning` remain in `execution_provenance.configuration.providerResponse`.

## 6. Model Experiments (Executive / Engineering)

| Model | Provider | Result | Note |
|---|---|---|---|
| `glm-5.3` native via AgentRouter | AgentRouter | `200` but `native compatibility` failure (contract mismatch) | Not migrated |
| `deepseek-v4-flash` via `claude_native` | AgentRouter | `200` `compatible` but no canonical Council migration (writer `1bd7…` hit `length` at 8192) | Proven compatible, not used for canonical |
| `claude-opus-4-8` (and `claude-opus-5`) | AgentRouter | Raw valid JSON but `canonical establishment blocked` by earlier artifact/availability issues (`f6b9…` `fadd…` `a016…`) | Blocked, not retried |
| `nvidia/nemotron-3-super-120b-a12b:free` | OpenRouter | **Strong capability:** small probe `23/25`, full Writer `7673` bytes `stop` `JSON/structural/semantic PASS`; **Free-route instability:** later `missing [DONE]` and `HTTP 404` on identical config | Capability proven, reliability degraded |
| `google/gemma-4-31b-it:free` / `26b` | OpenRouter | `HTTP 429` rate-limited via `Google AI Studio` shared pool (`limit_source upstream_provider_shared_pool`) on both small probe and Writer canary | Rate-limited, not capability failure |
| `dots-studio/dots-3-note-preview:free` | OpenRouter | **Successful canonical Writer `a66bd20d` `visible 4648` `reasoning 5530` and CEO `a9863d82` `visible 13063` `reasoning 7655` `16384` `finish stop` — both `COMPLETED`** | Proven stable canonical path for Writer/SEO/Brand/Growth/Finance/CEO |
| `openrouter/free` router | OpenRouter | `HTTP 200` routed to `cohere/north-mini-code:free` `23/25` but coding-specialized, not writer-suitable | Discovery only, never canonical |

## 7. Canonical V2 Manifest

All `status success` / `lifecycleState COMPLETED` under same workflow/correlation; historical failed executions remain `failed`.

| Specialist | Execution | Artifact | Provider / Model | Runtime | Status |
|---|---|---|---|---|---|
| **Reference Evidence** | — | `art-…-reference-content-evidence` | `BRIGHT_DATA` `gd_lyclm20il4r5helnj` (2 Reels) | — | `completed` |
| **Research** | `7a37fd46-99c4-43b2-a4cc-f27cc1987308` | `art-…-research-main-owner-authorized-v5-gpt56sol` | `agentrouter-openai` / `gpt-5.6-sol` | `governed-agentrouter-llm` | `success` |
| **Planner** | `85e5d793-0c4f-429b-ab28-d35ca4d93a36` | `art-…-planner-synthesis-v2-owner-authorized-fresh-gpt56sol` | `agentrouter-openai` / `gpt-5.6-sol` | `governed-agentrouter-llm` | `success` |
| **Writer** | `a66bd20d-fd1b-4534-bc29-fdf868850197` | `art-…-writer-strategy-v2-owner-authorized-dots-3-note-canary-v1` | `openrouter` / `dots-studio/dots-3-note-preview:free` `AtlasCloud` | `governed-openrouter-llm` | `success` |
| **SEO** | `f2220f60-2a61-4617-a986-7d6b09d6033b` | `art-…-seo-strategy-v2-owner-authorized-dots-3-note-canary-v1` | `openrouter` / `dots-studio/dots-3-note-preview:free` `AtlasCloud` | `governed-openrouter-llm` | `success` |
| **Brand** | `1c785340-5c2c-46d1-9cd7-22b5c4b5e570` | `art-…-brand-strategy-v2-owner-authorized-dots-3-note-canary-v1` | `openrouter` / `dots-studio/dots-3-note-preview:free` `AtlasCloud` | `governed-openrouter-llm` | `success` |
| **Growth** | `dd8c23af-83c5-44f9-9094-4905adf9255b` | `art-…-growth-strategy-v2-owner-authorized-dots-3-note-canary-v2` | `openrouter` / `dots-studio/dots-3-note-preview:free` `AtlasCloud` | `governed-openrouter-llm` | `success` (after calibrated-language remediation) |
| **Finance** | `5d36e1b8-851c-47b7-a6ae-c4b0fe717a13` | `art-…-finance-strategy-v2-owner-authorized-dots-3-note-canary-v1` | `openrouter` / `dots-studio/dots-3-note-preview:free` `AtlasCloud` | `governed-openrouter-llm` | `success` |
| **CEO** | `a9863d82-56c8-481b-a45b-b84415761953` | `art-…-ceo-strategy-v2-owner-authorized-dots-3-note-canary-v3` | `openrouter` / `dots-studio/dots-3-note-preview:free` `AtlasCloud` | `governed-openrouter-llm` | `success` `AWAITING_OWNER_APPROVAL` |

CEO consumed 7 specialist inputs: Research, Planner, Writer, SEO, Brand, Growth, Finance (verified via `configuration.validatedArtifacts` 7 entries).

Historical failed/orphan executions (preserved, non-canonical): `1bd7f588` (DeepSeek length), `7ee86921` (Nemotron orphan `strategy_council_writer_v2` completed artifact but execution `failed` due to JSONB `stableFingerprint` bug, now fixed), `65e41764` / `0624e03a` (Nemotron missing DONE / 404), `c13cfa97` / `81690af4` (Gemma 429), `2b6eeb9c` (Growth guarantee), `8a93ee13` / `f540fa92` (CEO 8192 length, now 16384).

## 8. Final CEO Strategy Summary

CEO `a9863d82` (Dots 3, `max_tokens 16384`, `reasoning 7655`, `visible 13063`, `finish stop`, `cost 0`) synthesizes:

- **Territory:** `Short-form historical POV and AI-generated fantasy storytelling` (Historical POV: Baghdad 1258, House of Wisdom, Mongol siege; Fantasy: shield-and-soul warrior, dragon's lament, soulbound sword — 10 videoConcepts).
- **Audience:** `Global audience seeking dramatic narratives, history enthusiasts, fantasy escapism`.
- **Positioning:** `A dynamic short-form content studio delivering emotionally charged historical and fantasy stories on visual-first platforms.`
- **Channel:** `PHASED_PORTFOLIO` — `launchesFirst Instagram Reels pilot` (Week 1) → `YouTube Shorts` after traction 4-8w → `TikTok` after Shorts 8-12w; `expansionTrigger 5% engagement 10 Reels, 10k views >50%, $100 revenue`.
- **Content:** Primary pillars `Historical POV`, `AI Fantasy`; deferred `Long-form`, `Documentary`; formats `30s Reel` + `15s AI visual`; production `Modular script/visual/voice/editing reusable templates`.
- **Platform:** Reels primary (both references), Shorts bridge, TikTok trend-driven — each with `launchTiming` / `reuseApproach`.
- **Identity:** `HYBRID` (A/B faceless vs on-camera, flexibility).
- **Growth:** 4 pilot Reels → 1/week → 8 Reels → traction gates `5% engagement`, `10k views`, `10% weekly follower growth`, `$100 monetization`.
- **Monetization:** Initial sponsorship/affiliate/ad revenue; later brand partnerships/merchandise/premium; dependencies audience/engagement/platform policy.
- **Finance:** Low-cost free AI + open-source; `unknownCosts` 3; `costControlGates` monthly review/reinvest only after revenue/track cost per view; milestones `100` test, `1k` partial, `10k` expansion as **SCENARIOS**, not forecasts.
- **Risks:** 7 categories (platform, saturation, production, monetization, copyright, cost, operational) with mitigations.

Full payload at `art-…-ceo-…-canary-v3` (`status AWAITING_OWNER_APPROVAL`).

## 9. Owner Status

`APPROVE_WITH_CHANGES`

1. Quantitative gates (5% engagement, 10k views, $100 revenue) are **EXPERIMENTAL PILOT GATES only**, not permanent company truths.
2. Four videos across four weeks may be an insufficient sample; a stronger **low-cost Pilot Testing Framework** must be designed before production launch. (Owner will not mutate CEO artifact; changes recorded here and in governance.)

## 10. Remaining Next Phases

1. **Bright reference-intelligence audit** (this document §11) — completed.
2. **Final owner strategy closure** (approve CEO with above qualifications).
3. **BRAND_AND_CHANNEL_NAMING_V1** (separate, owner-approved; naming is `DEFERRED` in CEO).
4. **Channel/account architecture** (after naming).
5. **Pilot Testing Framework** (stronger low-cost framework per owner change #2).
6. **Production** (modular Reels with AI visuals, human review).
7. **Publishing** (single-platform, approval gate, idempotency).
8. **Analytics/learning** (ingest `content_id` metrics, revenue attribution).
9. **AMF Control Platform** at appropriate phase.

---

## 11. Bright Data Reference Intelligence Provenance Audit (Read-Only)

**Scope:** Two owner-supplied Instagram Reel URLs.

- `https://www.instagram.com/reel/DajiNgwxen9/?igsi=N3h5NmM4Mzh5NWV4` (Baghdad 1258, House of Wisdom)
- `https://www.instagram.com/reel/Dceqmeno62-/?igsi=MWx2cmEzZjQ5YmEwaQ` (shield-and-soul fantasy)

**Provider:** `BRIGHT_DATA` via `bright-data-social` adapter, dataset `gd_lyclm20il4r5helnj` (Instagram Reel metadata), `https://api.brightdata.com/datasets/v3/scrape?dataset_id=…&format=json` POST `[{url}]` with `Bearer` token.

### Field-Level Trace

**BRIGHT_RAW_RESPONSE_FOUND:** No raw `array` JSON persisted as a separate artifact; only normalized `SocialResearchResponse.results` are persisted in the reference artifact. `sanitizedResponseDiagnostic` logs are operational, not persisted.

**BRIGHT_RAW_JSON_AVAILABLE:** `NOT_AVAILABLE` (raw `item.video_url` etc. are mapped in-memory via `normalizeSocialEvidence` but not stored as raw).

**Owner Bright Dataset Correction (2026-09-08):** Owner independently supplied real Bright Data Instagram Reel dataset output proving this dataset/schema **CAN** return `video_url`, `audio_url`, `thumbnail`, `length` (plus `description/caption`, `likes`, `comments`, `top_comments`, `hashtags`, `tagged_users`, `creator metadata`, `coauthors`, `partnership metadata`). Therefore:

- `BRIGHT_DATASET_SUPPORTS_VIDEO_URL = YES`
- `BRIGHT_DATASET_SUPPORTS_AUDIO_URL = YES`
- `BRIGHT_DATASET_SUPPORTS_THUMBNAIL = YES`
- `BRIGHT_DATASET_SUPPORTS_DURATION = YES`

Distinct from:

- `CANONICAL_V2_REFERENCE_VIDEO_URL_RETURNED = NO`
- `CANONICAL_V2_REFERENCE_AUDIO_URL_RETURNED = NO`

(both based ONLY on persisted canonical V2 evidence for the two Reels, where `video_url` was `null`/absent). The architectural finding `REFERENCE_INTELLIGENCE_GAP = YES` remains, but is broader than media URLs — it also includes `top_comments`, `tagged_users`, `coauthors`, `creator/follower context`, `partnership metadata`, richer engagement.

**Raw dataset fields (from adapter code `bright-data-social.ts:33`):**
`url, shortcode|shortCode|id, user_posted|username, description|caption, date_posted|timestamp, length|video_duration, views|video_view_count, likes, num_comments|comments, shares, hashtags, mentions, audio_id, audio_title, audio_artist, video_url|videoUrl`

**Observed normalized fields for both Reels (from `art-…-reference-content-evidence` payload):**

- `BRIGHT_VIDEO_URL_PRESENT:` `NOT_PRESENT` for both (normalized `mediaUrlReference` absent; raw `video_url` was `null`/missing for these two items)
- `BRIGHT_VIDEO_URL_FIELD_NAMES:` `video_url` / `videoUrl` (adapter) — not present in returned data
- `BRIGHT_AUDIO_URL_PRESENT:` `NOT_PRESENT` (no `audio_url`; only `audio_id`/`audio_title`/`audio_artist` fields exist in adapter but were `null` for these items)
- `BRIGHT_AUDIO_URL_FIELD_NAMES:` `audio_url` (not in current adapter; adapter only maps `audio_id|audio_title|audio_artist`)
- `BRIGHT_OTHER_MEDIA_FIELDS_PRESENT:` `PARTIAL` — `thumbnail` / `image` fields not in Bright Reel dataset; `duration` (`length` → `durationSeconds`) was `undefined` for both; `viewCount` present via `views`; `likeCount`/`commentCount` present; `shareCount` present; `authorOrCreator` present (`official.povhistory` / `azys.ai`); `platformContentId` present (`DajiNgwxen9` / `Dceqmeno62-`)
- `BRIGHT_OTHER_MEDIA_FIELD_NAMES:` `length → durationSeconds`, `views → viewCount`, `likes → likeCount`, `num_comments → commentCount`, `user_posted → creatorName`, `shortcode → platformContentId`
- `BRIGHT_CAPTION_PRESENT:` `YES` (`caption` = `description` from Bright, full text preserved)
- `BRIGHT_AUTHOR_PRESENT:` `YES` (`authorOrCreator`)
- `BRIGHT_ENGAGEMENT_PRESENT:` `YES` (`likeCount 46526/753036`, `commentCount 1204/1360`)

**REFERENCE_ARTIFACT_PRESERVES_VIDEO_URL:** `NO` (field `mediaUrlReference` absent)
**REFERENCE_ARTIFACT_PRESERVES_AUDIO_URL:** `NO`
**REFERENCE_ARTIFACT_PRESERVES_OTHER_MEDIA_FIELDS:** `PARTIAL` (preserves `caption`, `hashtags`, `engagement`, `authorOrCreator`, `platformContentId`, `canonicalUrl`, `publishedAt`, but not `video_url`/`duration` because source did not return them)

**RESEARCH_PROJECTION_INCLUDES_VIDEO_URL:** `NO` (`compactStrategyResearchEvidence` in `production-executor.ts:338-388` projects `captionExcerpt` (360 chars), `hashtags` (8), `engagement`, `sourceUrl`, `platform`, `publishedAt`, `authorOrCreator`, `provenance`, but never `mediaUrlReference`/`video_url`/`duration`)
**RESEARCH_PROJECTION_INCLUDES_AUDIO_URL:** `NO`
**RESEARCH_PROJECTION_INCLUDES_MEDIA_METADATA:** `NO` (no `duration`, `mediaUrlReference`, `thumbnail`, `audioId` in projection)

**RESEARCH_PROMPT_ACTUALLY_INCLUDED_VIDEO_URL:** `NO` (`evidence projection` JSON slice `2400` chars contains `sourceUrl` = `https://www.instagram.com/reel/…` but not direct `video_url`)
**RESEARCH_PROMPT_ACTUALLY_INCLUDED_AUDIO_URL:** `NO`
**RESEARCH_PROMPT_ACTUALLY_INCLUDED_MEDIA_METADATA:** `NO` (only caption excerpt + hashtags + engagement; verified via `configuration.validatedArtifacts` and `compactStrategyResearchEvidence` code path)

**RESEARCH_ACTUALLY_CONSUMED_RICH_BRIGHT_FIELDS:** `NO` — Research consumed only metadata/summary (`caption` snippet, `hashtags`, engagement counts, `sourceUrl`) as `ResearchEvidence` `sources[].snippet` (e.g., `Caption presents Baghdad in 1258 … 46,526 likes … Transcript unavailable`).

**MEDIA_FIELDS_DROPPED_AT_STAGE:** `NORMALIZATION` (raw `video_url` was `null` for these two items, so no drop; but even if present, `production-executor.ts` projection would drop `mediaUrlReference` before Research prompt) + `RESEARCH_PROJECTION` (by design, `compactStrategyResearchEvidence` does not project media fields)

**RESEARCH_PROMPT_CONSUMPTION:** `PROVABLE` (proven via code path `compactStrategyResearchEvidence` → `Research` agent `strategyEvidence` → `validatedArtifacts` projection; no `video_url` in persisted `research.payload.sources[].snippet`).

### Media URL Safety

No video/audio was downloaded or fetched during audit. No signed URLs were printed. Field names and presence only reported above.

### Reference Intelligence Pipeline Assessment

**REFERENCE_INTELLIGENCE_PIPELINE:** `METADATA_ONLY` (caption, author, hashtags, engagement, sourceUrl, platformContentId preserved; direct media URLs/duration not returned for these two items and not projected even if returned)

**REFERENCE_INTELLIGENCE_GAP:** `YES` — gap at `RESEARCH_PROJECTION` boundary: `normalizeSocialEvidence` supports `mediaUrlReference` (`video_url`) but `compactStrategyResearchEvidence` intentionally projects only `captionExcerpt`/`hashtags`/`engagement` for Research LLM; even if Bright had returned `video_url`, Research would not have consumed it.

**FUTURE_REFERENCE_INTELLIGENCE_RECOMMENDATION:** `DESIGN_ONLY` — Define a normalized **Reference Intelligence Contract** separate from Research projection:

- `source { sourceUrl, sourceId (platformContentId), provider (BRIGHT_DATA), datasetId, retrievedAt }`
- `author { authorOrCreator }`
- `caption { text, hashtags }`
- `engagement { likeCount, commentCount, viewCount, shareCount }`
- `media { video { url: mediaUrlReference (redacted), durationSeconds, thumbnail? }, audio { id, title, author }, image? }`
- `retrievalProvenance { provenance (BRIGHT_DATA_DATASET:…), accessMethod API, limitations, publishedAt }`
- `rights { reuseStatus: RESEARCH_REFERENCE_ONLY, analysisStatus: TRANSCRIPT_UNAVAILABLE }`

Keep `REFERENCE ANALYSIS RIGHTS` (metadata analysis) separate from `MEDIA REUSE RIGHTS` (downloadable URL ≠ permission; `rights: RESEARCH_REFERENCE_ONLY` already correctly in reference artifact). Store raw `video_url` (redacted) in reference artifact if returned, but keep it out of LLM prompts unless explicitly required for multimodal analysis.

### Council Strategy Material Impact

**COUNCIL_STRATEGY_MATERIAL_IMPACT:** `LOW`

Research correctly reasoned from `caption` + `engagement` + `sourceUrl` without video/audio bytes; its `strategyFindings` explicitly note `TRANSCRIPT_UNAVAILABLE` and `Research reference only`, and Planner/Writer/SEO etc. correctly hedge with `unknowns` (`audience retention UNKNOWN`, `best platform-native execution UNKNOWN`). The CEO strategy remains valid as a **metadata-grounded** strategy. Rich media would enable future **multimodal** enhancements (transcript, visual style, audio analysis) but was not required for the current business/channel/portfolio decisions.

## 12. Verification

Read-only `SELECT` on `artifacts` / `execution_provenance` for `workflow-council-v2-c84ea3d0-f02d-467a-b105-40b09f5f697d` / `corr-council-v2-68bdb2ae-fbd6-4527-b472-d8e6df3acf53`:

- 8 specialist `status success` / `COMPLETED` executions verified (Research `7a37fd46`, Planner `85e5d793`, Writer `a66bd20d`, SEO `f2220f60`, Brand `1c785340`, Growth `dd8c23af` v2, Finance `5d36e1b8`, CEO `a9863d82` v3).
- 7 CEO specialist inputs verified (`Research, Planner, Writer, SEO, Brand, Growth, Finance`).
- CEO `a9863d82` consumed 7 inputs, `max_tokens 16384`, `finish stop`, `visible 13063`.
- No duplicate canonical Writer: `success` Writer count =1 (`a66bd20d`); orphan `7ee…` remains `failed` (1 artifact `completed` but execution `failed`, not counted as canonical).
- Historical failed executions (`1bd7f588`, `7ee86921`, `65e41764`, `0624e03a`, `c13cfa97`, `81690af4`, `2b6eeb9c`, `8a93ee13`, `f540fa92`) remain `failed`.
- Workflow owner-approval: `APPROVE_WITH_CHANGES` (documented here, not yet persisted as DB governance state).

## 13. Accounting

- Model generation calls, AgentRouter, OpenRouter, Bright, Serper, media, publishing: `0` for this task (documentation + read-only audit).
- Canonical artifact / execution provenance / database destructive writes: `0` (no mutation).
- File edits: `1` new doc `docs/strategy-council-v2-milestone.md` + `1` update to `docs/project-state.md` (allowed).

## 14. Final Owner Closure (2026-09-08)

**OWNER_FINAL_DECISION = APPROVED_WITH_CHANGES** (CEO artifact `art-…-ceo-…-canary-v3` remains immutable; amendments recorded here and in governance, not in artifact)

**Amendments:**
1. `5% engagement`, `10k views`, `$100 revenue` are `EXPERIMENTAL_PILOT_GATES` only — not permanent company benchmarks.
2. `Four videos over four weeks` is insufficient sample for pillar/format validation; **PILOT_TESTING_FRAMEWORK_V1** is required before durable pillar/format selection. (Design deferred to next phase.)
3. `REFERENCE_INTELLIGENCE_GAP = YES` remains **non-blocking** for Strategy Council V2; no Council rerun required. **Bright dataset** supports `video_url`/`audio_url`/`thumbnail`/`length` etc. (owner proof), but canonical V2 evidence for these two Reels did not return them — gap is broader than media URLs (top comments, tagged users, coauthors, partnership metadata, richer engagement).

**STRATEGY_COUNCIL_V2_PHASE = CLOSED** (all 8 specialists canonical, CEO `AWAITING_OWNER_APPROVAL` → `APPROVED_WITH_CHANGES`)

**BRIGHT_DATASET_SUPPORTS_RICH_MEDIA = YES** (see §11 correction)  
**REFERENCE_INTELLIGENCE_GAP = YES** (proven at `RESEARCH_PROJECTION` boundary)  
**REFERENCE_INTELLIGENCE_GAP_BLOCKING_STRATEGY = NO**  
**FUTURE_CAPABILITY = REFERENCE_INTELLIGENCE_CONTRACT_V2** (design-only, covers `source`, `author`, `caption`, `engagement`, `media.video/audio/thumbnail/duration`, `retrievalProvenance`, `rights`; `REFERENCE ANALYSIS RIGHTS` separate from `MEDIA REUSE RIGHTS`)

**Next Authorized Business Phase:** `BRAND_AND_CHANNEL_NAMING_V1_PREPARATION` (naming deferred per CEO, requires owner approval; no names generated, no media download, no framework design in this task).

---

**Next Phase:** `BRAND_AND_CHANNEL_NAMING_V1` → channel/account architecture → Pilot Testing Framework (stronger low-cost framework per owner change) → production → publishing → analytics → AMF Control Platform.

