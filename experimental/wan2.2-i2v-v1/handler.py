"""
AI Media Factory Wan2.2 I2V Runtime v1 — Handler
- Explicit image_base64 input (required, no T2V fallback)
- Content-addressed input image (amf-i2v-<sha256[:24]>.png)
- No opaque diskcache for image-dependent stages
- Request-isolated workflow mutation
"""

import base64
import binascii
import hashlib
import json
import os
import time
import uuid
import logging
import urllib.request
import urllib.parse
import websocket
from receipt_store import load_receipt as load_receipt_file, persist_receipt as persist_receipt_file

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ComfyUI server (in container)
server_address = os.getenv("SERVER_ADDRESS", "127.0.0.1")
client_id = str(uuid.uuid4())

WORKFLOW_PATH = "/app/workflow_api.json"  # handler and workflow are at /app in new image
# Fallback for local tests
if not os.path.exists(WORKFLOW_PATH):
    WORKFLOW_PATH = os.path.join(os.path.dirname(__file__), "workflow_api.json")

EXPECTED_LOADIMAGE_NODE_ID = "260"
EXPECTED_LOADIMAGE_CLASS = "LoadImage"

# Loaded once at startup, validated, then deep-copied per request
_WORKFLOW_TEMPLATE = None
_WORKFLOW_SHA256 = None
RECEIPT_DIR = os.getenv("AMF_VIDEO_RECEIPT_DIR", "/runpod-volume/amf-video-receipts")


def load_receipt(client_execution_id: str):
    return load_receipt_file(RECEIPT_DIR, client_execution_id)


def persist_receipt(client_execution_id: str, receipt: dict):
    persist_receipt_file(RECEIPT_DIR, client_execution_id, receipt)


def load_workflow_template(path: str):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    # Startup validation
    if EXPECTED_LOADIMAGE_NODE_ID not in data:
        raise RuntimeError(f"Workflow missing expected LoadImage node {EXPECTED_LOADIMAGE_NODE_ID}")
    node = data[EXPECTED_LOADIMAGE_NODE_ID]
    if node.get("class_type") != EXPECTED_LOADIMAGE_CLASS:
        raise RuntimeError(f"Workflow node {EXPECTED_LOADIMAGE_NODE_ID} class_type is {node.get('class_type')!r}, expected {EXPECTED_LOADIMAGE_CLASS!r}")
    if "image" not in node.get("inputs", {}):
        raise RuntimeError(f"Workflow node {EXPECTED_LOADIMAGE_NODE_ID} has no 'image' input")
    return data


def init_workflow():
    global _WORKFLOW_TEMPLATE, _WORKFLOW_SHA256
    tmpl = load_workflow_template(WORKFLOW_PATH)
    raw = json.dumps(tmpl, sort_keys=True).encode("utf-8")
    sha = hashlib.sha256(raw).hexdigest()
    _WORKFLOW_TEMPLATE = tmpl
    _WORKFLOW_SHA256 = sha
    logger.info(f"Workflow template loaded: {WORKFLOW_PATH} SHA256 {sha[:16]} nodes={len(tmpl)} LoadImage={EXPECTED_LOADIMAGE_NODE_ID}")


# Initialize at import (fail fast if workflow drifts)
try:
    init_workflow()
except Exception as e:
    logger.warning(f"Workflow template not yet available at import: {e} (will retry on first request)")


def get_workflow_copy():
    """Return a deep copy of the template (request-isolated)."""
    global _WORKFLOW_TEMPLATE, _WORKFLOW_SHA256
    if _WORKFLOW_TEMPLATE is None:
        init_workflow()
    # json round-trip is the simplest deep copy for ComfyUI workflows
    return json.loads(json.dumps(_WORKFLOW_TEMPLATE))


def validate_image_base64(b64: str) -> bytes:
    """Validate and decode, also verify it is an image via PIL header or at least non-empty bytes."""
    try:
        decoded = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError) as e:
        raise ValueError(f"image_base64 is not valid base64: {e}") from e
    if len(decoded) == 0:
        raise ValueError("image_base64 decoded to empty bytes")
    # Basic image magic check (PNG or JPEG)
    if not (decoded[:8].startswith(b"\x89PNG") or decoded[:2] == b"\xff\xd8" or decoded[:4] in (b"RIFF", b"GIF8")):
        # Try PIL if available, but don't require it for the handler to start
        try:
            from PIL import Image
            import io
            Image.open(io.BytesIO(decoded)).verify()
        except ImportError:
            # PIL not installed in test env — skip strict check, just ensure non-empty
            if len(decoded) < 100:
                raise ValueError("image_base64 decoded bytes too short to be an image")
        except Exception as e:
            raise ValueError(f"image_base64 is not a valid image: {e}") from e
    return decoded


