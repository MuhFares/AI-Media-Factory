# AMF Project State and Roadmap Reconciliation

**Status:** Current handoff / source of truth for execution planning  
**Updated:** 2026-09-09
**Owner:** CTO / execution layer

This document is the durable handoff for future Work/Codex sessions. It complements the Company Brain; it does not replace the vision, mission, goals, or business-model documents. Claims here are limited to repository evidence and the accepted production artifacts listed below.

## Current State

**CURRENT_PHASE = `BRAND_AND_CHANNEL_NAMING_V1`** — Naming Round 1 reached `OWNER_SHORTLIST_REVIEW_REQUIRED` under workflow `workflow-brand-and-channel-naming-v1-2d0e1859-a720-41d4-ba06-dc6c43b3d00d`. The owner configuration is frozen; 30 deduplicated candidates were evaluated in bounded batches and a 10-item shortlist is pending owner review. No external verification, final selection, trademark/domain/handle search, Bright Data call, media download, or publishing occurred. Strategy Council V2 remains `CLOSED` and immutable. See [`docs/brand-and-channel-naming-v1.md`](brand-and-channel-naming-v1.md).

**ROUND_2_GOVERNED_EXECUTION_PATH = `IMPLEMENTED`** — The local governed Round 2 path supports exactly `claude-opus-4-8` and `gpt-5.6-sol`, independent strategist inputs, cross-evaluation, exact-coverage batches, linguistic review, and bounded synthesis. `ROUND_2_EXECUTED = NO`; no provider or external calls were made. **NEXT_STEP = `OWNER_AUTHORIZATION_TO_EXECUTE_NAMING_V1_ROUND_2`**.

**ROUND_2_EXECUTION_ATTEMPT = `BLOCKED_BEFORE_VISIBLE_MODEL_OUTPUT`** — The Claude AgentRouter attempt requested `claude-opus-4-8`; it did not produce a provider response, visible JSON, actual-model confirmation, or a canonical model-output artifact. Sol and all downstream Round 2 stages were not started. No external verification occurred. **NEXT_STEP = `RESOLVE_AGENTROUTER_TRANSPORT_AND_STALE_EXECUTION_STATE_BEFORE_REAUTHORIZATION`**.

An owner-authorized Sol-only attempt subsequently requested `gpt-5.6-sol` over the AgentRouter OpenAI-compatible route and also remained blocked before any visible model output. It did not proceed to merge, evaluation, linguistic review, or synthesis.

### Social Intelligence Provider V1 (2026-09-01)

Generic social contracts, normalized evidence, risk metadata, bounded results, and an optional Research Source Router social port are present. Apify is the MVP implementation candidate; Bright Data remains replaceable. The direct-reference diagnostic succeeded once with provider-reported usage of $0.0027 and normalized public Instagram metadata/engagement/audio fields. Instagram direct reference metadata is proven for tested fields; keyword discovery remains unproven, transcript/multimodal analysis remain unavailable, and TikTok remains unproven.

The separate bounded hashtag discovery validation used `travel` and completed with one `no_items` Actor envelope and zero content records. It remains `IMPLEMENTED_LIVE_UNPROVEN`; no additional Instagram run is authorized by this milestone.

### Artifact lineage classification

The following labels are authoritative for this repository:

| Classification | Artifacts / decisions | Use in current gates |
|---|---|---|
| **CURRENT ACCEPTED** | `output/visual-benchmarks/cairo-street-realism-zimage-live-v1.png` (Z-Image Turbo); `output/wan-single-scene-single-scene-1787942858498.mp4` (Z-Image Turbo → Wan production, endpoint `ry49lc45y50ldy`) | Valid input for the current Production Editing V2 canonical gate |
| **HISTORICAL ACCEPTED** | Earlier accepted Z-Image/Wan provider evidence and the prior E2E V1 closure | Historical evidence only; do not reopen or regenerate solely for tests |
| **EXPERIMENTAL** | `experimental/wan2.2-i2v-v1/`, `experimental/wan2.2-sageattention/`, and endpoint `o54nlat1w78954` | Excluded from production; no root cause is asserted |
| **EXCLUDED** | Talking-head/lip-sync; live publishing; paid generation during this subphase | Out of scope for Production Editing V2 |
| **INVALID-LINEAGE** | `output/canonical-wan/scene-001..003` and the prior multi-scene Editing V2 render/E2E V1 media when derived from FLUX | Must not be used as quality-gate input for the current Z-Image Turbo → Wan production path |

The FLUX-derived scene files may remain available for historical comparison and isolated transition fixtures. Their presence does not make them current production evidence.

### Accepted technical and human gates

| Gate | State | Evidence |
|---|---|---|
| E2E V1 human final | PASS | [`docs/demos/e2e-v1-closure.md`](demos/e2e-v1-closure.md), canonical final artifact under `output/final/` |
| Z-Image Turbo public endpoint | PASS technical + visual | Provider `runpod-zimage`, model `z-image-turbo`; canonical `output/visual-benchmarks/cairo-street-realism-zimage-live-v1.png`; SHA256 `E50BC449E30667E00F89A4BC5D291C0B670663345369A0999548B4C6AF89A356` |
| Wan production I2V | PASS technical + human realism | Endpoint `ry49lc45y50ldy`; one attempt; job `57cd504d-e0dc-49ae-ba9a-6ad8c3265cde-e1`; accepted MP4 `output/wan-single-scene-single-scene-1787942858498.mp4`; SHA256 `620CC3D1039CDB8189BCAA82EC26C77AFC1CF80A0FADC16CCA71F6CC2FA77C6B`; 1,136,773 bytes; H.264 480x832, 32 FPS, 5.032s, no audio |
| Wan evidence | PASS | `output/wan-evidence/single-scene-1787942858498.json` and `output/wan-first-frame-single-scene-1787942858498.png` |
| Runtime / integration tests | PASS | Mocked integration 169/169; runtime 45/45; `git diff --check` PASS at the accepted checkpoint |
| Production Editing V2 technical gate | PASS | `output/production-editing-v2/canonical-production-editing-v2.mp4` SHA256 `c10065fe1b231a554df6f252126a600f903c2a74a0df31cfa62a2de44f8d5957`; evidence `canonical-production-editing-v2-evidence.json`; current input is the accepted single-scene Wan artifact only; no provider call |
| Production Editing V2 human gate | PASS | User-approved visual/audio review on 2026-08-29; approval covers the edited artifact, captions, branding, bounds, and absence of obvious clipping. The synthetic audio proxy does not prove semantic narration quality. |

### Accepted decisions

- The production Wan endpoint is `ry49lc45y50ldy`. Experimental `o54nlat1w78954` is excluded from production; no cache root cause is asserted.
- The single-scene production runner is `run-wan-single-scene.mjs`.
- `video-agent → video.generate` authorization is least-privilege and fixed.
- `imageBase64` propagation through `VideoGenerationCapabilityExecutor` is fixed and covered by mocked integration behavior.
- `VOICETUT_EGYPTIAN = ACCEPTED`: VoiceTuT remains the accepted Egyptian-first voice/model decision. Historical evidence includes a valid `Mohamed` short WAV from endpoint `g5xcgmqb2by58y` using the v3-era deployment path.
- `VOICETUT_RUNTIME_HEALTH = BLOCKED`: current RunPod worker readiness is blocked before container startup.
- `VOICETUT_FAILURE_STAGE = CONTAINER_IMAGE_PULL`.
- `VOICETUT_CURRENT_ROOT_CAUSE = REGISTRY_IMAGE_PULL_RATE_LIMIT`: RunPod worker logs report `failed to pull image: toomanyrequests` while downloading container layers.
- `media.compose` uses local FFmpeg; `timeline.plan` and the timeline executor are deterministic, provider-agnostic orchestration surfaces.
- Talking-head and lip-sync are out of scope for the current production path.
- No paid provider generation is part of Production Editing V2 implementation or tests. Canonical/local fixtures are mandatory.
- The canonical Editing V2 run uses `scripts/run-production-editing-v2-quality-gate.mjs`, the accepted Wan MP4 above, and local synthetic audio fixtures only. Its synthetic audio is a bounded mix/codec fixture, not semantically aligned narration; the user-approved human gate does not infer narration quality from it. VoiceTuT remains the accepted path for a later semantically aligned content package.

## Implementation Reconciliation

| Epic / capability | State | Repository evidence | Next gate |
|---|---|---|---|
| Foundation | SUBSTANTIALLY IMPLEMENTED | typed capabilities, authorization, registry, persistence, evidence, runtime/workflow packages | keep regression coverage; close remaining prompt/registry wiring backlog only when needed |
| Research | PARTIAL | research agent/package, workflow and schemas exist | prove one evidence-backed topic through content workflow |
| Content | PARTIAL | writer/SEO/brand/thumbnail/video agents, `timeline.plan`, image/video adapters, `timeline-executor`, `media.compose` | Production Editing V2 acceptance; then one publishable multi-scene content package |
| Publishing | PARTIAL / NOT LIVE | publisher capability, YouTube adapter, stores and idempotency tests exist | approval + evidence + one-platform dry run, then explicit human approval for any live publish |
| Analytics | PARTIAL | analytics capability/adapter and stores exist | ingest metrics keyed by `content_id` and published destination |
| Business / Finance | NOT CLOSED | agents/contracts and cost/revenue concepts exist | close the attributed First-Dollar loop; do not claim revenue or ROI before live evidence |

## Agent and business-chain status

Implemented or structurally present: Orchestrator, Research, Writer, SEO, Brand, Thumbnail, Video, Director/Timeline, Media/Composer, Publisher, Analytics, CEO, Growth, and Finance contracts/packages. “Present” is not “proven autonomous.” The following chain remains open:

`content_id → generation costs/provider jobs → publishing destination → platform metrics → revenue → ROI → learning feedback`

- `content_id`: workflow/correlation/artifact lineage exists, but a single canonical business ledger key must be enforced across all stages.
- Generation costs/provider jobs: provider evidence and job IDs exist in media execution paths; normalized cost recording is incomplete.
- Publishing destination: capability, YouTube adapter, session store, and idempotency exist; no accepted live publication is recorded in this state.
- Platform metrics: analytics surfaces exist; production ingestion and durable linkage to published IDs are not proven.
- Revenue: attribution fields/contracts exist conceptually; no verified revenue event is recorded here.
- ROI: requires the preceding cost and revenue facts; not claimable yet.
- Learning feedback: CEO/Growth/knowledge contracts exist; a measured experiment loop is not closed.

### Full Content E2E V2 text-agent preflight (2026-08-29)

| Stage | Result | Evidence / limitation |
|---|---|---|
| Research | PARTIAL — reused real research artifact | Workflow `wf-content-e2e-v2-1787961083050`; current Free Router retry did not satisfy the research schema, so the latest completed evidence-backed research report was reused. No new trend claim is made from the failed retry. |
| Writer | LOCAL FALLBACK | Free Router response failed the governed writer schema; no paid provider fallback was used. |
| SEO | API PASS (trial) | OpenRouter Free Router selected `liquid/lfm-2.5-2.6b:free`; reported cost `0`; provider metadata persisted in the workflow artifact. |
| Brand | API PASS (trial) | OpenRouter Free Router selected `nvidia/nemotron-3-super-120b-a12b:free`; reported cost `0`; provider metadata persisted in the workflow artifact. |
| Review / QA | LOCAL FALLBACK | Free Router-backed chain was not schema-complete, so deterministic local validation completed the preflight without claiming API-agent proof. |
| Media / VoiceTuT / publish / analytics | NOT RUN | This trial was text-agent-only. No image/video generation, VoiceTuT call, external publish, or analytics side effect occurred. |

Overall status: **PARTIAL / PRE-MEDIA**, not Full Content E2E V2 PASS. The persisted run report is `output/e2e-v2/content-agents-api-wf-content-e2e-v2-1787961083050.json`. The next honest step is to repair/validate the text-agent schema path or proceed with the saved research plus local content package, then stop for the separately required VoiceTuT/provider approval before any paid media or voice call.

### VoiceTuT runtime regression investigation (2026-08-29)

The voice-comparison and long-text experiments are stopped. The configured endpoint matches the historical endpoint ID `g5xcgmqb2by58y`; `RUNPOD_BASE_URL` is `https://api.runpod.ai/v2`; no default speaker override is configured, so the adapter default remains `Mohamed`; and the request/handler contract is `{ input: { text, voice, format: "wav" } }` with `/run` followed by `/status/{jobId}` polling. The repository’s known-good v3 build is recorded at commit `7a151a3`, with image tags `ghcr.io/muhfares/voicetut-tts:latest` and `:v3`, torch 2.6/CUDA 12.4, pre-downloaded model weights, and build-time synthesis gates. A deployed digest, RunPod console configuration, and worker logs are not present in the repository.

Read-only endpoint health during this investigation returned HTTP 200 with `completed: 1, failed: 7, inProgress: 0, inQueue: 0` and all worker counts at zero (`ready: 0, running: 0, initializing: 0, unhealthy: 0`). New RunPod worker logs conclusively identify the stage as `CONTAINER_IMAGE_PULL`: `failed to pull image: toomanyrequests`. The registry rate limit occurs while downloading image layers, before container startup, before `handler.py`, and before model loading or inference. Therefore the observed `Mohamed` HTTP 404, `Asmaa` queue/cancellation, and prior client timeout must not be attributed to voice selection, model inference, request contract, or TTS latency; they are downstream symptoms/observations of an unavailable worker path, with their exact data-plane boundary not further inferred. The historical WAV was valid (606,764 bytes, 12.6s, prior request latency 26,647ms). Read-only RunPod control-plane metadata lookup returned HTTP 401, and anonymous GHCR manifest access for `v3` returned HTTP 401, so the deployed image reference, digest, and registry-auth attachment remain unverified from this environment; no credentials were printed.

