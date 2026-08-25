# VoiceTuT-TTS — Egyptian Arabic TTS on RunPod Serverless
# Apache-2.0 stack: OmniVoice (k2-fsa) + VoiceTuT fine-tune (mohammedaly22).
FROM pytorch/pytorch:2.4.1-cuda12.1-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PIP_PREFER_BINARY=1
# Bake the model into the image for fast cold starts (~3GB).
ENV HF_HUB_ENABLE_HF_TRANSFER=0

RUN apt-get update && apt-get install -y \
    git \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN pip install --no-cache-dir runpod

# OmniVoice backbone (not on PyPI — installed from GitHub)
RUN pip install --no-cache-dir "git+https://github.com/k2-fsa/OmniVoice.git"

# VoiceTuT-TTS (Egyptian fine-tune)
RUN pip install --no-cache-dir voicetut-tts

# Pre-download the fine-tuned weights at build time (cold start without a 3GB download)
RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('mohammedaly22/VoiceTut-TTS')"

COPY handler.py /handler.py

CMD ["python", "-u", "/handler.py"]