def queue_prompt(prompt):
    url = f"http://{server_address}:8188/prompt"
    p = {"prompt": prompt, "client_id": client_id}
    data = json.dumps(p).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())


def get_history(prompt_id):
    url = f"http://{server_address}:8188/history/{prompt_id}"
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.loads(response.read())


def get_videos(ws, prompt_id):
    while True:
        out = ws.recv()
        if isinstance(out, str):
            message = json.loads(out)
            if message["type"] == "executing":
                data = message["data"]
                if data["node"] is None and data["prompt_id"] == prompt_id:
                    break
        else:
            continue
    history = get_history(prompt_id)[prompt_id]
    output_videos = {}
    for node_id in history["outputs"]:
        node_output = history["outputs"][node_id]
        videos_output = []
        if "gifs" in node_output:
            for video in node_output["gifs"]:
                with open(video["fullpath"], "rb") as f:
                    video_data = base64.b64encode(f.read()).decode("utf-8")
                videos_output.append(video_data)
        if videos_output:
            output_videos[node_id] = videos_output
    return output_videos


def to_nearest_multiple_of_16(value):
    try:
        numeric_value = float(value)
    except Exception:
        raise ValueError(f"width/height must be numeric: {value!r}")
    adjusted = int(round(numeric_value / 16.0) * 16)
    if adjusted < 16:
        adjusted = 16
    return adjusted