No `Sayed`, `Ahmed`, or `Hanan` requests were submitted after the investigation rule was applied, and no long-text request will be retried. No default voice was changed. First restore a successful pull and worker readiness for the historically known `ghcr.io/muhfares/voicetut-tts:v3` reference (including registry authentication/configuration) without changing the image/model unless evidence requires it. Once a worker is healthy/ready, stop and request approval for exactly one very short `Mohamed` smoke using the historical request shape; do not perform it automatically.

The one subsequently approved short `Mohamed` smoke was sent only after health reported `ready: 1, idle: 1`, with poll retries disabled and a 120s client maximum wait. It did not return a WAV and ended at the client timeout. Post-request health showed `inQueue: 1`, `initializing: 1`, `ready: 0`, `running: 0`, and `retried: 0`; this is not evidence of voice failure or measured TTS inference latency, and no retry was issued. The validation remains inconclusive until RunPod worker logs show whether the queued job was later accepted, cancelled, or failed.

### VoiceTuT container distribution stabilization — Phase A blocked (2026-08-29)

Target objective: mirror the exact existing source image `ghcr.io/muhfares/voicetut-tts:v3` (known source digest `sha256:2b9b0d987c98a03cda78f90ebc462e5d2927c18af230f9f6a980455dda00ede8`) into the existing `registry.runpod.net` registry, then switch only endpoint `g5xcgmqb2by58y` to the verified target reference and validate cold-start readiness. No copy, rebuild, endpoint mutation, worker churn, or TTS/inference call was performed in this phase.

Inspection found the original build/push workflow at `.github/workflows/build-voicetut-tts.yml`: it builds the existing Dockerfile and pushes GHCR tags `latest` and `v3`; it is not an OCI mirror workflow. No repository OCI copy mechanism exists. The execution host has no `skopeo`, `crane`, `oras`, `docker`, `podman`, or `runpodctl`. The local environment exposes no secure target-registry credential or registry namespace/path, and the RunPod control-plane metadata lookup returned HTTP 401. Therefore the exact `registry.runpod.net` image reference, target digest, registry-auth attachment, and endpoint image switch cannot be verified or safely performed here. The GHCR source remains unchanged and the RunPod endpoint remains unchanged.

Formal phase status: `VOICETUT_CONTAINER_DISTRIBUTION = BLOCKED`; `VOICETUT_CONTAINER_IMAGE_PULL = BLOCKED`; `VOICETUT_WORKER_READINESS = BLOCKED`; `VOICETUT_EGYPTIAN = ACCEPTED`; `VOICETUT_RUNTIME_HEALTH = BLOCKED`; `VOICETUT_FAILURE_STAGE = CONTAINER_IMAGE_PULL`; `VOICETUT_INFERENCE = NOT_REACHED`. Minimal unblock: provide an approved secure execution path with access to the existing `registry.runpod.net` registry authentication and the endpoint’s actual target namespace/reference (or enable a RunPod/GitHub Actions registry-copy workflow without exposing credentials). After target verification and endpoint switch, perform one cold-start-only validation; do not run TTS until separately approved.

### Phase B-unblock preparation — GitHub Actions OCI mirror (2026-08-29)

Prepared, but did not execute, `.github/workflows/mirror-voicetut-v3-to-runpod.yml`. It uses `crane copy` on the existing image reference/digest; it does not invoke Docker build, the Dockerfile, a provider, a worker, or TTS. The workflow requires the exact RunPod repository path as a manual `workflow_dispatch` input, so it does not guess or hardcode a namespace. It verifies that `ghcr.io/muhfares/voicetut-tts:v3` resolves to the approved source digest before copying, then compares source/target manifest identity (index manifest digests, or config and layer digests) after the copy.

The workflow expects these GitHub Actions Secrets only: `GHCR_READ_USERNAME`, `GHCR_READ_TOKEN`, `RUNPOD_REGISTRY_USERNAME`, and `RUNPOD_REGISTRY_PASSWORD`. Secret values are never echoed or written to artifacts. The non-secret RunPod values still required from the RunPod UI are: the registry host (expected `registry.runpod.net`), the exact repository/namespace path under that host, and confirmation that the existing registry credential entry named `registry.runpod.net` is the credential selected for that registry. In RunPod, inspect **Settings → Container Registries** (entry name/registry host, username metadata if shown, and credential status) and **Serverless → endpoint `g5xcgmqb2by58y` → Edit/Configuration → Container Image and Container Registry Credentials** (image field, selected registry credential, worker/scaling settings). Do not paste the password/token into chat.

The workflow was not dispatched because the target path and required GitHub Secrets are not verifiably available in this execution environment. No target image, target digest, endpoint switch, cold-start validation, or worker start is claimed. Exact next user action: confirm the non-secret target repository path from those RunPod screens and create the four named GitHub Secrets in the repository settings; then the workflow can be reviewed before a user-authorized dispatch. Keep TTS inference at zero for this phase.

### OpenCode Temp forensic reconciliation — VoiceTuT registry history (2026-08-29)

Read-only review of `C:\Users\mohamed.abdo\AppData\Local\Temp\opencode\ci6.log` and `ci7.log`, repository workflows, and repository history found no prior VoiceTuT login, push, OCI mirror/copy, Docker tag/push, or non-GHCR deployment path targeting `registry.runpod.net`. The only concrete `registry.runpod.net` references in repository history are unrelated Wan experimental base-image references, including `registry.runpod.net/wlsdml1114-generate-video-ksampler-dockerfile:a9247705c`; they do not prove a user-pushable VoiceTuT repository or namespace. The OpenCode OpenAPI snapshots are generic schemas, not account-specific Container Registry Auth metadata. No credential values or sanitized VoiceTuT namespace were recorded.

The CI history clarifies tag lineage. `ci6.log` shows the earlier failed build pushed both GHCR tags `latest` and `v3` at digest `sha256:b200dfe5b3aca969027f9b515561ff135d64d13d4b996884b0bb055a4bf45699`, followed by a failed handler smoke. `ci7.log` shows the accepted build pushed both `ghcr.io/muhfares/voicetut-tts:latest` and `ghcr.io/muhfares/voicetut-tts:v3` at the known accepted digest `sha256:2b9b0d987c98a03cda78f90ebc462e5d2927c18af230f9f6a980455dda00ede8`, with `SMOKE OK: 80684 bytes`. Thus `latest` and `v3` were equivalent at the time of the accepted CI push; `latest` remains mutable, so the pinned `v3`/digest is the safer production reference. No later tag drift was found in the searched evidence.

This forensic result does not change the current runtime diagnosis: the supplied RunPod logs still prove a GHCR layer-pull `TOOMANYREQUESTS` failure before container startup, so the active issue remains container distribution/image pull, not voice selection, request contract, model inference, or TTS latency. No Temp scripts were executed, no registry was contacted, no image operation or endpoint/worker/TTS action occurred, and no provider call was made. Exact RunPod target repository path and secure registry credentials remain unverified; do not infer a target such as `registry.runpod.net/muhfares/voicetut-tts:v3`.

### VoiceTuT new-endpoint runtime smoke — one-shot result (2026-08-29)

The temporary endpoint `fn0r8im79ij4dp` was verified before the smoke with `ready: 1`, `idle: 1`, `running: 0`, `initializing: 0`, and `unhealthy: 0`. The user-provided RunPod evidence identifies its image as `ghcr.io/muhfares/voicetut-tts:v3` at the accepted digest `sha256:2b9b0d987c98a03cda78f90ebc462e5d2927c18af230f9f6a980455dda00ede8`, with the worker ready. The old endpoint `g5xcgmqb2by58y` was not used or modified.

Exactly one VoiceTuT inference request was submitted through the existing `tts-voicetut-smoke-pg.mjs` runner: voice `Mohamed`, format `wav`, short Egyptian Arabic smoke text, with `TTS_POLL_RETRIES=0`. No retry or second request was sent. The request did not produce a WAV; the runner ended after approximately `301.7s` with `Provider job timed out before completion`. No RunPod job ID or terminal provider status was emitted by the runner, so this is recorded as `CLIENT_TIMEOUT / UNRESOLVED_JOB`, not as inference, model-load, handler, voice, or latency failure. No `TOOMANYREQUESTS` was observed in this execution path. The existing historical WAV remains the only valid local VoiceTuT output; no new WAV evidence was created.

Formal status after the one-shot smoke: `VOICETUT_EGYPTIAN = ACCEPTED`; `VOICETUT_V3_IMAGE = PASS`; `VOICETUT_V3_DIGEST = VERIFIED`; `VOICETUT_NEW_ENDPOINT_CONTAINER_START = PASS`; `VOICETUT_NEW_ENDPOINT_WORKER_READINESS = PASS`; `VOICETUT_RUNTIME_HEALTH = BLOCKED`; `VOICETUT_FAILURE_STAGE = CLIENT_TIMEOUT_OR_UNRESOLVED_JOB`. Registry migration remains `DEFERRED / NOT_CURRENTLY_REQUIRED` pending clearer runtime evidence; the old endpoint remains unchanged and the new endpoint is not promoted canonically. No Wan, Z-Image, FLUX, publishing, or AgentRouter calls occurred in this phase.

### New-endpoint worker-exit forensic reconciliation (2026-08-29)

The new endpoint evidence confirms the accepted image was loaded from cache and reached `worker is ready`, but a later worker event reported `worker exited with exit code 1` while the same original job remained `IN_QUEUE`; the RunPod UI temporarily reported that all workers were unhealthy and exiting before processing jobs. No useful container log or Python traceback was available. This proves a worker/process availability failure after at least one readiness event, but it does not prove the exact internal crash point. The best supported classification is `RUNPOD_WORKER_INFRASTRUCTURE`; the more specific container-process/handler/model stage remains `UNKNOWN`.

The v3 startup chain is: Docker `CMD ["python", "-u", "/handler.py"]` → module imports (`torch`, then `runpod`) → `if __name__ == "__main__": runpod.serverless.start({"handler": handler})` → RunPod worker loop → first dispatched job calls `handler(job)` → `get_tts()` lazily imports `voicetut_tts`, logs `Loading VoiceTut-TTS model...`, calls `VoiceTutTTS.from_pretrained(MODEL_ID)`, then logs `VoiceTut-TTS model loaded.`. Therefore model initialization occurs on the first request handled by the worker, not during Python module import and not necessarily before the RunPod `worker is ready` event. The Dockerfile separately performs build-time model load/synthesis and Hugging Face weight download, but those are image-build gates, not runtime worker initialization.

Potential pre-log exit paths visible in the implementation are failure of the `torch` or `runpod` imports, malformed integer environment configuration, failure inside `runpod.serverless.start`, or an external process termination such as OOM/CUDA/runtime failure. `get_tts()` and synthesis are inside the handler `try` block and normally return a structured error with traceback rather than exit the process. The historical `ci7.log` demonstrates the handler path reached model loading and completed synthesis (`Loading VoiceTut-TTS model...`, `VoiceTut-TTS model loaded.`, `SMOKE OK: 80684 bytes`), but it does not establish that the new endpoint’s queued job ever reached a worker.

For the current one-shot smoke, `REQUEST_DISPATCH = NOT_PROVEN` because no job ID or worker/handler log ties the queued request to a worker. `VOICETUT_INFERENCE = NOT_REACHED` is retained: no successful completion or handler inference evidence exists. The current endpoint’s later `ready` display is infrastructure status only and is not model-readiness proof. No additional status request, retry, cancellation, resubmission, or provider call was made during this investigation.

### Existing VoiceTuT job/container lifecycle reconciliation (2026-08-29)

The existing one-shot job is `fe62662d-be8b-4f8c-baa7-f17cfb9bced6-e2`. The newly supplied RunPod lifecycle evidence shows the same accepted v3 image and digest, then `worker is ready`, `create container`, `start container ...: begin`, a second start-initiation line, `stop container 3a49d3c8c0f2961169823b99ad828e5f6401cf414dabcbdc89da419b1108c4c4`, and `remove container`; a separate worker event reported process exit code `1`. These facts establish `IMAGE_PULL = PASS`, `IMAGE_DIGEST = VERIFIED`, `CONTAINER_CREATE = PASS`, `CONTAINER_START_INITIATED = PASS`, `CONTAINER_TERMINATED = YES`, and `PROCESS_EXIT_CODE = 1`.

No local repository or OpenCode Temp evidence gives the suffix `-e2` a defined RunPod meaning. It must not be treated as a proven execution-attempt counter or retry marker. The application/client request count remains exactly one; RunPod internal execution-attempt count is `NOT_PROVEN`. The lifecycle evidence does not prove that the queued job reached the handler, so `HANDLER_ENTRY = NOT_PROVEN`, `MODEL_INITIALIZATION = NOT_REACHED / NOT_PROVEN`, and `INFERENCE = NOT_REACHED` remain unchanged. The evidence-supported classification remains `RUNPOD_WORKER_INFRASTRUCTURE / CONTAINER_PROCESS_LIFECYCLE`, with underlying cause `UNKNOWN`; no cancel, retry, resubmission, or additional request was performed.

### New endpoint CUDA fitness failure — conclusive GPU compatibility evidence (2026-08-29)

