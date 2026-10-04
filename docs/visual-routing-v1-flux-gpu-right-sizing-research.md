# FLUX GPU Right-Sizing Research — Round 1 Cost Context

Date: 2026-08-31. Scope: research and accounting only; no endpoint or deployment change.

## Current runtime found in the repository

The active FLUX path is `self-hosted-image` → RunPod Serverless → ComfyUI 5.8.7. The adapter constructs a ComfyUI API workflow using `flux1-dev-fp8.safetensors`, `CheckpointLoaderSimple`, two `CLIPTextEncode` nodes, `FluxGuidance`, `EmptyLatentImage`, `KSampler`, `VAEDecode`, and `SaveImage`. The current generation settings are batch size 1, `720x1280` for Round 1, 20 steps, CFG 1, Euler/simple, and denoise 1. The workflow contains no explicit CPU-offload setting; the adapter also does not expose peak VRAM or worker-active/GPU-active timings. Components are loaded through the checkpoint loader, so simultaneous residency/offload behavior is a runtime/container concern not proven by this repository.

The current checkpoint is an FP8 FLUX.1-dev checkpoint. ComfyUI's official examples say FP8 lowers memory usage substantially and that the FP8 checkpoint uses CFG 1.0, while noting a possible small quality reduction versus full precision. Black Forest Labs' model card identifies FLUX.1-dev as a 12B model and documents CPU offload as an optional VRAM-saving mode for the full Diffusers pipeline. Neither source proves an exact minimum VRAM for this specific RunPod ComfyUI workflow.

## Pricing and accounting

The user-confirmed current deployment input is:

`self-hosted-image / FLUX.1-dev-fp8 / 24GB Pro / $1.10 per GPU-hour`

It is versioned in `configs/pricing/visual-provider-pricing-v1.json` with source `USER_CONFIRMED_INFRASTRUCTURE_RATE`. RunPod bills Serverless compute by the second while workers run; start/model loading, request execution, and idle timeout can all contribute to billed worker time. Therefore request latency is not automatically billable GPU time.

The implemented cost function prefers provider-reported cost, then explicit billable GPU seconds, then active-runtime seconds, and uses request latency only as an explicitly labeled estimate:

`amount = duration_seconds × usd_per_gpu_hour / 3600`

Round 1 evidence exposes only `latencyMs` for FLUX. The six records are therefore `ESTIMATED_FROM_REQUEST_LATENCY`; no exact billable GPU duration is claimed. Estimated FLUX total is **$0.03891311**. Z-Image has six provider-reported `$0.005` results, known total **$0.03000000**. Combined known-plus-estimate context is **$0.06891311**, not an invoice total.

The database already persists execution evidence and arbitrary cost metadata in JSONB `payload`; no schema migration is needed for these fields. Future reporting can group provider/model/domain/capability and distinguish exact, provider-reported, compute-derived, active-runtime-estimated, request-latency-estimated, and unknown amounts. Dashboard work is out of scope.

## GPU comparison

RunPod's current GPU pool documentation groups `L4`, `A5000`, and `RTX 3090` as `AMPERE_24` (24 GB), and `RTX 4090` as `ADA_24`. RunPod's current pricing documentation uses per-second billing and identifies GPU time during worker start and execution as billable. The user-confirmed current price for the 24GB Pro/4090 class is **$1.10/hr**, and the user-confirmed standard-24GB endpoint rate is **$0.69/hr**. The standard endpoint's exact GPU subtype remains unknown because management metadata returned 401.

