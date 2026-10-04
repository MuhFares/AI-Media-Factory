# Social Intelligence Provider V1

V1 adds a provider-agnostic social layer and an Apify Actor-backed adapter. No social credential was present, so no live Actor run was made. Required variable: `APIFY_API_TOKEN`; its value is never logged or persisted. Bright Data remains replaceable.

`packages/research-agent/src/social-intelligence.ts` defines normalized platform, capability, risk, run-status, transcript-provenance and evidence contracts. Outputs normalize into existing `ResearchEvidence`; unknown metrics remain absent. Results are bounded to 1–10 (default 3), do not auto-paginate, and do not retry ambiguous paid submissions.

Instagram/TikTok reference URLs are parsed and canonicalized when recognizable. Without a configured provider, the safe fallback is `UPLOAD_VIDEO_REQUIRED`. Uploaded local video remains the route for metadata/frame extraction; transcript and multimodal semantic analysis remain unavailable.

| Capability | Apify | Bright Data | Current state |
|---|---|---|---|
| Instagram discovery/reels/metadata/engagement | Actor-dependent | Paid product | Contract implemented; live unproven |
| TikTok discovery/metadata/engagement | Actor-dependent | Paid product | Contract implemented; live unproven |
| Transcripts/audio/trends | Actor/product dependent or unknown | Unknown/product dependent | Never claimed |

Apify’s official documentation describes Actors, REST runs, datasets and webhooks; its Store includes maintained and community Actors, so owner/schema/maintenance/pricing are per-Actor facts. Bright Data’s official pages advertise Instagram/TikTok products, 5,000 free records/month and PAYG pricing shown as $1.50/1,000 records; exact scope must be confirmed before use.

Only public/provider-managed access is modeled. Terms, privacy, copyright and production-use questions remain `REVIEW_REQUIRED`. No login or anti-bot bypass, private-content access, browser automation, or custom proxy infrastructure exists. Social thumbnails are research references, not licensed generation assets. Views alone are not a trend.

## Bright Data Provider V1

Bright Data is integrated as a second provider-neutral Social Intelligence adapter, while Apify remains unchanged and eligible. The adapter currently supports URL-oriented Instagram Reel/Post metadata through Bright Data dataset IDs and normalizes provider fields into the existing social evidence contract. It deliberately does not guess a Bright Data discovery endpoint; discovery is `PARTIAL` and product-dependent until a supported credential-backed operation is validated.

