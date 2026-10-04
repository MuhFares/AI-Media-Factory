# Visual Production Routing V1

Status: **COMPLETE**. This document records the finalized routing evidence and the closed Round 1 / FLUX GPU right-sizing decision. No new provider execution is authorized by this closure.

## Existing architecture audit

The repository already has a provider-agnostic `image.generate` capability, authorization and capability registry, evidence fields, a provider registry, and concrete `runpod-zimage` and `self-hosted-image` (FLUX/ComfyUI) adapters. The image executor validates and forwards the generation contract; the registry currently chooses one configured active provider. Visual research, visual strategy, scene briefs, and the fail-closed Reviewer/QA image gate already exist. Artifact/evidence persistence and timeline/director integration are separate orchestration surfaces. There was no generic evidence-driven visual router, capability profile, or manual external generation lifecycle, so routing is added to the existing visual-capability package rather than creating a second provider system.

The current Z-Image I2I limitation remains: its adapter accepts `referenceImageUrl` only. The repository has local artifacts/data URLs and provider response persistence, but no approved object storage or signed provider-readable URL issuer. This phase does not change that boundary.

## Routing model

`visual-production-routing.ts` separates content domain (for example `CARTOON_2D` or `LOCATION_SENSITIVE`) from requirements (for example `CHARACTER_CONSISTENCY`, `REFERENCE_EDIT`, or `LOCATION_FIDELITY`). A `ProviderCapabilityProfile` records provider/model, route, benchmark evidence, separate human and automated verdicts, quality/cost/latency when known, commercial eligibility, resolution, confidence, and benchmark provenance. Unknown and unbenchmarked values remain unknown; no score is invented.

Selection is deterministic: filter by hard requirements, human-approved evidence, automated non-failure evidence, commercial eligibility, and quality threshold; then choose the lowest configured cost and latency among eligible automatic low-cost providers. Premium evidence is the next route. If no automatic route qualifies, the decision can escalate to `MANUAL_EXTERNAL_GENERATION` or `REAL_OR_LICENSED_MEDIA`; it never silently selects a cheap provider with failed/unknown reference fidelity.

Routes are `AUTOMATIC_LOW_COST`, `PREMIUM_API`, `MANUAL_EXTERNAL_GENERATION`, and `REAL_OR_LICENSED_MEDIA`. Qwen and other premium APIs are not integrated here. Z-Image and FLUX remain candidates; domain winners are not hardcoded.

## Manual external generation and ingestion

`ManualExternalGenerationRequest` is a provider-independent request containing the ready-to-paste prompt, negative constraints, references and descriptions, dimensions, purpose, acceptance/preservation criteria, and a safe output inbox identifier. Its lifecycle is:

`PENDING_HUMAN_GENERATION → ASSET_RECEIVED → REVIEW_REQUIRED → QA_REQUIRED → APPROVED | REJECTED`.

The request never requires credentials or a particular website. A future filesystem inbox may use a request-scoped path such as `input/human-assets/<requestId>/`, resolved through the existing artifact/path-safety rules; arbitrary paths must not be accepted. `HumanAssetProvenance` preserves source type, optional provider/model notes, human origin, request ID, references, approval state, SHA256, dimensions, and ingestion time. The lifecycle contract prevents bypassing Reviewer and QA.

Qwen Chat is currently recorded as one metadata instance of this generic route: `externalTool=QWEN_CHAT`, provider/API cost `0`, `humanInterventionRequired=true`, `automationLevel=MANUAL`, and `costClassification=MANUAL_EXTERNAL_ZERO_PROVIDER_COST`. This does not mean zero human or operational cost, and it is not a Qwen API integration. Manual Qwen evidence remains `MANUAL_EXTERNAL_BENCHMARK_EVIDENCE`; Cairo/Egypt fidelity remains not approved.

Every imported or generated visual follows Reviewer → QA → human gate when automation is unavailable. The existing gate remains fail-closed: unavailable multimodal review is `HUMAN_REVIEW_REQUIRED`, not automated PASS.

## Prepared benchmark: Z-Image vs FLUX

The first fair benchmark uses the same semantic prompt for both providers, one call per provider per case, with no provider-specific prompt optimization. Eight cases cover people, lifestyle, sports, cinematic, wildlife, product, 2D cartoon, and stylized 3D. This is a small representative set spanning human anatomy/action, realism, material/geometry, and stylization without spending calls on every taxonomy label. Proposed future live calls: **16 total** (8 cases × 2 providers), excluding retries and any reference/I2I extension. Target is 1024×1024. Each result is technically checked separately from a human 1–10 rubric: prompt adherence, visual quality, domain fit, and production readiness; task-specific criteria are added where appropriate.

No live calls were made in this preparation phase. Current evidence is preserved: Z-Image T2I categories already have the recorded human PASS results; tested Z-Image reference/location preservation remains human FAIL; FLUX evidence remains historical/configured-candidate evidence only. Current provider pricing is not embedded because the repository has no verified versioned pricing registry; estimated cost is therefore unknown until the live benchmark configuration supplies it.