New direct RunPod worker logs supersede the earlier `UNKNOWN` underlying cause for this execution path. The accepted image pulled successfully at the verified digest and the worker reached the infrastructure `ready` event, but RunPod assigned `NVIDIA RTX PRO 6000 Blackwell Server Edition MIG 1g.24gb` (`sm_120`). The fitness check reported that the installed PyTorch build supports only `sm_50 sm_60 sm_70 sm_75 sm_80 sm_86 sm_90`, then failed at `cuda_init_check` with `RuntimeError: CUDA initialization failed`; the worker became unhealthy and exited with code `1` before VoiceTuT handler/model/inference execution.

Formal statuses: `VOICETUT_V3_IMAGE_PULL = PASS`; `VOICETUT_V3_DIGEST = VERIFIED`; `GPU_ASSIGNED = NVIDIA RTX PRO 6000 Blackwell Server Edition MIG 1g.24gb`; `GPU_COMPUTE_CAPABILITY = sm_120`; `PYTORCH_SUPPORTED_ARCHITECTURES = sm_50 sm_60 sm_70 sm_75 sm_80 sm_86 sm_90`; `CUDA_FITNESS_CHECK = FAIL`; `WORKER_HEALTH = FAIL`; `WORKER_EXIT_CODE = 1`; `HANDLER_ENTRY = NOT_REACHED`; `MODEL_INITIALIZATION = NOT_REACHED`; `INFERENCE = NOT_REACHED`; `VOICETUT_RUNTIME_HEALTH = BLOCKED_BY_GPU_COMPATIBILITY`; `ROOT_CAUSE = GPU / PYTORCH ARCHITECTURE INCOMPATIBILITY`.

The `worker is ready` event is therefore only RunPod worker readiness, not VoiceTuT model readiness. The safest compatible GPU selection preserves the accepted image and chooses a device whose reported compute capability is in the supported set and has materially more than the documented approximately 3 GB VoiceTuT VRAM requirement. Suitable architecture families include T4 (`sm_75`), A10/A40 (`sm_86`), A100 (`sm_80`), V100 (`sm_70`), and H100 (`sm_90`) when RunPod explicitly reports that capability. Recommended next smoke target: an A10 24 GB-class GPU (`sm_86`) if available, because it preserves the 24 GB capacity without requiring a runtime-stack change. Avoid Blackwell `sm_120` for the existing v3 image.

The existing queued job remains preserved as the single authorized smoke attempt and must not be cancelled or resubmitted automatically. It is not valid evidence for a future GPU-selected smoke; any cancellation before a later approved request is a separate user-authorized state change. No Dockerfile, handler, model, dependency, endpoint, registry, or GPU setting was changed. Image rebuild is not required by the current evidence. Registry migration remains `DEFERRED / NOT_CURRENTLY_REQUIRED`; the image pull and digest were already verified. No provider call occurred during this investigation.

### VoiceTuT compatible-GPU runtime smoke — PASS (2026-08-29)

After the endpoint was moved off the incompatible Blackwell `sm_120` allocation, the current compatible worker was verified by the user as RTX A5000 (`sm_86`). A read-only health check for the new endpoint `fn0r8im79ij4dp` reported `ready: 1`, `idle: 1`, `running: 0`, `initializing: 0`, and `unhealthy: 0`; the health response does not expose GPU type. User-provided RunPod evidence confirms the pulled image `ghcr.io/muhfares/voicetut-tts:v3`, digest `sha256:2b9b0d987c98a03cda78f90ebc462e5d2927c18af230f9f6a980455dda00ede8`, and `worker is ready`. The old endpoint `g5xcgmqb2by58y` was not used or modified.

Exactly one new VoiceTuT request was submitted through the governed existing runner, with automatic polling retries disabled (`TTS_POLL_RETRIES=0`): voice `Mohamed`, format `wav`, text `أهلاً بيك، ده اختبار صوت قصير.`. The RunPod job was `07535fdc-e1c8-485d-9f8f-2ed85d9af75e-e2`; it completed successfully in `20.1s` (`requestLatencyMs: 20115`). Completion timestamp from the persisted result is `2026-08-29T15:06:46.912Z`; the corresponding request-start time is approximately `2026-08-29T15:06:26.797Z` based on the measured latency. The runner completed the handler path and persisted durable, idempotent execution evidence.

Output evidence: `output/tts-benchmark/voicetut-short-mohamed.wav`; `113804` bytes; SHA256 `C454C024D61307D9CC343902690BC1BF25C3ADC617D452083D712999947295B0`; parseable PCM signed 16-bit little-endian WAV; `24000 Hz`, mono; ffprobe duration `2.370s` (runner estimate `2.4s`). No retry occurred, no container-pull error appeared, and no additional TTS request was sent. `VOICETUT_EGYPTIAN = ACCEPTED`; `VOICETUT_V3_IMAGE = PASS`; `VOICETUT_GPU_COMPATIBILITY = PASS`; `VOICETUT_RUNTIME_HEALTH = PASS`; `VOICETUT_REGISTRY_MIGRATION = DEFERRED / NOT_CURRENTLY_REQUIRED`. The prior Blackwell incompatibility remains historical resolved GPU-selection evidence; the old endpoint is not declared healthy or promoted canonically.

## Production Editing V2 scope and acceptance criteria

Build incrementally on the existing `media.compose` and timeline executor. Keep the current video+audio contract backward compatible and provider-agnostic.

1. Captions/subtitles: accept a governed local SRT/ASS fixture, validate its path and timestamps, render it deterministically, and record the caption artifact in evidence. The canonical gate checks Arabic RTL/shaping, explicit wrapping, safe zones, and mobile readability.
2. Governed BGM/SFX: accept allowlisted local audio assets with explicit volume and timing; reject arbitrary FFmpeg arguments and out-of-root paths; preserve narration intelligibility.
3. Transitions and retention editing: support deterministic, bounded scene transitions and an explicit trim/keep plan at the timeline/compose boundary; no unbounded filter graph or hidden auto-editing. The current single-scene gate does not claim multi-scene transition quality; transition tests are separate.
4. Branding/templates: accept a versioned local template/brand spec (safe logo/watermark/title treatment) and preserve vertical output dimensions.
5. Evidence: output hash, dimensions, duration, stream metadata, edit-plan identity, input identities, and warnings must be persisted.
6. Tests: use local fixtures only; focused tests first, then relevant package suites/builds; classify unrelated failures separately.

Not in this subphase: new generation providers, paid calls, talking-head/lip-sync, platform publishing, live analytics, monetization, or a new orchestration service.

## Deferred scope and next roadmap gates

1. **Production Editing V2** — current execution phase; gate is a deterministic, captioned, branded, music/SFX-capable vertical render with retention/transition controls and evidence.
2. **Content E2E V2** — one real multi-scene package using already accepted generation paths, followed by human review; no regeneration of accepted canonical artifacts merely for testing.
3. **Publishing E2E** — one platform, approval gate, idempotency, destination evidence; requires explicit human authorization before a live side effect.
4. **Analytics E2E** — ingest provider-confirmed metrics keyed to `content_id` and published IDs.
5. **CEO/Growth experiments** — one measurable hook/title/thumbnail/editing experiment with a predeclared hypothesis and budget.
6. **Finance / First Dollar** — normalize generation, render, storage, distribution costs; attach verified revenue and compute ROI. The objective is the first positive, evidenced autonomous contribution, not feature count.
7. **Scale** — only after measured economics and a repeatable publish/measure loop.

## Known issues and working rules

### External text-agent data boundary (2026-08-29)

The text-agent workflow keeps Research evidence collection on the configured Research API and routes the language-model portions through the explicit AgentRouter model map. Before any external LLM request, `apps/worker/src/production-executor.ts` sanitizes prompt text for common API keys, bearer tokens, authorization values, passwords, secrets, and provider environment assignments. Secret values are not included in prompts or evidence. Media, TTS, publishing, and analytics remain separate capabilities and are not implicitly sent to AgentRouter.

- Prior independent build failures in unrelated packages and the direct-`ffprobe` PATH/tool failure are known issues; do not attribute them to current edits without evidence.
- Do not use the experimental Wan endpoint. Do not regenerate accepted Z-Image or Wan outputs solely for tests.
- Never print or commit secrets. Never add credentials to evidence or fixtures.
- No commit or push without an explicit user request.
- A live provider call, external publish, or material business/architecture decision requires a separate justification and explicit approval/stop point.
- Every subphase ends with focused tests, relevant suites/builds where practical, `git diff --check`, and a regression-vs-known-failure report.

### Full Content E2E V2 text-agent attempt — BLOCKED (2026-08-29)

Workflow `wf-content-e2e-v2-1788017086964` used content id `content-cairo-everyday-life-v2`. The persisted real research artifact was reused because no Research API credential was available in the execution environment; no new research claim was made. AgentRouter was explicitly selected with the sanitized outbound boundary. Five AgentRouter specialist calls were attempted once each: writer, SEO, brand, review, and QA. Only brand completed with `agentrouter-openai`, model `glm-5.3`, 764 input tokens, 3498 output tokens, and recorded cost `0`; writer, SEO, review, and QA were not accepted and the existing non-strict runner substituted local fallback artifacts. The run report is `output/e2e-v2/content-agents-api-wf-content-e2e-v2-1788017086964.json`.

This is not a Full Content E2E V2 technical pass: the textual chain is `BLOCKED / INVALID_FOR_CANONICAL_MEDIA`, because required specialist outputs were not all produced by the configured AgentRouter path. No VoiceTuT, Z-Image, Wan, FLUX, publishing, analytics, or additional provider calls were made after this failure. The runner was updated with `STRICT_AGENT_ROUTING=true` so future canonical runs fail closed instead of silently creating fallback artifacts; the failed specialist calls must not be retried automatically under the current one-execution budget.

### Full Content E2E V2 agent-output forensic reconciliation — BLOCKED (2026-08-29)

Read-only forensic analysis was performed for the five already-consumed AgentRouter attempts in workflow `wf-content-e2e-v2-1788017086964`; no agent or provider was called during this phase. The persisted workflow report is `output/e2e-v2/content-agents-api-wf-content-e2e-v2-1788017086964.json`, and the corresponding database artifacts contain stage summaries and accepted artifact metadata only. For writer, SEO, review, and QA, no raw AgentRouter response, response hash/identity, parser error, validator error, or provider error was persisted. Their artifact payloads are local-fallback artifacts with no `agentExecution` record. Consequently, the exact rejected response cannot be replayed against its parser and the root cause cannot be honestly classified as provider content, schema mismatch, JSON parsing, markdown fencing, field/enum/missing-field validation, truncation, non-text handling, sanitization corruption, or runner extraction bug. No deterministic parser fix was applied because no rejected raw response or concrete parser defect exists in the evidence.

The accepted brand record contains only `agentExecution` metadata (`agentrouter-openai`, `glm-5.3`, 764 input tokens, 3498 output tokens, cost 0); it does not provide the rejected specialists' raw outputs or prove canonical validity of the full chain. The exact contracts remain documented in the agent implementations: writer requires a completed WriterReport with exact workflow/task identity and research source references; SEO requires a completed SEOReport with keywords, topics, and content structure; review requires a valid ReviewReport/findings/recommendations and must not approve invalid upstream artifacts; QA requires a valid QAReport/testResults and must not treat failed or fallback upstream artifacts as successful.

The proven dependency chain is sequential and non-canonical: writer was not accepted, then the non-strict runner created a local-fallback writer artifact; SEO ran against that fallback and was also not accepted, then another fallback was created; brand completed against the already contaminated upstream context; review ran after that context and was not accepted, then review fallback was created; QA ran after the fallback chain and was not accepted, then QA fallback was created. This proves fallback contamination and downstream invalidity, but it does not prove whether SEO, review, or QA provider responses independently failed their own validators because those responses were not saved. The brand PASS is therefore not sufficient for canonical lineage.

`STRICT_AGENT_ROUTING=true` is now enforced in `apps/worker/e2e/content-agents-api.mjs`: a non-research text-agent failure throws before local fallback creation. This is a deterministic local safety fix, not a relaxation of validation. Future diagnostics should persist sanitized failure category/error metadata and a non-secret response identity at the rejection boundary; raw provider content must not be persisted unless its handling is explicitly safe. No prompt or provider/model routing change was made in this forensic phase.

Formal forensic status: `WRITER_REJECTION = NOT_CLASSIFIABLE_RAW_MISSING`; `SEO_REJECTION = NOT_CLASSIFIABLE_RAW_MISSING`; `REVIEW_REJECTION = NOT_CLASSIFIABLE_RAW_MISSING`; `QA_REJECTION = NOT_CLASSIFIABLE_RAW_MISSING`; `FALLBACK_CANONICAL_LINEAGE = BLOCKED`; `STRICT_AGENT_ROUTING = CONFIRMED`; `FULL_CONTENT_E2E_V2_TEXTUAL_STAGE = BLOCKED`. No retry is justified within this forensic phase. A future controlled retry would require one fresh execution per required specialist (writer, SEO, brand, review, QA) under strict routing, with no automatic regeneration; because the prior brand input was contaminated, brand must be rerun in a fresh canonical workflow rather than reused. No media, research, TTS, publishing, or other provider call occurred during this phase.

### Controlled strict-routing diagnostic run — blocked at writer (2026-08-29)

At the user's request, one fresh text-only diagnostic run was started with `STRICT_AGENT_ROUTING=true` and `REUSE_PERSISTED_RESEARCH=true`. Research was reused from a persisted artifact; no new research call was made. The run stopped at the first writer failure with `text-agent stage failed under strict routing: writer; no local fallback permitted`. No SEO, brand, review, or QA call followed, and no media/provider stage was entered.

