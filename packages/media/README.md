# Media

## Purpose

The media package provides shared media primitives for the AI Media Factory. It exposes FFmpeg wrappers, image, video, and audio types, codec definitions, and rendering utilities used by the worker and by agents so that media handling is consistent across the system.

## Responsibilities

- Wrap FFmpeg operations behind a consistent interface.
- Define shared image, video, and audio types.
- Provide codec definitions and format helpers.
- Offer rendering and composition utilities.
- Standardize media metadata handling.

## Capabilities

- Transcoding and format conversion.
- Trimming, concatenation, and composition.
- Frame extraction and thumbnail generation.
- Audio extraction and mixing.
- Media probing and metadata inspection.

## Consumers

- `apps/worker` for media processing and rendering jobs.
- `packages/agents` for media aware agent capabilities.

## Roadmap

- Hardware accelerated encoding support.
- Streaming and chunked processing.
- Expanded codec coverage.
- Rendering preset library.
