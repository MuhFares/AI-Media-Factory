# VoiceTuT-TTS — Egyptian Arabic TTS on RunPod Serverless
# Apache-2.0 stack: OmniVoice (k2-fsa) + VoiceTuT fine-tune (mohammedaly22).
FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime

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

# torchaudio MUST match the base image's torch exactly. If left to pip
# resolution, a newer torchaudio can drag in a replacement torch build and
# silently break the CUDA stack.
RUN pip install --no-cache-dir "torchaudio==2.6.0"

# transformers 5.x requires torch >= 2.5; on older torch it "disables" torch
# and crashes with NameError inside integrations/tensor_parallel.py.
# Pin the range explicitly so resolution cannot drift between builds.
RUN pip install --no-cache-dir "transformers>=5.3,<6" "accelerate>=1.1"

# OmniVoice backbone (not on PyPI — installed from GitHub)
RUN pip install --no-cache-dir "git+https://github.com/k2-fsa/OmniVoice.git"

# VoiceTuT-TTS (Egyptian fine-tune)
RUN pip install --no-cache-dir voicetut-tts

# omnivoice's dependency tree pulls an older tomlkit that breaks runpod's
# SDK (config parsing). Re-pin it after all installs so the resolver
# conflict cannot ship inside the image.
RUN pip install --no-cache-dir "tomlkit>=0.15.1"

# ---- HARD GATES (build fails if the runtime stack is broken) ----
# Gate 1: torch importable with CUDA AND transformers actually sees it.
RUN python -c "import torch, transformers; from transformers.utils import is_torch_available as t; assert t(), 'transformers disabled torch: version mismatch'; print('torch', torch.__version__, '| cuda:', torch.cuda.is_available(), '| transformers', transformers.__version__)" && \
    python -c "import torchaudio; print('torchaudio', torchaudio.__version__)"
# Gate 2: the exact module that produced NameError 'torch' in production.
RUN python -c "import transformers.integrations.tensor_parallel; print('tensor_parallel import OK')"
# Gate 3: full model load + real synthesis (exercises from_pretrained path).
RUN python -c "from voicetut_tts import VoiceTutTTS; tts = VoiceTutTTS.from_pretrained('mohammedaly22/VoiceTut-TTS'); tts.synthesize('مرحبا', speaker='Mohamed', output='/tmp/gate.wav'); import os; assert os.path.getsize('/tmp/gate.wav') > 100, 'empty audio'; print('model load + synthesis OK')"

# Pre-download the fine-tuned weights at build time (cold start without a 3GB download)
RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('mohammedaly22/VoiceTut-TTS')"

COPY handler.py /handler.py

CMD ["python", "-u", "/handler.py"]
