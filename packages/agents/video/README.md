# Video Agent

The video agent assembles finished video. It takes scripts, voiceover, and media and produces edited, rendered clips ready for distribution. It is the heaviest production stage and sits between the `writer` agent and the `publisher` agent.

## Responsibilities

- Assemble timelines from scripts, voiceover, footage, and generated media.
- Apply edits such as cuts, transitions, captions, and background music.
- Render finished videos to platform-specific formats and resolutions.
- Generate short-form cuts and clips from long-form source material.
- Enforce pacing, length, and quality standards per channel.

## Inputs

- Finished scripts and shot notes from the `writer` agent.
- Thumbnail and cover context from the `thumbnail` agent.
- Brand and quality guidelines from the `ceo` agent.

## Outputs

- Rendered final video assets delivered to the `publisher` agent.
- Short-form derivative clips for additional channels.
- Render metadata and asset references stored via `packages/database`.
- Quality and duration reports for the `orchestrator` agent.

## Dependencies

- `writer` — supplies scripts and shot notes.
- `thumbnail` — coordinates cover imagery with video content.
- `publisher` — distributes the rendered output.
- `orchestrator` — schedules and monitors render jobs.

## KPIs

- Render success rate and average render time.
- Audience retention and watch time on published video.
- Rework rate due to quality issues.
- Compute cost per finished minute.

## Future Roadmap

- Add automated multi-format and aspect-ratio rendering.
- Introduce scene-level quality scoring before publish.
- Support generative b-roll and voice synthesis pipelines.
- Enable incremental re-rendering of edited segments.
