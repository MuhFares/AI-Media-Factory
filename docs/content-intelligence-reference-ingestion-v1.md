# Content Intelligence & Reference Ingestion V1

## Scope and role boundary

Research Agent is an intelligence layer. It collects and normalizes evidence for Strategy, Writer, Director, and CEO; it does not silently write, direct, publish, or generate media.

The current implementation keeps the legacy `ResearchAgent` report and `web.search` capability backward-compatible, and adds provider/platform-neutral contracts for research requests, source capabilities, freshness, normalized evidence, reference analysis, originality constraints, and content-intelligence results.

## Current capability matrix

| Capability | Status | Current evidence / limitation |
|---|---|---|
| WEB_SEARCH | IMPLEMENTED_AND_PROVEN | Existing Brave/Tavily/Serper/Exa adapters and runtime capability; provider credentials are environment-dependent. |
| NEWS_SEARCH | PARTIAL | Web search can retrieve news, but there is no dedicated news source/date-enforcement adapter yet. |
| IMAGE_SEARCH | MISSING | Visual research contracts exist; no image-search provider adapter is wired. |
| YOUTUBE_SEARCH | IMPLEMENTED_AND_PROVEN | One controlled live `search.list` validation succeeded with three real IDs; bounded/no-pagination behavior is persisted. |
| YOUTUBE_METADATA | IMPLEMENTED_AND_PROVEN | One batched `videos.list` enrichment succeeded with dates, duration, thumbnails, and returned public statistics. |
| YOUTUBE_TRANSCRIPT | MISSING | No legitimate transcript adapter. |
| YOUTUBE_REFERENCE_ANALYSIS | PARTIAL | A returned canonical URL was parsed and associated with metadata; transcript/media/semantic analysis remain unavailable. |
| INSTAGRAM_DISCOVERY | BLOCKED_BY_EXTERNAL_PLATFORM | Official access is account/app/permission scoped; no adapter. |
| INSTAGRAM_REFERENCE_URL | REQUIRES_UPLOAD | Do not bypass login/anti-bot restrictions; inaccessible URLs must become an upload request. |
| TIKTOK_DISCOVERY | REQUIRES_AUTH | Official Display/Research APIs require approved products and authorization; no adapter. |
| TIKTOK_REFERENCE_URL | REQUIRES_UPLOAD | No unrestricted public URL ingestion is claimed. |
| GENERIC_URL_INGESTION | PARTIAL | URL canonicalization and evidence contracts exist; safe retrieval/HTML extraction is not yet a dedicated capability. |
| UPLOADED_VIDEO_INGESTION | IMPLEMENTED_AND_PROVEN | Project-local MP4 ingestion validates path, hash, metadata, and samples frames. |
| VIDEO_METADATA_EXTRACTION | IMPLEMENTED_AND_PROVEN | Local `ffprobe` extraction. |
| VIDEO_TRANSCRIPT_EXTRACTION | BLOCKED_BY_MISSING_CAPABILITY | Current local path records `TRANSCRIPT_UNAVAILABLE`. |
| VIDEO_FRAME_SAMPLING | IMPLEMENTED_AND_PROVEN | Local `ffmpeg` first/middle/last frame extraction. |
| VIDEO_CONTENT_ANALYSIS | PARTIAL | Mechanical metadata/observations only; semantic multimodal analysis is unavailable. |
| TREND_ANALYSIS | PARTIAL | Contracts support freshness, recurrence, and confidence; no cross-platform trend collector yet. |
| COMPETITOR_ANALYSIS | PARTIAL | Can be expressed through web evidence; no dedicated profile/benchmark collector. |
| CONTENT_PATTERN_EXTRACTION | PARTIAL | Reference analysis contract and originality constraints exist; semantic extraction requires multimodal/runtime evidence. |

## Source and evidence model

`ResearchRequest` supports mode, topic/query, reference URLs, uploaded media, platforms, freshness, language, region, source limits, and objective. `ResearchEvidence` keeps source type, platform, canonical URL, dates, access method, provenance, confidence, limitations, and optional transcript/engagement/media metadata. Missing fields remain unknown.

Freshness is explicit: `REALTIME_OR_NEAR_REALTIME`, `LAST_24_HOURS`, `LAST_7_DAYS`, `LAST_30_DAYS`, `EVERGREEN`, or `CUSTOM_RANGE`. A dated source does not silently satisfy a recent request when it is outside the requested window.

Evidence kinds are separated as `FACT`, `SOURCE_CLAIM`, `OBSERVATION`, `INFERENCE`, and `UNKNOWN`. Trend claims require corroboration and recurrence evidence; views alone are not a trend verdict.

## Reference video ingestion

`ingestLocalReferenceVideo` accepts only an absolute project-controlled path, validates non-zero bytes and a video stream, computes SHA-256, extracts container/duration/resolution/FPS/audio presence, and samples first/middle/last frames. The current local validation used the existing approved Wan MP4 and produced evidence under `output/content-intelligence-reference-ingestion-v1/local-video/` with hash `5B77DB...322C2D`, `480x832`, `5.03125s`, H.264, and no audio track. Transcript extraction and semantic multimodal analysis remain explicitly unavailable.

`ReferenceContentAnalysis` separates observed data from inferred data and carries `STRUCTURAL_INSPIRATION` originality constraints. It prohibits copying exact scripts, distinctive phrasing, logos/watermarks, creator identity, exact shot sequences, copyrighted footage/music, protected characters, and unique visual composition.

## Platform access research

- YouTube Data API v3 supports authorized projects, resource listing, search, and public/authorized metadata. Google documents a default 10,000-unit daily quota and `search.list` cost of 100 units; captions are a separate API surface and are not assumed available for arbitrary videos. Official sources: [YouTube Data API overview](https://developers.google.com/youtube/v3/getting-started), [search.list](https://developers.google.com/youtube/v3/docs/search), and [quota/compliance](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits).
- Instagram’s official APIs are centered on Instagram professional accounts and authorized app access. Meta’s current documentation describes Instagram Login/permissions and account-owned media/insights; it does not provide unrestricted arbitrary public Reel/video research. Public URL analysis therefore degrades to `REFERENCE_ACCESS_BLOCKED` / `REQUIRES_UPLOAD` without approved access. Official reference: [Meta Instagram API documentation](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api).
- TikTok’s official Display API provides authorized access to a user’s profile and videos, while Research API access requires an approved research project/client. Neither is an unrestricted arbitrary-URL scraping path. Official sources: [Display API overview](https://developers.tiktok.com/docs/en/display-api-overview), [Display API setup](https://developers.tiktok.com/docs/en/display-api-get-started), and [Research API setup](https://developers.tiktok.com/doc/research-api-get-started/).

No scraping, anti-bot bypass, private-content access, or platform restriction bypass is implemented.

## Validation and next step

Local contract tests cover canonical URLs, freshness, unknown evidence, and project path safety. The existing web-search capability remains covered by its provider-mocked integration tests. The local approved video was ingested successfully and frames were extracted. The next smallest milestone is a credentialed, read-only YouTube discovery/metadata adapter with quota-aware evidence; Instagram/TikTok should remain explicit authenticated or upload-required routes until legitimate access is configured.
