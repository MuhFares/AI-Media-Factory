# AI Media Factory Wan2.2 I2V Runtime v1
# Pinned, reproducible, owns handler/workflow, content-addressed image input.

ARG CUDA_BASE=nvidia/cuda:12.6.0-cudnn-devel-ubuntu22.04
FROM ${CUDA_BASE}

ARG SOURCE_REVISION=uncommitted

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PIP_PREFER_BINARY=1

# Python 3.10 (ComfyUI requirement)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 python3.10-venv python3-pip git wget curl ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN python3.10 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Pinned PyTorch + CUDA
RUN pip install --no-cache-dir \
    "torch==2.3.1" \
    "torchvision==0.18.1" \
    "torchaudio==2.3.1" \
    --index-url https://download.pytorch.org/whl/cu121

# ComfyUI — pinned commit (2026-02-16, compatible with WanVideoWrapper 86ad93d 2026-02-16)
ARG COMFYUI_COMMIT=1978f59ffdf242389ded3eec76274a4cbed9cc3d
RUN git clone https://github.com/comfyanonymous/ComfyUI.git /ComfyUI && \
    cd /ComfyUI && \
    git checkout ${COMFYUI_COMMIT} && \
    pip install -r requirements.txt

# ComfyUI custom nodes — pinned
ARG WAN_WRAPPER_COMMIT=86ad93d616f2b7ee8f200244537cfead276118b0
RUN cd /ComfyUI/custom_nodes && \
    git clone https://github.com/kijai/ComfyUI-WanVideoWrapper.git && \
    cd ComfyUI-WanVideoWrapper && \
    git checkout ${WAN_WRAPPER_COMMIT} && \
    pip install -r requirements.txt

ARG VIDEO_HELPER_COMMIT=4d907bee61e92c2e65af3bd6383a4e4d356126d1
RUN cd /ComfyUI/custom_nodes && \
    git clone https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git && \
    cd ComfyUI-VideoHelperSuite && \
    git checkout ${VIDEO_HELPER_COMMIT} && \
    pip install -r requirements.txt

ARG FRAME_INTERPOLATION_COMMIT=26545cc2dd95bc3d27f056016300673bdeee78f5
RUN cd /ComfyUI/custom_nodes && \
    git clone https://github.com/Fannovel16/ComfyUI-Frame-Interpolation.git && \
    cd ComfyUI-Frame-Interpolation && \
    git checkout ${FRAME_INTERPOLATION_COMMIT} && \
    python install.py

# Wan2.2 models (via extra_model_paths.yaml, not baked — use network volume)
COPY extra_model_paths.yaml /ComfyUI/extra_model_paths.yaml

# Handler + workflow (owned, not from base image)
WORKDIR /app
COPY handler.py /app/handler.py
COPY receipt_store.py /app/receipt_store.py
COPY workflow_api.json /app/workflow_api.json
COPY requirements.txt /app/requirements.txt
COPY start.sh /app/start.sh
RUN pip install -r /app/requirements.txt
RUN chmod +x /app/start.sh

# OCI labels — SOURCE_REVISION is supplied by the immutable CI commit build.
LABEL org.opencontainers.image.source="https://github.com/MUHFARES/AI-Media-Factory"
LABEL org.opencontainers.image.revision="${SOURCE_REVISION}"
LABEL org.opencontainers.image.version="v0.1.0-test"

EXPOSE 8188 8000

CMD ["/app/start.sh"]
