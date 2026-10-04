# VISUAL CAPABILITY BENCHMARK V1

This document is the general visual pipeline benchmark for real-world, travel/location, football/sports, cinematic/editorial, and stylized cartoon content. It is intentionally separate from the historical Cairo artifacts.

## Pipeline contract

`Research (research.web + optional research.images) → Visual Strategy/Brief → image.generate → Reviewer Image Review → QA Image Review → Human Gate → Wan I2V`

The shared contracts live in `packages/tool-framework/src/visual-capability/visual-capability.ts`. `image.generate` remains provider-agnostic. The strategy carries `visualMode` and `referenceStrategy`; the gate requires actual multimodal runtime evidence and otherwise returns `HUMAN_REVIEW_REQUIRED` with `canEnterWan=false`.

## Controlled budget

| Capability | Maximum generation calls | Retries |
|---|---:|---:|
| Z-Image T2I | 4 | 0 |
| Z-Image I2I | 3 | 0 |
| Wan production I2V | 2 | 0 |
| Wan still image | 0 (`NOT_PROVEN`) | 0 |
| VoiceTuT / FLUX / experimental Wan / publishing / AgentRouter content | 0 | 0 |

Research grounding calls, if used, are logged separately from media calls. The benchmark runner is `scripts/visual-capability-benchmark-v1.mjs` and writes only to `output/visual-capability-benchmark-v1/`.

## Capability matrix

| Capability | Current V1 result | Recommended role |
|---|---|---|
| Z_IMAGE_REALISM | Technical PASS; HUMAN_PASS; automated Reviewer/QA HUMAN_REVIEW_REQUIRED | production candidate subject to existing human gate |
| LOCATION_FIDELITY | Technical PASS; HUMAN_PASS; automated Reviewer/QA HUMAN_REVIEW_REQUIRED | production candidate with location references |
| PEOPLE | Technical PASS; HUMAN_PASS; automated Reviewer/QA HUMAN_REVIEW_REQUIRED | production candidate for non-identity people |
| SPORTS_ACTION | Technical PASS; HUMAN_PASS; automated Reviewer/QA HUMAN_REVIEW_REQUIRED | specialist candidate subject to human gate |
| CARTOON | Technical PASS; HUMAN_PASS; automated Reviewer/QA HUMAN_REVIEW_REQUIRED | specialist / production candidate subject to human gate |
| REFERENCE_I2I | Up to three strengths in E; preservation must be visually measured | specialist, not identity solution |
| IDENTITY_PRESERVATION | Not proven | rejected as an identity guarantee |
| WAN_I2V_GENERAL_SOURCE_PRESERVATION | MIXED / USE_CASE_DEPENDENT; historical accepted scenes coexist with this rejected manual-person test | use-case specific; require human review |
| WAN_PERSON_IDENTITY_PRESERVATION | FAIL_IN_TESTED_MANUAL_SOURCE_CASE | not approved as identity-preserving |
| WAN_CHARACTER_CONTINUITY_ROLE | NOT_APPROVED_WITHOUT_STRONGER_REFERENCE/CONTROL | do not use for identity-critical continuity |
| WAN_MOTION_QUALITY | Requires human review of V1 output | specialist pending review |
| WAN_STILL_IMAGE_GENERATION | NOT_PROVEN | rejected / do not route still generation |

## Status fields

- `WAN_STILL_IMAGE_GENERATION=NOT_PROVEN`
- `MANUAL_SOURCE_I2V=COMPLETED_PROVIDER_OUTPUT` for the user-owned source `output/test for wan.png`; full lineage and the human rejection are in `output/visual-capability-benchmark-v1/manual-source-wan-i2v-evidence.json`.
- Any image without real multimodal Reviewer and QA evidence is `HUMAN_REVIEW_REQUIRED` and cannot enter Wan.

See `output/visual-capability-benchmark-v1/manifest.json` and `attempts.json` for actual invocation counts, hashes, jobs, latency, dimensions/bytes, and cost when calls are run.

## REFERENCE ASSET TRANSPORT FORENSICS (2026-08-30)

This zero-provider-call step is **`REFERENCE_ASSET_TRANSPORT=BLOCKED_BY_MISSING_INFRASTRUCTURE`**. The Z-Image adapter intentionally accepts `referenceImageUrl` as an externally reachable `http(s)` URL and sends it as `input.image`; it does not accept local paths, data URLs, or base64 references. The upstream benchmark now keeps T2I independent and does not force a reference, while I2I fails closed until a valid resolved URL exists.