The failed `executeAgentStep` result contained only an in-memory error, and the runner throws before writing its final report. No capability execution, artifact, raw response, response hash, HTTP status, parser error, or validator error was persisted for this fresh attempt. Therefore this run proves the failure stage (`writer`) and confirms fallback isolation, but does not prove whether the underlying cause was authorization, provider content, JSON/schema validation, or another AgentRouter failure. This is an observability gap in the local runner/executor, not evidence of a provider-specific root cause. AgentRouter calls during this diagnostic run: one attempted writer call; no retries. Full Content E2E V2 remains `BLOCKED` and no media call is authorized by this result.

The runner was then given a minimal diagnostic-output fix: under strict routing it writes a non-secret `output/e2e-v2/agent-failure-<workflow>-<agent>.json` record containing stage, status, sanitized error text, retryability, and explicit flags that raw response was not persisted and no fallback was created. It does not store provider response bodies or credentials. Build and worker tests passed after this change. A follow-up writer retry was not executed because the current forensic authorization still prohibits retries and the user acknowledgement did not explicitly authorize the external AgentRouter egress; no additional provider call occurred after the one failed writer attempt.

The persisted-research selector was corrected to require a completed report with `reportId`, `summary`, a non-empty `sources` array, and JSON structure before reuse. The latest previously selected records were metadata-only wrappers (`agent`, `reportId`, `workflowId`, `executionMode`, `sourceArtifactId`) and therefore are now correctly rejected as malformed. No valid persisted research report is currently available in the database after applying this guard; no source or fallback was fabricated. Build and worker tests remained passing. A full workflow invocation was not run after this change because the execution environment blocked the command as potentially capable of external AgentRouter egress; consequently no additional provider call occurred.

### Real Research attempt after routing correction — blocked by AgentRouter billing (2026-08-29)

The user authorized a real Research run. The first attempt used the default provider selection and failed before research capability execution because the existing `OPENROUTER_API_KEY` caused the research LLM path to select OpenRouter; OpenRouter returned HTTP 404 stating that the configured free model was unavailable. No valid research report or search evidence was produced.

A second, single controlled attempt explicitly set `TEXT_AGENT_PROVIDER=agentrouter`, with `STRICT_AGENT_ROUTING=true` and no persisted-research reuse. It reached the AgentRouter OpenAI path and returned HTTP 402. The Research Agent failed before its `web.search` capability could execute, so Serper was not called and no real research artifact was created. The sanitized failure record is `output/e2e-v2/agent-failure-wf-content-e2e-v2-1788018522491-research.json`; it contains no credential or raw provider response. No retry was issued. Full Content E2E V2 remains blocked before writer/media stages; no TTS, Z-Image, Wan, FLUX, publishing, or other media call occurred.

### Research routing correction validation — Research PASS, writer blocked (2026-08-29)

The production executor was corrected so the research agent does not select OpenRouter/AgentRouter for its initial report synthesis. It now uses the configured real web-search capability first, while writer, SEO, brand, review, and QA remain on AgentRouter. The corrected controlled run created workflow `wf-content-e2e-v2-1788018875660`: `web.search` completed successfully through `serper` with 5 real results, and the persisted research artifact contains 5 grounded sources plus provider evidence. This confirms the intended Research → Serper routing.

The same run then reached the writer stage, which selected the configured AgentRouter Anthropic route (`claude-opus-5`) and failed with HTTP 402. Strict routing stopped the workflow before SEO, brand, review, or QA; no fallback was created. The sanitized writer failure record is `output/e2e-v2/agent-failure-wf-content-e2e-v2-1788018875660-writer.json`. No TTS, Z-Image, Wan, FLUX, publishing, or analytics call occurred. `FULL_CONTENT_E2E_V2_TEXTUAL_STAGE` remains `BLOCKED_BY_AGENTROUTER_BILLING`; Research routing is now `PASS`, but the downstream text gate cannot continue until AgentRouter billing/availability is restored.

After the user confirmed additional account balance, one further controlled test was run with the same corrected routing. Research again succeeded through Serper, while writer again failed on the AgentRouter Anthropic route with HTTP 402; strict routing stopped before all downstream agents. This repeated result shows the issue is not the Research provider or the former OpenRouter model-selection path. Temp and git-history inspection found no verified implementation or prior evidence for separate per-agent AgentRouter tokens; the repository currently exposes one OpenAI credential and one Anthropic credential, and `AGENT_ROUTER_MODELS` maps agents to models only. No token split was invented or hardcoded. The latest failure record is `output/e2e-v2/agent-failure-wf-content-e2e-v2-1788019342343-writer.json`. No retries beyond this controlled test and no media/provider calls occurred.

### AgentRouter deepseek transport diagnostic — PASS (2026-08-29)

A bounded diagnostic tested model `deepseek-v4-flash` once through each supported AgentRouter transport, using the configured base URLs, the OpenAI Bearer header or Anthropic `x-api-key` header as appropriate, and `User-Agent: opencode/1.0`. Both returned HTTP 200 with a valid short `OK` response. No workflow, research, writer, or media stage was executed by this diagnostic. This proves the token, base URL, client identification, and both transport paths are currently accepted for this model; it does not prove that `claude-opus-5` is funded/available or that every AgentRouter model shares the same quota state. No credentials or response secrets were persisted.

### AgentRouter all-model transport smoke — 2026-08-29

A fast, minimal smoke tested each configured AgentRouter model once through both OpenAI-compatible and Anthropic-compatible transports, with no workflow or project content and no retries. Results: `deepseek-v4-flash` returned `200/200`; `glm-5.3` returned `200/200`; `claude-opus-4-8` returned `402/402`; `claude-opus-5` returned `402/402`; and `gpt-5.6-sol` returned `402/402`. The 402 responses explicitly reported `Budget pool quota has been exhausted`; the same result across both transports rules out a transport-specific header/path failure for those models. This is direct evidence of model/budget-pool availability, not proof of token-per-agent support. No workflow, Research, TTS, Z-Image, Wan, FLUX, publishing, or analytics call occurred.

### Available-model text-flow attempt — blocked at Writer (2026-08-29)

For the controlled content flow, AgentRouter model routing was temporarily distributed only across models that passed the transport smoke: writer/brand/QA → `deepseek-v4-flash`; SEO/review → `glm-5.3`; Research remained on the real Serper capability. Build and worker tests passed before execution. Research completed with real Serper evidence, then Writer ran once through AgentRouter and was rejected by its deterministic contract validator: `Invalid writer response: task description does not match the assigned task`. Strict routing created no fallback and stopped before SEO, brand, review, or QA. No TTS, Z-Image, Wan, FLUX, publishing, or analytics call occurred.

This is now a concrete Writer output-contract mismatch (exact `taskDescription` value), not a 402/quota, endpoint, header, or authentication failure. No validator was weakened and no automatic retry was issued. The temporary model distribution remains recorded in code for the next explicitly controlled run; `FULL_CONTENT_E2E_V2_TEXTUAL_STAGE` remains `BLOCKED_AT_WRITER`.

## Definition of Done for this handoff

- This document and links are sufficient for a new session to understand current state without chat history.
- Accepted/rejected decisions and canonical artifacts are explicit.
- Production Editing V2 has a backward-compatible contract, local-fixture tests, and verified output evidence.
- Roadmap claims distinguish implemented, partial, not started, and not proven.
- The First-Dollar loop remains an explicit business gate rather than an implied technical success.

## Full Content E2E V2 canonical gate — technical result (2026-08-29)

Canonical content item `content-cairo-everyday-life-v2` completed the textual and media pipeline without fallback artifacts. Research used the configured Serper capability (5 sources); Writer, SEO, Brand, Review, and QA each completed through `agentrouter-openai` with `deepseek-v4-flash`. AgentRouter calls in this successful textual workflow: 5. The exact Egyptian-Arabic script is persisted in `output/full-content-e2e-v2/content-cairo-everyday-life-v2/content-e2e-v2-evidence.json`.

VoiceTuT used endpoint `fn0r8im79ij4dp`, voice `Mohamed`, WAV, one request and zero retries. Job `deba0a05-db91-4b9c-a6a0-b24c0313e8db-e2` completed in approximately 20.3s; output `output/tts-benchmark/voicetut-short-mohamed.wav` is 767084 bytes and approximately 15.98s.

Timeline `timeline-1625728a9ceb` used the exact narration duration (15980ms), 5 semantic scenes, and `deterministic-v2`. The timeline planner now accepts `visualStyle` as an input and includes it in deterministic timeline identity, preventing collisions between differently directed plans. Media workflow `wf-timeline-exec-1788022941735` completed 5 current `runpod-zimage` image calls and 5 production Wan calls through endpoint `ry49lc45y50ldy`; DB evidence confirms the image provider was `runpod-zimage` despite the historical runner's legacy `fluxImages` counter label. FLUX calls: 0. Experimental Wan calls: 0.

Production Editing V2 then used the new multi-scene MP4 plus the real VoiceTuT WAV, generated timeline-derived Arabic RTL ASS captions with safe margins, applied AMF watermarking, and omitted the tone fixture/BGM to preserve narration clarity. Final artifact: `output/full-content-e2e-v2/content-cairo-everyday-life-v2/editing/content-cairo-everyday-life-v2-final-edited.mp4`, 1391913 bytes, SHA256 `bc83b7f2d2a8b5fe6fc7f2bc22c2243b130f6d6f5728dd881f84f18d7b100b8e`, 15980ms, 480x832, H.264/AAC, 24kHz mono. Editing evidence is adjacent at `content-cairo-everyday-life-v2-editing-evidence.json`.

Historical snapshot before the user’s visual review: `FULL_CONTENT_E2E_V2_TECHNICAL = PASS`; `FULL_CONTENT_E2E_V2_HUMAN = PENDING_USER_REVIEW`. The subsequent authoritative review rejected the artifact; see the hardening section below. Publishing, analytics, revenue attribution, ROI, and First-Dollar remain not run.

## Full Content E2E V2 visual-direction hardening (2026-08-29)

The first canonical Full Content E2E V2 artifact is retained as historical failed-quality evidence only. The authoritative human result is now `FULL_CONTENT_E2E_V2_TECHNICAL = PASS` and `FULL_CONTENT_E2E_V2_HUMAN = REJECTED_FOR_REGENERATION`; publishing is `BLOCKED`, analytics and revenue are `NOT_STARTED`. Rejection categories are `CAPTION_CONTAMINATION`, `CAIRO_IDENTITY_FAILURE`, `SEMANTIC_ALIGNMENT_FAILURE`, `VISUAL_PROMPT_CONTAMINATION`, and `COLLAGE_ARTIFACTS`.

The root source of the technology/workspace contamination was the deterministic timeline planner, not Wan: `packages/tool-framework/src/timeline/timeline-planner.ts` contained a `generic_technology` fallback concept, a generic `modern workspace with subtle technology elements` concept prompt, and a technology-creator host default. The planner now creates a scene-level `SceneVisualBrief` for Cairo/Egypt-directed content and uses it as the authoritative image, negative, and motion prompt source. It suppresses the generic host for location-sensitive Cairo scenes and includes the brief in the persisted timeline artifact. `visualStyle` remains part of deterministic timeline identity.

The new contract is implemented in `packages/tool-framework/src/timeline/visual-brief.ts`. Each brief preserves the exact narration segment and contains semantic subject, action, location, environment, people, wardrobe, objects, transport, architecture, time, lighting, camera, composition, motion, Cairo grounding cues, required/forbidden elements, text policy, and single-shot policy. The reusable local grounding artifact is `docs/e2e-v2/cairo-visual-grounding-v2.md`; it is a conservative visual baseline, not a claim of fresh 2026 external visual research. No provider was called in this hardening phase.

Generated imagery now has an explicit text-free policy: external ASS is the sole caption layer; readable letters, words, captions, subtitles, logos, watermarks, UI text, numbers, and foreground readable signage are forbidden. The pre-Wan gate is wired into `packages/timeline-executor/src/timeline-executor.ts` behind `enforcePreWanImageGate`; it runs before `video.generate` and fails closed when no local inspection decision exists. The local implementation accepts deterministic text/collage/duplicate-subject signals and blocks material signals, but reliable local OCR and pixel-layout inspection are not installed, so an unscored image is `HUMAN_REVIEW_REQUIRED` and cannot enter Wan. This does not claim perfect OCR or production-grade collage detection.

The five current Cairo scene briefs were reconstructed locally from the accepted narration and saved at `output/full-content-e2e-v2/content-cairo-everyday-life-v2/visual-direction-v2/visual-briefs.json`. They are review/planning artifacts only; `regenerationAuthorized = false`. Existing failed scenes are reusable: `NONE`, because each must satisfy the new semantic, Cairo, text-free, and single-shot gates before reuse. If approved, the controlled plan is at most 5 Z-Image calls (one per scene), with each source inspected before at most 5 corresponding production Wan calls; a blocked source stops its scene and no automatic retry is allowed.

Focused regression coverage is in `packages/tool-framework/test/visual-brief.test.js`; it covers planner contamination, Cairo context, forbidden wardrobe/technology, text-free prompts, scene lineage, single-shot policy, and fail-closed pre-Wan behavior. No AgentRouter, Research, VoiceTuT, Z-Image, Wan, FLUX, publishing, or other provider calls occurred in this phase. The next state is `READY_FOR_VISUAL_BRIEF_REVIEW`, not ready for regeneration until the five briefs are approved.

## Controlled Z-Image V2 regeneration attempt (2026-08-29)

The five Visual Direction V2 briefs were human-approved, but the controlled image-only regeneration was blocked locally before any RunPod HTTP/provider invocation. Five governed capability attempts were made, exactly one for each scene, with zero retries. Each was rejected by the existing image capability policy because the approved verbatim prompt exceeded the configured 1000-character prompt limit. No prompt was silently shortened or rewritten.