## Current evidence and open decisions

Egypt/Cairo is not hardcoded as impossible. Current evidence means `EGYPT_LOCATION_FIDELITY` has no approved automatic provider until a future benchmark proves otherwise; specialist, manual, or real/licensed routes remain available. The next decision is whether to authorize the prepared Z-Image vs FLUX benchmark, and separately how to provide approved object storage/signed URL infrastructure for future reference-sensitive I2I.

## Live Round 1 result (2026-08-31)

The controlled round completed with exactly 12 provider invocations: six `runpod-zimage` calls and six `self-hosted-image` FLUX calls, paired by domain, with zero retries. The common production size was `720x1280` (`9:16`), and all 12 outputs passed technical existence/PNG/dimension checks. Z-Image reported `$0.005` per output (`$0.030` known total); FLUX cost was not reported by the existing adapter and remains `UNKNOWN`.

The six domains were `PHOTOREAL_PEOPLE`, `SPORTS`, `CINEMATIC`, `PRODUCT`, `CARTOON_2D`, and `STYLIZED_3D`. Automated Reviewer/semantic review remains `HUMAN_REVIEW_REQUIRED`; no automated or human quality scores were populated, and no production routing winner was assigned. Evidence and local comparison sheets are under `output/visual-provider-routing-benchmark-v1/live-round-1/`. Wan, premium APIs, publishing, and Full E2E remained unused.

## Final routing and GPU decision (2026-08-31)

The human-reviewed Round 1 evidence is finalized: both Z-Image and FLUX pass general T2I. Current evidence prefers Z-Image for realistic/photorealistic people, realistic cinematic work, product work, and as a realistic sports capability candidate. It prefers FLUX for `CARTOON_2D` and `STYLIZED_3D`. Anime, fantasy, illustrative storytelling, reference fidelity, location fidelity, identity preservation, and consistency remain unproven; no global winner was assigned. Qwen Chat remains `MANUAL_EXTERNAL_GENERATION` with zero provider/API cost, mandatory human intervention, and no claim of zero operational or human cost. Real/licensed media remains a separate valid route.

The original Standard 24GB three-call evidence and matched Pro evidence are preserved unchanged. People is retained as the first request for each sequence with `FIRST_REQUEST` and `POSSIBLE_COLD_START_CONTAMINATION`; this is not a confirmed cold start. The primary steady-state estimate uses Product and Stylized 3D only: Standard averages **27.333s** and **$0.005239/image** at `$0.69/hr`; Pro averages **17.430s** and **$0.005326/image** at `$1.10/hr`. Both costs are `ESTIMATED_FROM_REQUEST_LATENCY`, not invoice or exact billable GPU cost. Standard latency is about **56.8% higher**; Pro latency is about **36.2% lower**. The three-image aggregate remains recorded as potentially cold-start influenced: Standard `33.684s` / `$0.006456`, matched Pro `24.699s` / `$0.007547`, approximately `14.45%` estimated Standard savings.

Final production decision: `FLUX_24GB_PRO = PRIMARY`; `STANDARD_24GB = VALID_FALLBACK_AND_COST_OPTIMIZATION_CANDIDATE`. Standard is technically valid (3/3, no OOM, same workflow), but its near-parity estimated cost does not justify the observed warm-like latency penalty. Neither endpoint was changed, disabled, or retired. The detailed closure record is `output/visual-provider-routing-benchmark-v1/flux-gpu-benchmark-finalization.json`.

## Manual External Generation V1 — request handoff (2026-08-31)

The first provider-agnostic manual request is prepared and intentionally stopped at `PENDING_HUMAN_GENERATION`. Qwen Chat is metadata only (`externalTool=QWEN_CHAT`, `generationMethod=HUMAN_MANUAL`); no Qwen API, scraping, or browser automation is used. The request, exact prompt, acceptance criteria, and project-controlled inbox are in `output/manual-external-generation-v1/`. The expected asset is `output/manual-external-generation-v1/inbox/manual-external-generation-v1-001.png`.

The minimal state contract now represents `QA_REQUIRED → HUMAN_APPROVAL_REQUIRED → APPROVED → READY_FOR_DOWNSTREAM_VIDEO`; invalid bypasses fail closed. Ingestion is not claimed until the human supplies the asset. On receipt, the future gate will validate supported type, bytes, decodability, dimensions, aspect ratio, SHA-256, safe inbox ownership, and provenance before Reviewer → QA → human approval. Rights remain `UNKNOWN`; provider cost is `$0` with `MANUAL_EXTERNAL_ZERO_PROVIDER_COST`, while human intervention remains required. Wan and all downstream video steps remain outside this gate.

Ingestion attempt `001` received the expected filename, verified the PNG, bytes, decodability, hash, and project-controlled path, but rejected the asset at technical QA because it was `1664x928` landscape rather than vertical `9:16`. Automated semantic review remains `HUMAN_REVIEW_REQUIRED`; no human approval or downstream readiness was claimed. Evidence: `output/manual-external-generation-v1/evidence/ingestion-evidence.json`.