Repository forensics found local filesystem outputs, data URLs, artifact metadata/persistence, and a YouTube-only resumable upload flow. It found no implemented or configured object/blob storage, public asset URL issuer, signed/presigned URL service, temporary provider-readable URL service, or generic `ReferenceAsset` resolver. README statements that assets are stored in an “asset store and object storage” are roadmap/platform assumptions, not an executable mechanism in this repository. The full trace and evidence are in `output/visual-capability-benchmark-v1/reference-asset-transport-forensics.json`.

The selected reference remains `output/visual-capability-benchmark-v1/A-real-world-location.png` (768x1024, SHA256 `375e720edb02ee71eefa608a6ec18b2be2d5a43bb4c853f23fac60eb9db079f9`). No I2I provider call was made. Required production infrastructure is: an approved object/blob store or controlled asset store, runtime identity and secret-manager binding, a short-lived scoped read-only signed URL issuer, allowlisted URL origin/expiry provenance, and a small upstream resolver that maps `ReferenceAsset` to that URL. Until those are supplied and tested, do not add an upload workaround or weaken URL/SSRF security.

## LIVE COMPLETION (2026-08-30)

The controlled live completion is **PARTIAL / I2I BLOCKED_BY_ENVIRONMENT**. The existing RunPod Z-Image adapter supports I2I only through an externally reachable `http(s)` reference URL (`input.image`); it does not support a local path, local data URL, or local base64 reference, and no approved durable local-to-supported-reference transport is configured. The benchmark runner previously coupled the unresolved I2I gate to the whole benchmark and bypassed the capability/executor path; that bug is fixed. T2I sends no reference field and runs through `RuntimeCapabilityExecutor → image.generate → RunPodZImageAdapter → /runsync`. The four T2I outputs are now `HUMAN_PASS` from the user, while automated Reviewer and QA remain `HUMAN_REVIEW_REQUIRED`. The three I2I strengths (`0.35`, `0.55`, `0.75`) remain blocked, with no security boundary change and no external upload workaround.

The manual source test did run through the existing production Wan endpoint `ry49lc45y50ldy` exactly once, with `pollRetries=0`, seed `9102`, 81 frames, and a five-second target. Source and output lineage, hashes, job ID, prompt, dimensions, codec, frame hashes, latency, and unavailable cost are recorded in the adjacent evidence file. `MANUAL_SOURCE_I2V_TECHNICAL_QA=PASS` (H.264, 480x832, 32fps, 5.03125s). The automated semantic gate remains `HUMAN_REVIEW_REQUIRED` because multimodal Reviewer/QA runtime was unavailable; the available human review then rejected the output as `REJECTED_FOR_IDENTITY_DRIFT`, with `IDENTITY_PRESERVATION_FAIL`. It is not a production candidate. No second Wan call was made because every Z-Image subtest remains blocked before provider invocation and therefore has no human-approved source.

The four T2I outputs are recorded with prompt/reference integrity, job IDs, dimensions, bytes, SHA256, latency, and cost (`0.005` each; total `0.020`). User human review is `HUMAN_PASS` for A/B/C/D; automated Reviewer and QA remain `HUMAN_REVIEW_REQUIRED` and are not represented as PASS. The upstream capability bug that dropped `referenceImageUrl` was fixed and covered by a focused transport test. Using the user-supplied CNN URL as a temporary external location/style reference, the three I2I calls (`0.35`, `0.55`, `0.75`) completed successfully at `0.005` each (total `0.015`), with the same reference hash and zero retries. User human review rejected all three: the Cairo Tower and skyline/location composition were not preserved and a different tower/landmark was substituted. Evidence is `output/visual-capability-benchmark-v1/z-image-i2i-cnn-evidence.json`; contact sheet is `output/visual-capability-benchmark-v1/z-image-i2i-cnn-contact-sheet.html`. Automated semantic Reviewer and QA remain `HUMAN_REVIEW_REQUIRED`. The reference was used only for location/composition/style, not identity. Wan is technically capable and has historical source-preservation evidence, but general source preservation is `MIXED / USE_CASE_DEPENDENT`; this tested manual portrait/person case failed identity preservation. Wan still-image generation remains `NOT_PROVEN`; no still call was made. This phase did not run Full E2E, publishing, or create a final publish candidate.