`Z_IMAGE_V2_REGENERATION = FAILED_PRE_PROVIDER_VALIDATION`; successful images: 0; generated Z-Image provider calls: 0; `WAN_REGENERATION = NOT_AUTHORIZED`; Wan calls: 0. No source image can enter the pre-Wan gate, and no contact sheet was created. The approved artifact remains unchanged; the failed historical E2E media remains untouched. The exact per-scene attempt evidence is `output/full-content-e2e-v2/content-cairo-everyday-life-v2/visual-direction-v2/z-image-regeneration/evidence.json`.

The next required decision is a local contract correction that preserves the approved prompt content while allowing the existing governed image capability to accept it, such as a justified prompt-length policy adjustment or deterministic structured prompt transport. No automatic retry is authorized.

## Controlled Z-Image V2 regeneration attempt 2 (2026-08-29)

The local prompt transport correction passed validation and the newly authorized image-only gate completed exactly five canonical `runpod-zimage` / `z-image-turbo` provider invocations, one per approved scene, with zero retries and zero failures. The approved prompts were transported intact: each pre-validation prompt length/hash matches the prompt observed immediately before the adapter invocation. The scoped Z-Image policy is 4000 characters by default, configurable through `RUNPOD_ZIMAGE_MAX_PROMPT_LENGTH` with an 8192-character safety ceiling; other image providers retain their existing policy behavior.

The five new source images are isolated under `output/full-content-e2e-v2/content-cairo-everyday-life-v2/visual-direction-v2/z-image-regeneration/attempt-2/`. Durable evidence is `evidence.json`, and the human-review contact sheet is `contact-sheet.html`. Each result is 768x1024 PNG, provider-reported cost is 0.005 each (available total: 0.025), and each local pre-Wan result is `HUMAN_REVIEW_REQUIRED` with `canEnterWan = false` because local OCR/layout inspection is unavailable. No image was auto-approved.

Provider counts for this attempt: Z-Image provider invocations = 5; Wan = 0; VoiceTuT = 0; AgentRouter = 0; Research = 0; FLUX = 0; Publishing = 0. `WAN_REGENERATION = NOT_AUTHORIZED`, `HUMAN_PRE_WAN_GATE = PENDING_USER_REVIEW`, and `FULL_CONTENT_E2E_V2_HUMAN = REJECTED_FOR_REGENERATION` remain unchanged. No new final video was composed and no historical media was overwritten. The next action is human visual inspection of the five source images; Wan must remain stopped until explicit approval.

## VISUAL CAPABILITY BENCHMARK V1 — LIVE COMPLETION (2026-08-30)

Final phase status: **PARTIAL / I2I BLOCKED_BY_ENVIRONMENT**. Historical and canonical artifacts remain unchanged. The current RunPod Z-Image adapter requires an externally reachable `http(s)` reference URL for I2I and has no supported local-file, data-URL, or base64 reference transport. The benchmark runner had incorrectly coupled that I2I gate to the whole benchmark and bypassed the capability/executor path. It now separates T2I from I2I: T2I sends no reference and runs through `RuntimeCapabilityExecutor → image.generate → RunPodZImageAdapter → /runsync`. No security boundary was changed and no arbitrary external upload was used.

The user-owned manual source `output/test for wan.png` was sent exactly once through production Wan endpoint `ry49lc45y50ldy`, job `397f35b4-16a7-465a-a5cf-15d11c1fdb23-e2`, with zero retries. Output evidence is `output/visual-capability-benchmark-v1/manual-source-wan-i2v-evidence.json`; MP4 SHA256 is `1df348cb86a2f031825502eb257065f68bdfe36b33dcb1e9b33a9339b4f337a8`. `MANUAL_SOURCE_I2V_TECHNICAL_QA=PASS`: H.264, 480x832, 32fps, 5.03125s. `MANUAL_SOURCE_I2V_AUTOMATED_SEMANTIC_GATE=HUMAN_REVIEW_REQUIRED` because the multimodal Reviewer/QA gate was unavailable. The available human review confirms material change in the person's facial features and appearance: `MANUAL_SOURCE_I2V_HUMAN_REVIEW=REJECTED`, `WAN_MANUAL_SOURCE_IDENTITY_PRESERVATION=FAIL`, `WAN_MANUAL_SOURCE_SEMANTIC_VERDICT=REJECTED_FOR_IDENTITY_DRIFT`, and `WAN_MANUAL_SOURCE_PRODUCTION_CANDIDATE=NO`. `BEST_ZIMAGE_I2V=PENDING_HUMAN_APPROVAL`; no second Wan call was made. Wan still remains `NOT_PROVEN` with zero calls.

Phase limits: Z-Image T2I 4/4, Z-Image I2I 3/3, Wan I2V 1/2, Wan still 0/0, retries 0; FLUX, VoiceTuT, experimental Wan, AgentRouter content generation, publishing, and Full E2E were all 0/not run. The four T2I outputs have user `HUMAN_PASS`; automated Reviewer and QA remain `HUMAN_REVIEW_REQUIRED`. The capability transport bug that dropped `referenceImageUrl` was fixed and tested. The external CNN location/style reference was resolved successfully and the three I2I outputs for strengths `0.35`, `0.55`, and `0.75` completed at `0.005` each; user human review rejected all three because the Cairo Tower and skyline/location composition were not preserved and a different tower/landmark was substituted. Evidence is `output/visual-capability-benchmark-v1/z-image-i2i-cnn-evidence.json` and contact sheet is `output/visual-capability-benchmark-v1/z-image-i2i-cnn-contact-sheet.html`. Automated semantic/QA review remains `HUMAN_REVIEW_REQUIRED`. The reference was not an identity benchmark. The second Wan budget unit is preserved and remains gated by human approval. Practical decision and full attempt history are in `docs/visual-capability-benchmark-v1.md`, `docs/visual-capability-benchmark-v1.json`, and `output/visual-capability-benchmark-v1/manifest.json` plus `attempts.json`. No commit or push was performed.

## REFERENCE ASSET TRANSPORT FORENSICS (2026-08-30)

No provider calls were made. The repository has local filesystem/data-URL outputs, artifact metadata/persistence, and a YouTube-only resumable upload path, but no executable object/blob storage integration, public or temporary provider-readable asset URL issuer, signed/presigned URL mechanism, or generic reference-asset resolver. The Z-Image adapter correctly remains URL-only for I2I. Therefore `REFERENCE_ASSET_TRANSPORT=BLOCKED_BY_MISSING_INFRASTRUCTURE`; evidence is `output/visual-capability-benchmark-v1/reference-asset-transport-forensics.json`. Required unblock: approved object/blob storage, runtime identity/secret-manager binding, scoped short-lived read-only URL issuance, allowlisted origin/expiry provenance, and upstream `ReferenceAsset` resolution with tests. No fake localhost server, tunnel, random hosting, or security weakening was used.

## Visual Production Routing V1 — architecture preparation (2026-08-31)

Architecture preparation is complete with no live provider calls. The existing `image.generate` capability, provider registry, Z-Image adapter, FLUX/ComfyUI adapter, visual research/strategy, scene briefs, evidence persistence, and fail-closed Reviewer/QA gate were audited and reused. A provider-agnostic routing contract now separates content domain from capability requirements, records evidence-backed provider profiles without inventing unknown scores, chooses the cheapest eligible automatic provider after hard requirement checks, and escalates to premium, `MANUAL_EXTERNAL_GENERATION`, or `REAL_OR_LICENSED_MEDIA` when appropriate. Manual generation has a request-scoped lifecycle and provenance contract; it does not require a particular website or credentials and cannot bypass Reviewer → QA → human approval.

The prepared `VISUAL_PROVIDER_ROUTING_BENCHMARK_V1` compares Z-Image and FLUX across eight representative domains with 16 proposed future calls (one per provider/case, zero retries). It is not authorized or run. Z-Image/FLUX/Qwen/Gemini/GPT Image/Wan/VoiceTuT/publishing invocations in this phase are all zero; Wan’s remaining budget is untouched. Reference transport remains `BLOCKED_BY_MISSING_INFRASTRUCTURE` until approved object/blob storage and a scoped, short-lived, read-only URL issuer are provided. Details: `docs/visual-production-routing-v1.md` and `.json`.

## Visual Provider Routing Benchmark V1 - Live Round 1 (2026-08-31)

The controlled Z-Image versus FLUX T2I round completed with exactly 12 calls: six `runpod-zimage` and six `self-hosted-image` (FLUX), paired across `PHOTOREAL_PEOPLE`, `SPORTS`, `CINEMATIC`, `PRODUCT`, `CARTOON_2D`, and `STYLIZED_3D`. Common output size was `720x1280` (`9:16`); all 12 passed technical PNG existence, decodability signature, byte-positive, and dimension checks. Retries were zero. Z-Image reported cost `$0.005` per call, known total `$0.030`; FLUX cost is `UNKNOWN` because the current adapter does not report it.

Evidence is `output/visual-provider-routing-benchmark-v1/live-round-1/evidence.json`, with one comparison sheet per domain and a master sheet in the same directory. Automated Reviewer/semantic review is `HUMAN_REVIEW_REQUIRED`; human scores remain `PENDING_HUMAN_REVIEW`; production routing winners were not assigned. Wan remains untouched at `1/2` used, `1/2` remaining; premium image APIs, Qwen API, publishing, and Full E2E were not used. Historical benchmark artifacts remain unchanged.

## Visual Routing V1 - human verdict, FLUX cost model, and GPU research (2026-08-31)

Round 1 human verdict is now persisted in `output/visual-provider-routing-benchmark-v1/live-round-1/evidence.json` and `human-review-manifest.json`: `Z_IMAGE_T2I_GENERAL = PASS` and `FLUX_T2I_GENERAL = PASS`. Current specialization evidence prefers Z-Image for realistic/photorealistic people, realistic cinematic, and product work; Z-Image sports remains a capability candidate because the decisive-pass action was not precise enough. FLUX is preferred for `CARTOON_2D` and `STYLIZED_3D`. Fantasy, anime, illustrative storytelling, reference, location, identity, and consistency are not newly benchmark-proven. No global rejection or simplistic application routing was introduced; production winners remain evidence/policy controlled.

The current FLUX infrastructure inputs are versioned at `configs/pricing/visual-provider-pricing-v1.json` (24GB Pro, `$1.10/GPU-hour`) and `configs/pricing/flux-standard-24gb-endpoint-v1.json` (standard 24GB, `$0.69/GPU-hour`), both sourced as `USER_CONFIRMED_INFRASTRUCTURE_RATE`. The cost function and provenance labels are in `packages/tool-framework/src/visual-capability/cost-accounting.ts`. Round 1 exposes only request latency for FLUX, so its six-image total is an estimate of `$0.03891311` with confidence `ESTIMATED_FROM_REQUEST_LATENCY`; exact billable GPU seconds were not fabricated. Z-Image's known provider-reported total remains `$0.03000000`.

The exact deployed FLUX path remains RunPod Serverless ComfyUI 5.8.7 with `flux1-dev-fp8.safetensors`, batch 1, 20 steps, CFG 1, Euler/simple, and no explicit offload in the repository workflow. Research finds the 24GB Pro is probably not required for VRAM fit, but its performance/stability advantage is unproven. A standard 24GB A5000 is the single recommended future live test candidate; 16GB is plausible only with unproven offload/latency compromises. No endpoint, deployment, or GPU setting was changed. Research: `docs/visual-routing-v1-flux-gpu-right-sizing-research.md`.

The user-created standard-24GB endpoint `7msusuancyl74c` then passed exactly three FLUX workflow calls for people, product, and stylized 3D, with zero OOM and zero retries. RunPod management metadata returned 401, so actual GPU type is recorded as unknown; health showed three ready workers. Evidence is `output/visual-provider-routing-benchmark-v1/gpu-standard-24gb-gate/evidence.json`. The candidate remains `INCONCLUSIVE_PENDING_HUMAN_REVIEW_AND_GPU_IDENTITY`; no endpoint was changed and the Pro endpoint received zero new calls.

Qwen Chat routing is explicitly classified as `MANUAL_EXTERNAL_GENERATION`, not `PREMIUM_API`: provider/API cost `$0`, human intervention required, automation level `MANUAL`, and cost classification `MANUAL_EXTERNAL_ZERO_PROVIDER_COST`. Generic lifecycle and provenance remain unchanged; configuration is `configs/routing/manual-external-qwen-chat-v1.json`. This does not claim zero human/operational cost or Qwen API integration.

## Visual Routing V1 closure (2026-08-31)

The Visual Provider Routing Benchmark V1 and FLUX GPU Right-Sizing V1 are complete with no calls in the finalization phase. Raw Standard 24GB and Pro measurements remain preserved. People is recorded as `FIRST_REQUEST` with `POSSIBLE_COLD_START_CONTAMINATION`, not as a confirmed cold start. Product and Stylized 3D are the current `WARM_LIKE` comparison: Standard `27.333s` average and estimated `$0.005239/image`; Pro `17.430s` average and estimated `$0.005326/image`. Both use `ESTIMATED_FROM_REQUEST_LATENCY`; billable GPU seconds remain unknown. The aggregate three-image comparison remains preserved separately and marked `POTENTIALLY_COLD_START_INFLUENCED`.

