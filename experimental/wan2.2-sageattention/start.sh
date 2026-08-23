#!/usr/bin/env bash
# Patched start.sh — original from runpod-workers/worker-comfyui/src/start.sh:1-83
# Change: honors SAGEATTENTION=1 → adds --use-sageattention to ComfyUI
# and logs clearly which attention is active.

if [ -n "$PUBLIC_KEY" ]; then
  mkdir -p ~/.ssh
  echo "$PUBLIC_KEY" > ~/.ssh/authorized_keys
  chmod 700 ~/.ssh
  chmod 600 ~/.ssh/authorized_keys
  for key_type in rsa ecdsa ed25519; do
    key_file="/etc/ssh/ssh_host_${key_type}_key"
    if [ ! -f "$key_file" ]; then
      ssh-keygen -t "$key_type" -f "$key_file" -q -N ''
    fi
  done
  service ssh start && echo "worker-comfyui: SSH server started" || echo "worker-comfyui: SSH server could not be started" >&2
fi

TCMALLOC="$(ldconfig -p | grep -Po "libtcmalloc.so.\d" | head -n 1)"
export LD_PRELOAD="${TCMALLOC}"

echo "worker-comfyui: Checking GPU availability..."
if ! GPU_CHECK=$(python3 -c "
import torch
try:
    torch.cuda.init()
    name = torch.cuda.get_device_name(0)
    cap = torch.cuda.get_device_capability(0)
    _ = (torch.zeros(8, device='cuda') + 1).sum().item()
    torch.cuda.synchronize()
    print(f'OK: {name} (sm_{cap[0]}{cap[1]}), torch {torch.__version__}, cuda {torch.version.cuda}')
except Exception as e:
    print(f'FAIL: {e}')
    exit(1)
" 2>&1); then
  echo "worker-comfyui: GPU is not available or incompatible with this PyTorch build:"
  echo "worker-comfyui: $GPU_CHECK"
  exit 1
fi
echo "worker-comfyui: GPU available — $GPU_CHECK"

# ---------------------------------------------------------------------------
# SageAttention wiring — isolated experiment, env-driven
# ---------------------------------------------------------------------------
# SAGEATTENTION=1 → enable; 0/unset → normal attention.
# SageAttention 1.0.6 is stable for torch>=2.3 + CUDA 12.6 + 4090/5090.
# No Triton nightly required.
: "${SAGEATTENTION:=0}"
SAGE_STATUS="disabled"
SAGE_VERSION="not-installed"
SAGE_EXTRA_ARGS=""

if python3 -c "import sageattention" 2>/dev/null; then
  SAGE_VERSION=$(python3 -c "import sageattention; print(getattr(sageattention,'__version__','unknown'))" 2>/dev/null || echo "installed")
  if [ "$SAGEATTENTION" = "1" ]; then
    # ComfyUI 0.3.30 accepts --use-sageattention; verify support
    if python3 /comfyui/main.py --help 2>&1 | grep -q "use-sageattention"; then
      SAGE_EXTRA_ARGS="--use-sageattention"
      SAGE_STATUS="enabled (--use-sageattention, sageattention ${SAGE_VERSION})"
    else
      # Fallback: ComfyUI may auto-detect sageattention without flag (some forks)
      # Keep flag unset but log that library is present.
      SAGE_STATUS="installed but ComfyUI flag not found (sageattention ${SAGE_VERSION} present, running without --use-sageattention)"
      echo "worker-comfyui: WARNING — --use-sageattention flag not found in this ComfyUI build; SageAttention may still be auto-used if present" >&2
    fi
  else
    SAGE_STATUS="installed but disabled (SAGEATTENTION=${SAGEATTENTION}, sageattention ${SAGE_VERSION})"
  fi
else
  if [ "$SAGEATTENTION" = "1" ]; then
    echo "worker-comfyui: ERROR — SAGEATTENTION=1 but sageattention package not importable" >&2
    SAGE_STATUS="requested but not installed"
  else
    SAGE_STATUS="not installed, disabled"
  fi
fi

echo "worker-comfyui: SageAttention: ${SAGE_STATUS}"
if [ -n "$SAGE_EXTRA_ARGS" ]; then
  echo "worker-comfyui: SageAttention extra args: ${SAGE_EXTRA_ARGS}"
fi

comfy-manager-set-mode offline || echo "worker-comfyui - Could not set ComfyUI-Manager network_mode" >&2

echo "worker-comfyui: Starting ComfyUI"
: "${COMFY_LOG_LEVEL:=DEBUG}"
COMFY_PID_FILE="/tmp/comfyui.pid"

# Log the exact ComfyUI command for auditability
echo "worker-comfyui: ComfyUI command: python -u /comfyui/main.py --disable-auto-launch --disable-metadata --listen --verbose ${COMFY_LOG_LEVEL} --log-stdout ${SAGE_EXTRA_ARGS}"

if [ "$SERVE_API_LOCALLY" = "true" ]; then
  python -u /comfyui/main.py --disable-auto-launch --disable-metadata --listen --verbose "${COMFY_LOG_LEVEL}" --log-stdout ${SAGE_EXTRA_ARGS} &
  echo $! > "$COMFY_PID_FILE"
  echo "worker-comfyui: Starting RunPod Handler"
  python -u /handler.py --rp_serve_api --rp_api_host=0.0.0.0
else
  python -u /comfyui/main.py --disable-auto-launch --disable-metadata --verbose "${COMFY_LOG_LEVEL}" --log-stdout ${SAGE_EXTRA_ARGS} &
  echo $! > "$COMFY_PID_FILE"
  echo "worker-comfyui: Starting RunPod Handler"
  python -u /handler.py
fi
