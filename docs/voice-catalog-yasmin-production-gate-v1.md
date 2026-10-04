# Voice Catalog V1 — Yasmin production gate

The official VoiceTuT model card documents 17 built-in speakers and lists `Yasmin` in the female inventory. The current repository runtime contract accepts `input.voice` and forwards it to the handler as `speaker`; a speaker-list endpoint is not required by this contract. Yasmin was therefore eligible for one controlled synthesis test, while runtime synthesis remained unproven.

Arabic rendering was repaired locally with a project-controlled Fontconfig file referencing the installed Windows Arial font. The zero-provider ASS/libass test passed UTF-8, Arabic shaping/joining, RTL ordering, two-line wrapping, and the 480x832 safe area.

The single Yasmin request was submitted through the existing VoiceTuT adapter with zero retries. RunPod returned `HTTP 409 ENDPOINT_PAUSED` (`max_workers=0`) before synthesis. This is recorded as `YASMIN_RUNTIME_SYNTHESIS=FAIL` caused by paused endpoint infrastructure; it is not evidence that Yasmin is absent or unsupported by the documented model. No Mohamed fallback was used. No Arabic audio or final video exists for this gate.

Evidence: `output/manual-external-generation-v1/voice-catalog-dual-production-gate-v1/egyptian-yasmin/failure-evidence.json`.

The earlier paused-endpoint attempt remains preserved. For the controlled retry, endpoint `fn0r8im79ij4dp` was confirmed active through the read-only health check (`ready=1`, `idle=1`, `unhealthy=0`). The single authorized retry synthesized `Yasmin` successfully; runtime compatibility and synthesis technical status are `PASS`, while human naturalness, Egyptian-accent quality, and production approval remain pending human review.

The successful candidate is recorded under `output/manual-external-generation-v1/voice-catalog-dual-production-gate-v1/egyptian-yasmin/attempt-2/`. It reused the approved Wan source unchanged and passed container, audio-duration, Arabic-rendering, caption-layout, and lineage QA. Final state: `PENDING_HUMAN_FINAL_VIDEO_REVIEW`.

Hannah’s existing English candidate is now recorded in the catalog as `HUMAN_PASS_LIFESTYLE_SOCIAL_SCENE`; no Groq regeneration was performed.
