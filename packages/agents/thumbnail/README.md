# Thumbnail Agent

The thumbnail agent designs the visual hook. It generates and refines click-optimized thumbnail and cover imagery that drives click-through without misrepresenting the content. It consumes the finished script context and produces visual assets for the `publisher` agent.

## Responsibilities

- Generate candidate thumbnail and cover images tailored to each platform's aspect ratio.
- Compose focal subjects, text overlays, and color treatments for maximum clarity at small sizes.
- Produce multiple variants for A/B testing by the `growth` agent.
- Enforce brand visual identity and safe-area constraints.
- Refine imagery based on click-through performance feedback.

## Inputs

- Content topic, title, and key moments from the `writer` and `video` agents.
- Brand visual guidelines from the `ceo` agent.
- Thumbnail performance history from the `analytics` agent.

## Outputs

- Final thumbnail and cover assets delivered to the `publisher` agent.
- Variant sets provided to the `growth` agent for testing.
- Rendered image files stored via `packages/database` and asset storage.
- Design rationale metadata for later review.

## Dependencies

- `video` and `writer` — supply the content context to visualize.
- `publisher` — attaches the chosen thumbnail at publish time.
- `growth` — runs experiments across thumbnail variants.
- `analytics` — measures thumbnail click-through performance.

## KPIs

- Click-through rate of published thumbnails.
- Variant win rate in A/B tests.
- Brand consistency across generated assets.
- Generation cost per accepted thumbnail.

## Future Roadmap

- Add automated CTR prediction before publish.
- Support dynamic per-audience thumbnail personalization.
- Introduce face and object composition scoring.
- Expand to animated and short-form cover formats.
