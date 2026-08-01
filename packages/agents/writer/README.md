# Writer Agent

The writer agent turns research briefs into finished written content. It produces scripts, captions, and long-form copy tuned to each platform's format and audience. It sits between `research` upstream and the `video`, `seo`, and `publisher` agents downstream.

## Responsibilities

- Draft video scripts, voiceover copy, and shot notes from research briefs.
- Write platform-specific captions, descriptions, and long-form articles.
- Adapt tone, length, and structure to each target channel and audience.
- Incorporate editorial guidelines and brand voice from the `ceo` agent.
- Revise content in response to `seo` and quality feedback.

## Inputs

- Structured research briefs from the `research` agent.
- Editorial guidelines and brand voice from the `ceo` agent.
- Keyword and metadata guidance from the `seo` agent.

## Outputs

- Finished scripts and shot notes delivered to the `video` agent.
- Captions and descriptions passed to the `publisher` agent.
- Long-form articles for SEO content channels.
- Draft variants for A/B testing by the `growth` agent.

## Dependencies

- `research` — supplies the briefs the writer works from.
- `seo` — provides keyword targets and reviews copy.
- `video` and `publisher` — consume the writer's output.
- `packages/prompts` — shared prompt building blocks for generation.

## KPIs

- Content approval rate on first draft.
- Audience engagement on published copy such as watch time and read-through.
- Turnaround time from brief to finished draft.
- Adherence to brand voice and editorial guidelines.

## Future Roadmap

- Add automated self-editing and style-consistency passes.
- Support multi-format generation from a single brief.
- Introduce localization and translation workflows.
- Build tighter feedback loops with `analytics` for data-driven revisions.
