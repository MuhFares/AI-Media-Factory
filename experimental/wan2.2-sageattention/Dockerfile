# Experimental Wan2.2 + SageAttention — isolated from production ry49lc45y50ldy
# Base MUST be the exact production image (visible in RunPod Console → Endpoint → Container Image)
# Fallback to upstream worker-comfyui base if production image is not yet pushed to a registry.
ARG BASE_IMAGE=runpod/worker-comfyui:5.8.7-base
FROM ${BASE_IMAGE}

# Keep the exact ComfyUI / CUDA / Python stack from production.
# Only addition is SageAttention 1.0.6 (stable release, pytorch>=2.3, triton>=2.3).
# Do NOT use triton-nightly unless audit proves required — prefer stable.
ENV PIP_PREFER_BINARY=1
ENV PYTHONUNBUFFERED=1

# Install SageAttention in the same venv used by worker-comfyui (uv venv /opt/venv)
# The base image already has /opt/venv from upstream Dockerfile:28-34
RUN uv pip install --no-cache "sageattention==1.0.6"

# Verify install at build time (fails fast if CUDA/PyTorch mismatch)
RUN python -c "import sageattention; print(f'SageAttention {sageattention.__version__} installed')" || \
    (echo "SageAttention import failed — check torch/cuda compatibility" && exit 1)

# Patched entrypoint that honors SAGEATTENTION=1 → --use-sageattention
# See start.sh for logging and flag handling.
COPY start.sh /start.sh
RUN chmod +x /start.sh

# No change to model, workflow, custom nodes, or CUDA environment.
# Wan2.2 models (flux1-dev-fp8.safetensors + wan2.2) are expected via
# network volume or already baked in production base — do not re-download here.
