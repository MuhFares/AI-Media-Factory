# VoiceTuT-TTS RunPod Serverless — Egyptian Arabic

**Model:** `mohammedaly22/VoiceTut-TTS` (Apache-2.0) — Egyptian Arabic + code-switching, 17 built-in speakers, zero-shot cloning, Arabic text normalization (numbers/dates/currency → Egyptian colloquial), streaming.

**Base:** OmniVoice (k2-fsa, Apache-2.0) — RTF as low as 0.025 with FlashInfer.

## Build (GitHub Actions — automatic)

Push any change under `docker/voicetut-tts/` → the workflow builds and pushes:

```
ghcr.io/muhfares/voicetut-tts:latest
```

Manual trigger: Actions → "Build VoiceTuT-TTS image" → Run workflow.
Expected build time: 10-20 min (torch base + model pre-download).

## RunPod deployment

1. `Serverless` → `New Endpoint` → `Deploy from a Docker image`
2. Image: `ghcr.io/muhfares/voicetut-tts:latest`
   (if GHCR asks for auth: Container Registry Auth → username `muhfares`, password = a GitHub PAT with `read:packages`)
3. GPU: **any** (model needs ~3GB VRAM — even a cheap GPU works; 4090 = fastest)
4. Max workers: `1` — Active workers: `0` — Idle timeout: `300` — Execution timeout: `600`
5. Container disk: `20GB` (model is baked into the image — no volume needed)
6. No start command, no env vars required.
   Optional: `VOICETUT_DEFAULT_SPEAKER` (default `Mohamed`), `VOICETUT_MODEL_ID`.

## Contract

```json
POST /run
{ "input": { "text": "النص المصري هنا", "voice": "Mohamed", "format": "wav" } }
→ { "id": "job-id", "status": "IN_QUEUE" }

GET /status/{jobId}
→ { "status": "COMPLETED", "output": {
     "audio": "<base64 WAV>",
     "format": "wav",
     "voice": "Mohamed",
     "duration_seconds": 12.3 } }
```

Errors: `{ "error": "..." }` — never a fabricated success.

## Speakers

17 built-in studio voices (male & female), e.g. `Mohamed`, `Asmaa`, `Sayed`.
List them: `voicetut --list-speakers` (or check the HF model card).

## Notes

- Long text (>400 chars) uses `synthesize_long` (sentence-chunked streaming synth).
- Cold start: image has the model baked in → only model→VRAM load (~5-15s).
- VRAM: ~3GB fp16 — any GPU tier works.
