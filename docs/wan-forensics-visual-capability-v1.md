# Wan Forensics — Visual Capability Benchmark V1

Date: 2026-08-30

## Finding

`WAN_STILL_IMAGE_GENERATION=NOT_PROVEN`. No still-image call was made and no experimental endpoint was used.

The production endpoint configured in the repository is `ry49lc45y50ldy`. Its local production workflow is `experimental/wan2.2-i2v-v1/workflow_api.json` (inspected, not executed):

- node `260` is `LoadImage` and loads `00050-907847214.png`;
- node `481` is `WanFirstLastFrameToVideo` and receives `start_image` from node `847`;
- node `323` is `VAEDecode` for the video latent;
- node `277` is `VHS_VideoCombine` with `format: video/h264-mp4`, `frame_rate: 32`, and `save_output: true`.

This is an image-conditioned video / first-frame workflow. It is not evidence of a still-image output mode. The workflow has no node, output, or parameter named `front_camera`; the literal string is absent from the checked repository workflow and source files. Therefore the claim `front_camera=1` is not accepted as a Wan still-generation setting. It may be a UI/node-specific camera-control or first-frame setting from another workflow, but that interpretation is unverified here.

Official grounding:

- [ComfyUI WanFirstLastFrameToVideo node](https://docs.comfy.org/built-in-nodes/WanFirstLastFrameToVideo) documents start/end image conditioning and a latent output for video generation.
- [ComfyUI official Wan2.2 workflow](https://docs.comfy.org/tutorials/video/wan/wan2_2) instructs users to upload an input image and run the Wan video workflow.
- [ComfyUI official Wan FLF2V workflow](https://docs.comfy.org/tutorials/video/wan/wan-flf) describes first/last-frame video generation and says the output is a video sequence.
- [RunPod Serverless API](https://docs.runpod.io/serverless/endpoints/run) documents endpoint job execution and status polling; it does not establish that an arbitrary endpoint supports still-image generation.

Existing local evidence proves production Wan I2V can produce MP4 from a source image (`output/wan-single-scene-single-scene-1787942858498.mp4` and adjacent evidence), but that historical evidence does not prove T2I/still support.

## Budget and safety

The V1 runner uses a new isolated output directory, hard-coded production endpoint allowlisting, `pollRetries=0`, and no automatic retries. It never calls `o54nlat1w78954`; it never calls FLUX, VoiceTuT, publishing, or AgentRouter content generation. Wan still calls are fixed at zero because the support condition is not proven.