def handler(job):
    request_received_at = time.time()
    job_input = job.get("input", {}) or {}
    client_execution_id = job_input.get("client_execution_id")
    idempotency_key = job_input.get("idempotency_key")
    provider_job_id = job.get("id")

    if job_input.get("operation") == "lookup_receipt":
        if not isinstance(client_execution_id, str) or not client_execution_id.strip():
            return {"error": "client_execution_id is required for receipt lookup"}
        receipt = load_receipt(client_execution_id.strip())
        return {"receipt": receipt, "found": receipt is not None, "client_execution_id": client_execution_id.strip()}

    if isinstance(client_execution_id, str) and client_execution_id.strip():
        client_execution_id = client_execution_id.strip()
        existing_receipt = load_receipt(client_execution_id)
        if existing_receipt is not None:
            # Provider-side idempotency: never start a second generation for the
            # same runtime-owned logical execution identity.
            return {"receipt": existing_receipt, "duplicate_suppressed": True, **existing_receipt}

    # ---- Validation (I2V — image is required) ----
    if "image_base64" not in job_input or not str(job_input["image_base64"]).strip():
        return {"error": "image_base64 is required for this I2V endpoint (no T2V fallback)"}
    raw_b64 = str(job_input["image_base64"]).strip()
    # Strip data: prefix if present (client may send data:image/png;base64,...)
    if raw_b64.startswith("data:"):
        comma = raw_b64.find(",")
        if comma >= 0:
            raw_b64 = raw_b64[comma + 1:].strip()

    # Prompt is required
    prompt_text = job_input.get("prompt")
    if not isinstance(prompt_text, str) or not prompt_text.strip():
        return {"error": "prompt is required and must not be empty"}
    prompt_text = prompt_text.strip()
    if len(prompt_text) > 1000:
        return {"error": "prompt exceeds 1000 characters"}

    # Dimensions
    try:
        width = to_nearest_multiple_of_16(job_input.get("width", 480))
        height = to_nearest_multiple_of_16(job_input.get("height", 832))
    except ValueError as e:
        return {"error": str(e)}

    length = job_input.get("length", 81)
    steps = job_input.get("steps", 10)
    cfg = job_input.get("cfg", 2.0)
    seed = job_input.get("seed", 42)
    negative_prompt = job_input.get("negative_prompt", "")

    try:
        length = int(length)
        steps = int(steps)
        cfg = float(cfg)
        seed = int(seed)
    except (ValueError, TypeError):
        return {"error": "length/steps/seed/cfg must be numeric"}

    if not (1 <= length <= 121):
        return {"error": "length must be between 1 and 121"}
    if not (1 <= steps <= 50):
        return {"error": "steps must be between 1 and 50"}

    # ---- Decode + content-addressed filename ----
    try:
        decoded = validate_image_base64(raw_b64)
    except ValueError as e:
        return {"error": str(e)}

    image_sha256 = hashlib.sha256(decoded).hexdigest()
    filename = f"amf-i2v-{image_sha256[:24]}.png"
    # ComfyUI input dir — use absolute path inside container
    comfy_input_dir = os.path.join(os.path.dirname(__file__), "..", "ComfyUI", "input")
    # In the container, handler is at /app/handler.py, so ComfyUI is at /ComfyUI
    # Fallback: try /ComfyUI/input, then ./ComfyUI/input, then /tmp
    for candidate in ["/ComfyUI/input", "/app/ComfyUI/input", os.path.join(os.path.dirname(__file__), "ComfyUI", "input"), "/tmp"]:
        if os.path.isdir(candidate):
            comfy_input_dir = candidate
            break
    os.makedirs(comfy_input_dir, exist_ok=True)
    # Also ensure /tmp exists for fallback
    image_path = os.path.join(comfy_input_dir, filename)
    # Atomic write: write to temp then rename
    tmp_path = image_path + f".tmp.{uuid.uuid4().hex[:8]}"
    with open(tmp_path, "wb") as f:
        f.write(decoded)
    os.replace(tmp_path, image_path)

    request_id = str(client_execution_id).strip() if isinstance(client_execution_id, str) and client_execution_id.strip() else f"amf-{uuid.uuid4().hex[:8]}"
    logger.info(f"[{request_id}] provider_job_id={provider_job_id or 'unknown'} accepted_at={request_received_at:.6f} image_sha256={image_sha256[:16]} filename={filename} bytes={len(decoded)} prompt_len={len(prompt_text)} seed={seed}")

    # ---- Workflow (request-isolated copy) ----
    try:
        prompt = get_workflow_copy()
    except RuntimeError as e:
        return {"error": f"workflow template error: {e}"}

    # Inject image into the exact LoadImage node
    prompt[EXPECTED_LOADIMAGE_NODE_ID]["inputs"]["image"] = filename

    # Update other inputs
    prompt["135"]["inputs"]["positive_prompt"] = prompt_text
    prompt["135"]["inputs"]["negative_prompt"] = negative_prompt
    prompt["220"]["inputs"]["seed"] = seed
    prompt["540"]["inputs"]["seed"] = seed
    prompt["540"]["inputs"]["cfg"] = cfg
    prompt["235"]["inputs"]["value"] = width
    prompt["236"]["inputs"]["value"] = height
    prompt["498"]["inputs"]["context_overlap"] = job_input.get("context_overlap", 48)
    prompt["498"]["inputs"]["context_frames"] = length
    prompt["541"]["inputs"]["num_frames"] = length
    if "834" in prompt:
        prompt["834"]["inputs"]["steps"] = steps

    # ---- Submit to ComfyUI ----
    try:
        generation_started_at = time.time()
        if isinstance(client_execution_id, str):
            persist_receipt(client_execution_id, {
                "status": "RUNNING",
                "client_execution_id": client_execution_id,
                "idempotency_key": idempotency_key,
                "provider_job_id": provider_job_id,
                "source_input_hash": job_input.get("source_input_hash") or image_sha256,
                "config_fingerprint": job_input.get("configuration_fingerprint"),
                "created_at": request_received_at,
                "generation_started_at": generation_started_at,
            })
        ws_url = f"ws://{server_address}:8188/ws?clientId={client_id}"
        ws = websocket.create_connection(ws_url, timeout=10)
        videos = get_videos(ws, queue_prompt(prompt)["prompt_id"])
        ws.close()
    except Exception as e:
        logger.error(f"[{request_id}] ComfyUI execution failed: {e}")
        return {"error": f"ComfyUI execution failed: {e}"}

    # ---- Extract video ----
    # Find the VHS_VideoCombine or similar output
    for node_id, vids in videos.items():
        if vids:
            generation_completed_at = time.time()
            # Return first video as base64 with data: prefix for adapter compatibility
            result = {
                "video": f"data:video/mp4;base64,{vids[0]}",
                "image_sha256": image_sha256,
                "workflow_sha256": _WORKFLOW_SHA256[:16] if _WORKFLOW_SHA256 else None,
                "request_id": request_id,
                "client_execution_id": client_execution_id,
                "idempotency_key": idempotency_key,
                "provider_job_id": provider_job_id,
                "request_received_at": request_received_at,
                "generation_started_at": generation_started_at,
                "generation_completed_at": generation_completed_at,
            }
            if isinstance(client_execution_id, str):
                persist_receipt(client_execution_id, {"status": "COMPLETED", **result})
            return result

    return {"error": "No video output from ComfyUI"}


if __name__ == "__main__":
    import runpod

    runpod.serverless.start({"handler": handler})
