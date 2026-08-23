# Wan2.2 SageAttention Benchmark — Isolated Experiment

## Fixed Parameters (both A and B)

- GPU: RTX 4090, 24GB, 1 worker, 1 GPU/worker, FlashBoot OFF, idle 5m, timeout 600s, disk 180GB
- Resolution: 480×832, Length: 81 frames, Steps: 10, CFG: 2, Seed: 42
- Prompt: `Create a cinematic short video for an article titled "…"` (derived from same writer artifact, same seed)
- Source image: same FLUX PNG from `runpod-latest.png` (imageBase64 direct, no URL upload)
- Same workflow, same model `flux1-dev-fp8.safetensors` + Wan2.2
- Poll interval 4s, maxWait 600s

## Configurations

| Run | Endpoint | SAGEATTENTION | Image Endpoint |
|-----|----------|---------------|----------------|
| A1-A3 | `<exp-endpoint-id>` with `SAGEATTENTION=0` | OFF | `u1sveqdi1uj1fj` (prod FLUX) |
| B1-B3 | **same endpoint** toggled to `SAGEATTENTION=1` | ON | same |

**Do NOT use production `ry49lc45y50ldy` for this benchmark.**

## Metrics to Collect (per run)

Via `video-runpod-smoke-pg.mjs` and RunPod console:

- `delayTime` (RunPod `output.delayTime` if present)
- `executionTime` (RunPod `executionTime`)
- `provider durationMs` (`evidence.durationMs`)
- `wall time` (smoke `wallXs`)
- `output size` (bytes, `wan-latest.mp4` length)
- `success/failure` (COMPLETED vs FAILED/CANCELLED/TIMED_OUT)
- `GPU memory` (from `Logs` → `torch.cuda.memory_allocated` if exposed)
- `attention implementation` (from Logs → `SageAttention: enabled` / `xformers` / `FlashAttention`)
- `model load time` (from Logs → time between `Starting ComfyUI` and `API is reachable`)
- `inference time` (worker logs: time between `Executing` and `Execution finished`)

## Procedure

1. Deploy experimental endpoint as per `README.md` with `SAGEATTENTION=0`.
2. Warmup: one dry run to load models (discard timing).
3. Run A1, A2, A3 (separate `RUN_REAL_PROVIDER_TESTS=true` invocations, same seed).
4. In Console, change endpoint env `SAGEATTENTION=1` → Save → wait `Active` (worker restarts).
5. Verify Logs show `SageAttention: enabled`.
6. Run B1, B2, B3.
7. Optional: toggle back to 0 to confirm reproducibility.

## Calculations

For each metric:
- `mean`, `median`, `min`, `max`
- `improvement = (mean_A - mean_B) / mean_A * 100%`
- **Cost** (RunPod billing): `executionTime * price_per_second` (4090 ~ $0.00074/s)
  - `cost per video = mean executionTime * 0.00074`
  - `cost per second of video = cost / (length / fps)` ; for 81f @ ~16fps ≈ 5s → `cost / 5`
- Use wall time for user-perceived latency, executionTime for billable.

## Quality Verification

- `valid MP4` (`ftyp` header, `ffprobe` duration 81f)
- `same frame count` (`ffprobe -count_frames`)
- `same resolution` (`480×832`)
- Visual: compare 5s clips A vs B at same timestamp (no flicker, no smear)
- If `steps=10` remains, quality delta should be negligible (SageAttention is numerically close to SDPA).

## Success Criteria

- Do **not** claim speedup until `mean_B < mean_A` with `p < 0.05` across 3 runs.
- If B is **not** faster, check Logs: `SageAttention` may not be invoked on Wan2.2 attention pattern (some shapes not accelerated).
- If B is faster ≥15%, recommend enabling on production after 24h soak.

## Commands

```bash
# A
RUNPOD_VIDEO_ENDPOINT_ID=<exp-id> RUNPOD_IMAGE_ENDPOINT_ID=u1sveqdi1uj1fj SAGEATTENTION=0 \
  RUN_REAL_PROVIDER_TESTS=true node --env-file=.env apps/worker/e2e/video-runpod-smoke-pg.mjs

# B (after toggling endpoint env to 1)
RUNPOD_VIDEO_ENDPOINT_ID=<exp-id> RUNPOD_IMAGE_ENDPOINT_ID=u1sveqdi1uj1fj SAGEATTENTION=1 \
  RUN_REAL_PROVIDER_TESTS=true node --env-file=.env apps/worker/e2e/video-runpod-smoke-pg.mjs
```
