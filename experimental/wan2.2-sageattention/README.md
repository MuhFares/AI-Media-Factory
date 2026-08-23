# Wan2.2 SageAttention Experiment — Isolated from Production

**Production endpoint (DO NOT TOUCH):** `ry49lc45y50ldy` (Wan2.2, 4090, FlashBoot OFF, steps 10)

This experiment builds a **separate** RunPod Serverless endpoint that is **byte-identical** to production except for SageAttention.

## Files

- `Dockerfile` — `FROM ${BASE_IMAGE}` + `pip install sageattention==1.0.6` (stable, no triton-nightly) + build-time import check
- `start.sh` — patched entrypoint honoring `SAGEATTENTION=1 → --use-sageattention` with explicit logging

## Prerequisites

- Production image tag visible in RunPod Console → Endpoints → `ry49lc45y50ldy` → *Container Image* (e.g. `runpod/worker-comfyui:5.8.7` or your pushed `ghcr.io/.../wan2.2:prod`)
- Same network volume (if Wan models are on network volume — do **not** rebake models)
- Same custom nodes snapshot (WanVideoWrapper etc.) — inherited from base

## Build

```bash
# 1. Set BASE_IMAGE to the exact production image shown in console
export BASE_IMAGE="runpod/worker-comfyui:5.8.7-base"  # or ghcr.io/your/wan2.2:prod
export SAGE_IMAGE="your-registry/wan2.2-sageattention:exp1"

# 2. Build (from repo root)
docker build --build-arg BASE_IMAGE=$BASE_IMAGE \
  -f experimental/wan2.2-sageattention/Dockerfile \
  -t $SAGE_IMAGE .

# 3. Smoke: verify sageattention import without GPU (optional)
docker run --rm $SAGE_IMAGE python -c "import sageattention; print(sageattention.__version__)"
# Expected: 1.0.6

# 4. Push to registry accessible by RunPod
docker push $SAGE_IMAGE
```

## RunPod Deployment — New Isolated Endpoint

1. Console → **Serverless → New Endpoint** → *Import from Docker Registry*
2. Image: `$SAGE_IMAGE` (the one just pushed)
3. **Exact same config as production:**
   - GPU: `RTX 4090` (24GB)
   - Workers: `Max 1` (do NOT increase to 2)
   - GPU count per worker: `1`
   - Idle timeout: `5 minutes`
   - Execution timeout: `600 seconds`
   - Container disk: `180 GB`
   - Network volume: **same as production** (attach identical)
   - FlashBoot: `OFF` (keep baseline, toggle separately later)
4. Environment Variables:
   - `SAGEATTENTION=0` for **Benchmark A** (baseline)
   - `SAGEATTENTION=1` for **Benchmark B** (experiment)
   - Keep `COMFY_LOG_LEVEL=DEBUG` to capture attention logs
5. Do **NOT** set `MODEL_TYPE` override — inherit from base.

> **Verification after deploy:** In endpoint `Logs`, look for:
> - `SageAttention: disabled` (when 0) vs `enabled (--use-sageattention, sageattention 1.0.6)` (when 1)
> - ComfyUI command line includes `--use-sageattention` only when enabled.

## Verification Commands (local)

No agent changes. Use the existing smoke harness:

```bash
# Baseline (SAGEATTENTION=0) — run 3× via the EXPERIMENTAL endpoint
RUNPOD_VIDEO_ENDPOINT_ID=<new-exp-endpoint-id> \
RUNPOD_API_KEY=$RUNPOD_API_KEY \
IMAGE_PROVIDER=self-hosted-image \
VIDEO_PROVIDER=self-hosted-video \
RUN_REAL_PROVIDER_TESTS=true \
  node --env-file=.env apps/worker/e2e/video-runpod-smoke-pg.mjs

# Toggle endpoint env to SAGEATTENTION=1 (Console → Edit → Env → Save → wait Active)
# Then re-run same command 3× for B
```

Or direct API probe to confirm attention path without full produce:

```bash
curl https://api.runpod.ai/v2/<endpoint>/run \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input":{"prompt":"a cat","image_base64":"...","width":480,"height":832,"length":81,"steps":10,"cfg":2}}'
```

## Expected Startup Logs

```
worker-comfyui: SageAttention: disabled
# vs
worker-comfyui: SageAttention: enabled (--use-sageattention, sageattention 1.0.6)
worker-comfyui: SageAttention extra args: --use-sageattention
worker-comfyui: ComfyUI command: python -u /comfyui/main.py ... --use-sageattention
```