The final non-operational decision is `FLUX_24GB_PRO = PRIMARY` because it is materially faster at near-parity estimated cost. `STANDARD_24GB = VALID_FALLBACK_AND_COST_OPTIMIZATION_CANDIDATE`; it completed 3/3 calls with no OOM and the same workflow. No endpoint configuration was changed. Closure evidence: `output/visual-provider-routing-benchmark-v1/flux-gpu-benchmark-finalization.json`.

## Manual External Generation V1 — handoff prepared (2026-08-31)

A provider-agnostic manual generation request is prepared at `output/manual-external-generation-v1/request.json` with status `PENDING_HUMAN_GENERATION`. The human handoff is `output/manual-external-generation-v1/HUMAN-INSTRUCTIONS.md`; the project-controlled inbox is `output/manual-external-generation-v1/inbox/`, expecting `manual-external-generation-v1-001.png`. Qwen Chat is only the selected external-tool metadata: no API integration, scraping, or automation was used. The request uses `providerCostUsd=0`, `costClassification=MANUAL_EXTERNAL_ZERO_PROVIDER_COST`, `humanInterventionRequired=true`, and rights status `UNKNOWN`.

The existing manual lifecycle contract was minimally extended to fail closed through `HUMAN_APPROVAL_REQUIRED` and `READY_FOR_DOWNSTREAM_VIDEO`. This turn stops before asset receipt; no provenance, Reviewer, QA, human approval, Wan, or downstream video result is claimed. The next action is human generation and placement of the asset in the exact inbox path, followed by an explicit ingestion-gate continuation.

## Manual External Generation V1 — ingestion attempt 001 (2026-08-31)

The supplied `manual-external-generation-v1-001.png` was received from the project-controlled inbox and recorded with SHA-256 `6E82CD88827277CB38B8F97F5FDE17624FBBC9328F31392FDD6468F7597E7A87`, PNG format, 2,100,874 bytes, and dimensions `1664x928`. It is decodable and the path is safe, but it is landscape (`1.793:1`) rather than the requested vertical `9:16`; therefore technical QA failed and the request is `REJECTED`. The original asset was not modified. Automated semantic review remains `HUMAN_REVIEW_REQUIRED`, human approval was not reached, and the asset is not ready for downstream video. Evidence: `output/manual-external-generation-v1/evidence/ingestion-evidence.json`.

The corrected submission `1788209066685a.png` is recorded as ingestion attempt 002. It is a valid, decodable PNG at `1536x2688` (`0.5714`, within the configured 2% approximate-9:16 tolerance), with SHA-256 `A60324444C1446E1125B92717E9D6B92C5C6423055EE2DDCE50AE6D5F53D7C32` and 5,072,379 bytes. Technical QA passed and the request is now `HUMAN_APPROVAL_REQUIRED`; automated semantic review remains `HUMAN_REVIEW_REQUIRED`. No downstream readiness or Wan call is claimed. Evidence: `output/manual-external-generation-v1/evidence/ingestion-attempt-002.json`.

The user then approved the second corrected image `1788209474e8c0.png`. Its recorded provenance is SHA-256 `A12B7E235699039F003A9DE1FF12742ED1301EC45181C2108CC75019A7BF77F7`, PNG, 6,225,732 bytes, `1536x2752`, and approximately 9:16. The request is now `READY_FOR_DOWNSTREAM_VIDEO`; this is an approved metadata boundary only. Wan/video generation remains unexecuted and requires a separate authorized phase.

The authorized Manual Asset → Production Wan I2V Gate made exactly one call to production endpoint `ry49lc45y50ldy` using the generic `video.generate` capability and existing Wan adapter. The client timed out after 30.096s before returning a job ID, but this was not a confirmed provider failure: RunPod later reconciled job `9fbc118a-1e68-4593-82ae-c70a086fb208-e1` as `COMPLETED` (queue delay 19.952s, execution 163.054s). The MP4 was retrieved without retry, passed technical video QA, and received HUMAN_APPROVED. Evidence preserves `initialClientResult=TIMEOUT` and `finalRemoteResult=COMPLETED` at `output/manual-external-generation-v1/wan-i2v-gate/wan-i2v-evidence.json`; editing/publishing remain unexecuted.

## Specialized Instagram discovery provider V1

The Apify-maintained `apify/instagram-search-scraper` (`DrF9mzPPEuVizVF4l`) was selected by capability rather than platform-wide replacement. Its official schema documents `search`, `searchType` values `place`, `user`, `hashtag`, and `popular`, plus `searchLimit`. One bounded live run used `search="Egypt travel"`, `searchType="popular"`, and `searchLimit=3`; it returned three actual Instagram video records with stable identities, URLs, creators, timestamps, engagement fields, hashtags, locations and music metadata. Run `a8RMUQT32sLWgUVYV` / dataset `zO15d1YN9GN2cDP9W` reported `$0.0081`; retries and pagination were zero. Evidence: `output/social-intelligence-provider-v1/instagram-specialized-discovery-provider-v1/`.

Current discovery state is `INSTAGRAM_KEYWORD_DISCOVERY=IMPLEMENTED_AND_PROVEN_WITH_POPULAR_MODE` and `INSTAGRAM_REEL_DISCOVERY=IMPLEMENTED_AND_PROVEN_FOR_RETURNED_POPULAR_REELS`. User/profile/hashtag/place modes were not all exercised; generic free-text semantic search, transcripts, multimodal analysis and trend status remain unproven. The previous generic hashtag run remains `INCONCLUSIVE`, and the generic `apify/instagram-scraper` remains the proven direct-reference Actor. No TikTok or other provider calls were made.

## Bright Data Social Intelligence Provider V1

Bright Data is now represented as a second provider-neutral Social Intelligence implementation. Its URL-oriented Instagram adapter supports the documented Reel/Post dataset contract and normalizes returned fields without manufacturing unknown metrics. Capability eligibility is capability-first; Apify remains the proven provider for current Instagram popular-Reels discovery and direct-reference evidence. Bright Data discovery remains partial until a credential-backed product path is validated.

`BRIGHTDATA_API_TOKEN` was missing, so live validation was correctly blocked before any Bright Data request. Official current pricing evidence records 5,000 successful records/month free, `$1.50/1,000` PAYG successful records, no-card free access, spend limits, and no charge for failed delivery as stated on the official product page; rollover and exhausted-tier behavior remain unknown. No Bright Data, Apify, TikTok, YouTube, or generation-provider calls were made in this milestone. Evidence: `output/social-intelligence-provider-v1/bright-data-provider-v1/`.

After the credential became available, one authorized Bright Data Instagram Reels request was attempted against a public reference URL. The provider returned HTTP 400 before delivering a record. This is preserved as `FAILED_PROVIDER_VALIDATION`, not as a successful capability result; retries and fallback were zero, and the root cause remains unproven. Evidence: `output/social-intelligence-provider-v1/bright-data-provider-v1/live-validation-001/`.

### Bright Data final controlled validation V2

The contract diagnostic completed before this run and preserved the prior 400 without rewriting it. One final synchronous Bright Data Reels request then returned one real Instagram record for the same public reference, with stable ID/URL, creator, caption, publication date, likes, and comments. Bright Data direct-reference metadata is now live-proven for the tested dataset and returned fields; transcript and audio metadata remain unproven. The run used exactly one submission, no retry, no pagination, and no Apify fallback. Evidence: `output/social-intelligence-provider-v1/bright-data-provider-v1/live-validation-v2/`. Apify remains eligible as the broader proven direct-reference provider; Bright Data is a redundant eligible path.

### Social Intelligence Research Integration V1

Research Agent now has a provider-neutral social capability router, intentional source strategy, bounded research budget, and explicit provider eligibility. Instagram discovery routes to Apify; direct Instagram Reel/Post reference metadata uses Apify primary with Bright Data as a governed fallback only after a known terminal failure. Timeouts and `SUBMISSION_OUTCOME_UNKNOWN` require reconciliation and never trigger duplicate paid requests. Normalized evidence preserves provider provenance and unknown fields, while trend verdicts remain non-claiming until sufficient multi-observation evidence exists. No live calls were made in this milestone.
### Dual-language narration + editing integration gate — rejected regression (2026-09-01)

The previous English TTS generation remains preserved as technical TTS `PASS`, but its final edit is human `REJECTED` for `NARRATION_CUT_OFF` and `CAPTION_OUT_OF_FRAME`. The old output and evidence were not deleted or rewritten. No female VoiceTuT speaker was defensibly established, so VoiceTuT remained at zero calls and no fallback to `Mohamed` was made.

### Production Editing QA Hardening V1 (2026-09-01)

The local hardening work added provider-agnostic narration-fit validation and measured caption safe-area layout. The approved source Wan MP4 was verified unchanged. For the 480x832/5.031s scene, the default policy reserves a 300ms speech tail and allows only a bounded 1.15x tempo adjustment; material overflow fails as `NARRATION_DURATION_MISMATCH` rather than being silently truncated. The corrected text is `Two friends, a rooftop garden, and a harvest worth sharing.` and its measured English layout wraps into two safe lines inside the configured margins.

The installed Windows FFmpeg `subtitles`/libass path remains blocked by missing Fontconfig configuration; the tested `drawtext` fallback is available, but now must use measured layout evidence rather than an unbounded single line. Arabic shaping/RTL rendering is not proven in this runtime and remains `ARABIC_CAPTION_RENDERING=BLOCKED`. Local hardening evidence is `output/manual-external-generation-v1/production-editing-qa-hardening-v1/qa-hardening-evidence.json`.

The one Groq call consumed in this execution had already produced the previous long narration. To respect the maximum of one new Groq call, no second call was made for the corrected text and no corrected V2 MP4 is claimed. The phase therefore stops before the live corrected gate with `BLOCKED_PROVIDER_BUDGET_AFTER_PRIOR_CALL`; no Wan, VoiceTuT, image, publishing, or downstream editing calls occurred.

## Voice Catalog V1 + dual-voice production editing gate (2026-09-01)

The provider-neutral voice catalog is now persisted in `configs/voices/voice-catalog-v1.json`, with a matching nullable PostgreSQL `voice_catalog` table definition and generic selection contract. Official VoiceTuT model documentation confirms 17 built-in voices, including female `Yasmin`, but the deployed RunPod handler exposes no speaker-list or runtime metadata operation; runtime availability is therefore recorded as unverified. Arabic ASS/libass shaping is also blocked by the missing Fontconfig configuration, so the VoiceTuT candidate was stopped before synthesis. Historical `Mohamed` evidence remains unchanged.

Groq official documentation confirms the six English Orpheus voices. The one authorized new Groq call used `hannah` (non-Troy project test candidate) with the exact text `A little harvest is better when you share the moment.` It produced a 2.960s WAV, which fit the existing 5.031s source under the 300ms speech-tail policy. The corrected English video passed container, audio-duration, caption-layout, and lineage QA and is pending human review at `output/manual-external-generation-v1/voice-catalog-dual-production-gate-v1/`. No Wan, VoiceTuT, image, publishing, or other provider call occurred in this gate.

The first Yasmin attempt remains historical `ENDPOINT_PAUSED` (`HTTP 409`, `max_workers=0`). The current endpoint `fn0r8im79ij4dp` was subsequently verified active using read-only health metadata, and the one authorized retry synthesized successfully. `YASMIN_RUNTIME_SYNTHESIS=PASS` and `YASMIN_RUNTIME_COMPATIBILITY=PASS`; the Arabic final candidate is technically validated and remains `PENDING_HUMAN_FINAL_VIDEO_REVIEW`. No human voice-quality, accent, or production approval is inferred. This retry used exactly one VoiceTuT call; all other provider call counts remained zero.

### Content Intelligence & Reference Ingestion V1

The Research Agent remains an intelligence-only component and keeps its legacy report/web-search interface backward-compatible. New provider-neutral contracts now cover research modes, source capabilities/access modes, normalized evidence, freshness requirements, reference-content analysis, originality constraints, and content-intelligence results. A safe local reference-video ingester validates project-controlled paths, hashes the file, extracts ffprobe metadata, and samples representative frames. Validation of the existing approved Wan MP4 passed locally; transcript extraction and multimodal semantic analysis are explicitly unavailable. YouTube, Instagram, and TikTok remain capability-specific: official YouTube discovery is not yet wired, Instagram arbitrary public research is not claimed, and TikTok access requires approved authenticated APIs; inaccessible social URLs degrade to upload-required behavior. No media-generation or publishing provider was called in this milestone.

### Research Sources V2

The provider-neutral research contracts were preserved and extended with centralized source planning, freshness-gated news evidence normalization, and a read-only `YouTubeResearchAdapter`. The adapter supports bounded YouTube search plus metadata retrieval, URL/video-ID parsing, public metadata/statistics when returned, and official quota accounting (`search.list` plus `videos.list`). No YouTube credential is present in the current environment, so live validation is explicitly `BLOCKED_BY_MISSING_CREDENTIAL` and no research API request was made. Image discovery remains unimplemented pending a dedicated legitimate image-search source; Instagram/TikTok remain honest authenticated/upload fallbacks. No generation or publishing provider was called.

## Full Agent Cycle & Orchestration Audit V1 (2026-09-02)

The actual production entry is `apps/api/src/handler.ts` → PostgreSQL queue → `apps/worker/src/cli.ts` → `WorkflowWorker`/durable Workflow Engine → `createProductionAgentExecutor`. The executable `produce` definition is `research → writer → seo → brand → review → thumbnail → video → qa → publisher → analytics`; the worker injects the provider-neutral Research Source Router and persists artifact/capability lineage when run with PostgreSQL. Planner, Director, Media/Composer, Growth, Finance, and CEO packages exist but are not part of that production chain; legacy non-production steps use a deterministic worker fallback.

