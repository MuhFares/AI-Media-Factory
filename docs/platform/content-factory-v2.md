# Content Factory V2 (Program 3 record)

**Date:** 2026-09-24. **Mode:** PLATFORM_VALIDATION_MODE.
Authority unchanged: NOT_GRANTED / NOT_GRANTED / NOT_PUBLISHED.
Zero provider calls, zero uploads, zero publications in this program.

## Architecture

Durable identity (subject_profiles, subject_reference_assets, scene_specs
in Postgres) → provider-neutral intent → canonical capability routing →
existing visual-direction compile → existing adapters → existing artifacts
with subject/reference lineage. No second workflow engine, no competing
asset database, no duplicated binaries.

## Scene model

scene_id, sequence, duration, purpose, script ref, visual, subjects[]
(subjectId + pose/expression/wardrobe), environment, shot, camera angle,
movement, continuity[], reference IDs, intent object, audio ref, status.
Ordered composition inputs derive from sequence.

## Format model

youtube-short (9:16, supported) and youtube-longform (16:9, supported,
thumbnail required); instagram-reel, tiktok, square-social planned
(placeholders, never presented as supported).

## Subject/reference model

Metadata-only profiles (DRAFT → APPROVED with rationale); reference rows
point at canonical artifacts by ID with per-kind approval; idempotent
attach; supersession without rewriting history.

## Prompt assembly

Brand context (ACTIVE strategy payloads) + subject identity + scene
requirements + format profile assembled with full provenance, then
compiled by the proven visual-direction layer (fail-closed validation).
No opaque concatenation.

## Media lineage

Artifacts carry subject_id, reference_artifact_ids, scene_id in payload;
QA checks dimensions, aspect (tolerant), subject linkage, reference
linkage, continuity metadata, provider self-invalidation.

## QA

Structural image checks plus consistency states (never biometric claims).
Thumbnails via existing thumbnail_report kind.

## Composition

Ordered scene inputs verified stable; existing FFmpeg compose path
unchanged (no NLE rebuild).

## Owner journey

Content Item → Characters/subjects (create, approve with rationale,
attach references) → Scenes (specify with bindings) → Start production
(prefills the governed Command Room; Owner reviews and submits there;
nothing starts from Content).

## Audio/voice

Host voice represented as subject voiceId resolved against the existing
voice catalog. No cloning.

## Failure/retry

Reference context travels with intent and persisted specs; retry paths
cannot drop identity inputs (proven at contract level; no silent
downgrade anywhere in the chain).

## Limitations

- Reference-guided only; no identity guarantee.
- Z-Image references require externally reachable URLs (no in-repo
  object storage / signed-URL issuer).
- FLUX transport accepts `input.images[]`, but the wired workflow
  consumes none; reference-aware FLUX needs a compatible workflow
  (custom deployment if required nodes/models are unavailable).
- Long-form proven at contract level, not via executed long video.
- Thumbnails: foundation only, no optimization product.

## Proof evidence

subjects-scenes 3/3, five-scene proof 7/7 (one host × 5 shots, same
profile, propagated references, routed requests, intact lineage, honest
QA), content-factory-v2 unit 7/7, subjects-scenes API 2/2, content UI
factory surfaces 5/5, regressions green. Zero external side effects.