The current official Bright Data pages document a 5,000 successful-record monthly free tier, no credit card requirement, PAYG pricing of `$1.50/1,000` records, charging only successfully delivered results, and monthly spend limits. Rollover and post-exhaustion behavior are not documented in the audited sources and remain unknown. HTTP requests, jobs/snapshots, delivered records, free allowance, and billable records are separate accounting dimensions. Sources: [Instagram Scraper product](https://brightdata.com/products/web-scraper/instagram), [Instagram API docs](https://docs.brightdata.com/datasets/scrapers/instagram/introduction), and [first request/API dataset reference](https://docs.brightdata.com/datasets/scrapers/instagram/send-first-request).

The initial provider gate found `BRIGHTDATA_API_TOKEN` missing. A later controlled request used the documented `/scrape` contract but returned HTTP 400 before a record; no retry or fallback occurred. The request-contract diagnostic preserved that result and added bounded, redacted non-2xx response diagnostics for future authorized runs. Evidence is under `output/social-intelligence-provider-v1/bright-data-provider-v1/`. Research access is not a production license; terms, privacy, copyright, and platform restrictions remain `REVIEW_REQUIRED`.

### Bright Data live validation attempt 001

After the credential became available, one controlled request was sent through the Bright Data Instagram Reels dataset for the existing public Reel reference. Bright Data returned HTTP 400 before delivering a record. The adapter classified this as `FAILED_PROVIDER_VALIDATION`, with zero retries, zero fallback calls, and unknown cost; no root cause is claimed because the provider response body was not preserved by the current adapter. Evidence is under `output/social-intelligence-provider-v1/bright-data-provider-v1/live-validation-001/`. Bright Data remains implemented but unproven for that historical attempt.

### Bright Data final controlled live validation V2

One final authorized synchronous `/datasets/v3/scrape` request was made for the same public Reel reference using dataset `gd_lyclm20il4r5helnj`. The provider returned one real Instagram record with stable content ID/URL, creator, caption, publication date, likes, and comments. The request used no retry, pagination, fallback, or second submission and is `PASS` for Bright Data direct-reference metadata and returned engagement fields. Audio metadata and transcript were not returned and remain unproven. Evidence is under `output/social-intelligence-provider-v1/bright-data-provider-v1/live-validation-v2/`.

The provider did not return invoice cost. Evidence records an estimated `$0.0015` for one successful record at the audited `$1.50/1,000` PAYG rate, while preserving the console-observed `5,000/5,000` allowance separately from HTTP request quota. Apify remains the broader proven reference path in the preserved comparison; Bright Data is now a viable redundant direct-reference provider, not a universal replacement. Research access remains distinct from production licensing.

## Apify Instagram live validation

The credential was available and one bounded Actor run was made with `Egypt travel`, `searchType=hashtag`, `resultsType=posts`, and `resultsLimit=3`. The official Actor completed and reported $0.0027 usage, but the adapter observed one non-normalizable record and the dataset readback was empty/private. Therefore the result is `INCONCLUSIVE`, not a capability PASS: no metadata, engagement, transcript, audio, or trend claim was accepted. No second run was made; reference reuse used zero provider runs. Evidence is under `output/social-intelligence-provider-v1/apify-instagram-live-v1/`.

Local validation remains mocked for tests. No generation or publishing calls were made.

## Direct reference diagnostic

The previous keyword gate remains `INCONCLUSIVE` with root cause `INSUFFICIENT_EVIDENCE`; `EMPTY_OR_PRIVATE_DATA` was an operator readback classification, not an Apify failure code. A single documented public Reel URL lookup then succeeded and normalized real ID/URL, creator, caption, date, likes, comments, plays, hashtags, mentions, and music metadata. Provider-reported cost was `$0.0027`. This proves public direct-reference metadata for returned fields only; transcript, multimodal analysis, and trending-audio claims remain unproven.

## Specialized Instagram discovery provider V1

The Apify-maintained `apify/instagram-search-scraper` (`DrF9mzPPEuVizVF4l`) was audited from its current official schema and tested once with the documented popular-reels keyword mode: `{ search: "Egypt travel", searchType: "popular", searchLimit: 3 }`. The Actor returned three actual Instagram video records in dataset `zO15d1YN9GN2cDP9W`, each with stable ID/shortCode/URL, creator, caption, timestamps, likes/comments/plays, hashtags, location and music metadata. Provider-reported run cost was `$0.0081`; no retry or pagination was used. Evidence is under `output/social-intelligence-provider-v1/instagram-specialized-discovery-provider-v1/`.

This proves `INSTAGRAM_KEYWORD_DISCOVERY` and popular-Reels content discovery only. It does not prove free-text semantic search, all documented user/hashtag/place modes, transcripts, multimodal analysis, or trend status. The previous hashtag attempts remain historical `INCONCLUSIVE`. The generic `apify/instagram-scraper` remains the direct-reference Actor. [Official Actor schema and documentation](https://apify.com/apify/instagram-search-scraper).

## Discovery validation V2

The documented hashtag mode was tested once with the single token `travel` (`searchType=hashtag`, `resultsType=posts`, `resultsLimit=3`). The Actor completed, but the dataset contained one `{ error: "no_items" }` envelope and zero Instagram content records. The adapter now excludes such envelopes from record counts and emits `NO_ITEMS_ENVELOPE`. Discovery remains `IMPLEMENTED_LIVE_UNPROVEN`; direct reference metadata remains proven separately. The earlier phrase `Egypt travel` should not be treated as one hashtag target. [Current Actor input/output semantics](https://apify.com/apify/instagram-scraper)

## Social Intelligence Research Integration V1

Research Agent integration is capability-based. `SocialCapabilityRouter` selects eligible providers from registrations rather than exposing Actor IDs to the agent. Current policy selects Apify for Instagram discovery and direct-reference metadata, with Bright Data eligible only for supported direct-reference metadata as a policy-controlled fallback after a known terminal provider failure. `SUBMISSION_OUTCOME_UNKNOWN`, network timeout, and reconciliation-required states never trigger automatic fallback or a duplicate paid request.

`ResearchSourceStrategy` records intentional WEB/YOUTUBE/SOCIAL sources and `ResearchBudget` bounds external requests, paid runs, estimated cost, results per source, fallback, and experimental-provider use. `ContentIntelligenceResult` exposes strategy, source coverage, missing capabilities, cost summary, provenance summary, and a non-claiming trend verdict. Social results remain evidence, not trend conclusions; public retrieved media remains `RESEARCH_REFERENCE_ONLY` and does not imply production rights.
