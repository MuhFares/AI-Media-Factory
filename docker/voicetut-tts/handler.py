"""
RunPod serverless handler — VoiceTuT-TTS (Egyptian Arabic).

Contract:
  input:  { text: str (required), voice?: str (speaker name), format?: "wav" }
  output: { audio: "<base64 WAV>", format: "wav", voice: "<speaker>",
            duration_seconds: float }
  errors: { error: "..." }  (never a fabricated success)

Model: mohammedaly22/VoiceTut-TTS (Apache-2.0, Egyptian Arabic + code-switching).
The model is pre-downloaded at image build time for fast cold starts.
"""

import base64
import os
import tempfile

import runpod

MODEL_ID = os.getenv("VOICETUT_MODEL_ID", "mohammedaly22/VoiceTut-TTS")
DEFAULT_SPEAKER = os.getenv("VOICETUT_DEFAULT_SPEAKER", "Mohamed")
LONG_TEXT_THRESHOLD = int(os.getenv("VOICETUT_LONG_TEXT_THRESHOLD", "400"))
SAMPLE_RATE = 24_000

tts = None


def get_tts():
    global tts
    if tts is None:
        from voicetut_tts import VoiceTutTTS

        print("Loading VoiceTut-TTS model...")
        tts = VoiceTutTTS.from_pretrained(MODEL_ID)
        print("VoiceTut-TTS model loaded.")
    return tts


def handler(job):
    job_input = job.get("input") or {}
    text = (job_input.get("text") or "").strip()
    if not text:
        return {"error": "text is required"}

    speaker = (job_input.get("voice") or DEFAULT_SPEAKER).strip()
    fmt = (job_input.get("format") or "wav").strip().lower()
    if fmt != "wav":
        return {"error": f"unsupported format: {fmt} (only wav is supported)"}

    try:
        tts = get_tts()
        with tempfile.TemporaryDirectory() as td:
            out_path = os.path.join(td, "out.wav")
            if len(text) > LONG_TEXT_THRESHOLD:
                tts.synthesize_long(text, out_path, speaker=speaker)
            else:
                tts.synthesize(text, speaker=speaker, output=out_path)
            with open(out_path, "rb") as f:
                audio = f.read()
    except Exception as e:  # noqa: BLE001 — return the failure truthfully
        return {"error": f"synthesis failed: {e}"}

    if len(audio) < 100:
        return {"error": "provider produced empty audio"}

    return {
        "audio": base64.b64encode(audio).decode("utf-8"),
        "format": "wav",
        "voice": speaker,
        "duration_seconds": round(max(0, len(audio) - 44) / 2 / SAMPLE_RATE, 2),
    }


runpod.serverless.start({"handler": handler})