| Candidate | VRAM/pool | Current evidence | Same workflow judgment | Decision |
|---|---:|---|---|---|
| Current 4090 Pro | 24 GB / ADA_24 | Existing endpoint works | Baseline | REFERENCE |
| A5000 | 24 GB / AMPERE_24 | Same RunPod 24GB pool; price published around $0.69/hr | Likely VRAM-compatible; throughput unknown | **RECOMMENDED_FOR_LIVE_TEST** |
| L4 | 24 GB / AMPERE_24 | Same pool; throughput differs within tier | Likely VRAM-compatible; performance unknown | PLAUSIBLE_BUT_NEEDS_TEST |
| RTX 3090 | 24 GB / AMPERE_24 | Same pool; throughput differs within tier | Likely VRAM-compatible; operational/performance evidence absent | PLAUSIBLE_BUT_NEEDS_TEST |
| 20GB class | No relevant official pool evidence found | Minimum for this exact workflow unproven | Unknown safety margin | INSUFFICIENT_EVIDENCE |
| 16GB A4000-class | 16 GB / AMPERE_16 | RunPod documents a 16GB pool; exact workflow fit not proven | May require offload/low-memory behavior; latency/OOM risk unknown | PLAUSIBLE_BUT_NEEDS_TEST, not live default |

The 24GB Pro class does not appear strictly necessary for VRAM alone because the exact FP8 workflow is already in a 24GB model family and the standard 24GB pool exists. It may still be justified by speed, cold start, stability, or capacity. A standard 24GB A5000 is the single recommended first comparison because it removes VRAM as a confounder while testing the lower-cost pool. At $0.69/hr it represents about **37.3% lower hourly cost** than $1.10/hr, before accounting for speed.

Six Round 1 FLUX requests averaged about 22.9 seconds of request latency. If a future A5000 benchmark matched that duration and the $0.69/hr rate, the rough latency-proxy cost would be about $0.00439/image versus about $0.00699/image at $1.10/hr. This is illustrative only; it is not a performance prediction or billing claim. If the cheaper GPU is more than about 59% slower, the hourly saving would be erased on a per-image compute basis.

## Research verdict

- 24GB Pro over-provisioned for **VRAM fit**: probably, but not proven over-provisioned for latency/stability.
- Cheaper standard 24GB running the same workflow: technically plausible; **A5000 is recommended for a future live test**.
- 16GB: technically possible only with runtime/offload compromises that are not proven acceptable for production; not recommended without a controlled test.
- Smaller than 16GB: insufficient evidence for this exact workflow.
- Main risks: model-load OOM, system-RAM pressure, cold-start cost, different throughput within the same RunPod VRAM pool, and FP8/offload quality or latency changes.

## Future GPU benchmark (not executed)

Compare current 4090 Pro against one A5000. Use the same `flux1-dev-fp8.safetensors`, ComfyUI workflow, seed, prompt, `720x1280`, 20 steps, CFG 1, batch 1, and output format. Run at most three images per GPU. Measure cold/model-load time, inference time, worker-active time, peak VRAM, OOM/technical failures, output integrity, and cost/image. Do not change the endpoint until this benchmark is explicitly approved.

Sources: [RunPod Serverless pricing](https://docs.runpod.io/serverless/pricing), [RunPod GPU types and pools](https://docs.runpod.io/references/gpu-types), [RunPod serverless GPU failover/pool behavior](https://www.runpod.io/blog/serverless-places-workers), [official ComfyUI FLUX examples](https://github.com/comfyanonymous/ComfyUI_examples/blob/master/flux/README.md), [Black Forest Labs FLUX.1-dev model card](https://huggingface.co/black-forest-labs/FLUX.1-dev).

## Standard-24GB economics gate (2026-08-31)

The user-created endpoint `7msusuancyl74c` completed exactly three paired-domain checks (people, product, stylized 3D) using the same production workflow. All three were technically successful at `720x1280`, with no OOM and zero retries. RunPod management metadata returned HTTP 401, so the actual GPU type is not claimed; health showed three ready workers. The evidence uses `standard-24GB / GPU type UNKNOWN_ENDPOINT_METADATA_401` and the user-confirmed standard-24GB rate of `$0.69/hr`. The gate evidence is `output/visual-provider-routing-benchmark-v1/gpu-standard-24gb-gate/evidence.json`.