The audit records `FULL_AGENT_CYCLE_AUDIT_V1=PARTIAL` and `FULL_CONTENT_PIPELINE_V3=BLOCKED`. Concrete blockers are missing post-research Planner synthesis, missing visual semantic review/QA/human gate before Wan, missing final product review/human publish approval, and missing TTS→measured timeline→Wan→composer wiring in the production definition. The Workflow Engine has durable checkpoints/recovery and approval primitives, but the `produce` graph has no GateStep; bounded Reviewer/QA loop APIs are not connected to it. Growth/Finance/CEO feedback is package/test-level and absent from the worker produce graph; it is P2 only for a publish-ready-only first V3. No external call or media generation was made in this audit. Evidence: `output/architecture-audit/full-agent-cycle-v1/` and `docs/full-agent-cycle-orchestration-audit-v1.md`.

### YouTube Research Live Validation V1

`YOUTUBE_API_KEY` was confirmed available without exposing its value. The one controlled live validation used `CONTENT_DISCOVERY`, query `Egypt travel`, `LAST_30_DAYS`, three results, and no pagination. It made exactly one `search.list` call and one batched `videos.list` call; all three results passed freshness and metadata validation. Current quota accounting is the official granular model: 1 search request in the `SEARCH_QUERIES` bucket plus 1 metadata read unit. YouTube Search and Metadata are now `IMPLEMENTED_AND_PROVEN`. A returned canonical URL was parsed and associated with its evidence; transcript remains `MISSING`, reference analysis remains `PARTIAL`, and multimodal analysis remains unavailable. Evidence is stored under `output/research-sources-v2/youtube-live-validation-v1/`. No generation or publishing provider was called.

### Post-Research Planner Synthesis V1

The production `produce` path now executes `planner-initial (INITIAL_CONTENT_PLAN) → research → planner-synthesis (POST_RESEARCH_SYNTHESIS) → writer`, followed by the pre-existing SEO/Brand/Reviewer/media stages. The initial plan contains intent and research questions without factual claims; the synthesis consumes the persisted initial plan plus `research_report` and emits the typed `evidence_backed_content_brief`. Writer production execution requires that brief and receives normalized research evidence, so the previous direct `Research → Writer` bypass is closed. Missing or malformed synthesis dependencies fail closed. This remediation intentionally does not change the remaining visual, TTS/timeline/Wan/composer, or final human-gate blockers. Evidence: `output/architecture-remediation/post-research-planner-synthesis-v1/`.

### Production Media Chain V1

The `produce` definition now contains the governed media stages: Director, TTS, measured-narration contract, Timeline, scene visual artifact, visual semantic review, visual technical QA, human visual gate, Wan authorization, scene video clip, and deterministic media composition. Thumbnail remains packaging-only and is no longer the production scene-video source. Provider calls were not executed. The chain is `PARTIAL`: stage contracts and ordering are present, while the approval-to-authorization artifact bridge and provider-backed scene execution remain fail-closed for the next implementation step. Evidence: `output/architecture-remediation/production-media-chain-v1/`.

### Production Media Chain Execution Bridge V2

A local `ProductionMediaChainBridge` now executes the media-stage contracts through injected capability boundaries: mocked TTS produces a measured `NarrationArtifact`, Timeline consumes and persists the exact duration, three scene images and visual-review/QA artifacts are persisted, human approval produces per-scene `WanAuthorization`, mocked Wan produces lineage-preserving clips, and mocked `media.compose` produces a `FinalMediaArtifact`. The bridge pauses before Wan without approvals and isolates scene identity. However, forensic audit confirms the default durable `ProductionAgentExecutor` has not yet registered each new workflow stage ID to this bridge; those stages still use deterministic fallback or fail-closed behavior in the default worker path. Therefore `PRODUCTION_MEDIA_CHAIN_EXECUTION_BRIDGE_V2=PARTIAL`, `P0_MEDIA_CHAIN=OPEN`, and no provider calls were made. Evidence: `output/architecture-remediation/production-media-chain-execution-bridge-v2/`.

### Visual Governance & Pre-Wan Authorization V1

The production `produce` definition now routes `thumbnail → visual-human-gate → video`. The gate is a durable Workflow Engine `GateStep` with checkpointed pause/resume behavior. Independently, the Video Agent execution boundary requires a matching `WanAuthorization` for the current workflow, scene, generated visual artifact identity, and human approval; missing, invalid, or stale authorization blocks before `video.generate`. Automated pixel-semantic review remains unavailable, so no automated visual PASS is claimed. Director scene-brief wiring, TTS/timeline/composer, and final publication approval remain separate blockers. No external or generation provider calls were made. Evidence: `output/architecture-remediation/visual-governance-pre-wan-v1/`.

### Production Media Chain Default Executor Registration V3

The canonical worker composition root (`apps/worker/src/cli.ts`) now constructs the default `ProductionAgentExecutor` with the existing `ProductionMediaChainBridge`. Required media workflow stages are registered through `executeStage` and no longer resolve through deterministic fallback; missing bridge/persistence fails closed as `EXECUTOR_NOT_CONFIGURED`. Focused default-executor tests cover Director, measured TTS (13,740 ms), Timeline reload, three scene-image calls, governance artifacts, per-scene authorization, video capability calls, and composition, all with injected mocks and zero external calls. Executor registration is `PASS`; final technical/product review and publication authorization remain unresolved, so `FULL_CONTENT_PIPELINE_V3` remains `BLOCKED`. Evidence: `output/architecture-remediation/production-media-chain-default-executor-registration-v3/`.

### Production Media Chain Durable Workflow Closure V5

The default executor now exposes explicit named registrations for each required media stage (`executeDirector`, `executeTts`, `executeTimeline`, `executeSceneImage`, visual governance, authorization, video, and composer) and retains fail-closed behavior when bridge/persistence is unavailable. A typed per-scene decision field was added to the normal workflow approval contract so scene decisions can be persisted without encoding authorization in free-form notes. The milestone remains `PARTIAL`: canonical direct `DirectorAgent`/`VideoAgent`/`MediaAgent` invocation and a complete Workflow Engine pause → persistence → runtime reconstruction → approval → resume proof were not established. No external calls were made. Evidence: `output/architecture-remediation/production-media-chain-durable-workflow-closure-v5/`.

### P0 Media Chain Closure Gate

The final closure gate is `BLOCKED`, not partial. The existing canonical agent contracts cannot drive the current `produce` chain without scoped contract corrections: `DirectorAgent.execute` requires `narrationDurationMs` and owns `timeline.plan` although `director` precedes `tts`; `VideoAgent` still requires a `thumbnail_report` rather than a governed `SceneVisualArtifact`; and `MediaAgent` accepts one video path plus one audio path rather than the persisted ordered scene clips required by the production composer stage. The bridge currently duplicates those three owners by generating a scene plan and calling `video.generate`/`media.compose` directly. Consequently canonical invocation and durable restart/resume acceptance tests cannot be truthfully constructed. `P0_MEDIA_CHAIN=OPEN`; external calls and cost remained zero. Evidence: `output/architecture-remediation/p0-media-chain-closure-gate/`.

## Strategy Council V2 — Canonical Milestone (2026-09-08)

**Workflow:** `workflow-council-v2-c84ea3d0-f02d-467a-b105-40b09f5f697d` / `corr-council-v2-68bdb2ae-fbd6-4527-b472-d8e6df3acf53` — **COMPLETED** through CEO (`AWAITING_OWNER_APPROVAL`). Detailed milestone: `docs/strategy-council-v2-milestone.md`.

**Why V2:** Single coherent business strategy before naming/channel/production. V1 fragmented Writer/SEO/Brand/Growth/Finance without shared evidence contract, lineage, or durable artifact. V2 adds `PRE_PUBLICATION_STRATEGY` with `strategyCouncilArtifactIds` lineage, strict `STRATEGY_COUNCIL_*_V2` schemas (`additionalProperties:false`, semantic validators), envelope + `stableFingerprint` (JSONB-safe) deep equality, and governed provider lifecycle.

**V1 Lost State:** `2026-09-05` live DB truncated by test harness (see `docs/incidents/2026-09-05-live-database-truncated-by-test.md`). Recovery re-anchored to surviving `Research 7a37fd46` / `Planner 85e5d793` under new workflow `c84ea3d0`; `TEST_DATABASE_URL` isolation and guards now prevent recurrence.

**Provider Evolution:** `Research`/`Planner` remain `AgentRouter`/`gpt-5.6-sol`; Writer/SEO/Brand/Growth/Finance/CEO now proven via first-class `openrouter` (`OPENAI_COMPATIBLE` `governed-openrouter-llm` at `https://openrouter.ai/api/v1/chat/completions` `stream true`). No global default change (`ROUTE_MUTATIONS 0`).

**OpenRouter Hardening:** Streaming SSE with `TextDecoder` leftover buffer, `CRLF` + `:` comment handling, `data: [DONE]` required, `choices[].delta.content` only, `reasoning`/`reasoning_details` isolated to `reasoningTokens`/`detailCount`, `gen-*` generationId capture, `actualModel` guard, `finish length` / `missing [DONE]` → `PROVIDER_RESPONSE_INCOMPLETE` (never semantic), truthful `provider openrouter` provenance via `governedRouteForLifecycle`, `stableFingerprint` for JSONB.

**Model Experiments:** GLM native failed; DeepSeek native compatible but no Council migration; Claude valid but blocked; Nemotron Super strong capability (`7673` bytes) but free-route instability (404/missing DONE); Gemma free 429 rate-limited; **Dots 3 Note Preview** (`dots-studio/dots-3-note-preview:free` `AtlasCloud` `512000` ctx `460800` max) succeeded for Writer (`4648` `reasoning 5530`), SEO (`6910` `2728`), Brand (`5632` `4233`), Growth v2 (`7676` `6559` after calibrated prompt), Finance (`5831` `6445`), CEO (`13063` `7655` at `16384`).

**Canonical Manifest (success / COMPLETED):**
- Reference `art-…-reference-content-evidence` (Bright Data `gd_lyclm20il4r5helnj` 2 Reels)
- Research `7a37fd46` `art-…-research-main-owner-authorized-v5-gpt56sol` (`agentrouter-openai` `gpt-5.6-sol`)
- Planner `85e5d793` `art-…-planner-synthesis-v2-owner-authorized-fresh-gpt56sol` (`agentrouter-openai` `gpt-5.6-sol`)
- Writer `a66bd20d` `art-…-writer-…-dots-3-note-canary-v1` (`openrouter` `dots` `AtlasCloud`)
- SEO `f2220f60` `art-…-seo-…-dots-3-note-canary-v1` (`openrouter` `dots` `AtlasCloud`)
- Brand `1c785340` `art-…-brand-…-dots-3-note-canary-v1` (`openrouter` `dots` `AtlasCloud`)
- Growth `dd8c23af` `art-…-growth-…-dots-3-note-canary-v2` (`openrouter` `dots` `AtlasCloud`) — after `guaranteed` remediation
- Finance `5d36e1b8` `art-…-finance-…-dots-3-note-canary-v1` (`openrouter` `dots` `AtlasCloud`)
- CEO `a9863d82` `art-…-ceo-…-dots-3-note-canary-v3` (`openrouter` `dots` `AtlasCloud` `16384` `AWAITING_OWNER_APPROVAL`) — synthesizes 7 specialists.

**CEO Strategy:** `PHASED_PORTFOLIO` — `Historical POV Narration` + `AI-Generated Fantasy Storytelling`, initial `Instagram Reels` pilot (Week 1), then `YouTube Shorts` 4-8w, `TikTok` 8-12w, `HYBRID` A/B faceless vs on-camera, `modular script/visual/voice/editing` reusable templates, `lowest practical cost` `free AI + open-source`, `reinvest after evidence`, monetization `sponsorship/affiliate/ad` as scenarios, risks 7 with mitigations, `AWAITING_OWNER_APPROVAL`.

**Owner Review:** `APPROVE_WITH_CHANGES` — quantitative gates (5% engagement, 10k views, $100) are **experimental pilot gates only**, not permanent truths; four videos/four weeks insufficient sample — stronger low-cost **Pilot Testing Framework** required before production. CEO artifact not mutated; changes recorded in docs/governance.

**Next Phases:** Bright audit (this doc §11) → final strategy closure → `BRAND_AND_CHANNEL_NAMING_V1` → channel/account architecture → Pilot Testing Framework → production → publishing → analytics → AMF Control Platform.

## Brand and Channel Naming V1 — Round 2 Sol-Only Recovery (2026-09-09)

`workflow-brand-and-channel-naming-v1-2d0e1859-a720-41d4-ba06-dc6c43b3d00d` / `corr-brand-and-channel-naming-v1-c3f5296e-b5bd-4744-bf3e-a3ecb7e9bc22` — `ROUND_2_MODE SOL_ONLY_RECOVERY` (Claude `claude-opus-4-8` `agentrouter-anthropic` `TEMPORARILY_UNAVAILABLE` `UND_ERR_CONNECT_TIMEOUT` at `180s`).

