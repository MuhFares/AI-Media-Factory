# Media Capability Matrix V1 (canonical guidance)

Evidence levels: VERIFIED_IMPLEMENTED (code + tests and/or human-reviewed
runs) · VERIFIED_PROVIDER_ONLY (provider supports, AMF does not wire it) ·
UNPROVEN · NOT_SUPPORTED · UNKNOWN.

## FLUX.1-dev-fp8 via self-hosted ComfyUI (`self-hosted-image`)

- Text-to-image: VERIFIED_IMPLEMENTED (EmptyLatentImage workflow; R8 5/5).
- Worker transport image input: VERIFIED_SUPPORTED — the RunPod worker
  accepts `input.images[]` (name + base64), referenceable from the supplied
  ComfyUI workflow (Owner-supplied worker docs; FLUX.1-dev-fp8 Hub only).
- Current AMF workflow image consumption: NO (verified in-repo: no
  image-loading node; output-side `images` only). Transport support does
  NOT imply img2img, reference guidance, or identity conditioning.
- Identity/style/pose conditioning: UNPROVEN. Identity preservation: UNPROVEN.
- Seed: VERIFIED_IMPLEMENTED (deterministic when provided).
- Seed: VERIFIED_IMPLEMENTED (deterministic when provided).
- Aspect ratios 1:1/16:9/9:16/4:3/3:4 (computed dims; 9:16 ≈ 768x1344).
- Output PNG. Cost UNKNOWN (adapter unreported).
- Routing evidence (visual-production-routing-v1): preferred for
  CARTOON_2D and STYLIZED_3D.

## z-image-turbo via RunPod (`runpod-zimage`)

- Text-to-image: VERIFIED_IMPLEMENTED (benchmark T2I 4/4 HUMAN_PASS).
- Single image reference: VERIFIED_IMPLEMENTED (externally reachable
  http(s) URL, png/jpeg, strength 0..1 required). No local/data-URL/base64
  transport in-repo (BLOCKED_BY_MISSING_INFRASTRUCTURE).
- Multiple references: NOT_SUPPORTED (single `image` field).
- Identity conditioning: UNPROVEN (never FAILED — no formal controlled
  test exists; one tested case did not preserve location identity on
  human review, which guides composition use but proves nothing general).
- Style/pose references, inpainting, control image: NOT_SUPPORTED.
- Seed: VERIFIED_IMPLEMENTED. Sizes: fixed set incl. 768*1024/1024*768.
- Output png/jpeg/webp. Cost $0.005/output (provider-reported).
- Routing evidence: preferred for realistic/photorealistic people.

## Other providers

- Wan video: image-conditioned first-frame video (forensics doc);
  still-image generation NOT_PROVEN; person identity FAIL in tested case.
- Voice (Voicetut + narrator config): voice catalog real; cloning not
  supported and not authorized.
- YouTube publish/analytics: validated via M4 private publication and
  HTTP 200 transport proof.

## Rules for future agents

- Passing an image parameter never proves identity consistency.
- Reference-guided wording only, until human approval or a real metric.
- Consistency-required generation without references fails closed.
- Identity-critical sequences have no verified route: human approval.
- Z-Image stays eligible for realistic and reference-guided scenes;
  unproven identity never silently disqualifies it.
- FLUX transport accepts images, but only a compatible reference-aware
  workflow (custom deployment if needed) could use them; the current
  workflow cannot.

## Correction note (2026-09-24, Program 3 remains CLOSED/PASS)

Owner-supplied RunPod worker docs prove `input.images[]` transport support
for the FLUX Hub worker. Previous wording overstated "no image input" at
the transport level; corrected to transport-YES / workflow-consumption-NO.
Z-Image "human-rejected" wording removed as a general classification:
strict identity is UNPROVEN, and Z-Image remains an eligible route wherever
strict identity is not required. No provider calls were made for this
correction.
