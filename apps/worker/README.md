# Worker

## Purpose

The worker is the background and media processing app for the AI Media Factory. It executes long running and resource intensive jobs asynchronously, keeping the control plane responsive. It consumes jobs enqueued by `apps/api` and `apps/orchestrator` and reports results back through the shared datastores.

## Responsibilities

- Execute background jobs pulled from the shared task queue.
- Render video, including composition, transitions, and encoding.
- Generate images from prompts and model outputs.
- Run FFmpeg processing for transcoding, trimming, and format conversion.
- Handle scheduling of deferred and recurring jobs.
- Report job progress, results, and failures for observability.

## Technology

- Python as the primary runtime.
- A task queue such as Celery or RQ, backed by Redis, for job distribution.
- FFmpeg for media transcoding and rendering.

## Job Types

- Video rendering and encoding jobs.
- Image generation jobs.
- FFmpeg transcode and processing jobs.
- Scheduled and recurring maintenance jobs.

## Scaling Model

Workers are stateless and scale horizontally. Additional worker processes or containers can be added to increase throughput, with the shared queue distributing jobs across the pool. Queues can be partitioned by job type so that heavy rendering work does not block lighter tasks.

## Interfaces

The worker does not expose a public HTTP surface. It consumes jobs enqueued by `apps/api` and `apps/orchestrator` from the shared task queue, and it reads and writes state through the shared datastores. Media primitives are provided by `packages/media`.
