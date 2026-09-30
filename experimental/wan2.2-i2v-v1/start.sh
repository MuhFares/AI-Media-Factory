#!/usr/bin/env bash
set -euo pipefail

COMFYUI_HOST="${COMFYUI_HOST:-127.0.0.1}"
COMFYUI_PORT="${COMFYUI_PORT:-8188}"
COMFYUI_STARTUP_TIMEOUT_SECONDS="${COMFYUI_STARTUP_TIMEOUT_SECONDS:-180}"
export SERVER_ADDRESS="${SERVER_ADDRESS:-${COMFYUI_HOST}}"
export AMF_VIDEO_RECEIPT_DIR="${AMF_VIDEO_RECEIPT_DIR:-/runpod-volume/amf-video-receipts}"

case "${AMF_VIDEO_RECEIPT_DIR}" in
  /runpod-volume/*) ;;
  *)
    echo "AMF_VIDEO_RECEIPT_DIR must be under /runpod-volume" >&2
    exit 64
    ;;
esac

mkdir -p "${AMF_VIDEO_RECEIPT_DIR}"
test -w "${AMF_VIDEO_RECEIPT_DIR}"

python -u /ComfyUI/main.py \
  --disable-auto-launch \
  --listen "${COMFYUI_HOST}" \
  --port "${COMFYUI_PORT}" &
COMFYUI_PID=$!

cleanup() {
  kill "${COMFYUI_PID}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

deadline=$((SECONDS + COMFYUI_STARTUP_TIMEOUT_SECONDS))
until curl --fail --silent --show-error \
  "http://${COMFYUI_HOST}:${COMFYUI_PORT}/system_stats" >/dev/null; do
  if ! kill -0 "${COMFYUI_PID}" 2>/dev/null; then
    echo "ComfyUI exited before readiness" >&2
    exit 70
  fi
  if (( SECONDS >= deadline )); then
    echo "ComfyUI readiness timeout" >&2
    exit 70
  fi
  sleep 2
done

python -u /app/handler.py