- **Sol strategist reused:** `7b6b8b3f-0ecb-4b5b-a849-a9bb1b38a0a6` (`agentrouter-openai` `gpt-5.6-sol` `success` `15` candidates, `CANDIDATES_REGENERATED 0`).
- **Merged:** Sol-only `15` unique (no Claude, `round1CollisionsRemoved` filtered).
- **Evaluation:** `BRAND_EVALUATOR_SOL` `gpt-5.6-sol` `agentrouter-openai` `16384` `stream true` — 2 batches `15/15` `EVALUATOR_INDEPENDENCE_TYPE SAME_MODEL_SEPARATE_ROLE` (not cross-model), `CROSS_EVALUATION NOT_AVAILABLE_DUE_TO_CLAUDE_UNAVAILABILITY`.
- **Linguistic:** `LINGUISTIC_CULTURAL_REVIEWER` via Sol — 2 batches `15/15` `PASS`.
- **Synthesis:** `naming_synthesizer` `gpt-5.6-sol` → `round2Top10` 10 + `crossRoundPool` 8 (all `NOT_REVIEWED`).
- **Workbook:** `artifacts/reviews/brand-and-channel-naming-v1-round-2-sol-only.xlsx` with `Round 2 Overview`, `Sol Candidates`, `Evaluations`, `Linguistic Review`, `Sol Top 10`, `Cross-Round Pool`, `Owner Review`, `Limitations` — transparently states `DUAL_MODEL_OBJECTIVE_COMPLETED NO`, `CLAUDE_OPUS_4_8_UNAVAILABLE`, `EVALUATION_INDEPENDENCE LIMITED`.
- **Provider calls this recovery:** `5` (`2` evaluation + `2` linguistic + `1` synthesis, all `gpt-5.6-sol`), `ACTUAL_PROVIDER_COST UNKNOWN` (free-tier), `EXTERNAL_WEB_SEARCHES 0`, `HIDDEN_REASONING 0`.
- **Owner status:** `OWNER_CROSS_ROUND_REVIEW_REQUIRED` (no `APPROVED`/`WINNER`).

Initial `round2-evaluation-sol-only-1` first attempt hit `UND_ERR_CONNECT_TIMEOUT` `TCP` at `180s` (transient, not prompt-size causality — same `17537` bytes succeeded on retry), correctly classified as `PROVIDER_EXECUTION_FAILED` (not semantic). Retry with identical payload succeeded, proving transient TCP connectivity, not model inference failure.

## Brand and Channel Naming V1 � External Verification V1 (2026-09-09)

**Workflow:** same workflow-brand-and-channel-naming-v1-2d0e1859-a720-41d4-ba06-dc6c43b3d00d � verification artifact rt-�-naming-verification-v1-7746ec0c-97b5-47e5-88f1-e83ed4d8f985 + workbook rtifacts/reviews/brand-and-channel-naming-v1-external-verification.xlsx (13 sheets).

**Candidates verified:** Aeon Morroway Remnara Veilward Nexora � OWNER_STATUS NOT_REVIEWED, no new names, no handle/domain purchase.

**Outcome:**
- Aeon � SEVERE (Aeon Co., Ltd. TYO:8267), DROP`n- Morroway � LOW (only small UK holding), ADVANCE`n- Remnara � LOW (no major exact), ADVANCE`n- Veilward � MEDIUM (board game + cybersecurity exact uses), HOLD`n- Nexora � SEVERE ($3BN distributor), DROP`n- **Finalists recommended:** Morroway, Remnara (2, not forced 3); FORMAL_LEGAL_CLEARANCE_COMPLETED NO; EXTERNAL_WEB_SEARCHES ~5 + 5 domain webfetch, BRIGHT_CALLS 0, MODEL_GENERATION_CALLS 0.

## Brand Architecture and Naming Hierarchy V1 (2026-09-09)

**Document:** docs/brand-architecture-and-naming-hierarchy-v1.md + rtifacts/brand-architecture-v1.json (BrandArchitectureV1 1.0 APPROVED).

**Architecture:** AI MEDIA FACTORY / AMF (Corporate Parent) ? Consumer Master Brand (Morroway/Remnara pending) ? Channel identities (consistent) + Content Series + Future Brands + AMF Control Platform (internal). LEGAL_ENTITY NOT_FINALIZED, AMF = Corporate Parent LIGHT endorsement, DISPLAY_NAME_POLICY = Master Brand everywhere, HANDLE_POLICY Tier 1 @brand with forbidden @brand_2026 etc., AMF Control Platform internal only.

**Finalists:** Both MORROWAY and REMNARA placed identically; no final brand selected. BRAND_ARCHITECTURE_AND_NAMING_HIERARCHY_V1 = PASS MULTI_BRAND_SCALABILITY PASS CHANNEL_NAMING_CONFLICT_PREVENTION PASS LEGAL_CORPORATE_AND_CONSUMER_SEPARATION PASS.

## Final Brand Decision V1 � Deterministic Decision Support (2026-09-09)

**Artifact:** rt-workflow-brand-and-channel-naming-v1-2d0e1859-a720-41d4-ba06-dc6c43b3d00d-final-brand-decision-v1-002cf538 (inal_brand_decision) + rtifacts/reviews/brand-and-channel-naming-v1-final-decision.xlsx (10 sheets).

**Method:** Deterministic after single gpt-5.6-sol transport failure (33ab7514); no new model call. **Scores:** MORROWAY 86.4 vs REMNARA 79.1. **Recommendation:** MORROWAY (MEDIUM). **Owner status:** OWNER_FINAL_BRAND_DECISION_REQUIRED. No final brand selected.

**Provider calls this continuation:**  . No destructive writes, no commits.


## Owner Final Approval � Morroway Consumer Master Brand (Naming V1 CLOSED)

**OWNER_FINAL_DECISION = APPROVED** (OWNER_DIRECT_DECISION). **FINAL_CONSUMER_MASTER_BRAND = MORROWAY**. **NAMING_V1_STATUS = CLOSED**. Corporate parent AI Media Factory / AMF unchanged. Legal entity NOT_FINALIZED, formal trademark clearance NOT_COMPLETED, handles/domains NOT_SELECTED. Remnara = RESERVE_FINALIST. Decision artifact rt-�-naming-owner-final-decision-1706c838 + workbook rtifacts/reviews/brand-and-channel-naming-v1-final-decision.xlsx (Owner Decision sheet). Next: MORROWAY_BRAND_IDENTITY_V1.

## Morroway Brand Identity V1 � Owner Review (2026-09-09)

**Artifact:** rt-�-morroway-brand-identity-v1-07668c48 (morroway_brand_identity, execution  7668c48, openrouter / dots-studio/dots-3-note-preview:free TEMPORARY_PHASE_ONLY, HTTP 200 finish stop, visible 14145, cost 0). **Workbook:** rtifacts/reviews/morroway-brand-identity-v1.xlsx (17 sheets). **Doc:** docs/morroway-brand-identity-v1.md.

**Essence:** A journey through time and imagination. **Visual:** Threshold / Memory / Cinematic Worlds ? recommended Threshold primary. **Colors (exploratory):** Abyssal / Ember / Aurora ? Abyssal. **Owner status:** OWNER_BRAND_IDENTITY_REVIEW_REQUIRED � no logo/palette/typography/tagline approved. Next: OWNER_BRAND_IDENTITY_REVIEW.

## Morroway Brand Identity � Owner Decision Pack (READY_FOR_OWNER_DECISION)

Canonical artifact rt-�-morroway-brand-identity-v1-07668c48 reviewed read-only (zero model calls). Workbook rtifacts/reviews/morroway-brand-identity-v1.xlsx now 22 sheets (+5 review). Pack: Threshold primary + Cinematic Worlds secondary; Abyssal (#0B0F1A, #1E2A3A, #4A5568) recommended exploratory; typography direction only (FONT_FAMILIES_SELECTED = NO); 3 logo routes (Threshold Arc recommended, Abstract M challenger, Layered Dimension). All four owner decisions PENDING. Next: OWNER_APPROVES_VISUAL_TERRITORY_COLOR_TYPOGRAPHY_LOGO_CONCEPT.
## Morroway Identity Direction Approvals + Visual Production Prep (PREPARATION_ONLY)
Directions APPROVED_DIRECTION: Threshold primary + Cinematic Worlds secondary; Abyssal (final HEX PENDING, accent exploration allowed); typography system (families PENDING); logo Threshold Arc primary + Abstract M challenger (max 6 concepts, final PENDING_VISUAL_REVIEW). Artifact art-morroway-identity-direction-approval-7508edab + spec docs/morroway-visual-identity-production-v1.md. Recommended next: MORROWAY_VISUAL_REFERENCE_RESEARCH_V1. No assets produced.
## Morroway Visual Reference Research V1 (COMPLETE)
Research COMPLETE: 16 references, evidence + brief artifacts (c8cf8ed5, openrouter/dots, cost 0), workbook 14 sheets, doc docs/morroway-visual-reference-research-v1.md. Guardrails + Route A/B briefs + color/typo/motion synthesis ready. Next: MORROWAY_VISUAL_IDENTITY_PRODUCTION_V1. No artwork produced.
## Morroway Logo Exploration V1 (PARTIAL � 5 valid concepts)
Logo symbol exploration PARTIAL: 5/6 valid (A1, A2, B1, B2, B3) via self-hosted-image FLUX.1-dev-fp8, 8 submissions. A3 eliminated after 2 policy-capped attempts (sunrise, then plus/cross). Artifact art-morroway-logo-exploration-v1-0862b41f + review package + workbook. Owner review next: OWNER_VISUAL_REVIEW_OF_A1_A2_B1_B2_B3. No winner.
## Morroway Manual Prompt Experiment V1 (EXPERIMENTAL, NON-CANONICAL)
Owner-directed 4-route test (MM-01 Hidden M, MM-02 Split Horizon, MM-03 Folded Passage, MM-04 Wordmark-led) via self-hosted-image FLUX.1-dev-fp8, 5 calls. All 4 valid (MM-02 replaced once for scenery attempt0). Top-2 refinement: MM-03, MM-01. Artifact art-manual-morroway-experiment-43ceb531 + review package + workbook + doc docs/morroway-manual-prompt-experiment-v1.md. No final approval.
## Morroway Approved Brand Assets V1 (OWNER_APPROVED)
Registered 5 owner-approved masters + 7 deterministic derivatives under artifacts/brand/morroway/v1/ with manifest, governance artifact art-brand-morroway-assets-v1-392be50a, and guidelines docs/morroway-brand-assets-v1.md. Tagline-in-lockup noted, tagline approval PENDING. Next: MORROWAY_FINAL_PALETTE_AND_TYPOGRAPHY_V1.
## Morroway Master Asset Cleanup V1 (PARTIAL)
Clean masters: logo-primary-clean, wordmark, symbol (verified). Key visuals need manual edit (v2 delogo ghosted, discarded). Vector redraw pending with spec. Record art-brand-morroway-cleanup-v1-9f647751. Next: MORROWAY_FINAL_PALETTE_AND_TYPOGRAPHY_V1 or MANUAL_VECTOR_REDRAW.
## Morroway Vector Redraw Preparation (PREPARED)
Spec docs/morroway-vector-redraw-v1.md prepared: 5 SVG deliverables, fidelity HIGH, wordmark WAIT_FOR_TYPOGRAPHY (typeface unknown), icon-02 optical variant possible, mono/dark-light/small-size validation defined, no auto-trace. Next: OWNER_OR_DESIGNER_PERFORMS_MANUAL_VECTOR_REDRAW then FINAL_PALETTE_AND_TYPOGRAPHY.
## Morroway Final Palette and Typography V1 (RECOMMENDED_PENDING_OWNER_APPROVAL)
Recommended palette (Abyssal #0B0F1A, Deep #1E2A3A, White #EDEBE6 measured, Silver #9E9E9E derived-pending, Amber #C99867 measured-fringe; contrasts 16.06/7.37/7.14 calculated). Typography: Outfit (display) + IBM Plex Sans (body) + Plex Sans Arabic (primary) / Cairo (alternate), all OFL-1.1 verified; wordmark FONT_PLUS_CUSTOMIZATION. Doc docs/morroway-final-palette-and-typography-v1.md + artifact art-brand-morroway-palette-typography-v1-5c082ec8. Next: OWNER_PALETTE_AND_TYPOGRAPHY_REVIEW.
## Morroway Palette/Typography Approval + Vector Execution Result
OWNER_APPROVED palette (6 roles incl. Cinematic Black permitted neutral) + typography (Outfit/Plex/Plex-Arabic/Cairo-alt) + wordmark approach + Arabic Latin-primary. Approval artifact art-brand-morroway-palette-approval-b5db9a15. Vector execution NOT performed (no fonts/tools/potrace; all 5 MANUAL_REQUIRED, WORDMARK_VECTOR_REQUIRES_MANUAL_DESIGN_TOOL=YES). Next: OWNER_COMPLETES_REMAINING_MANUAL_VECTOR_FILES.
## Morroway Social and Channel Brand Kit V1 (READY_FOR_PRODUCTION_USE, raster)
Kit ready under artifacts/brand/morroway/v1/channel-kit/ (avatars, YouTube banner 2560x1440, watermarks, title plate, end cards, guides) + governance artifact art-brand-morroway-channel-kit-v1-e1f7dc95 + doc docs/morroway-social-and-channel-brand-kit-v1.md. Sourced from 2026-09-10 owner placements (supersession of old masters pending owner). One discarded screen-blend banner recorded honestly. Vectors still MANUAL_PENDING. Next: MORROWAY_PILOT_CONTENT_SYSTEM_V1.

## Morroway Vector Supersession and Channel Kit Reconciliation V1 (PASS)

Validated path-only SVG masters supersede raster technical masters for the primary logo, wordmark, symbol, Icon 01, and Icon 02; `VECTOR_MASTER_STATUS=PRODUCTION_READY`. Raster references are preserved. The primary-logo descender clipping was corrected; vector-derived avatars, watermarks, and end cards were refreshed; banner/title-card compositions were retained. Evidence: `artifacts/brand/morroway/v1/manifests/morroway-vector-supersession-and-channel-kit-reconciliation-v1.json`.
