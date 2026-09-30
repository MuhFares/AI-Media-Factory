# AI Media Factory Wan2.2 I2V Runtime v1 — Design

**Status:** PREDEPLOYMENT SOURCE CHECKPOINT READY (no image build, no deploy,
no provider calls). Deployment remains blocked until an immutable GHCR digest,
RunPod management authentication, a compatible network volume, endpoint parity,
and the separate live certification gates are proven.
**Replaces:** `registry.runpod.net/wlsdml1114-generate-video-ksampler-dockerfile:a9247705c` + `sageattention` overlay (experimental `wan2.2-diskcache-exp`)
**Reason:** 3 distinct FLUX inputs produced identical Wan source identity — forensic boundary proven between `LoadImage` input (distinct) and Wan output (identical). Root cause not code-proven in the deployed base image; reproducibility requires an owned runtime.

---

## Requirements

- Wan2.2 Image-to-Video (not T2V)
- NVIDIA GPU, 480×832 vertical, 81 frames (~5.03s at 16fps)
- RunPod Serverless (`/run` + `/status` polling)
- Explicit `image_base64` (required, no silent T2V fallback)
- Deterministic `seed`, `steps`, `cfg`, `width`, `height`, `length`
- `negative_prompt`
- No opaque diskcache for image-dependent stages
- Request-isolated image handling (concurrent-safe)
- Reproducible Docker build (pinned digests/commits)

### Runtime entrypoint and persistent volume layout

`start.sh` verifies that the receipt directory is writable, starts the pinned
ComfyUI runtime, waits for its health endpoint, and then starts the RunPod
serverless handler. The network volume must be mounted at `/runpod-volume` with:

- durable receipts at `/runpod-volume/amf-video-receipts`;
- model assets under `/runpod-volume/models`, using the subdirectories declared
  by `extra_model_paths.yaml` (`diffusion_models`, `text_encoders`, `vae`,
  `loras`, and related ComfyUI model directories).

The receipt directory may not be redirected to ephemeral container storage.

---

## Pinned Dependencies

| Component | Version / Commit | Source | License | Reason |
|-----------|------------------|--------|---------|--------|
| CUDA base | `nvidia/cuda:12.6.0-cudnn-devel-ubuntu22.04` | `nvidia/cuda` Docker Hub | NVIDIA | Matches `a9247705c` CUDA 12.6, PyTorch 2.3+ |
| Python | `3.10` (from `deadsnakes` or `python:3.10-slim` layer in base) | `python/cpython` | PSF-2.0 | ComfyUI requires 3.10 |
| PyTorch | `torch==2.3.1` + `torchvision==0.18.1` + `torchaudio` with CUDA 12.1 | `pytorch/pytorch` | BSD | Matches SageAttention 1.0.6 `torch>=2.3` |
| ComfyUI | `1978f59ffdf242389ded3eec76274a4cbed9cc3d` (2026-02-16, verified compatible with WanVideoWrapper `86ad93d` at `2026-02-16T13:44:15Z`) | `comfyanonymous/ComfyUI` | GPL-3.0 | Workflow pin |
| ComfyUI-WanVideoWrapper | `kijai/ComfyUI-WanVideoWrapper@86ad93d` (2026-02-16, closest to `a9247705c` build date) | `kijai/ComfyUI-WanVideoWrapper` | GPL-3.0 / MIT | Wan I2V nodes (`WanFirstLastFrameToVideo`) |
| ComfyUI-Manager | pinned commit at `a9247705c` time | `Comfy-Org/ComfyUI-Manager` | GPL-3.0 | Not required for I2V, but in base image |
| Wan2.2 models (via `extra_model_paths.yaml`) | `Wan2_2-I2V-A14B-HIGH_fp8_e4m3fn_scaled_KJ.safetensors`, `Wan2_1_VAE_bf16.safetensors`, `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | `Comfy-Org/Wan_2.2_ComfyUI_Repackaged` | Apache-2.0 | Wan I2V |
| runpod | `runpod==1.8.1` (pinned) | `runpod/runpod-python` | MIT | Serverless |
| websocket-client | pinned | `websocket-client` | BSD | ComfyUI WS |
| ffmpeg | `ffmpeg:7.1` static (from `ffmpeg:7.1-cuda` or `apt`) | `ffmpeg` | LGPL | VHS_VideoCombine needs it, but v1 uses it only for `get_videos` polling |

**Licensing:** Wan2.2 Apache-2.0 (permissive). ComfyUI and ComfyUI-WanVideoWrapper are GPL-3.0. GPL-3.0 permits internal/cloud-service use (as here, on RunPod) and permits container distribution provided that the Corresponding Source (including any modifications to the GPL components) is made available to recipients/upon request. No warranty or additional legal assurance is provided here.

**OCI labels:**
```
org.opencontainers.image.revision = <git SHA>
org.opencontainers.image.version = v0.1.0-test
org.opencontainers.image.source = https://github.com/MUHFARES/AI-Media-Factory
org.opencontainers.image.base.name = nvidia/cuda:12.6.0-cudnn-devel-ubuntu22.04
```

---

## API Contract

```json
{
  "input": {
    "prompt": "string, required, 1..1000",
    "negative_prompt": "string, optional",
    "image_base64": "string, required, base64 PNG/JPG (stripped, no data: prefix, >500 chars)",
    "width": 480,
    "height": 832,
    "length": 81,
    "steps": 10,
    "cfg": 2.0,
    "seed": 42,
    "context_overlap": 48
  }
}
```

- `image_base64` **required** for this I2V endpoint — handler returns `400` with `error: "image_base64 is required for I2V"` if missing (no T2V fallback).
- All fields validated: `prompt` 1..1000, `image_base64` valid base64 and decodable as image, `width/height` multiples of 16, `length` in `[1, 121]`, `steps` 1..50, `cfg` 0..10, `seed` 0..2^32-1.

---

## Handler Design

**Location:** `experimental/wan2.2-i2v-v1/handler.py`

1. `job["input"]` → validate `image_base64` exists, else `error`
2. `decoded = base64.b64decode(image_base64)` → validate via `PIL.Image.open` (not just `base64 --validate`)
3. `image_sha256 = hashlib.sha256(decoded).hexdigest()` — **deterministic identity**
4. `filename = f"amf-i2v-{image_sha256[:24]}.png"` — **content-addressed, not task_<uuid>**
5. `path = /comfyui/input/{filename}` — ComfyUI input dir, not per-task subdir
6. `with open(path, "wb") as f: f.write(decoded)` — **idempotent**: same bytes → same filename → same content; different bytes → different filename
7. `prompt = json.load(open(workflow_api.json))` — **fresh per request** (inside `handler`, not module global)
8. `prompt["260"]["inputs"]["image"] = filename` — **exact LoadImage node** (ID 260 in `workflow_api.json`)
9. Startup validation: `assert "260" in prompt and prompt["260"]["class_type"] == "LoadImage"` else `raise`
10. `queue_prompt(prompt)` → poll `get_history` → `get_videos` → return `{"video": "data:video/mp4;base64,..."}`

**Why content-addressed, not `task_<uuid>`:** `task_<uuid>` is unique per job but still requires a custom `IS_CHANGED` that hashes content — which we have (LoadImage does), but content-addressed makes the **filename itself** the identity, so even a naive `filename`-only cache would be correct, and it allows **legitimate reuse** (same image → same filename → same latent **correctly**). It is also debuggable: `ls /comfyui/input/amf-i2v-*.png` shows which images were used.

**Request isolation:** `decoded` bytes are request-local; `filename` is deterministic from bytes, so concurrent jobs `A` and `B` with different images write `amf-i2v-<hashA>.png` and `amf-i2v-<hashB>.png` — **no overwrite**.

**No global mutable workflow/conditioning:** `prompt` is a fresh `dict` per request.

---

## Workflow Graph

**File:** `experimental/wan2.2-i2v-v1/workflow_api.json` (copied from `wlsdml1114/generate_video` `workflow/wan22_nolora.json` at `a9247705c`, then pinned)

```
260: LoadImage (image: "00050-907847214.png") — overwritten to amf-i2v-{hash}.png
  → 847: ImageScale (image: [260], width: [843], height: [843])
    → 481: WanFirstLastFrameToVideo (start_image: [847], width: [845], height: [845], length: [846], positive: [6], negative: [7], vae: [226])
      → 830: ScheduledCFGGuidance
        → 836: SamplerCustomAdvanced (latent_image: [481])
          → 832: SamplerCustomAdvanced (latent_image: [836])
            → 323: VAEDecode (samples: [832], vae: [226])
              → 482: RIFE VFI
                → 277: VHS_VideoCombine → video