Corrected ingestion attempt `002` received `1788209066685a.png` from the same project-controlled inbox. It passed file, PNG, byte, decodability, hash, and technical aspect-ratio checks at `1536x2688` (within the configured 2% approximate-9:16 tolerance). The request is now `HUMAN_APPROVAL_REQUIRED`; automated semantic review remains unavailable/`HUMAN_REVIEW_REQUIRED`, and the asset is not ready for downstream video. Evidence: `output/manual-external-generation-v1/evidence/ingestion-attempt-002.json`.

The user subsequently approved `1788209474e8c0.png`, the second corrected vertical candidate. It passed technical validation at `1536x2752` and is recorded as `HUMAN_APPROVED` and `READY_FOR_DOWNSTREAM_VIDEO`. This does not execute or authorize Wan; the downstream boundary remains a separate phase.

The subsequent authorized Wan gate attempted exactly one production call through the existing generic `video.generate` path and endpoint `ry49lc45y50ldy`. The client timed out after approximately 30.096s before receiving a job ID, but RunPod later reconciled job `9fbc118a-1e68-4593-82ae-c70a086fb208-e1` as `COMPLETED` (queue delay 19.952s, execution 163.054s). The MP4 was retrieved without a retry or second generation, passed technical QA, and was human-approved. The raw client timeout remains preserved as `initialClientResult=TIMEOUT`; the final remote result is `COMPLETED`. Evidence: `output/manual-external-generation-v1/wan-i2v-gate/wan-i2v-evidence.json`.

## Production editing QA hardening (2026-09-01)

The previous English Groq edit is preserved as human rejected regression evidence: TTS generation technical `PASS`, final edit `REJECTED` for narration cutoff and caption overflow. The local source fix is now explicit and provider-agnostic: narration must fit the measured video duration minus a 300ms tail, with bounded 1.15x tempo adjustment only; otherwise composition fails before output. Caption layout is measured against a 480x832 safe area, wraps the corrected English text into at most two lines, and records bounds before rendering. The old unmeasured one-line caption path was the supported cause of the overflow; the exact evidence does not prove a more specific renderer-only cause.

The ASS/libass path remains unavailable because the installed FFmpeg reports missing Fontconfig configuration and crashes on the subtitles filter. The drawtext fallback is usable for English only when the measured safe-area contract passes. Arabic RTL shaping remains unproven/blocked. Local evidence is `output/manual-external-generation-v1/production-editing-qa-hardening-v1/qa-hardening-evidence.json`.

The single authorized Groq call had already been consumed by the previous long narration during this execution, so no second paid call was made and no corrected V2 final MP4 is claimed. The corrected candidate remains blocked before live TTS; no Wan or VoiceTuT call occurred.

## Voice Catalog V1 + dual-voice production editing gate (2026-09-01)

Voice metadata is now represented by a provider-neutral catalog contract and PostgreSQL schema definition. The catalog records provider facts separately from project evaluation and preserves unknown runtime availability. Official VoiceTuT documentation lists `Yasmin` among its female built-in voices, but the current RunPod handler has no non-generation speaker discovery endpoint; the current runtime cannot prove that inventory. The Egyptian candidate therefore remains blocked before synthesis, also because Arabic shaping/RTL rendering is not proven while Fontconfig is unavailable.

The English candidate used official Groq-supported `hannah`, explicitly excluding `troy`. One Groq synthesis call produced a 2.960s narration; the same approved Wan source was composed with measured two-line captions and passed technical, audio-duration, caption-layout, and lineage checks. Automated semantic review and human review remain pending. Evidence and review package: `output/manual-external-generation-v1/voice-catalog-dual-production-gate-v1/`. No provider winners or human quality verdicts were assigned automatically.

`VISUAL_PROVIDER_ROUTING_BENCHMARK_V1 = COMPLETE` and `FLUX_GPU_RIGHT_SIZING_V1 = COMPLETE`. No Round 2 or additional GPU benchmark is currently required. The recommended next milestone is provider-agnostic `MANUAL_EXTERNAL_GENERATION_V1 — END_TO_END_INGESTION_GATE`: request preparation, human external generation, safe asset ingestion/provenance, Reviewer, QA, human approval, and downstream readiness. It must not start Wan generation before the supplied asset is approved.
## Dual-language narration + editing integration gate (2026-09-01)

The approved manual-external Wan MP4 was reused unchanged. One Groq English TTS call produced the `troy` voice version, which was locally composed with the same source timing and AMF watermark and is pending human final video review. VoiceTuT was not called: no female speaker can be defensibly resolved from the current runtime/config evidence, so the Egyptian version is `BLOCKED_PRE_PROVIDER` rather than silently falling back to `Mohamed`. Provider calls in this gate: Groq 1, VoiceTuT 0, Wan 0. The installed Windows FFmpeg `subtitles`/libass path crashed due missing Fontconfig configuration; the English fallback used exact-text `drawtext` captions and passed technical validation. Evidence: `output/manual-external-generation-v1/dual-language-production-editing-gate/comparison/comparison-evidence.json`.
