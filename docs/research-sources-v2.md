# Research Sources V2 — YouTube, News, and Image Discovery

## Implementation status

The existing Research Agent still accepts its legacy `ResearchAgentInput` and web capability requests. A backward-compatible `executeSourceRequest(ResearchRequest)` entry point now delegates to the centralized source router when configured. This milestone adds a real read-only `YouTubeResearchAdapter` in the provider-adapters package and exports safe YouTube URL parsing. It performs one bounded `search.list` request followed by one `videos.list` metadata request, records request count and official quota estimates, and never paginates implicitly.

Public discovery can use an API key. OAuth is reserved for authorized/user-owned operations and other scopes; it is not silently required for public search. Current quota accounting uses the granular method buckets documented by Google: `search.list` costs 1 request in the `SEARCH_QUERIES` bucket with a documented default of 100 calls/day, and `videos.list` costs 1 unit in the default read bucket. Official quota references: [YouTube API overview](https://developers.google.com/youtube/v3/getting-started), [search.list](https://developers.google.com/youtube/v3/docs/search), [videos.list](https://developers.google.com/youtube/v3/docs/videos/list), and [quota calculator](https://developers.google.com/youtube/v3/determine_quota_cost).

### Live validation result

The environment reported `YOUTUBE_API_KEY = AVAILABLE` without logging any secret. One request used `search.list` for `Egypt travel`, `maxResults=3`, `publishedAfter` set to the calculated `LAST_30_DAYS` boundary, and no pagination. One batched `videos.list` request enriched the three returned IDs. All three had `freshnessSatisfied=true`. The gate consumed 2 HTTP requests and 2 quota units under the current model. Evidence is under `output/research-sources-v2/youtube-live-validation-v1/`.

The adapter returns title, description, channel, publication date, thumbnails, duration, and public statistics only when returned by the API. It does not identify Shorts as a separate semantic category, infer engagement velocity, or provide arbitrary public-video transcripts. A YouTube reference URL can be parsed into a video ID, but metadata retrieval remains credential-gated and metadata-only; no shot, transcript, or semantic content claim is made without media/transcript evidence.

## News and images

News uses the existing web-search transport rather than a duplicate provider. `normalizeSearchEvidence` preserves URL, query, retrievedAt, publishedAt, provenance, and claim-vs-observation semantics. `newsEvidenceEligible` rejects undated or stale evidence for a requested freshness window. A dedicated news provider is not required for V2, but a future news adapter may add stronger publication-date guarantees and source metadata.

Image/visual discovery remains limited by the absence of a dedicated image-search adapter. Existing `VisualResearchResult`/`VisualEvidence` contracts remain intact; discovered web images must be represented as research references, never automatically treated as licensed generation assets. No image-search live call was made.

## Source routing and fallbacks

`researchSurfacePlan` centralizes default routing: fact/news → web, visual → web/image-capable source, trend/content discovery → web + YouTube. Explicit platform requests override defaults. Instagram remains `REFERENCE_ACCESS_BLOCKED` / `REQUIRES_UPLOAD` without approved Meta access. TikTok remains `REQUIRES_AUTH` for official APIs and `REQUIRES_UPLOAD` for inaccessible arbitrary URLs. No browser automation or scraping bypass exists.

## Validation

Mocked YouTube tests pass URL parsing, metadata normalization, duration/statistics handling, and quota accounting. Research contract tests pass canonicalization, freshness, evidence normalization, source routing, and project path safety. The existing approved local Wan MP4 remains a successful local ingestion fixture with frame sampling; transcript and multimodal semantic analysis remain unavailable. Provider generation calls are zero.

## Social Intelligence Provider V1

The social extension is generic and opt-in. A single Apify direct public Instagram Reel diagnostic succeeded and normalized real metadata/engagement/audio fields; Instagram public reference metadata is now proven for tested fields. Keyword discovery remains separate and unproven after its earlier inconclusive run. Transcript and multimodal analysis remain unavailable; TikTok remains unvalidated.

Hashtag discovery V2 used the documented single token `travel` with one bounded Actor run. The run succeeded but returned only a `no_items` envelope, so no discovery record was accepted; that historical result remains `INCONCLUSIVE`.

Bright Data final direct-reference validation V2 completed one synchronous Reels scrape for the preserved public Reel URL and normalized one real Instagram record. Bright Data direct-reference metadata and returned engagement are now live-proven for this dataset and field set; transcript, audio metadata in this run, discovery, and multimodal analysis remain unproven. No fallback or retry occurred. Evidence: `output/social-intelligence-provider-v1/bright-data-provider-v1/live-validation-v2/`.

The subsequent integration work adds a capability-based social router and governed research source strategy. Apify is eligible for proven Instagram discovery and direct-reference capabilities; Bright Data is eligible only for supported direct-reference capabilities and only as policy-controlled fallback after a known terminal failure. Ambiguous submission/timeouts require reconciliation and cannot trigger a second paid submission. Research budgets and trend verdicts remain explicit; no live calls were used for this integration milestone.

The specialized Apify-maintained `apify/instagram-search-scraper` was then exercised once in its documented `popular` keyword mode with `Egypt travel` and `searchLimit=3`. It returned three usable Instagram video records with stable identities and real returned engagement/music fields. `INSTAGRAM_KEYWORD_DISCOVERY` is now proven specifically for popular-Reels mode; generic free-text, all other modes, transcript and multimodal analysis remain unproven. Evidence: `output/social-intelligence-provider-v1/instagram-specialized-discovery-provider-v1/`.

Bright Data Social Intelligence Provider V1 is implemented as a second generic provider adapter, but live validation is blocked because `BRIGHTDATA_API_TOKEN` is missing. Official Bright Data documentation supports URL-oriented Instagram profiles, posts, reels, and comments with synchronous JSON and asynchronous delivery options; discovery is product-dependent and remains partial/unproven in this repository. The free allowance and PAYG model are recorded without treating requests as records. Evidence: `output/social-intelligence-provider-v1/bright-data-provider-v1/`.

The subsequent single live Bright Data attempt used the Reels dataset and returned HTTP 400 with no delivered record. No retry or Apify fallback occurred; the cause remains unproven and Bright Data capabilities remain unproven pending a separately authorized diagnostic.