```

Validator at startup and in tests asserts `260 → 847 → 481 → 830/833 → 836 → 832 → 323 → 482 → 277`.

---

## Cache Policy (v1)

| Cache | Scope | Key | Safe? | Policy |
|-------|-------|-----|-------|--------|
| Model weights (Wan DiT, VAE, UMT5) | Global, immutable | `model_id` | Yes | **Keep** (immutable) |
| Text embeddings (`WanVideoTextEncode`) | Per prompt/model | `hash(prompt + model)` | Yes (image-independent) | **Keep** (optional, but safe) |
| **Image latent / CLIP vision / Wan conditioning** | Per request | **Must include `image_sha256`** | **Was unsafe** | **Disallow** in v1 — no cache for `WanFirstLastFrameToVideo`, `VAEEncode`, `CLIPVision` |
| ComfyUI node cache (`IS_CHANGED`) | Per node | `LoadImage`: `hash(bytes)` | Yes (unique filename) | **Keep** — now correct due to content-addressed filename |

**v1 has no custom `diskcache` Python module** — correctness over clever caching. Optimization is a separate phase after Gates E–G pass.

---

## Diagnostic Evidence

Per request:
```
request_id: task_<uuid> (for logging, not for filename)
image_sha256: <64 hex> (truncated to 24 for filename, full in logs)
workflow_version: wan22_nolora.json SHA256
runtime_version: ghcr.io/muhfares/amf-wan22-i2v:v1.0.0 (immutable tag + digest)
seed, width, height, length, steps, cfg
```
Never log `image_base64`.

---

## Tests (Zero GPU)

See `tests/test_handler.py` and `tests/test_workflow.py` for TEST A–J.

---

## Docker / CI / Deployment

- **Image:** `ghcr.io/muhfares/amf-wan22-i2v:v1.0.0` + `:<git-sha>` (immutable, never `:latest` to production)
- **Labels:** `org.opencontainers.image.revision`, `version`, `source`, `base.name`
- **CI:** `.github/workflows/build-amf-wan22-i2v.yml` — triggers on `experimental/wan2.2-i2v-v1/**`, pushes `v1.0.0` and `sha-<sha>`, no RunPod mutation, fail on tests
- **RunPod:** New experimental endpoint `amf-wan22-i2v-v1-test` (do not overwrite `o54nlat1w78954` yet; A/B rollback)

---

## Acceptance (Future Phase, Not This)

Two existing FLUX images (scene-002 `FA59...` and scene-003 `1344...`), same prompt/seed/dims → expect Video A preserves source A, Video B preserves source B, `A != B` perceptually, re-run same source → deterministic.

**Current phase must achieve Gates A–D before that validation (tests pass, no build/deploy).**
